import { setOptions } from '@googlemaps/js-api-loader';

/**
 * One place that configures the Google Maps JS loader.
 *
 * This used to live at module scope in MapView, which was fine while the map
 * was the only thing that touched Google — but MapView is lazy-loaded, so the
 * loader stayed unconfigured until the map chunk arrived. Anything else that
 * wanted a Maps library before then (the postal geocoder, the clinic photo
 * fetch) called importLibrary against a keyless loader and silently got
 * nothing back. Importing this module is what makes the loader usable, so it
 * must be imported by every caller rather than assumed.
 *
 * The key is intentionally public — it MUST reach the browser for the SDK to
 * authenticate. Protect it with HTTP referrer restrictions in Google Cloud
 * Console: APIs & Services -> Credentials -> [key] -> Application restrictions
 * -> HTTP referrers, then list your domains.
 */
export const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';

if (MAPS_API_KEY) {
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });
}
