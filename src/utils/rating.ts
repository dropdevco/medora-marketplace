import type { Provider } from '../types/provider';

/**
 * What a star rating in this directory actually means, and how to rank by it.
 *
 * Two facts about the data drive everything here.
 *
 * First, 1,849 of the 2,717 Doctoralia-sourced providers have no rating at
 * all. Ingest stored that as `rating: 0`, which the cards rendered as a
 * literal "0.0 (0)" — a directory where nearly half the listings appear to
 * have been rated one star out of five by people who never rated them. An
 * absent rating is not a bad rating, and it has to render as its own thing.
 *
 * Second, Doctoralia publishes ratings quantised to whole stars, and 94% of
 * the ones it does publish are exactly 5.0. There is no conversion bug — this
 * is what the source says. But sorting on it puts a 5.0 with two reviews above
 * a 4.7 with eight hundred, which is why the top of every list was a wall of
 * identical five-star entries nobody could tell apart. Ranking therefore uses
 * a confidence-weighted score rather than the raw value.
 */

/**
 * How many reviews it takes before a provider's own average outweighs the
 * directory average. At 25, a provider with 25 reviews sits halfway between
 * the two; one with 800 is essentially its own number; one with two barely
 * moves off the middle. Low enough that a genuinely well-reviewed clinic is
 * not held back, high enough that a single five-star review buys nothing.
 */
const CONFIDENCE_WEIGHT = 25;

/** Used when the caller has no directory to average. Close to the real mean. */
export const FALLBACK_PRIOR = 4.7;

/** A rating we hold, or null when the provider has never been rated. */
export function ratingOf(p: Provider): number | null {
    if (!Number.isFinite(p.rating) || p.rating <= 0) return null;
    if (!Number.isFinite(p.reviewCount) || p.reviewCount <= 0) return null;
    return p.rating;
}

export const isRated = (p: Provider): boolean => ratingOf(p) !== null;

/** Mean rating across everything that has one. The prior for the shrunk score. */
export function priorMean(providers: Provider[]): number {
    let sum = 0;
    let n = 0;
    for (const p of providers) {
        const r = ratingOf(p);
        if (r !== null) { sum += r; n += 1; }
    }
    return n > 0 ? sum / n : FALLBACK_PRIOR;
}

/**
 * The rating, pulled toward the directory average in proportion to how little
 * evidence stands behind it.
 *
 * Unrated providers score below every rated one rather than at zero: "we don't
 * know" belongs after "we know it's mediocre" in a ranking, but it is not the
 * same claim, and anchoring it at 0 would also have made it the worst possible
 * result for a `minRating` filter it should simply be excluded from.
 */
export function shrunkScore(p: Provider, prior = FALLBACK_PRIOR): number {
    const r = ratingOf(p);
    if (r === null) return -1;
    return (CONFIDENCE_WEIGHT * prior + r * p.reviewCount) / (CONFIDENCE_WEIGHT + p.reviewCount);
}

/**
 * Where a rating came from, so "5.0" is legible rather than merely impressive.
 *
 * Doctoralia's number is an average of patient opinions on a whole-star scale
 * and Google's is a decimal average of Google reviews. Printing both as a bare
 * "5.0" invites the reader to compare two things that are not the same
 * measurement — which is exactly the doubt the review raised.
 */
export type RatingSource = 'doctoralia' | 'google' | 'other';

export function ratingSource(p: Provider): RatingSource {
    if (p.source === 'doctoralia') return 'doctoralia';
    if (p.source === 'google') return 'google';
    return 'other';
}
