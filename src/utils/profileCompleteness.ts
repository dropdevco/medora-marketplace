import type { Provider } from '../types/provider';

export type CompletenessKey =
    | 'avatar' | 'description' | 'contact' | 'languages' | 'socials' | 'photos';

export interface CompletenessTarget {
    tab: 'profile' | 'photos';
    /** DOM id (without '#') of the section to scroll to and focus. */
    field?: string;
}

export interface CompletenessItem {
    key: CompletenessKey;
    done: boolean;
    target: CompletenessTarget;
}

export const MIN_GALLERY_PHOTOS = 3;
export const MIN_DESCRIPTION = 60;

/** A picture the clinic put there itself, as opposed to the source site's generic banner. */
export function hasOwnAvatar(p: Provider): boolean {
    return !!p.imageUrl && p.imageUrl.includes('/clinic-photos/');
}

/**
 * What a clinic still has to do to have a complete listing. Pure and derived
 * from the provider row, plus the count of gallery photos (which live in a
 * separate table).
 */
export function profileCompleteness(p: Provider, galleryCount: number) {
    const socials = p.socials ?? {};
    const items: CompletenessItem[] = [
        { key: 'avatar', done: hasOwnAvatar(p), target: { tab: 'profile', field: 'acct-avatar' } },
        {
            key: 'description',
            done: ((p as Provider & { description?: string }).description ?? '').trim().length >= MIN_DESCRIPTION,
            target: { tab: 'profile', field: 'acct-description' },
        },
        { key: 'contact', done: !!(p.phone?.trim() && p.email?.trim()), target: { tab: 'profile', field: 'acct-phone' } },
        {
            key: 'languages',
            // Non-empty is enough: migration 0004 cleared every fabricated value, so
            // any language on a row was stated by someone. (Deliberately not
            // `languagesConfirmed`, which normalizeProvider currently never sets:
            // it reads camelCase keys but the column is `languages_confirmed`.)
            done: p.languages.length > 0,
            target: { tab: 'profile', field: 'acct-languages' },
        },
        { key: 'socials', done: Object.values(socials).some(Boolean), target: { tab: 'profile', field: 'acct-socials' } },
        { key: 'photos', done: galleryCount >= MIN_GALLERY_PHOTOS, target: { tab: 'photos' } },
    ];
    const doneCount = items.filter((i) => i.done).length;
    return { items, doneCount, total: items.length, percent: Math.round((doneCount / items.length) * 100) };
}
