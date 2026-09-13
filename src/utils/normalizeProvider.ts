import type { Provider } from '../types/provider';

/**
 * PostgreSQL stores unquoted column names as all-lowercase.
 * Supabase therefore returns e.g. `googleplaceid` instead of `googlePlaceId`.
 * This function normalises any row coming from the DB back to the camelCase
 * fields our Provider interface expects.
 */
export function normalizeProvider(row: any): Provider {
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
        featuredRank:  row.featuredRank  ?? row.featuredrank  ?? undefined,
        tier:          row.tier ?? 'basic',
        licensed:      row.licensed ?? false,
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
