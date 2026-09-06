import type { Provider, ProviderFilters, SortMode } from '../types/provider';
import type { SearchDoc } from './search';
import { scoreDoc } from './search';
import { distanceKm, DEFAULT_RADIUS_KM } from './geo';

export const defaultFilters: ProviderFilters = {
    search: '',
    specialty: [],
    country: '',
    minRating: 0,
    insurances: [],
    languages: [],
    bookableOnly: false,
    verifiedOnly: false,
    withPricing: false,
    maxPriceMxn: null,
    sort: 'relevance',
    postalCode: '',
    radiusKm: DEFAULT_RADIUS_KM,
};

/**
 * How many filters are narrowing the list, ignoring the free-text search.
 *
 * Drives the count on the "Filters (2)" button and the badge on the mobile
 * sheet — with the rail closed, this is the only signal that results are being
 * filtered at all.
 */
export function countActiveFilters(filters: ProviderFilters): number {
    let n = 0;
    n += filters.specialty.length;
    n += filters.insurances.length;
    n += filters.languages.length;
    if (filters.country) n++;
    if (filters.minRating > 0) n++;
    if (filters.postalCode) n++;
    if (filters.bookableOnly) n++;
    if (filters.verifiedOnly) n++;
    if (filters.withPricing) n++;
    return n;
}

export interface FilterContext {
    /** Folded haystack per provider id, from buildSearchIndex(). */
    index: Map<string, SearchDoc>;
    /** Tokenised query. Empty means "no text query", not "match nothing". */
    terms: string[];
    /** Centre of the searched postal code, or null when we don't know the code. */
    centre: { lat: number; lng: number } | null;
}

/**
 * Everything except the free-text query.
 *
 * Split out from `applyFilters` because the facet counts need to ask "how many
 * would survive if this one axis were released?" — see facets.ts.
 */
export function matchesFilters(
    p: Provider,
    filters: ProviderFilters,
    ctx: FilterContext,
    /** Axis to ignore, so a facet can count its own options without excluding them. */
    skip?: keyof ProviderFilters,
): boolean {
    if (filters.postalCode && skip !== 'postalCode') {
        // An unknown code yields no centre; returning false here is deliberate,
        // so the UI can say "no such code" rather than silently ignoring it.
        if (!ctx.centre) return false;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
        if (distanceKm(ctx.centre.lat, ctx.centre.lng, p.lat, p.lng) > filters.radiusKm) return false;
    }

    if (skip !== 'specialty' && filters.specialty.length) {
        if (!filters.specialty.some((s) => p.specialty.includes(s))) return false;
    }

    if (skip !== 'country' && filters.country && p.country !== filters.country) return false;

    if (skip !== 'minRating' && p.rating < filters.minRating) return false;

    if (skip !== 'insurances' && filters.insurances.length) {
        const held = p.insurances ?? [];
        if (!filters.insurances.some((i) => held.includes(i))) return false;
    }

    if (skip !== 'languages' && filters.languages.length) {
        const held = p.languages ?? [];
        if (!filters.languages.some((l) => held.includes(l))) return false;
    }

    if (skip !== 'bookableOnly' && filters.bookableOnly && !p.bookingUrl) return false;

    if (skip !== 'verifiedOnly' && filters.verifiedOnly && !p.verified) return false;

    if (skip !== 'withPricing' && filters.withPricing) {
        if (p.priceFromMxn == null) return false;
        if (filters.maxPriceMxn != null && p.priceFromMxn > filters.maxPriceMxn) return false;
    }

    return true;
}

/**
 * Which order actually applies.
 *
 * "Relevance" is meaningless without a query, so an empty search box falls
 * through to whatever signal is present: nearest when the user gave a location,
 * best-rated otherwise. Choosing here rather than in the UI keeps the sort
 * dropdown honest — it never displays an order that isn't in effect.
 */
function effectiveSort(filters: ProviderFilters, ctx: FilterContext): SortMode {
    if (filters.sort !== 'relevance') return filters.sort;
    if (ctx.terms.length) return 'relevance';
    return ctx.centre ? 'distance' : 'rating';
}

/** Filter, score and sort in one pass. Returns a new array; inputs are untouched. */
export function applyFilters(
    providers: readonly Provider[],
    filters: ProviderFilters,
    ctx: FilterContext,
): Provider[] {
    const scores = new Map<string, number>();
    const distances = new Map<string, number>();
    const sort = effectiveSort(filters, ctx);

    const kept: Provider[] = [];

    for (const p of providers) {
        if (!matchesFilters(p, filters, ctx)) continue;

        if (ctx.terms.length) {
            const doc = ctx.index.get(p.id);
            const score = doc ? scoreDoc(doc, ctx.terms) : 0;
            if (score === 0) continue;
            scores.set(p.id, score);
        }

        if (ctx.centre) {
            distances.set(p.id, distanceKm(ctx.centre.lat, ctx.centre.lng, p.lat, p.lng));
        }

        kept.push(p);
    }

    const byDistance = (a: Provider, b: Provider) =>
        (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity);

    kept.sort((a, b) => {
        // Promoted listings hold the top tier in every order. That is the deal
        // they paid for, and it is why it sits above the sort choice.
        if (a.promoted !== b.promoted) return a.promoted ? -1 : 1;

        switch (sort) {
            case 'relevance': {
                const d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
                if (Math.abs(d) > 0.001) return d;
                break;
            }
            case 'reviews': {
                const d = (b.reviewCount || 0) - (a.reviewCount || 0);
                if (d !== 0) return d;
                break;
            }
            case 'distance': {
                const d = byDistance(a, b);
                // Sub-10m differences are noise from averaged postal centroids.
                if (Math.abs(d) > 0.01) return d;
                break;
            }
            case 'price': {
                // Unpriced providers sort last rather than as free.
                const pa = a.priceFromMxn ?? Infinity;
                const pb = b.priceFromMxn ?? Infinity;
                if (pa !== pb) return pa - pb;
                break;
            }
            case 'rating':
                break;
        }

        // Rating is the universal tiebreak, then review volume so a lone
        // 5.0 review doesn't outrank a 4.8 with three hundred.
        const byRating = (b.rating || 0) - (a.rating || 0);
        if (byRating !== 0) return byRating;
        return (b.reviewCount || 0) - (a.reviewCount || 0);
    });

    return kept;
}
