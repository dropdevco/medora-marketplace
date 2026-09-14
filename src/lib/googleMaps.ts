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

/**
 * The language the Maps script itself boots in — this is what controls map
 * tile labels (street names, city names). It has to be read straight from
 * localStorage rather than from `i18n.language`: this module is a
 * side-effect import that several hooks pull in before `src/i18n/index.ts`
 * necessarily has, and the script tag this loader injects can only be told
 * a language once, at this first load.
 *
 * Reviews don't depend on this — `useGoogleReviews` passes its own
 * `language` on every request, which the legacy Places Details API honours
 * per call. This constant only matters for the parts of the SDK (map tiles)
 * that don't take a per-call override, so it degrades gracefully: it starts
 * a session in whatever language the user was already in, and only a
 * language switch mid-session (which nothing here reloads for) would leave
 * map labels one step behind until the next full page load.
 */
function initialMapsLanguage(): string {
    try {
        const stored = localStorage.getItem('medsociety-language');
        if (stored?.startsWith('es')) return 'es';
        if (stored?.startsWith('en')) return 'en';
    } catch {
        // Private mode, or site data blocked. Fall through to the default.
    }
    return navigator.language?.startsWith('es') ? 'es' : 'en';
}

if (MAPS_API_KEY) {
    setOptions({ key: MAPS_API_KEY, v: 'weekly', language: initialMapsLanguage() });
}
