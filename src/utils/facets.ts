/**
 * Facet counts and the autocomplete vocabulary, both derived from the loaded
 * directory rather than from a config file — the options can never drift from
 * the data that way.
 *
 * Every count is computed with its own axis released, which is what makes the
 * numbers useful: "Dentist (412)" means 412 results *if you tick this*, not 0
 * because dentist isn't currently selected.
 */

import type { Provider, ProviderFilters, Specialty } from '../types/provider';
import { fold, synonymsOf } from './search';
import type { FilterContext } from './filters';
import { matchesFilters } from './filters';

export interface FacetCounts {
    specialty: Map<Specialty, number>;
    insurance: Map<string, number>;
    language: Map<string, number>;
    /** Results that would remain if only this toggle were added. */
    bookable: number;
    verified: number;
    withPricing: number;
}

export function buildFacets(
    providers: readonly Provider[],
    filters: ProviderFilters,
    ctx: FilterContext,
): FacetCounts {
    const specialty = new Map<Specialty, number>();
    const insurance = new Map<string, number>();
    const language = new Map<string, number>();
    let bookable = 0;
    let verified = 0;
    let withPricing = 0;

    const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

    for (const p of providers) {
        if (matchesFilters(p, filters, ctx, 'specialty')) {
            for (const s of p.specialty) bump(specialty, s);
        }
        if (matchesFilters(p, filters, ctx, 'insurances')) {
            for (const i of p.insurances ?? []) bump(insurance, i);
        }
        if (matchesFilters(p, filters, ctx, 'languages')) {
            for (const l of p.languages ?? []) bump(language, l);
        }
        if (matchesFilters(p, filters, ctx, 'bookableOnly') && p.bookingUrl) bookable++;
        if (matchesFilters(p, filters, ctx, 'verifiedOnly') && p.verified) verified++;
        if (matchesFilters(p, filters, ctx, 'withPricing') && p.priceFromMxn != null) withPricing++;
    }

    return { specialty, insurance, language, bookable, verified, withPricing };
}

/** Insurers most worth offering first, since there are far too many to list. */
export function topInsurers(counts: Map<string, number>, limit: number): string[] {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([name]) => name);
}

// ── Autocomplete ────────────────────────────────────────────────────────────

export type SuggestionKind = 'specialty' | 'service' | 'city' | 'postal' | 'provider' | 'insurance';

export interface Suggestion {
    kind: SuggestionKind;
    /** What the user reads. */
    label: string;
    /** The filter value or provider id this resolves to. */
    value: string;
    /** How many providers sit behind it, when that is meaningful. */
    count?: number;
}

/** Vocabulary the suggester draws on. Built once per [providers, language]. */
export interface SuggestVocabulary {
    specialties: { key: Specialty; label: string; folded: string; count: number }[];
    services: { label: string; folded: string; count: number }[];
    /** `country` is the side of the border the city sits on — a city
     *  suggestion narrows by country, since that is the axis we filter on. */
    cities: { label: string; folded: string; count: number; country: 'MX' | 'US' }[];
    postals: { label: string; count: number }[];
    insurers: { label: string; folded: string; count: number }[];
    providers: { id: string; label: string; folded: string }[];
}

/** How many distinct service names to keep. The long tail is one-offs. */
const MAX_SERVICE_TERMS = 400;

export function buildVocabulary(
    providers: readonly Provider[],
    labelOf: (s: Specialty) => string,
): SuggestVocabulary {
    const specialtyCounts = new Map<Specialty, number>();
    const serviceCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();
    const cityCountry = new Map<string, 'MX' | 'US'>();
    const postalCounts = new Map<string, number>();
    const insurerCounts = new Map<string, number>();
    const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

    for (const p of providers) {
        for (const s of p.specialty) bump(specialtyCounts, s);
        for (const s of p.services ?? []) if (s.name) bump(serviceCounts, s.name.trim());
        for (const i of p.insurances ?? []) bump(insurerCounts, i);
        if (p.city) {
            bump(cityCounts, p.city);
            if (!cityCountry.has(p.city)) cityCountry.set(p.city, p.country);
        }
        if (p.postalCode) bump(postalCounts, p.postalCode);
    }

    const ranked = <T>(m: Map<T, number>) =>
        [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

    return {
        specialties: ranked(specialtyCounts).map(([key, count]) => {
            const label = labelOf(key);
            // The haystack is the visible label plus every synonym, pipe-joined.
            // '|' is a non-word character, so a synonym still ranks as a
            // word-start hit rather than as a mid-word one.
            const folded = [fold(label), ...synonymsOf(key)].join('|');
            return { key, label, folded, count };
        }),
        services: ranked(serviceCounts)
            .slice(0, MAX_SERVICE_TERMS)
            .map(([label, count]) => ({ label, folded: fold(label), count })),
        cities: ranked(cityCounts).map(([label, count]) => ({
            label, folded: fold(label), count, country: cityCountry.get(label) ?? 'MX',
        })),
        postals: ranked(postalCounts).map(([label, count]) => ({ label, count })),
        insurers: ranked(insurerCounts).map(([label, count]) => ({ label, folded: fold(label), count })),
        providers: providers.map((p) => ({ id: p.id, label: p.name, folded: fold(p.name ?? '') })),
    };
}

/** Word-start beats mid-word, so "orto" offers Ortodoncia before Deportología. */
function rank(folded: string, needle: string): number {
    const at = folded.indexOf(needle);
    if (at === -1) return -1;
    if (at === 0) return 2;
    return /[a-z0-9]/.test(folded[at - 1]) ? 0 : 1;
}

const LIMITS: Record<SuggestionKind, number> = {
    specialty: 3,
    service: 3,
    city: 2,
    postal: 2,
    insurance: 2,
    provider: 4,
};

/**
 * What to offer under the search box.
 *
 * Concept suggestions (specialty, city, insurer, postal) resolve to *filters*
 * rather than to more text in the box — picking "Dentist" should narrow the
 * directory, not run a fresh string match for the word. That distinction is
 * most of what separates a search engine from a search field.
 */
export function suggest(vocab: SuggestVocabulary, query: string, max = 8): Suggestion[] {
    const needle = fold(query.trim());
    if (needle.length < 2) return [];

    const buckets: Record<SuggestionKind, Suggestion[]> = {
        specialty: [], service: [], city: [], postal: [], insurance: [], provider: [],
    };
    const scored: { s: Suggestion; r: number; c: number }[] = [];

    // Kind-specific caps are applied after ranking, so everything competes on
    // match quality first and only then gets trimmed per category.
    const consider = (folded: string, s: Suggestion, count: number) => {
        const r = rank(folded, needle);
        if (r < 0) return;
        scored.push({ s, r, c: count });
    };

    for (const s of vocab.specialties) {
        consider(s.folded, { kind: 'specialty', label: s.label, value: s.key, count: s.count }, s.count);
    }
    for (const s of vocab.services) {
        consider(s.folded, { kind: 'service', label: s.label, value: s.label, count: s.count }, s.count);
    }
    for (const c of vocab.cities) {
        consider(c.folded, { kind: 'city', label: c.label, value: c.country, count: c.count }, c.count);
    }
    for (const i of vocab.insurers) {
        consider(i.folded, { kind: 'insurance', label: i.label, value: i.label, count: i.count }, i.count);
    }
    if (/^\d{2,5}$/.test(needle)) {
        for (const p of vocab.postals) {
            if (p.label.startsWith(needle)) {
                scored.push({ s: { kind: 'postal', label: p.label, value: p.label, count: p.count }, r: 2, c: p.count });
            }
        }
    }
    for (const p of vocab.providers) {
        consider(p.folded, { kind: 'provider', label: p.label, value: p.id }, 0);
    }

    scored.sort((a, b) => b.r - a.r || b.c - a.c || a.s.label.length - b.s.label.length);

    // Cap each kind so one prolific category can't crowd out the rest.
    const out: Suggestion[] = [];
    for (const { s } of scored) {
        const bucket = buckets[s.kind];
        if (bucket.length >= LIMITS[s.kind]) continue;
        bucket.push(s);
        out.push(s);
        if (out.length >= max) break;
    }
    return out;
}
