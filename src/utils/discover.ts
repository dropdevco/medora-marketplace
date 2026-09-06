/**
 * The browse rows shown before anyone has searched.
 *
 * Airbnb's home page never asks "where do you want to go?" and then shows you a
 * map — it shows you rows of places, because a picture is a better invitation
 * than an empty viewport. These rows are the same idea: each one is a *preview
 * of a search*, so clicking through hands the user a real, filtered result set
 * rather than a curated dead end.
 *
 * Every row is derived from the loaded directory, so a row can never advertise
 * a search that returns nothing — a candidate with too few providers behind it
 * is simply dropped.
 */

import type { Provider, ProviderFilters } from '../types/provider';
import { portraitUrl } from './images';

export interface DiscoverRow {
    id: string;
    /** i18n key for the heading. */
    titleKey: string;
    /** The exact search this row previews. "See all" applies it verbatim. */
    filters: Partial<ProviderFilters>;
    providers: Provider[];
}

/** Below this a row looks like a mistake rather than a category. */
const MIN_ROW = 6;
/** Beyond this nobody scrolls, and every extra tile is an image request. */
const ROW_SIZE = 14;

/**
 * Rating alone puts a single five-star review above a 4.8 with three hundred.
 * Pulling each score toward the directory mean, weighted by how many reviews
 * back it, is what stops the browse rows filling with one-review clinics.
 */
const PRIOR = 25;
const MEAN = 4.4;

function confidence(p: Provider): number {
    const n = p.reviewCount || 0;
    return ((p.rating || 0) * n + MEAN * PRIOR) / (n + PRIOR);
}

/**
 * Portraits first. A row of eight photos and six monograms reads as broken;
 * a row that front-loads the photos reads as curated, and the monograms that
 * follow look deliberate.
 */
function browseOrder(a: Provider, b: Provider): number {
    const pa = portraitUrl(a.imageUrl) ? 1 : 0;
    const pb = portraitUrl(b.imageUrl) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (a.promoted !== b.promoted) return a.promoted ? -1 : 1;
    return confidence(b) - confidence(a);
}

interface Candidate {
    id: string;
    titleKey: string;
    filters: Partial<ProviderFilters>;
    match: (p: Provider) => boolean;
}

/**
 * Ordered by how much of the directory they speak for, so the first screen a
 * new visitor sees is the border's two biggest questions — a dentist in
 * Juárez, a doctor in El Paso — rather than a niche.
 */
const CANDIDATES: Candidate[] = [
    {
        id: 'dentists-juarez',
        titleKey: 'discover.dentistsJuarez',
        filters: { specialty: ['dentist'], country: 'MX' },
        match: (p) => p.country === 'MX' && p.specialty.includes('dentist'),
    },
    {
        id: 'primary-elpaso',
        titleKey: 'discover.primaryElPaso',
        filters: { specialty: ['general'], country: 'US' },
        match: (p) => p.country === 'US' && p.specialty.includes('general'),
    },
    {
        id: 'published-prices',
        titleKey: 'discover.publishedPrices',
        filters: { withPricing: true },
        match: (p) => p.priceFromMxn != null,
    },
    {
        id: 'books-online',
        titleKey: 'discover.booksOnline',
        filters: { bookableOnly: true },
        match: (p) => Boolean(p.bookingUrl),
    },
    {
        id: 'womens-health',
        titleKey: 'discover.womensHealth',
        filters: { specialty: ['obgyn'] },
        match: (p) => p.specialty.includes('obgyn'),
    },
    {
        id: 'mental-health',
        titleKey: 'discover.mentalHealth',
        filters: { specialty: ['mental_health'] },
        match: (p) => p.specialty.includes('mental_health'),
    },
    {
        id: 'pediatrics',
        titleKey: 'discover.pediatrics',
        filters: { specialty: ['pediatrics'] },
        match: (p) => p.specialty.includes('pediatrics'),
    },
    {
        id: 'aesthetic-juarez',
        titleKey: 'discover.aestheticJuarez',
        filters: { specialty: ['plastic_surgery'], country: 'MX' },
        match: (p) => p.country === 'MX' && p.specialty.includes('plastic_surgery'),
    },
];

export function buildDiscoverRows(providers: readonly Provider[]): DiscoverRow[] {
    if (providers.length === 0) return [];

    const rows: DiscoverRow[] = [];
    for (const c of CANDIDATES) {
        const hits = providers.filter(c.match);
        if (hits.length < MIN_ROW) continue;
        rows.push({
            id: c.id,
            titleKey: c.titleKey,
            filters: c.filters,
            providers: hits.sort(browseOrder).slice(0, ROW_SIZE),
        });
    }
    return rows;
}
