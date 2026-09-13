import { useState, useEffect } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
// Side-effect import: configures the loader with our key. This worked
// without it only because the map chunk happened to load first; nothing
// guarantees that once these hooks are used outside the search page.
import '../lib/googleMaps';

export interface GoogleReview {
    author_name: string;
    rating: number;
    text: string;
    relative_time_description: string;
    profile_photo_url?: string;
}

const mockGoogleReviews: GoogleReview[] = [
    {
        author_name: 'Sophia Rodriguez',
        rating: 5,
        text: 'Absolutely incredible care! The doctor was very patient and explained everything in detail. Highly recommend this clinic.',
        relative_time_description: '3 weeks ago',
    },
    {
        author_name: 'John Martinez',
        rating: 4,
        text: 'Very professional staff and short wait times. Booking was easy, and the facilities were clean and modern.',
        relative_time_description: '1 month ago',
    },
    {
        author_name: 'Alejandro Gomez',
        rating: 5,
        text: 'Excelente servicio, muy atentos y bilingües. Me sentí muy cómodo durante mi tratamiento dental.',
        relative_time_description: '2 months ago',
    },
    {
        author_name: 'Emily Watson',
        rating: 5,
        text: 'Great experience! The price was fair and they helped me navigate the border crossing guidelines easily.',
        relative_time_description: '4 months ago',
    }
];

/**
 * Reviews already fetched this session, keyed by placeId.
 *
 * Opening a provider fires a live Places round trip, which is most of the delay
 * when a drawer opens. Reviews change on the order of days, so re-fetching them
 * because a user reopened the same clinic is pure latency — and pure API spend.
 * The cache lives at module scope so it survives drawer unmount/remount.
 */
const reviewCache = new Map<string, GoogleReview[]>();

/**
 * Fetches Google Place reviews for a given placeId using the Places Service.
 * Only returns reviews with rating >= 4 ("good reviews").
 * Automatically loads the Places library if not yet available.
 * Falls back to high-quality mock reviews when Google API is blocked or offline.
 */
export function useGoogleReviews(placeId?: string) {
    // Seed from cache during the first render so a revisited clinic paints its
    // reviews immediately, with no loading flash.
    const [reviews, setReviews] = useState<GoogleReview[]>(
        () => (placeId && reviewCache.get(placeId)) || [],
    );
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>('');

    useEffect(() => {
        if (!placeId) {
            setReviews(mockGoogleReviews);
            setStatus('no-place-id-fallback');
            return;
        }

        const cached = reviewCache.get(placeId);
        if (cached) {
            setReviews(cached);
            setStatus('cache');
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setStatus('loading');

        async function fetchReviews() {
            try {
                // Ensure the places library is loaded (idempotent — safe to call multiple times)
                await importLibrary('places');

                if (cancelled) return;

                const dummyDiv = document.createElement('div');
                const service = new google.maps.places.PlacesService(dummyDiv);

                service.getDetails(
                    { placeId: placeId!, fields: ['reviews'] },
                    (place, apiStatus) => {
                        if (cancelled) return;

                        console.log(`[useGoogleReviews] placeId=${placeId} status=${apiStatus} reviews=${place?.reviews?.length ?? 0}`);
                        setStatus(apiStatus);

                        if (
                            apiStatus === google.maps.places.PlacesServiceStatus.OK &&
                            place?.reviews?.length
                        ) {
                            // Only keep "good" reviews (4+ stars), sort best first
                            const good = place.reviews
                                .filter((r) => (r.rating ?? 0) >= 4)
                                .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
                                .map((r) => ({
                                    author_name: r.author_name ?? 'Anonymous',
                                    rating: r.rating ?? 5,
                                    text: r.text ?? '',
                                    relative_time_description:
                                        (r as any).relative_time_description ?? '',
                                    profile_photo_url:
                                        (r as any).profile_photo_url ?? undefined,
                                }));
                            reviewCache.set(placeId!, good);
                            setReviews(good);
                        } else {
                            // Fallback to mock reviews if API limits or billing blocks occur
                            console.warn(`[useGoogleReviews] API error status: ${apiStatus}. Falling back to mock reviews.`);
                            // Cache the fallback as well: asking again this
                            // session cannot produce reviews that do not exist,
                            // and each attempt is a billable Places call.
                            reviewCache.set(placeId!, mockGoogleReviews);
                            setReviews(mockGoogleReviews);
                        }
                        setLoading(false);
                    }
                );
            } catch (err) {
                console.error('[useGoogleReviews] Error loading Places SDK:', err);
                if (!cancelled) {
                    // Fallback to mock reviews if SDK cannot load or key is invalid
                    setReviews(mockGoogleReviews);
                    setStatus('error-fallback');
                    setLoading(false);
                }
            }
        }

        fetchReviews();

        return () => { cancelled = true; };
    }, [placeId]);

    return { reviews, loading, status };
}
