import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { useTranslation } from 'react-i18next';
import type { MapBox, Provider } from '../../types/provider';
import { IconLocate, IconMapPin } from '../icons/Icons';

/** Fallback view if we have no providers at all to derive bounds from. */
const BORDER_CENTER = { lat: 31.738, lng: -106.455 };
const FALLBACK_ZOOM = 12;

/**
 * How far outside the clinic footprint a user may pan, in degrees.
 * The live set spans roughly 0.36° x 0.40°, so ~13km of slack lets someone
 * nudge the view for context without ever reaching the world map.
 */
const PAN_MARGIN = 0.12;
/** Padding, in px, between the outermost markers and the viewport edge. */
const FIT_PADDING = 72;

/**
 * How many pins may be on screen at once. Rendering ~4,000 individual pins is
 * what made the map slow to load and to pan, so the viewport plus this cap is
 * what keeps the marker count in the low hundreds instead.
 */
const DEFAULT_MAX_PINS = 150;

/**
 * How far the camera must move before "Search this area" is worth offering,
 * as a share of the current viewport span. Below this the user has nudged the
 * map rather than gone looking somewhere else, and a button that reappears on
 * every twitch is noise.
 */
const AREA_CHANGE_THRESHOLD = 0.15;

/**
 * The Google Maps JavaScript API key is intentionally public — it MUST be
 * sent to the browser for the Maps SDK to authenticate itself.
 * Protect it by adding HTTP referrer restrictions in Google Cloud Console:
 *   → APIs & Services → Credentials → [your key] → Application restrictions
 *   → Set to "HTTP referrers" and add your domain(s).
 */
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';

if (API_KEY) {
    setOptions({ key: API_KEY, v: 'weekly' });
}

interface MapViewProps {
    providers: Provider[];
    /** Unfiltered set — defines the pannable region so filtering can't unlock the globe. */
    allProviders: Provider[];
    selectedProvider: Provider | null;
    onProviderSelect: (p: Provider) => void;
    /**
     * The result card the cursor is currently over. Hovering a card lights up
     * its pin, which is what turns two panels into one view — without it the
     * list and the map are just two lists, and the map is the useless one.
     */
    hoveredId?: string | null;
    /** The pin the cursor is over, so the page can highlight the matching result card. */
    onProviderFocus?: (id: string | null) => void;
    /** Fires when the user presses "Search this area" with the current camera box. */
    onSearchArea?: (box: MapBox) => void;
    /** The active map-area filter, or null. */
    mapArea?: MapBox | null;
    /**
     * Changes only when a NON-spatial filter changes. The refit keys on this
     * instead of on `providers`, so a map-driven search cannot re-trigger it.
     */
    fitKey?: string;
    /** Ceiling on how many pins are drawn at once. See DEFAULT_MAX_PINS. */
    maxPins?: number;
    /**
     * Reports how many pins are actually drawn vs how many results exist, so the
     * page can tell the user the map is showing a subset.
     */
    onVisibleCountChange?: (shown: number, total: number, capped: boolean) => void;
}

/** Bounding box of a provider set, or null when there is nothing to bound. */
function boundsOf(list: Provider[]): MapBox | null {
    const pts = list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length === 0) return null;

    let north = -90, south = 90, east = -180, west = 180;
    for (const p of pts) {
        north = Math.max(north, p.lat);
        south = Math.min(south, p.lat);
        east = Math.max(east, p.lng);
        west = Math.min(west, p.lng);
    }
    return { north, south, east, west };
}

/** Exact equality, used to keep an unchanged camera from re-rendering. */
function sameBox(a: MapBox, b: MapBox): boolean {
    return a.north === b.north && a.south === b.south
        && a.east === b.east && a.west === b.west;
}

/**
 * Has the camera moved far enough that there is genuinely something new to
 * search? Measured against the current span rather than in fixed degrees, so
 * the answer means the same thing at street level as it does metro-wide.
 */
function movedMaterially(camera: MapBox, area: MapBox): boolean {
    const latSpan = Math.abs(camera.north - camera.south) || 1e-6;
    const lngSpan = Math.abs(camera.east - camera.west) || 1e-6;
    return Math.abs(camera.north - area.north) / latSpan > AREA_CHANGE_THRESHOLD
        || Math.abs(camera.south - area.south) / latSpan > AREA_CHANGE_THRESHOLD
        || Math.abs(camera.east - area.east) / lngSpan > AREA_CHANGE_THRESHOLD
        || Math.abs(camera.west - area.west) / lngSpan > AREA_CHANGE_THRESHOLD;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

export function MapView({
    providers, allProviders, selectedProvider, onProviderSelect, hoveredId = null,
    onProviderFocus, onSearchArea, mapArea = null, fitKey,
    maxPins = DEFAULT_MAX_PINS, onVisibleCountChange,
}: MapViewProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
    const infoRef = useRef<google.maps.InfoWindow | null>(null);
    /** Marker key -> the provider that marker currently stands for. */
    const cellByKeyRef = useRef<Map<string, string>>(new Map());
    const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
    const userMarkerRef = useRef<google.maps.Marker | null>(null);
    /** Camera box as of the last idle, driving the "Search this area" offer. */
    const [cameraBox, setCameraBox] = useState<MapBox | null>(null);

    /**
     * Marker listeners are attached once, at creation, and read their callbacks
     * through these refs. Re-attaching them on every render meant ~16k listener
     * operations per click once the directory grew past 4,000 providers.
     */
    const providersByIdRef = useRef<Map<string, Provider>>(new Map());
    const onSelectRef = useRef(onProviderSelect);
    const onFocusRef = useRef(onProviderFocus);
    const selectedIdRef = useRef<string | null>(null);
    const hoveredIdRef = useRef<string | null>(null);
    const overviewHtmlRef = useRef<(p: Provider) => string>(() => '');

    /**
     * The draw pass reads these rather than closing over them, so changing the
     * result set or the cap never means tearing down and re-attaching the
     * 'idle' listener and every marker listener under it.
     */
    const providersRef = useRef<Provider[]>(providers);
    const maxPinsRef = useRef(maxPins);
    const onVisibleCountChangeRef = useRef(onVisibleCountChange);
    /** Last (shown, total) reported, so an idle that changes nothing stays quiet. */
    const lastCountRef = useRef<{ shown: number; total: number; capped: boolean } | null>(null);
    /** The live draw pass, so a result-set change can redraw without a camera move. */
    const drawRef = useRef<() => void>(() => { });

    const providersById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);

    /**
     * The pannable region is derived from every clinic we know about — not the
     * filtered subset — so the world map is never reachable, but filtering down
     * to one clinic doesn't lock the user into a single block either.
     */
    const region = useMemo(() => boundsOf(allProviders), [allProviders]);

    // ── Marker icon builder ────────────────────────────────────────────────
    const makeIcon = useCallback((
        provider: Provider,
        isSelected: boolean,
        isHovered = false,
    ): google.maps.Symbol => {
        // Three states have to be tellable apart at a glance, on a pin eight
        // pixels across. Selected is a filled dark disc; hover inverts it —
        // white disc, heavy dark ring — so it reads as "this one" without
        // reading as a second selection; everything else keeps its side-of-
        // the-border tint. Hover used to share the selected fill and differ
        // only by one pixel of radius, which was no signal at all.
        const idleFill = provider.promoted
            ? '#0f6b52'
            : provider.country === 'MX'
                ? '#3f6b52'
                : '#3f5570';

        return {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: isSelected ? '#1b1d22' : isHovered ? '#ffffff' : idleFill,
            fillOpacity: 1,
            strokeColor: isHovered ? '#1b1d22' : '#ffffff',
            strokeWeight: isSelected ? 4 : isHovered ? 5 : 2.5,
            scale: isSelected ? 13 : isHovered ? 11 : provider.promoted ? 10 : 8,
        };
    }, []);

    /**
     * Repaint one marker from whatever it currently is. Selection and hover
     * both flow through here so the two can never disagree about a pin — the
     * bug being avoided is a hovered-then-selected marker reverting to its
     * idle colour when the cursor leaves.
     */
    const restyle = useCallback((id: string | null) => {
        if (!id) return;
        const marker = markersRef.current.get('p' + id);
        const provider = providersByIdRef.current.get(id);
        if (!marker || !provider) return;
        const isSelected = selectedIdRef.current === id;
        const isHovered = hoveredIdRef.current === id;
        marker.setIcon(makeIcon(provider, isSelected, isHovered));
        marker.setZIndex(isSelected ? 999 : isHovered ? 998 : provider.promoted ? 50 : 1);
    }, [makeIcon]);

    // ── Hover overview card ────────────────────────────────────────────────
    const overviewHtml = useCallback((p: Provider) => {
        const specialties = p.specialty
            .map((s) => t(`specialties.${s}`, { defaultValue: s }))
            .join(' · ');
        const side = p.country === 'MX' ? t('drawer.ciudadJuarez') : t('drawer.elPaso');
        const accent = p.country === 'MX' ? '#3f6b52' : '#3f5570';

        const star =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="#b5760a" style="flex-shrink:0">' +
            '<path d="M12 3.6l2.6 5.3 5.85.85-4.23 4.12 1 5.83L12 16.95l-5.22 2.75 1-5.83L3.55 9.75 9.4 8.9z"/></svg>';

        return `
      <div style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;padding:13px 15px;max-width:265px;color:#14161a;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="width:7px;height:7px;border-radius:50%;background:${accent};flex-shrink:0;"></span>
          <span style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${accent};">
            ${escapeHtml(side)}
          </span>
          ${p.promoted
                ? '<span style="font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#0f6b52;border:1px solid #b8ddd0;border-radius:99px;padding:1px 6px;">'
                + escapeHtml(t('drawer.promoted')) + '</span>'
                : ''}
        </div>
        <div style="font-size:15px;font-weight:700;line-height:1.3;margin-bottom:3px;">
          ${escapeHtml(p.name)}
        </div>
        <div style="font-size:12px;color:#5c6068;line-height:1.45;margin-bottom:8px;">
          ${escapeHtml(specialties)}
        </div>
        <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:#14161a;">
          ${star}
          <strong>${p.rating.toFixed(1)}</strong>
          <span style="color:#5c6068;">(${p.reviewCount.toLocaleString()})</span>
          <span style="color:#cfcfcd;">|</span>
          <span style="color:#5c6068;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(p.city)}
          </span>
        </div>
        <div style="margin-top:9px;font-size:11px;font-weight:600;color:#0f6b52;">
          ${escapeHtml(t('map.clickForDetails'))}
        </div>
      </div>`;
    }, [t]);

    /**
     * Keep the marker listeners' view of the world current. Written in an
     * effect rather than during render, and declared above the effect that
     * draws markers so the refs are populated before anything reads them.
     */
    useEffect(() => {
        providersByIdRef.current = providersById;
        providersRef.current = providers;
        maxPinsRef.current = maxPins;
        onSelectRef.current = onProviderSelect;
        onFocusRef.current = onProviderFocus;
        onVisibleCountChangeRef.current = onVisibleCountChange;
        overviewHtmlRef.current = overviewHtml;
    }, [
        providersById, providers, maxPins, onProviderSelect, onProviderFocus,
        onVisibleCountChange, overviewHtml,
    ]);

    // ── Init map ───────────────────────────────────────────────────────────
    useEffect(() => {
        if (!API_KEY || !containerRef.current || mapInstance) return;

        let isMounted = true;
        (async () => {
            try {
                const { Map } = await importLibrary('maps');
                await importLibrary('marker');
                await importLibrary('places'); // needed by the reviews hook

                const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';

                const map = new Map(containerRef.current!, {
                    center: BORDER_CENTER,
                    zoom: FALLBACK_ZOOM,
                    // Keep the viewport on the border region. Without this the
                    // map opens on the whole world, which is never useful here.
                    minZoom: 9,
                    maxZoom: 18,
                    zoomControl: true,
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    clickableIcons: false,
                    styles: initialTheme === 'dark' ? darkMapStyles : lightMapStyles,
                });

                if (isMounted) setMapInstance(map);
            } catch (err) {
                console.error('[MapView] Maps init error:', err);
            }
        })();
        return () => { isMounted = false; };
    }, [mapInstance]);

    // ── Lock panning to the clinic region ──────────────────────────────────
    useEffect(() => {
        if (!mapInstance || !region) return;
        mapInstance.setOptions({
            restriction: {
                latLngBounds: {
                    north: region.north + PAN_MARGIN,
                    south: region.south - PAN_MARGIN,
                    east: region.east + PAN_MARGIN,
                    west: region.west - PAN_MARGIN,
                },
                strictBounds: false,
            },
        });
    }, [mapInstance, region]);

    // ── Frame the visible clinics ──────────────────────────────────────────
    /**
     * Keying this on `providers` is a ratchet once the viewport itself filters
     * results: pan -> fewer results -> new `providers` identity -> refit, and
     * FIT_PADDING means each refit lands on a strictly tighter box than the one
     * that produced it, until the map bottoms out on a pin or two. So when the
     * page hands us a `fitKey` — which changes only for non-spatial filters —
     * we key on that and read the list through a ref. Without one we keep the
     * old `providers`-keyed behaviour so the component still works standalone.
     */
    const fitDep = fitKey ?? providers;
    useEffect(() => {
        if (!mapInstance) return;
        // Selecting a clinic has its own camera move; don't fight it.
        if (selectedProvider) return;
        // A map-area search means the user chose this camera. Refitting would
        // move it out from under them, and then filter on where it landed.
        if (mapArea) return;

        const list = providersRef.current;
        const box = boundsOf(list);
        if (!box) return;

        // A single result would otherwise zoom to max; give it a neighbourhood.
        if (list.length === 1) {
            mapInstance.setCenter({ lat: list[0].lat, lng: list[0].lng });
            mapInstance.setZoom(14);
            return;
        }

        mapInstance.fitBounds(
            new google.maps.LatLngBounds(
                { lat: box.south, lng: box.west },
                { lat: box.north, lng: box.east },
            ),
            FIT_PADDING,
        );
        // Refit whenever the result set changes — that is the point of the filter.
    }, [mapInstance, fitDep, selectedProvider, mapArea]);

    // ── Container resize ───────────────────────────────────────────────────
    /**
     * The sidebar collapses to a rail, which changes the map's width without a
     * window resize. Maps caches its container size, so tell it explicitly or it
     * keeps painting at the old width with a blank strip down the side.
     */
    useEffect(() => {
        const node = containerRef.current;
        if (!mapInstance || !node || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            google.maps.event.trigger(mapInstance, 'resize');
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [mapInstance]);

    // ── Theme listener ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!mapInstance) return;

        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName !== 'data-theme') continue;
                const next = document.documentElement.getAttribute('data-theme');
                mapInstance.setOptions({ styles: next === 'dark' ? darkMapStyles : lightMapStyles });
            }
        });

        observer.observe(document.documentElement, { attributes: true });
        return () => observer.disconnect();
    }, [mapInstance]);

    // -- Render whatever the viewport currently needs -----------------------
    /**
     * Every pin on screen is exactly one provider. Clustering used to stand in
     * for the ~4,000-pin load cost, but a metro-wide search folds nearly every
     * result into a bubble, and a bubble cannot light up when its card is
     * hovered — the list-to-map bridge silently stopped working for almost
     * every result. The viewport filter plus `maxPins` buys back the same
     * performance without ever hiding a provider inside an aggregate.
     */
    useEffect(() => {
        if (!mapInstance) return;

        if (!infoRef.current) {
            infoRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
        }
        const info = infoRef.current;

        const draw = () => {
            const bounds = mapInstance.getBounds();
            if (!bounds) return;

            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            const box: MapBox = {
                south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng(),
            };
            // Offer "Search this area" against wherever the camera settled.
            setCameraBox((prev) => (prev && sameBox(prev, box) ? prev : box));

            const list = providersRef.current;
            const cap = Math.max(maxPinsRef.current, 1);

            /**
             * `providers` arrives already sorted by the active sort mode
             * (relevance / rating / reviews / distance / price), so taking the
             * first N in array order is not arbitrary truncation — it is "the N
             * best results currently in view", which is the same ranking the
             * list panel is showing. Any other rule (random, geographic
             * thinning) would put pins on screen that the user cannot find in
             * the list.
             */
            const drawn: Provider[] = [];
            let capped = false;
            for (const p of list) {
                if (drawn.length >= cap) { capped = true; break; }
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
                if (!bounds.contains(new google.maps.LatLng(p.lat, p.lng))) continue;
                drawn.push(p);
            }

            // The selected and hovered pins are never subject to the cap. A
            // hovered card whose pin was suppressed is exactly the bug this
            // whole rewrite exists to kill.
            //
            // The exemption stops at the viewport edge, though. Marking a
            // provider that is off screen builds a marker nobody can see, so
            // it costs a draw pass and pays back nothing.
            for (const id of [selectedIdRef.current, hoveredIdRef.current]) {
                if (!id || drawn.some((p) => p.id === id)) continue;
                const pinned = providersByIdRef.current.get(id);
                if (!pinned || !Number.isFinite(pinned.lat) || !Number.isFinite(pinned.lng)) continue;
                if (!bounds.contains(new google.maps.LatLng(pinned.lat, pinned.lng))) continue;
                drawn.push(pinned);
            }

            const needed = new Set<string>();

            for (const provider of drawn) {
                const key = 'p' + provider.id;
                needed.add(key);

                let marker = markersRef.current.get(key);
                if (!marker) {
                    marker = new google.maps.Marker({
                        map: mapInstance,
                        position: { lat: provider.lat, lng: provider.lng },
                        optimized: true,
                    });
                    markersRef.current.set(key, marker);

                    // Listeners are attached once per marker and read whatever
                    // the marker currently represents from a ref, so a recycled
                    // marker never fires a stale handler.
                    marker.addListener('click', () => {
                        const id = cellByKeyRef.current.get(key);
                        if (!id) return;
                        info.close();
                        const current = providersByIdRef.current.get(id);
                        if (current) onSelectRef.current(current);
                    });
                    marker.addListener('mouseover', () => {
                        const id = cellByKeyRef.current.get(key);
                        if (!id) return;
                        const current = providersByIdRef.current.get(id);
                        if (!current) return;
                        info.setContent(overviewHtmlRef.current(current));
                        info.open({ map: mapInstance, anchor: marker });
                        // Highlight only — the cursor crosses a dozen pins while
                        // panning, and scrolling the list on each would jerk the
                        // page. Scrolling stays on click, via onProviderSelect.
                        onFocusRef.current?.(current.id);
                    });
                    marker.addListener('mouseout', () => {
                        info.close();
                        onFocusRef.current?.(null);
                    });
                } else {
                    marker.setPosition({ lat: provider.lat, lng: provider.lng });
                }

                cellByKeyRef.current.set(key, provider.id);
                const isSelected = selectedIdRef.current === provider.id;
                const isHovered = hoveredIdRef.current === provider.id;
                marker.setIcon(makeIcon(provider, isSelected, isHovered));
                marker.setTitle(provider.name);
                marker.setZIndex(
                    isSelected ? 999 : isHovered ? 998 : provider.promoted ? 50 : 1,
                );
            }

            // Retire anything the new viewport no longer needs.
            for (const [key, marker] of markersRef.current) {
                if (needed.has(key)) continue;
                google.maps.event.clearInstanceListeners(marker);
                marker.setMap(null);
                markersRef.current.delete(key);
                cellByKeyRef.current.delete(key);
            }

            // 'idle' fires on every settle, including ones that changed
            // nothing; only report a genuinely new pair or the page re-renders
            // its "showing N of M" line for no reason.
            const shown = drawn.length;
            const total = list.length;
            /**
             * Which limit bit matters to the reader, because the two point in
             * opposite directions. If the cap bound, a tighter view has fewer
             * candidates and stops hitting it — zoom IN. If the viewport bound,
             * the missing results are outside the frame — zoom OUT. Reporting
             * only the numbers left the page guessing, and it guessed wrong.
             */
            const last = lastCountRef.current;
            if (!last || last.shown !== shown || last.total !== total || last.capped !== capped) {
                lastCountRef.current = { shown, total, capped };
                onVisibleCountChangeRef.current?.(shown, total, capped);
            }
        };

        drawRef.current = draw;
        draw();
        const listener = mapInstance.addListener('idle', draw);
        return () => listener.remove();
    }, [mapInstance, makeIcon]);

    /**
     * Is this provider inside the camera box right now?
     *
     * Hover and selection redraw only for a provider the *cap* suppressed,
     * never for one that is simply off screen. Without the distinction,
     * scrubbing a list of 807 results — most of which sit outside the current
     * view — fires a full draw pass per row, which is the "moving down a list
     * feels like dragging" failure the ref-based listener architecture exists
     * to prevent. It also stopped short of helping: the marker the exemption
     * built landed outside the viewport, so the redraw was paid for and
     * nothing lit up.
     */
    const isInView = useCallback((id: string | null): boolean => {
        if (!id || !mapInstance) return false;
        const p = providersByIdRef.current.get(id);
        if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
        const bounds = mapInstance.getBounds();
        return bounds ? bounds.contains(new google.maps.LatLng(p.lat, p.lng)) : false;
    }, [mapInstance]);

    /**
     * A new result set usually moves the camera, and the resulting 'idle' would
     * redraw for us — but not when the new results happen to fit the same box
     * (a rating filter inside one neighbourhood, say). Redraw explicitly so the
     * pins can never be a search behind the list.
     */
    useEffect(() => {
        drawRef.current();
    }, [providers, maxPins, mapInstance]);

    // -- Selection styling --------------------------------------------------
    // Only the two affected markers are touched, instead of all of them.
    useEffect(() => {
        const previousId = selectedIdRef.current;
        const nextId = selectedProvider?.id ?? null;
        if (previousId === nextId) return;
        selectedIdRef.current = nextId;

        // Same cap exemption as hover: a selection past the cap needs a redraw
        // before it has a marker to restyle.
        if (nextId && !markersRef.current.has('p' + nextId) && isInView(nextId)) drawRef.current();
        restyle(previousId);
        restyle(nextId);
    }, [selectedProvider, restyle, isInView]);

    // ── Hover styling ──────────────────────────────────────────────────────
    /**
     * The bridge between the list and the map. Only the two affected markers
     * are touched — restyling all of them on every mouse move made moving down
     * a list of results feel like dragging.
     *
     * Hovering a card whose provider is on screen but past the pin cap would
     * light up nothing, so redraw first: the cap exempts the hovered provider,
     * and the marker exists by the time we restyle it. A provider that is off
     * screen entirely gets no redraw — see isInView.
     */
    useEffect(() => {
        const previousId = hoveredIdRef.current;
        if (previousId === hoveredId) return;
        hoveredIdRef.current = hoveredId;
        if (hoveredId && !markersRef.current.has('p' + hoveredId) && isInView(hoveredId)) drawRef.current();
        restyle(previousId);
        restyle(hoveredId);
    }, [hoveredId, restyle, isInView]);
    // ── Pan to selected ────────────────────────────────────────────────────
    useEffect(() => {
        if (!mapInstance || !selectedProvider) return;
        mapInstance.panTo({ lat: selectedProvider.lat, lng: selectedProvider.lng });
        if ((mapInstance.getZoom() ?? 0) < 15) mapInstance.setZoom(15);
    }, [selectedProvider, mapInstance]);

    // ── Geolocation ────────────────────────────────────────────────────────
    const locateUser = useCallback(() => {
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
                setUserLoc(pos);
                if (mapInstance) {
                    mapInstance.panTo(pos);
                    mapInstance.setZoom(14);
                }
            },
            () => console.warn('[MapView] Geolocation unavailable.'),
        );
    }, [mapInstance]);

    useEffect(() => {
        if (!mapInstance || !userLoc) return;

        if (!userMarkerRef.current) {
            userMarkerRef.current = new google.maps.Marker({
                map: mapInstance,
                position: userLoc,
                title: 'You are here',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: '#1b1d22',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 3,
                    scale: 8,
                },
                zIndex: 1000,
            });
        } else {
            userMarkerRef.current.setPosition(userLoc);
        }
    }, [userLoc, mapInstance]);

    // ── "Search this area" ─────────────────────────────────────────────────
    /**
     * Offered only when pressing it would actually change something: the page
     * has to want map-area searches at all, and the camera has to sit somewhere
     * other than the area already being searched.
     */
    const canSearchArea = Boolean(onSearchArea) && cameraBox !== null
        && (!mapArea || movedMaterially(cameraBox, mapArea));

    // ── No API key — static preview ───────────────────────────────────────
    if (!API_KEY) {
        return (
            <div style={{
                width: '100%', height: '100%', position: 'relative',
                background: 'var(--surface)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '1rem',
            }}>
                <svg
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}
                    viewBox="0 0 800 600"
                    preserveAspectRatio="xMidYMid slice"
                >
                    <defs>
                        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="1" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                    <line x1="0" y1="330" x2="800" y2="290" stroke="var(--gold)" strokeWidth="2" strokeDasharray="9 6" />
                </svg>

                {providers.slice(0, 8).map((p, i) => (
                    <button
                        key={p.id}
                        onClick={() => onProviderSelect(p)}
                        title={p.name}
                        className="press"
                        style={{
                            position: 'absolute',
                            left: `${14 + (i % 4) * 22}%`,
                            top: i < 4 ? '30%' : '62%',
                            width: p.promoted ? 40 : 32,
                            height: p.promoted ? 40 : 32,
                            borderRadius: '50%',
                            background: selectedProvider?.id === p.id
                                ? 'var(--gold)'
                                : p.country === 'MX' ? 'var(--mx)' : 'var(--us)',
                            border: '3px solid var(--navy-800)',
                            boxShadow: 'var(--shadow-sm)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#ffffff',
                            zIndex: p.promoted ? 2 : 1,
                        }}
                    >
                        <IconMapPin size={p.promoted ? 18 : 15} weight={2} />
                    </button>
                ))}

                <div className="panel" style={{ padding: '1.25rem 1.5rem', textAlign: 'center', maxWidth: 360, zIndex: 10 }}>
                    <p style={{ fontSize: '0.95rem', color: 'var(--white)', fontWeight: 700, marginBottom: '0.35rem' }}>
                        {t('map.previewMode')}
                    </p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)', lineHeight: 1.55 }}>
                        {t('map.previewHint')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

            <button
                onClick={locateUser}
                title={t('map.findMe')}
                aria-label={t('map.findMe')}
                className="press"
                style={{
                    position: 'absolute',
                    bottom: '28px',
                    left: '24px',
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    background: 'var(--navy-800)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                    color: 'var(--white)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                }}
            >
                <IconLocate size={21} />
            </button>

            {canSearchArea && (
                <button
                    onClick={() => cameraBox && onSearchArea?.(cameraBox)}
                    className="press"
                    style={{
                        position: 'absolute',
                        bottom: '28px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '0.6rem 1.15rem',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--surface)',
                        border: '1px solid var(--border-strong)',
                        boxShadow: 'var(--shadow)',
                        color: 'var(--brand)',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        zIndex: 10,
                    }}
                >
                    {t('map.searchThisArea')}
                </button>
            )}
        </div>
    );
}

const darkMapStyles: google.maps.MapTypeStyle[] = [
    { elementType: 'geometry', stylers: [{ color: '#121316' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#121316' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#b0b1b4' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#33353b' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#121316' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a4d54' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0b0d' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4fc79f' }, { weight: 2 }] },
];

/**
 * Light styles are tuned for contrast, not for the washed-out Google default:
 * near-black labels and white roads against a tinted land fill. Under the
 * Clinic White palette the map spends colour only on the border itself —
 * the country stroke is the accent green, and the water is pulled toward
 * the same hue so the Rio Grande reads as that line rather than competing
 * with it.
 */
const lightMapStyles: google.maps.MapTypeStyle[] = [
    { elementType: 'geometry', stylers: [{ color: '#f0f0ee' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#2a2d33' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#b6b6b2' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#14161a' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e8e8e5' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dfeae4' }, { visibility: 'on' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d6d6d3' }] },
    { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#3c4046' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f4f3f0' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#cdccc7' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#1d1f24' }] },
    { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#6d7178' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c7dbd4' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3f6b52' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#0f6b52' }, { weight: 2.4 }] },
];
