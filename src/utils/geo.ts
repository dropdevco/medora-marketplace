/**
 * Geographic helpers for the browser bundle.
 *
 * A haversine already exists in scripts/doctoralia/load.ts, but that module
 * reads .env and constructs a Supabase service-role client at import time —
 * importing it here would drag server credentials into the client bundle.
 */

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two WGS84 points. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * A five-digit MX postal code or US ZIP.
 *
 * ZIP+4 is accepted and truncated: the geocoder resolves the five-digit
 * prefix, and the extra four digits address a delivery route rather than a
 * place, so they carry nothing a radius search can use. Rejecting them
 * outright only meant that pasting an address's ZIP verbatim searched it as a
 * clinic name and returned nothing.
 */
export const POSTAL_PATTERN = /^(\d{5})(?:-\d{4})?$/;

export const isPostalQuery = (value: string) => POSTAL_PATTERN.test(value.trim());

/** The five digits a postal query resolves against, or '' if it is not one. */
export const normalizePostal = (value: string) =>
    POSTAL_PATTERN.exec(value.trim())?.[1] ?? '';

/** Radius options offered on the "near this code" chip, in kilometres. */
export const RADIUS_OPTIONS = [2, 5, 10, 25] as const;
export const DEFAULT_RADIUS_KM = 5;
