import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MapBox, Provider, ProviderFilters, Specialty, SortMode } from '../types/provider';
import { SpecialtyLabels } from '../types/provider';
import { supabase } from '../lib/supabase';
import { mockProviders } from '../data/providers';
import { normalizeProvider } from '../utils/normalizeProvider';
import { readProviderCache, writeProviderCache } from '../utils/providerCache';
import { DEFAULT_RADIUS_KM } from '../utils/geo';
import { buildSearchIndex, tokenize } from '../utils/search';
import { buildVocabulary, buildFacets } from '../utils/facets';
import { applyFilters, defaultFilters, type FilterContext } from '../utils/filters';
import { priorMean } from '../utils/rating';
import { resolvePostal, type PostalHit } from '../utils/postalGeocode';

const SPECIALTY_KEYS = new Set(Object.keys(SpecialtyLabels));
const SORT_MODES = new Set<SortMode>(['relevance', 'rating', 'reviews', 'distance', 'price']);

// ── Provider fetch ──────────────────────────────────────────────────────────

type RawProviderRow = Record<string, unknown>;

/** Distinguishes "no client configured" from a real fetch error, above. */
class NoSupabaseClientError extends Error {}

const PAGE_SIZE = 1000;

/**
 * The full directory, paged from Supabase.
 *
 * Page 0 asks for an exact count (`{ count: 'exact' }`), which lets every
 * remaining page be requested concurrently with `Promise.all` instead of one
 * after another — each `select=*` page measured ~0.9s TTFB, and five of them
 * sequentially was most of the ~3s it took the old code to get the last byte
 * of the directory. `.order('id')` is added to every page (page 0 included)
 * so the ranges stay stable across concurrent requests: without a stable
 * order Postgres is free to return a different row order per request, and
 * parallel `.range()` calls would then silently overlap or skip rows.
 *
 * If Supabase ever declines to report a count (some proxies/mocks omit it),
 * this falls back to the original sequential loop rather than guess a total.
 */
async function loadProvidersFromNetwork(): Promise<RawProviderRow[]> {
    if (!supabase) {
        throw new NoSupabaseClientError('Supabase client not initialized');
    }

    const first = await supabase
        .from('providers')
        .select('*', { count: 'exact' })
        .eq('status', 'live')
        .order('id')
        .range(0, PAGE_SIZE - 1);

    if (first.error) throw first.error;

    const data: RawProviderRow[] = [...(first.data ?? [])];
    const count = first.count;
    const firstLen = first.data?.length ?? 0;

    if (count == null) {
        // No count back from the server — page sequentially, as before.
        for (let from = PAGE_SIZE; ; from += PAGE_SIZE) {
            const page = await supabase
                .from('providers')
                .select('*')
                .eq('status', 'live')
                .order('id')
                .range(from, from + PAGE_SIZE - 1);
            if (page.error) throw page.error;
            data.push(...(page.data ?? []));
            if (!page.data || page.data.length < PAGE_SIZE) break;
        }
    } else if (firstLen === PAGE_SIZE && count > PAGE_SIZE) {
        const starts: number[] = [];
        for (let from = PAGE_SIZE; from < count; from += PAGE_SIZE) starts.push(from);

        const pages = await Promise.all(
            starts.map((from) =>
                supabase!
                    .from('providers')
                    .select('*')
                    .eq('status', 'live')
                    .order('id')
                    .range(from, from + PAGE_SIZE - 1),
            ),
        );

        for (const page of pages) {
            if (page.error) throw page.error;
            data.push(...(page.data ?? []));
        }
    }

    return data;
}

/**
 * Memoized at module scope so React StrictMode's dev-only double-mount
 * awaits one in-flight request instead of firing the whole paginated fetch
 * twice. A failed fetch clears the memo so a later mount (or a manual
 * retry) can try again rather than replay the same rejection forever.
 */
let providersPromise: Promise<RawProviderRow[]> | null = null;

function fetchProvidersOnce(): Promise<RawProviderRow[]> {
    if (!providersPromise) {
        providersPromise = loadProvidersFromNetwork().catch((err) => {
            providersPromise = null;
            throw err;
        });
    }
    return providersPromise;
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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        // Flips once the network settles (success or failure), so a slower
        // cache read can't clobber fresh data — or a mock fallback — that
        // already landed.
        let networkSettled = false;

        // Stale-while-revalidate: an IndexedDB cache read races the network.
        // If it wins and has usable rows, paint immediately and drop the
        // loading state; the network response (a few hundred ms to a few
        // seconds behind it) replaces it for real once it arrives, and never
        // the other way around.
        readProviderCache().then((cached) => {
            if (!mounted || networkSettled || !cached || cached.length === 0) return;
            setAllProviders(cached.map(normalizeProvider));
            setLoading(false);
        });

        fetchProvidersOnce()
            .then((data) => {
                networkSettled = true;
                if (!mounted) return;
                if (data.length > 0) {
                    setAllProviders(data.map(normalizeProvider));
                    // Cache the raw rows (pre-normalize), never mock data.
                    void writeProviderCache(data);
                } else {
                    console.warn('[Supabase] No providers found in DB, using mock data.');
                    setAllProviders(mockProviders);
                }
            })
            .catch((err) => {
                networkSettled = true;
                if (err instanceof NoSupabaseClientError) {
                    console.warn('[Supabase] client not initialized. Falling back to mock providers.');
                } else {
                    console.error('[Supabase] Error fetching providers:', err);
                }
                if (mounted) setAllProviders(mockProviders);
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

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

    /**
     * A code we hold resolves instantly from our own rows; anything else goes
     * to the geocoder.
     *
     * Keeping the derived centroid in front is not just a cost saving — for a
     * code we have providers in, the average of those providers is a better
     * centre for a radius search than the postal district's geometric middle.
     * The geocoder exists for the other 99.9% of codes on both sides of the
     * border, which is every code a patient is likely to type.
     */
    // Only the geocoder's answer lives in state (set asynchronously). The
    // "no lookup needed" and "still resolving" states are derived from the
    // current filters below, rather than written from inside the effect —
    // which also means a stale answer for a previous code/country can never
    // be mistaken for the current one.
    const [resolvedPostal, setResolvedPostal] = useState<{
        code: string;
        country: ProviderFilters['country'];
        hits: PostalHit[];
    } | null>(null);

    const localCentre = useMemo(
        () => (filters.postalCode ? postalCentroids.get(filters.postalCode) ?? null : null),
        [filters.postalCode, postalCentroids],
    );

    const needsRemote = Boolean(filters.postalCode) && !localCentre;

    useEffect(() => {
        if (!needsRemote) return;
        const code = filters.postalCode;
        const country = filters.country;

        let live = true;
        resolvePostal(code, country).then((hits) => {
            if (live) setResolvedPostal({ code, country, hits });
        });
        return () => { live = false; };
    }, [filters.postalCode, filters.country, needsRemote]);

    const remote = useMemo((): {
        code: string;
        state: 'resolving' | 'resolved';
        hits: PostalHit[];
    } | null => {
        if (!needsRemote) return null;
        const code = filters.postalCode;
        if (resolvedPostal && resolvedPostal.code === code && resolvedPostal.country === filters.country) {
            return { code, state: 'resolved', hits: resolvedPostal.hits };
        }
        return { code, state: 'resolving', hits: [] };
    }, [needsRemote, filters.postalCode, filters.country, resolvedPostal]);

    /**
     * The code means two places and the user has not said which side they are
     * on. Offered as a choice rather than guessed — picking the wrong country
     * silently returns an empty page for a code that plainly exists.
     */
    const postalChoices = useMemo(
        () => (remote?.state === 'resolved' && remote.hits.length > 1 ? remote.hits : []),
        [remote],
    );

    /** True while a code is in flight, so the UI can say so instead of "0 results". */
    const postalPending = remote?.state === 'resolving';

    /** Null when no code is active, and also when the code resolves nowhere. */
    const centre = useMemo(() => {
        if (!filters.postalCode) return null;
        if (localCentre) return localCentre;
        if (remote?.state !== 'resolved' || remote.code !== filters.postalCode) return null;
        // With two candidates and no stated side, filtering to either one would
        // be a guess. Hold the results until the user picks.
        if (remote.hits.length !== 1) return null;
        return { lat: remote.hits[0].lat, lng: remote.hits[0].lng };
    }, [filters.postalCode, localCentre, remote]);

    /**
     * The directory's own mean rating, computed once per load. It is the prior
     * the confidence-weighted sort shrinks toward, so it has to describe this
     * directory rather than a constant someone guessed.
     */
    const prior = useMemo(() => priorMean(allProviders), [allProviders]);

    const ctx: FilterContext = useMemo(
        () => ({ index: searchIndex, terms: tokenize(filters.search), centre, prior }),
        [searchIndex, filters.search, centre, prior],
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
        () => ({ index: searchIndex, terms: [], centre, prior }),
        [searchIndex, centre, prior],
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
        loading,
        /** Lets the UI tell "no providers near 32300" apart from "no such code". */
        knownPostalCodes: postalCentroids,
        /** True while a typed code is being geocoded. */
        postalPending,
        /** Two countries claim this code; the user has to say which. */
        postalChoices,
        /** Distance from the searched postal centre, for the result cards. */
        centre,
    };
}
