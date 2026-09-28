/**
 * Portrait handling for provider cards.
 *
 * The scrape filled `imageUrl` for two thirds of the directory, but 1,673 of
 * those rows point at the same Doctoralia Open Graph banner — the image the
 * source site serves when a profile has no photo at all. Treating it as a
 * portrait would wallpaper the whole browse view with one logo, which is worse
 * than showing no photo, so it is filtered out here rather than in each card.
 */

const PLACEHOLDER = /open-graph|\/og\.png/i;

/** A usable portrait URL, or undefined when there is nothing worth showing. */
export function portraitUrl(raw?: string): string | undefined {
    if (!raw) return undefined;
    if (PLACEHOLDER.test(raw)) return undefined;
    // Part of the directory was scraped with protocol-relative URLs, which
    // resolve fine in the browser but break any absolute-URL assumption.
    return raw.startsWith('//') ? `https:${raw}` : raw;
}

/**
 * The three portrait sizes used across the app: small tiles in a grid,
 * cards, and the single large hero shown on a provider's own page.
 */
export type PortraitSize = 'thumb' | 'tile' | 'large';

/**
 * Target pixel width per size — also used as the Google Places `maxWidthPx`
 * / `w` query param for the server photo proxy (see src/utils/placePhoto.ts),
 * so a Google-sourced photo and a Doctoralia one are requested at comparable
 * sizes for the same slot.
 */
export const PORTRAIT_WIDTHS: Record<PortraitSize, number> = {
    thumb: 160,
    tile: 400,
    large: 800,
};

// Doctoralia serves the same S3 asset at a few fixed suffixes; matching this
// exactly (not just "contains _large") avoids rewriting an unrelated file
// that merely has "_large" somewhere else in its name.
const S3_LARGE_SUFFIX = /_large\.(jpe?g|png|webp)$/i;

/**
 * A portrait URL sized for where it'll actually be shown.
 *
 * Doctoralia's S3-hosted photos (`pixel-p3.s3...amazonaws.com/.../*_large.jpg`)
 * come in a `_large` (full size) and `_small` (320px, ~13KB vs ~38KB)
 * variant of the same asset — swapping the suffix costs nothing and a tile
 * or thumb never needs the full-size image. Doctoralia's own
 * `..._220_square.jpg` URLs are already a fixed 220px and are left alone.
 * Any other host (including Google's proxy, which isn't handled here) is
 * left unchanged.
 */
export function portraitUrlSized(raw: string | undefined, size: PortraitSize): string | undefined {
    const url = portraitUrl(raw);
    if (!url) return undefined;
    if (size === 'large') return url;
    if (!S3_LARGE_SUFFIX.test(url)) return url;
    return url.replace(S3_LARGE_SUFFIX, (_match, ext: string) => `_small.${ext}`);
}

/**
 * The palette a provider's monogram is drawn from.
 *
 * Six curated tints, not the full colour wheel. The avatar is the most
 * repeated element in the product — 4,000+ of them scroll past on a
 * single search — so an unbounded hue lets the content out-colour the
 * brand. These six sit in a narrow band and are held at low saturation
 * by --mono-s1/--mono-s2, so a row of them reads as tinted paper rather
 * than as confetti.
 *
 * The gradient's second stop is this hue + 40deg (see .ms-mono), so the
 * set is chosen to stay coherent under that shift.
 */
const MONO_HUES = [158, 205, 252, 32, 282, 120];

/**
 * A stable tint per provider, for the gradient shown in place of a portrait.
 *
 * Derived from the id so a given clinic keeps its colour across reloads and
 * across the browse rows it appears in — a card that changes colour when you
 * scroll past it twice reads as a different clinic.
 */
export function hueOf(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 4096;
    return MONO_HUES[h % MONO_HUES.length];
}
