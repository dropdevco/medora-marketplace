import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import Supercluster from 'supercluster';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
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
 * Cluster bubbles, sized and shaded by how many clinics they stand for.
 * Rendering ~4,000 individual pins is what made the map slow to load and to
 * pan; the clusterer keeps only the visible aggregates on screen and splits
 * them apart as you zoom in.
 */
/** Supercluster feature properties, narrowed for the fields we read. */
interface ClusterProps {
    cluster?: boolean;
    cluster_id?: number;
    point_count?: number;
}

/** What a rendered marker currently stands for. Recycled markers read this. */
type Cell =
    | { kind: 'cluster'; position: google.maps.LatLngLiteral; expansionZoom: number }
    | { kind: 'provider'; providerId: string };

/**
 * Cluster bubble styling. Sized and shaded by how many clinics the bubble
 * stands for, relative to the biggest cluster currently on the map.
 */
function clusterIcon(count: number, largest: number): google.maps.Symbol {
    const share = count / Math.max(largest, 1);
    return {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: share > 0.6 ? '#0a4c3a' : share > 0.3 ? '#0f6b52' : '#2f8a70',
        fillOpacity: 0.92,
        strokeColor: '#ffffff',
        strokeWeight: 2.5,
        scale: 18 + Math.round(share * 14),
    };
}

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
}

interface Box { north: number; south: number; east: number; west: number }

/** Bounding box of a provider set, or null when there is nothing to bound. */
function boundsOf(list: Provider[]): Box | null {
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

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

export function MapView({
    providers, allProviders, selectedProvider, onProviderSelect, hoveredId = null,
}: MapViewProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
    const infoRef = useRef<google.maps.InfoWindow | null>(null);
    const cellByKeyRef = useRef<Map<string, Cell>>(new Map());
    const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
    const userMarkerRef = useRef<google.maps.Marker | null>(null);

    /**
     * Marker listeners are attached once, at creation, and read their callbacks
     * through these refs. Re-attaching them on every render meant ~16k listener
     * operations per click once the directory grew past 4,000 providers.
     */
    const providersByIdRef = useRef<Map<string, Provider>>(new Map());
    const onSelectRef = useRef(onProviderSelect);
    const selectedIdRef = useRef<string | null>(null);
    const hoveredIdRef = useRef<string | null>(null);
    const overviewHtmlRef = useRef<(p: Provider) => string>(() => '');

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
        // Hover borrows the selected colour but not its size, so passing the
        // cursor down a list reads as a highlight rather than as fourteen
        // separate selections.
        const fill = isSelected || isHovered
            ? '#1b1d22'
            : provider.promoted
                ? '#0f6b52'
                : provider.country === 'MX'
                    ? '#3f6b52'
                    : '#3f5570';

        return {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: fill,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: isSelected ? 4 : isHovered ? 3.5 : 2.5,
            scale: isSelected ? 13 : isHovered ? 12 : provider.promoted ? 10 : 8,
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
        onSelectRef.current = onProviderSelect;
        overviewHtmlRef.current = overviewHtml;
    }, [providersById, onProviderSelect, overviewHtml]);

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
    useEffect(() => {
        if (!mapInstance) return;
        // Selecting a clinic has its own camera move; don't fight it.
        if (selectedProvider) return;

        const box = boundsOf(providers);
        if (!box) return;

        // A single result would otherwise zoom to max; give it a neighbourhood.
        if (providers.length === 1) {
            mapInstance.setCenter({ lat: providers[0].lat, lng: providers[0].lng });
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
    }, [mapInstance, providers, selectedProvider]);

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

    // -- Cluster index (raw points, not marker objects) ---------------------
    /**
     * The index holds plain {lat, lng, id} points, never google.maps.Marker
     * objects. Building ~4,000 markers up front was the load cost, and most of
     * them were never on screen. Supercluster indexes the points in a few
     * milliseconds; markers are materialised only for what the current viewport
     * actually renders -- typically a few dozen.
     */
    const clusterIndex = useMemo(() => {
        const index = new Supercluster<{ providerId: string }>({
            radius: 90,
            maxZoom: 15,
            minPoints: 3,
        });
        index.load(
            providers
                .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
                .map((p) => ({
                    type: 'Feature' as const,
                    properties: { providerId: p.id },
                    geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
                })),
        );
        return index;
    }, [providers]);

    // -- Render whatever the viewport currently needs -----------------------
    useEffect(() => {
        if (!mapInstance) return;

        if (!infoRef.current) {
            infoRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
        }
        const info = infoRef.current;

        const draw = () => {
            const bounds = mapInstance.getBounds();
            const zoom = mapInstance.getZoom();
            if (!bounds || zoom == null) return;

            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            const cells = clusterIndex.getClusters(
                [sw.lng(), sw.lat(), ne.lng(), ne.lat()],
                Math.round(zoom),
            );

            // Largest cluster in this viewport, computed once — the bubble
            // shading is relative to it. Doing this per marker meant a fresh
            // world-wide cluster query for every bubble drawn.
            let largest = 1;
            for (const cell of cells) {
                const n = (cell.properties as ClusterProps).point_count;
                if (n && n > largest) largest = n;
            }

            const needed = new Set<string>();

            for (const cell of cells) {
                const [lng, lat] = cell.geometry.coordinates;
                const clusterId = (cell.properties as ClusterProps).cluster_id;
                const isCluster = Boolean((cell.properties as ClusterProps).cluster);
                const providerId = (cell.properties as { providerId?: string }).providerId;
                const key = isCluster ? 'c' + clusterId : 'p' + providerId;
                needed.add(key);

                let marker = markersRef.current.get(key);
                if (!marker) {
                    marker = new google.maps.Marker({
                        map: mapInstance,
                        position: { lat, lng },
                        optimized: true,
                    });
                    markersRef.current.set(key, marker);

                    // Listeners are attached once per marker and read whatever
                    // the marker currently represents from a ref, so a recycled
                    // marker never fires a stale handler.
                    marker.addListener('click', () => {
                        const current = cellByKeyRef.current.get(key);
                        if (!current) return;
                        info.close();
                        if (current.kind === 'cluster') {
                            mapInstance.setZoom(current.expansionZoom);
                            mapInstance.panTo(current.position);
                        } else {
                            const provider = providersByIdRef.current.get(current.providerId);
                            if (provider) onSelectRef.current(provider);
                        }
                    });
                    marker.addListener('mouseover', () => {
                        const current = cellByKeyRef.current.get(key);
                        if (!current || current.kind === 'cluster') return;
                        const provider = providersByIdRef.current.get(current.providerId);
                        if (!provider) return;
                        info.setContent(overviewHtmlRef.current(provider));
                        info.open({ map: mapInstance, anchor: marker });
                    });
                    marker.addListener('mouseout', () => info.close());
                } else {
                    marker.setPosition({ lat, lng });
                }

                if (isCluster) {
                    const count = (cell.properties as ClusterProps).point_count ?? 0;
                    cellByKeyRef.current.set(key, {
                        kind: 'cluster',
                        position: { lat, lng },
                        expansionZoom: Math.min(
                            clusterIndex.getClusterExpansionZoom(clusterId as number),
                            20,
                        ),
                    });
                    marker.setIcon(clusterIcon(count, largest));
                    marker.setLabel({
                        text: String(count),
                        color: '#ffffff',
                        fontSize: '13px',
                        fontWeight: '600',
                    });
                    marker.setTitle(count + ' providers');
                    marker.setZIndex(1000 + count);
                } else {
                    const provider = providerId ? providersByIdRef.current.get(providerId) : undefined;
                    if (!provider) continue;
                    cellByKeyRef.current.set(key, { kind: 'provider', providerId: provider.id });
                    const isSelected = selectedIdRef.current === provider.id;
                    const isHovered = hoveredIdRef.current === provider.id;
                    marker.setIcon(makeIcon(provider, isSelected, isHovered));
                    marker.setLabel(null);
                    marker.setTitle(provider.name);
                    marker.setZIndex(
                        isSelected ? 999 : isHovered ? 998 : provider.promoted ? 50 : 1,
                    );
                }
            }

            // Retire anything the new viewport no longer needs.
            for (const [key, marker] of markersRef.current) {
                if (needed.has(key)) continue;
                google.maps.event.clearInstanceListeners(marker);
                marker.setMap(null);
                markersRef.current.delete(key);
                cellByKeyRef.current.delete(key);
            }
        };

        draw();
        const listener = mapInstance.addListener('idle', draw);
        return () => listener.remove();
    }, [mapInstance, clusterIndex, makeIcon]);

    // -- Selection styling --------------------------------------------------
    // Only the two affected markers are touched, instead of all of them.
    useEffect(() => {
        const previousId = selectedIdRef.current;
        const nextId = selectedProvider?.id ?? null;
        if (previousId === nextId) return;
        selectedIdRef.current = nextId;

        restyle(previousId);
        restyle(nextId);
    }, [selectedProvider, restyle]);

    // ── Hover styling ──────────────────────────────────────────────────────
    /**
     * The bridge between the list and the map. Only the two affected markers
     * are touched — restyling all of them on every mouse move made moving down
     * a list of results feel like dragging.
     *
     * A provider still folded into a cluster has no marker of its own; nothing
     * lights up, and that is correct. Zooming in is what splits the cluster.
     */
    useEffect(() => {
        const previousId = hoveredIdRef.current;
        if (previousId === hoveredId) return;
        hoveredIdRef.current = hoveredId;
        restyle(previousId);
        restyle(hoveredId);
    }, [hoveredId, restyle]);
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
