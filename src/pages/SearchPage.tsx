import { useState, useCallback, useMemo, lazy, Suspense, useEffect } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { useProviders } from '../hooks/useProviders';
import { SearchHero } from '../components/search/SearchHero';
import { SearchPill } from '../components/search/SearchPill';
import { CategoryRail } from '../components/search/CategoryRail';
import { FilterChipRow } from '../components/search/FilterChipRow';
import { FilterModal } from '../components/search/FilterModal';
import { FilterSummary } from '../components/search/FilterSummary';
import { ProviderCard } from '../components/provider/ProviderCard';
import { Discover } from '../components/discover/Discover';
import { LogoMark } from '../components/brand/Logo';
import { IconSearch, IconMapPin, IconList } from '../components/icons/Icons';
import { trackProviderClick } from '../utils/analytics';
import { distanceKm } from '../utils/geo';
import { countActiveFilters } from '../utils/filters';
import { buildDiscoverRows } from '../utils/discover';
import type { MapBox, Provider, ProviderFilters, Specialty } from '../types/provider';

/**
 * The map is the heaviest thing this app can load — the Google Maps SDK and
 * an 800-line view. It is unreachable until a search has been run, so
 * splitting it out is no longer just a nice-to-have: the landing page
 * genuinely never pays for it.
 */
const MapView = lazy(() =>
    import('../components/map/MapView').then((m) => ({ default: m.MapView })),
);

const ProviderDrawer = lazy(() =>
    import('../components/provider/ProviderDrawer').then((m) => ({ default: m.ProviderDrawer })),
);

const NAV_HEIGHT = 68;
/** First-paint guess for the sticky toolbar; it measures itself once mounted. */
const BAND_HEIGHT = 176;
/** First-paint guess only — rows measure themselves once mounted. */
const ROW_HEIGHT = 164;
const ROW_GAP = 12;

/**
 * The directory, in two states.
 *
 * **Before a search** it is a search box over rows of providers, and there is
 * no map at all. Someone opening a healthcare directory already knows they want
 * a dentist; showing them a viewport full of pins asks them to answer a
 * question they never had.
 *
 * **After a search** the map earns its place, because now it is answering
 * "which of these is near me" about a set the user chose. Which state applies
 * is read off the filters, so the URL alone decides — a shared link to a search
 * opens on results, a shared link to `/` opens on the browse rows.
 */
export function SearchPage() {
    const { t } = useTranslation();
    const {
        providers, allProviders, filters, updateFilter, patchFilters, resetFilters,
        facets, vocabulary, selectedProvider, setSelectedProvider, loading,
        knownPostalCodes, centre,
    } = useProviders();

    const activeCount = countActiveFilters(filters);
    const searching = filters.search !== '' || activeCount > 0;

    const [view, setView] = useState<'list' | 'map'>('list');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [heroOpen, setHeroOpen] = useState(false);
    /** The card under the cursor. Forwarded to the map, which lights its pin. */
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    /** The pin under the cursor. The return leg: lights the matching card. */
    const [focusedId, setFocusedId] = useState<string | null>(null);
    /**
     * How many pins the map is actually drawing, against how many results the
     * list holds. The map caps what it renders, so these disagree on any broad
     * search — and a map showing 150 of 807 with nothing saying so reads as a
     * map that lost most of the results.
     */
    const [pinCount, setPinCount] = useState<
        { shown: number; total: number; capped: boolean } | null
    >(null);

    /**
     * The sticky toolbar's real height. The map column parks directly under it,
     * and the toolbar grows by a row whenever the search box is expanded or the
     * chip row wraps — a hardcoded offset leaves the map either overlapped or
     * floating below a gap on exactly the screens where it matters.
     */
    const [bandHeight, setBandHeight] = useState(BAND_HEIGHT);
    const attachBand = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        // Set-if-changed: an observer that writes the same number back on every
        // layout pass is one dependency away from an update loop.
        const measure = () => setBandHeight((prev) =>
            prev === node.offsetHeight ? prev : node.offsetHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    /**
     * Above the split breakpoint the list and the map are both on screen, so
     * "map view" is not a state that can exist there. Forcing it back also
     * rescues anyone who toggled to the map on a phone and then widened the
     * window — otherwise the list stays unmounted with no button to bring it
     * back, because the toggle itself is hidden at that width.
     */
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1181px)');
        const sync = () => { if (mq.matches) setView('list'); };
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);

    const postalKnown = !filters.postalCode || knownPostalCodes.has(filters.postalCode);

    /** Specialties in directory order — the rail should lead with what we have. */
    const specialtyOrder = useMemo(
        () => vocabulary.specialties.map((s) => s.key),
        [vocabulary],
    );

    /** Every insurer, most common first. Stable across filtering, unlike facets. */
    const insurers = useMemo(
        () => vocabulary.insurers.map((i) => i.label),
        [vocabulary],
    );

    const discoverRows = useMemo(
        () => (searching ? [] : buildDiscoverRows(allProviders)),
        [searching, allProviders],
    );

    /**
     * Distance from the top of the document to the first result — the window
     * virtualizer converts its offsets into page coordinates with it. A ref
     * read during render is null on the first pass, which would pin the margin
     * at 0 and misplace every row by the height of the toolbar.
     */
    const [listTop, setListTop] = useState(0);
    const attachList = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        const measure = () => setListTop((prev) =>
            prev === node.offsetTop ? prev : node.offsetTop);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(document.body);
        return () => observer.disconnect();
    }, []);

    const rowVirtualizer = useWindowVirtualizer({
        count: providers.length,
        estimateSize: () => ROW_HEIGHT + ROW_GAP,
        overscan: 6,
        scrollMargin: listTop,
        // Without this, a card scrolled to from the map parks underneath the
        // nav and the sticky toolbar, which is the one place you cannot read it.
        scrollPaddingStart: NAV_HEIGHT + bandHeight,
    });

    /**
     * Every filter EXCEPT the map viewport, as a comparable string.
     *
     * Two effects key on it rather than on `filters`, and both would misbehave
     * otherwise. The map refits its camera to the results; if a map-driven
     * search re-triggered that refit, the padded fit would land on a tighter
     * box than the one that produced it, filter again, and ratchet inward
     * until a couple of pins are left. And the scroll-to-top below would yank
     * the list back to row one every time the user searched an area.
     */
    const fitKey = useMemo(
        () => JSON.stringify({ ...filters, mapArea: null }),
        [filters],
    );

    /** Result index by provider id, so a map click can scroll the list to it. */
    const indexById = useMemo(
        () => new Map(providers.map((p, i) => [p.id, i])),
        [providers],
    );

    // A filter change can shorten the list under a scrolled-down window, which
    // otherwise leaves the user staring at blank space below the last result.
    useEffect(() => {
        if (view === 'list') window.scrollTo({ top: 0 });
    }, [fitKey, view]);

    const runSearch = useCallback((patch: Partial<ProviderFilters>) => {
        setHeroOpen(false);
        patchFilters(patch);
    }, [patchFilters]);

    const handleSelect = useCallback((p: Provider) => {
        trackProviderClick(p);
        setSelectedProvider((current) => (current?.id === p.id ? null : p));
    }, [setSelectedProvider]);

    /**
     * A pin was clicked. Bring its row into view.
     *
     * Only on click, never on hover — the cursor crosses a lot of pins while
     * panning, and scrolling under each one turns the list into a slot machine.
     * 'auto' rather than 'smooth': the rows measure themselves, and a smooth
     * scroll races that re-measure into a visible overshoot.
     */
    const handleProviderFromMap = useCallback((p: Provider) => {
        handleSelect(p);
        if (view !== 'list') return;
        const index = indexById.get(p.id);
        if (index !== undefined) {
            rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' });
        }
    }, [handleSelect, indexById, view, rowVirtualizer]);

    /** "Search this area" — narrow the results to the current camera box. */
    const handleSearchArea = useCallback((box: MapBox) => {
        // Replace rather than push: panning should not turn Back into a
        // re-enactment of every camera move the user made.
        patchFilters({ mapArea: box }, true);
    }, [patchFilters]);

    const handleVisibleCount = useCallback((shown: number, total: number, capped: boolean) => {
        setPinCount((prev) => (
            prev && prev.shown === shown && prev.total === total && prev.capped === capped
                ? prev
                : { shown, total, capped }
        ));
    }, []);

    const handleProviderSuggestion = useCallback((id: string) => {
        const p = allProviders.find((x) => x.id === id);
        if (p) handleSelect(p);
    }, [allProviders, handleSelect]);

    const toggleSpecialty = useCallback((s: Specialty) => {
        updateFilter(
            'specialty',
            filters.specialty.includes(s)
                ? filters.specialty.filter((x) => x !== s)
                : [...filters.specialty, s],
        );
    }, [filters.specialty, updateFilter]);

    /** Undefined outside a location search, or when a provider has no coordinates. */
    const distanceOf = useCallback((p: Provider) => {
        if (!centre || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return undefined;
        return distanceKm(centre.lat, centre.lng, p.lat, p.lng);
    }, [centre]);

    const hero = (
        <SearchHero
            filters={filters}
            vocabulary={vocabulary}
            insurers={insurers}
            onSubmit={runSearch}
            onProvider={handleProviderSuggestion}
            autoFocus={heroOpen}
        />
    );

    return (
        <div className="ms-page" style={{ paddingTop: NAV_HEIGHT }}>
            {searching ? (
                <>
                    {/* ── Results toolbar ── */}
                    <div ref={attachBand} className="ms-band" style={{ top: NAV_HEIGHT }}>
                        <div className="ms-band-inner">
                            {heroOpen ? hero : (
                                <div className="ms-band-pill">
                                    <SearchPill filters={filters} onExpand={() => setHeroOpen(true)} />
                                </div>
                            )}

                            <CategoryRail
                                order={specialtyOrder}
                                active={filters.specialty}
                                onToggle={toggleSpecialty}
                            />

                            <FilterChipRow
                                filters={filters}
                                updateFilter={updateFilter}
                                patchFilters={patchFilters}
                                facets={facets}
                                activeCount={activeCount}
                                onOpenFilters={() => setFiltersOpen(true)}
                            />
                        </div>
                    </div>

                    <div className={`ms-results${view === 'map' ? ' is-map' : ''}`}>
                        {/* ── List ──
                            Rendered, not merely hidden, when the map has the
                            screen to itself: a display:none list still reports
                            zero-height rows to the virtualizer, which resizes
                            the body, which re-fires the observer that measures
                            the list. That loop is a hard crash, not a flicker. */}
                        {view === 'list' && (
                        <div className="ms-results-list">
                            <FilterSummary
                                filters={filters}
                                updateFilter={updateFilter}
                                patchFilters={patchFilters}
                                resetFilters={resetFilters}
                                count={providers.length}
                                activeCount={activeCount}
                                postalKnown={postalKnown}
                            />

                            {loading ? (
                                <div style={{
                                    display: 'flex', flexDirection: 'column',
                                    gap: `${ROW_GAP}px`, marginTop: '0.9rem',
                                }}>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="skeleton"
                                            style={{
                                                width: '100%', height: ROW_HEIGHT,
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid var(--border)',
                                            }}
                                        />
                                    ))}
                                </div>
                            ) : providers.length === 0 ? (
                                <EmptyState onClear={resetFilters} />
                            ) : (
                                <div ref={attachList} style={{ marginTop: '0.9rem' }}>
                                    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                            const p = providers[virtualRow.index];
                                            return (
                                                <div
                                                    key={p.id}
                                                    data-index={virtualRow.index}
                                                    ref={rowVirtualizer.measureElement}
                                                    style={{
                                                        position: 'absolute', top: 0, left: 0, width: '100%',
                                                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                                                        paddingBottom: ROW_GAP,
                                                    }}
                                                >
                                                    <ProviderCard
                                                        provider={p}
                                                        selected={selectedProvider?.id === p.id}
                                                        onClick={handleSelect}
                                                        onHover={setHoveredId}
                                                        focused={focusedId === p.id}
                                                        distance={distanceOf(p)}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {/* ── Map ── */}
                        <div
                            className="ms-results-map"
                            style={{
                                top: NAV_HEIGHT + bandHeight,
                                height: `calc(100dvh - ${NAV_HEIGHT + bandHeight}px)`,
                            }}
                        >
                            {/* The map draws a capped subset of the results.
                                Saying so is what keeps a map showing 150 of 807
                                from reading as a map that lost 657 clinics. */}
                            {pinCount && pinCount.shown < pinCount.total && (
                                <div className="ms-map-note" role="status">
                                    {t(pinCount.capped ? 'map.showingCapped' : 'map.showingInView', {
                                        shown: pinCount.shown,
                                        total: pinCount.total,
                                    })}
                                </div>
                            )}
                            <Suspense fallback={<MapPlaceholder label={t('map.loading')} />}>
                                <MapView
                                    providers={providers}
                                    allProviders={allProviders}
                                    selectedProvider={selectedProvider}
                                    onProviderSelect={handleProviderFromMap}
                                    hoveredId={hoveredId}
                                    onProviderFocus={setFocusedId}
                                    onSearchArea={handleSearchArea}
                                    mapArea={filters.mapArea}
                                    fitKey={fitKey}
                                    onVisibleCountChange={handleVisibleCount}
                                />
                            </Suspense>
                        </div>
                    </div>

                    {/* The split is a desktop luxury; on a phone the two views
                        take turns, and this is how you switch. */}
                    <button
                        onClick={() => setView(view === 'map' ? 'list' : 'map')}
                        className="ms-view-fab press"
                    >
                        {view === 'map' ? <IconList size={16} /> : <IconMapPin size={16} />}
                        {view === 'map' ? t('map.listShort') : t('map.mapShort')}
                    </button>
                </>
            ) : (
                <>
                    {/* ── Discover ── */}
                    <section className="ms-hero-section">
                        <div className="ms-hero-copy">
                            <h1 className="display ms-hero-title">
                                {t('discover.heroTitle')}
                            </h1>
                            <p className="ms-hero-sub">{t('discover.heroSubtitle')}</p>
                        </div>
                        {hero}
                    </section>

                    <div className="ms-cats-band">
                        <div className="ms-band-inner">
                            <CategoryRail
                                order={specialtyOrder}
                                active={filters.specialty}
                                onToggle={toggleSpecialty}
                            />
                        </div>
                    </div>

                    <div className="ms-discover">
                        <Discover
                            rows={discoverRows}
                            loading={loading}
                            onSelect={handleSelect}
                            onSeeAll={runSearch}
                        />
                    </div>
                </>
            )}

            {filtersOpen && (
                <FilterModal
                    filters={filters}
                    updateFilter={updateFilter}
                    patchFilters={patchFilters}
                    resetFilters={resetFilters}
                    facets={facets}
                    count={providers.length}
                    onClose={() => setFiltersOpen(false)}
                />
            )}

            {selectedProvider && (
                <Suspense fallback={null}>
                    <ProviderDrawer provider={selectedProvider} onClose={() => setSelectedProvider(null)} />
                </Suspense>
            )}
        </div>
    );
}

function MapPlaceholder({ label }: { label: string }) {
    return (
        <div style={{
            position: 'absolute', inset: 0, background: 'var(--surface)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '1.1rem',
        }}>
            <LogoMark size={48} idle />
            <p style={{
                color: 'var(--gray-400)', fontWeight: 700,
                letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: '0.72rem',
            }}>
                {label}
            </p>
        </div>
    );
}

function EmptyState({ onClear }: { onClear: () => void }) {
    const { t } = useTranslation();
    return (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--gray-400)' }}>
            <div style={{
                width: 64, height: 64, margin: '0 auto 1.25rem', borderRadius: '50%',
                background: 'var(--surface)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--gray-600)',
            }}>
                <IconSearch size={28} />
            </div>
            <p style={{ marginBottom: '0.6rem', fontSize: '1rem', color: 'var(--white)', fontWeight: 600 }}>
                {t('map.noResults')}
            </p>
            <button
                onClick={onClear}
                style={{ color: 'var(--gold)', background: 'none', fontSize: '0.9rem', marginBottom: '2rem', fontWeight: 700 }}
            >
                {t('filters.clearFilters')}
            </button>
            <div style={{ paddingTop: '1.75rem', borderTop: '1px solid var(--border)', maxWidth: 420, margin: '0 auto' }}>
                <p style={{ marginBottom: '0.9rem', fontSize: '0.9rem' }}>{t('map.suggestClinic')}</p>
                <a
                    href="mailto:hello@medsociety.one?subject=Suggest%20a%20Clinic"
                    className="press"
                    style={{
                        display: 'inline-flex', padding: '0.65rem 1.25rem',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        color: 'var(--white)', fontWeight: 700, fontSize: '0.9rem',
                    }}
                >
                    {t('map.suggestBtn')}
                </a>
            </div>
        </div>
    );
}
