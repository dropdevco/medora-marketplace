import type { Provider } from '../types/provider';
import { portraitUrl } from '../utils/images';
import { useGooglePhotos } from './useGooglePhotos';

/**
 * The best photo we can show for a provider right now, without storing
 * anything new.
 *
 * A usable `imageUrl` wins outright. Failing that, and only then, we ask
 * Google for the place's photos — the same call `ClinicPhotos` already makes
 * for the drawer, cached per placeId for the session (see useGooglePhotos).
 * 1,275 of the 1,390 providers with a `googlePlaceId` have no `imageUrl` at
 * all — the scrape that populated it never requested Google's `photos`
 * field — so without this fallback, a card shows the specialty-icon monogram
 * for a clinic that has a perfectly good photo one API call away, while its
 * own drawer (which does call useGooglePhotos) shows that same photo.
 *
 * `useGooglePhotos` is given `undefined` rather than the real placeId once a
 * static photo is already in hand, which is what keeps a provider that has
 * both from ever triggering the Google call — the hook already treats an
 * undefined placeId as "nothing to fetch".
 *
 * No skeleton or spinner state is exposed for the Google-fetch path: the
 * caller's existing no-photo fallback (the monogram) is the visible state
 * until Google resolves, then the photo pops in — the same behaviour the
 * drawer's own gallery already has.
 */
export function usePortraitPhoto(provider: Provider): { url?: string; loading: boolean } {
    const staticUrl = portraitUrl(provider.imageUrl);
    const { photos, loading } = useGooglePhotos(staticUrl ? undefined : provider.googlePlaceId);
    return { url: staticUrl ?? photos[0]?.url, loading };
}
