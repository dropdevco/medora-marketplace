import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MapBox, Provider, ProviderFilters, Specialty, SortMode } from '../types/provider';
import { SpecialtyLabels } from '../types/provider';
import { supabase } from '../lib/supabase';
import { mockProviders } from '../data/providers';
import { DEFAULT_RADIUS_KM } from '../utils/geo';
import { buildSearchIndex, tokenize } from '../utils/search';
import { buildVocabulary, buildFacets } from '../utils/facets';
import { applyFilters, defaultFilters, type FilterContext } from '../utils/filters';

const SPECIALTY_KEYS = new Set(Object.keys(SpecialtyLabels));
const SORT_MODES = new Set<SortMode>(['relevance', 'rating', 'reviews', 'distance', 'price']);

/**
 * PostgreSQL stores unquoted column names as all-lowercase.
 * Supabase therefore returns e.g. `googleplaceid` instead of `googlePlaceId`.
 * This function normalises any row coming from the DB back to the camelCase
 * fields our Provider interface expects.
 */
function normalizeProvider(row: any): Provider {
    return {
        ...row,
        // camelCase fields the seed script wrote as camelCase keys
        // (Postgres lowercases them on the way in, so we need to restore them)
        googlePlaceId: row.googlePlaceId ?? row.googleplaceid ?? undefined,
        doctoraliaId:  row.doctoraliaId  ?? row.doctoraliaid  ?? undefined,
        reviewCount:   row.reviewCount   ?? row.reviewcount   ?? 0,
        imageUrl:      row.imageUrl      ?? row.imageurl      ?? undefined,
        bookingUrl:    row.bookingUrl    ?? row.bookingurl    ?? undefined,
        postalCode:    row.postalCode    ?? row.postalcode    ?? undefined,
        services:      row.services      ?? [],
        priceFromMxn:  row.priceFromMxn  ?? row.pricefrommxn  ?? undefined,
        // Trimmed here, once, so the insurance facet groups "GNP " with "GNP"
        // instead of offering both as separate options.
        insurances: (row.insurances ?? [])
            .map((s: unknown) => String(s).trim())
            .filter(Boolean),
        languages: (row.languages ?? [])
            .map((s: unknown) => String(s).trim().toLowerCase())
            .filter(Boolean),
    };
}

// ── URL ⇄ filters ───────────────────────────────────────────────────────────
//
// The URL is the single source of truth for the filter state. Keeping it there
// rather than in a useState means every search is shareable and bookmarkable,
// and the back button works, without a second copy to keep in sync.

function parseFilters(params: URLSearchParams): ProviderFilters {
    const num = (key: string, fallback: number) => {
        const v = Number(params.get(key));
        return Number.isFinite(v) && params.get(key) !== null ? v : fallback;
    };
    const sort = params.get('sort') as SortMode | null;

    return {
        search: params.get('q') ?? '',
        specialty: params.getAll('spec').filter((s) => SPECIALTY_KEYS.has(s)) as Specialty[],
        country: params.get('country') === 'MX' || params.get('country') === 'US'
            ? (params.get('country') as 'MX' | 'US')
            : '',
        minRating: num('rating', 0),
        insurances: params.getAll('ins'),
        languages: params.getAll('lang'),
        bookableOnly: params.get('book') === '1',
        verifiedOnly: params.get('verified') === '1',
        withPricing: params.get('priced') === '1',
        maxPriceMxn: params.has('max') ? num('max', 0) : null,
        sort: sort && SORT_MODES.has(sort) ? sort : 'relevance',
        postalCode: params.get('near') ?? '',
        radiusKm: num('r', DEFAULT_RADIUS_KM),
        mapArea: parseArea(params.get('area')),
    };
}

/** How many decimals survive into the URL. 4dp ≈ 11 m, finer than any pixel. */
const AREA_DP = 4;

/**
 * `area=south,west,north,east` — one param, four decimal degrees, in the same
 * order Google hands back a LatLngBounds (sw, ne).
 *
 * Parsed strictly: anything that is not exactly four finite numbers forming a
 * non-degenerate box is treated as absent. A hand-edited or truncated param
 * must never throw, and must never survive as a box that filters the whole
 * directory away — an empty result page with no visible cause is worse than
 * silently ignoring the param.
 */
function parseArea(raw: string | null): MapBox | null {
    if (!raw) return null;
    const parts = raw.split(',');
    if (parts.length !== 4) return null;

    const [south, west, north, east] = parts.map(Number);
    if (![south, west, north, east].every(Number.isFinite)) return null;
    if (south < -90 || north > 90 || west < -180 || east > 180) return null;
    // Strict: a zero-height or zero-width box, and any inverted box (which is
    // what a wrapped or scrambled param looks like), matches nothing.
    if (south >= north || west >= east) return null;

    return { north, south, east, west };
}

function serializeArea(b: MapBox): string {
    const r = (n: number) => Number(n.toFixed(AREA_DP));
    // Rounded on the way out, not on the way in: un-rounded floats churn the
    // URL on every sub-pixel camera settle, which defeats any identity check
    // built on the serialised string and floods the history stack.
    return [r(b.south), r(b.west), r(b.north), r(b.east)].join(',');
}

function serializeFilters(f: ProviderFilters): URLSearchParams {
    const p = new URLSearchParams();
    if (f.search) p.set('q', f.search);
    for (const s of f.specialty) p.append('spec', s);
    for (const i of f.insurances) p.append('ins', i);
    for (const l of f.languages) p.append('lang', l);
    if (f.country) p.set('country', f.country);
    if (f.minRating > 0) p.set('rating', String(f.minRating));
    if (f.bookableOnly) p.set('book', '1');
    if (f.verifiedOnly) p.set('verified', '1');
    if (f.withPricing) p.set('priced', '1');
    if (f.withPricing && f.maxPriceMxn != null) p.set('max', String(f.maxPriceMxn));
    if (f.sort !== 'relevance') p.set('sort', f.sort);
    if (f.postalCode) {
        p.set('near', f.postalCode);
        if (f.radiusKm !== DEFAULT_RADIUS_KM) p.set('r', String(f.radiusKm));
    }
    if (f.mapArea) p.set('area', serializeArea(f.mapArea));
    return p;
}

export function useProviders() {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const [allProviders, setAllProviders] = useState<Provider[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        async function fetchProviders() {
            if (!supabase) {
                console.warn('[Supabase] client not initialized. Falling back to mock providers.');
                if (mounted) setAllProviders(mockProviders);
                setLoading(false);
                return;
            }

            try {
                // Supabase caps a single select at 1000 rows. The directory is
                // larger than that, so page through or the map silently shows a
                // fraction of the providers.
                const PAGE_SIZE = 1000;
                const data: Record<string, unknown>[] = [];
                let error: { message: string } | null = null;

                for (let from = 0; ; from += PAGE_SIZE) {
                    const page = await supabase
                        .from('providers')
                        .select('*')
                        .range(from, from + PAGE_SIZE - 1);

                    if (page.error) {
                        error = page.error;
                        break;
                    }
                    data.push(...(page.data ?? []));
                    if (!page.data || page.data.length < PAGE_SIZE) break;
                }

                if (error) {
                    console.error('[Supabase] Error fetching providers:', error);
                    if (mounted) setAllProviders(mockProviders);
                    return;
                }

                if (mounted && data) {
                    if (data.length > 0) {
                        setAllProviders(data.map(normalizeProvider));
                    } else {
                        console.warn('[Supabase] No providers found in DB, using mock data.');
                        setAllProviders(mockProviders);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch providers:', err);
                if (mounted) setAllProviders(mockProviders);
            } finally {
                if (mounted) setLoading(false);
            }
        }

        fetchProviders();

        return () => {
            mounted = false;
        };
    }, []);

    const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

    const setFilters = useCallback(
        (next: ProviderFilters, replace: boolean) => {
            setSearchParams(serializeFilters(next), { replace });
        },
        [setSearchParams],
    );

    const updateFilter = useCallback(
        <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => {
            // Typing replaces the history entry; picking a filter pushes one, so
            // Back steps through deliberate choices rather than through keystrokes.
            setFilters({ ...filters, [key]: value }, key === 'search');
        },
        [filters, setFilters],
    );

    /** Several axes at once, as one history entry — e.g. a postal search. */
    const patchFilters = useCallback(
        (patch: Partial<ProviderFilters>, replace = false) => {
            setFilters({ ...filters, ...patch }, replace);
        },
        [filters, setFilters],
    );

    const resetFilters = useCallback(() => setFilters(defaultFilters, false), [setFilters]);

    /**
     * The folded haystack. Rebuilt only when the directory or the UI language
     * changes — not per keystroke, which is what makes scoring 4k rows on every
     * character viable.
     */
    const labelOf = useCallback(
        (s: Specialty) => t(`specialties.${s}`, { defaultValue: s }),
        [t],
    );

    const searchIndex = useMemo(
        () => buildSearchIndex(allProviders, labelOf),
        [allProviders, labelOf],
    );

    const vocabulary = useMemo(
        () => buildVocabulary(allProviders, labelOf),
        [allProviders, labelOf],
    );

    /**
     * Centre point of each postal code, averaged from the providers that sit in
     * it. Derived from data we already hold, so "near this ZIP" costs no
     * geocoding call and stays correct as the directory grows.
     */
    const postalCentroids = useMemo(() => {
        const sums = new Map<string, { lat: number; lng: number; n: number }>();
        for (const p of allProviders) {
            if (!p.postalCode || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
            const acc = sums.get(p.postalCode) ?? { lat: 0, lng: 0, n: 0 };
            acc.lat += p.lat;
            acc.lng += p.lng;
            acc.n += 1;
            sums.set(p.postalCode, acc);
        }

        const centroids = new Map<string, { lat: number; lng: number }>();
        for (const [code, acc] of sums) {
            centroids.set(code, { lat: acc.lat / acc.n, lng: acc.lng / acc.n });
        }
        return centroids;
    }, [allProviders]);

    /** Null when no code is active, and also when the code matches nothing we hold. */
    const centre = useMemo(
        () => (filters.postalCode ? postalCentroids.get(filters.postalCode) ?? null : null),
        [filters.postalCode, postalCentroids],
    );

    const ctx: FilterContext = useMemo(
        () => ({ index: searchIndex, terms: tokenize(filters.search), centre }),
        [searchIndex, filters.search, centre],
    );

    const filtered = useMemo(
        () => applyFilters(allProviders, filters, ctx),
        [allProviders, filters, ctx],
    );

    /**
     * Facet counts describe the *filters*, not the text query — they answer
     * "how many would I get if I ticked this box", which is a question about
     * the other axes. Excluding the query from the dependency list also keeps
     * this 4k-row pass off the per-keystroke path.
     */
    const facetCtx: FilterContext = useMemo(
        () => ({ index: searchIndex, terms: [], centre }),
        [searchIndex, centre],
    );

    /**
     * The map viewport is released for the whole facet pass, permanently.
     *
     * buildFacets calls matchesFilters once per axis, so with `mapArea` still
     * applied every chip count would become viewport-relative — and
     * FilterChipRow picks its four specialty shortcuts from `facets.specialty`
     * sorted by count, so those chips would reshuffle under the cursor as the
     * user pans. Chip counts should describe the query, not the camera.
     *
     * Done by nulling the axis in the filters handed to buildFacets rather than
     * by threading an extra skip through facets.ts; matchesFilters' widened
     * `skip` supports either, and this keeps the facet module untouched.
     */
    const facetFilters = useMemo(() => ({ ...filters, mapArea: null }), [filters]);

    const facets = useMemo(
        () => buildFacets(allProviders, facetFilters, facetCtx),
        [allProviders, facetFilters, facetCtx],
    );

    return {
        providers: filtered,
        allProviders,
        filters,
        updateFilter,
        patchFilters,
        resetFilters,
        facets,
        vocabulary,
        selectedProvider,
        setSelectedProvider,
        loading,
        /** Lets the UI tell "no providers near 32300" apart from "no such code". */
        knownPostalCodes: postalCentroids,
        /** Distance from the searched postal centre, for the result cards. */
        centre,
    };
}
