/**
 * Prices are stored in MXN only (`Provider.priceFromMxn`,
 * `ProviderService.priceMxn`) — Doctoralia MX never quotes anything else.
 * English-language visitors read in USD, so every price needs a display-time
 * conversion. This is a fixed, approximate rate, not a live FX feed: it
 * matches the numbers already hand-picked on the pricing page (roughly $50
 * USD to $850 MXN). Update it here only — this is the single source of truth
 * for MXN -> USD across the app.
 */
export const MXN_PER_USD = 17;

export type CurrencyCode = 'USD' | 'MXN';

/** True for any English variant ('en', 'en-US', ...). Spanish is everything else. */
export function isEnglish(lang: string): boolean {
    return lang.toLowerCase().startsWith('en');
}

export function currencyFor(lang: string): CurrencyCode {
    return isEnglish(lang) ? 'USD' : 'MXN';
}

/**
 * Convert an MXN amount to whole USD. Rounds to the nearest dollar, but never
 * rounds a real, non-zero price down to $0 — a $1 minimum reads as "cheap",
 * not as "free", which a fabricated zero would.
 */
export function mxnToUsd(mxn: number): number {
    if (mxn <= 0) return 0;
    return Math.max(1, Math.round(mxn / MXN_PER_USD));
}

/**
 * Format a price stored in MXN for display in the site's current language,
 * currency code included. English renders the USD conversion ("$88 USD");
 * Spanish renders the MXN amount exactly as it has always rendered
 * ("$1,500 MXN"). The locale used for digit grouping is fixed per currency
 * (rather than left to the runtime's default locale) so the output is
 * identical on every device — 'en-US' grouping is what today's plain
 * `toLocaleString()` call already produced for these amounts.
 */
export function formatPrice(mxn: number, lang: string): string {
    if (isEnglish(lang)) {
        return `$${mxnToUsd(mxn).toLocaleString('en-US')} USD`;
    }
    return `$${mxn.toLocaleString('en-US')} MXN`;
}
