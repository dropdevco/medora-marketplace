/**
 * Client helper for the `/api/place-photo` serverless proxy (see
 * api/place-photo.ts for the full rationale). Building the URL is trivial;
 * the useful part here is knowing *whether the proxy exists at all* before
 * pointing an `<img>` at it.
 *
 * In production (Vercel) the endpoint is always there. In `vite dev` it only
 * exists once vite.config.ts's dev-only middleware is wired up — without it,
 * the SPA's history fallback serves `index.html` with a 200 for any unknown
 * path, including `/api/place-photo?health=1`, which would otherwise look
 * like success. So the probe checks for the exact `204` this endpoint
 * returns for a healthy, configured proxy, not just a 2xx.
 */

let readyPromise: Promise<boolean> | undefined;
let resolvedState: boolean | undefined;
const listeners = new Set<() => void>();

function setState(value: boolean) {
    resolvedState = value;
    for (const listener of listeners) listener();
}

/** `/api/place-photo?placeId=...&w=...` for the given place and pixel width. */
export function placePhotoUrl(placeId: string, w: number): string {
    return `/api/place-photo?placeId=${encodeURIComponent(placeId)}&w=${w}`;
}

/**
 * Resolves `true` once, the first time it's called, based on a single probe
 * request — never re-probes on subsequent calls. Resolves `false` on any
 * network error or a response that isn't exactly `204`.
 */
export function placePhotoProxyReady(): Promise<boolean> {
    if (!readyPromise) {
        readyPromise = fetch('/api/place-photo?health=1')
            .then((res) => {
                const ok = res.status === 204;
                setState(ok);
                return ok;
            })
            .catch(() => {
                setState(false);
                return false;
            });
    }
    return readyPromise;
}

/** Synchronous read of the probe's resolved state: `undefined` while pending. */
export function placePhotoProxyState(): boolean | undefined {
    return resolvedState;
}

/** Subscribe to state changes, for `useSyncExternalStore`. */
export function subscribePlacePhotoProxy(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Kick the probe off eagerly at module import time, so it runs in parallel
// with whatever fetches providers — by the time a tile needs an answer, the
// probe has usually already resolved.
placePhotoProxyReady();
