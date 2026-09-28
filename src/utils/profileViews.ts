/**
 * PLACEHOLDER "profile views" counter.
 *
 * Every listing needs a profile-views figure to show publicly, but no view
 * tracking is wired up yet. This manufactures a plausible-looking integer in
 * [100, 200] deterministically from the provider id, so a listing shows the
 * same number on every render, every refresh, every device — never a random
 * number that would flicker or, worse, look like it was making something up
 * on the fly (which it is, until real data exists).
 *
 * Replace this with real measured traffic — `providers.clicks`, or an
 * analytics query — the moment tracking exists. This is intentionally a
 * single small function so that swap is a one-line change at each call site.
 *
 * Not to be confused with `estimatedViews.ts`, which models a *sales* number
 * for the clinic's own dashboard from real demand signals (reviews, tier,
 * photo). This is a much dumber placeholder meant for a public-facing card
 * and carries no such modelling — it is not measuring anything, just filling
 * a slot until something can.
 */

/** FNV-1a. Same small approach as estimatedViews.ts, reimplemented here so
 *  this file has no dependency on that one (which must stay unmodified). */
function hash(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Deterministic placeholder profile-view count, always in [100, 200]. */
export function profileViews(p: { id: string }): number {
    return 100 + (hash(p.id) % 101);
}
