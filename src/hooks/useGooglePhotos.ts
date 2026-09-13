import { useEffect, useSyncExternalStore } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
// Side-effect import: configures the loader with our key. This worked
// without it only because the map chunk happened to load first; nothing
// guarantees that once these hooks are used outside the search page.
import '../lib/googleMaps';

export interface GooglePhoto {
    /** Ready-to-render URL, sized for our gallery. */
    url: string;
    /**
     * Required attribution markup supplied by Google (usually a linked
     * photographer name). Google's terms require this to be displayed
     * alongside the photo — it must not be stripped.
     */
    attributionHtml: string;
}

/**
 * Photos already fetched this session, keyed by placeId.
 *
 * Deliberately memory-only, and deliberately not written to Supabase: Google's
 * Places policies permit only `place_id` to be retained indefinitely, and the
 * photo URLs are signed and expire. Persisting them would be both a licensing
 * problem and a source of broken images.
 *
 * A cached empty array is meaningful — it records "this place has no photos",
 * so we don't pay for the same answer twice.
 */
const photoCache = new Map<string, GooglePhoto[]>();

/** Google returns at most 10 photo references per place; we show fewer. */
const MAX_PHOTOS = 6;

/** Stable identity for "no photos", so a cache miss never churns renders. */
const NO_PHOTOS: GooglePhoto[] = [];

// The cache is an external mutable store, so components subscribe to it rather
// than mirroring it into their own state.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
function publish(placeId: string, photos: GooglePhoto[]) {
    photoCache.set(placeId, photos);
    for (const listener of listeners) listener();
}

/**
 * Loads Google Place photos for a placeId, mirroring useGoogleReviews:
 * fetched on demand, cached for the session, and resolving to an empty list
 * rather than throwing when a place has no photos or the API is unavailable.
 */
export function useGooglePhotos(placeId?: string) {
    // Read straight from the cache and re-render when it changes. No state to
    // keep in sync, so the effect never calls setState synchronously.
    const photos = useSyncExternalStore(
        subscribe,
        () => (placeId ? photoCache.get(placeId) : undefined) ?? NO_PHOTOS,
    );

    const loading = Boolean(placeId) && !photoCache.has(placeId!);

    useEffect(() => {
        if (!placeId || photoCache.has(placeId)) return;

        let cancelled = false;

        async function fetchPhotos() {
            try {
                await importLibrary('places');
                if (cancelled) return;

                const service = new google.maps.places.PlacesService(document.createElement('div'));

                service.getDetails({ placeId: placeId!, fields: ['photos'] }, (place, status) => {
                    if (cancelled) return;

                    const ok = status === google.maps.places.PlacesServiceStatus.OK;
                    const resolved: GooglePhoto[] = ok && place?.photos?.length
                        ? place.photos.slice(0, MAX_PHOTOS).map((photo) => ({
                            url: photo.getUrl({ maxWidth: 720, maxHeight: 480 }),
                            attributionHtml: (photo.html_attributions ?? []).join(' · '),
                        }))
                        : [];

                    publish(placeId!, resolved);
                });
            } catch (err) {
                console.error('[useGooglePhotos] Error loading Places SDK:', err);
                if (!cancelled) {
                    publish(placeId!, NO_PHOTOS);
                }
            }
        }

        fetchPhotos();
        return () => { cancelled = true; };
    }, [placeId]);

    return { photos, loading };
}
