import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderFilters } from '../../types/provider';
import type { FacetCounts } from '../../utils/facets';
import { FilterBar } from './FilterBar';
import { IconClose } from '../icons/Icons';

interface FilterModalProps {
    filters: ProviderFilters;
    updateFilter: <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => void;
    patchFilters: (patch: Partial<ProviderFilters>) => void;
    resetFilters: () => void;
    facets: FacetCounts;
    /** Live result count — the footer button is the user's proof it worked. */
    count: number;
    onClose: () => void;
}

/**
 * Every filter, in a modal, at every breakpoint.
 *
 * The rail this replaces stole a fifth of the page on desktop and vanished
 * entirely on mobile, which meant two different filter experiences to keep
 * honest. One overlay gives the results the full width and gives the deep
 * filters the room they need, and the count in the footer updates as you tick
 * so nobody has to close it to find out what they did.
 */
export function FilterModal({
    filters, updateFilter, patchFilters, resetFilters, facets, count, onClose,
}: FilterModalProps) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        // The page behind still scrolls on wheel otherwise, which under a
        // full-height overlay looks like the modal itself failing to scroll.
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panelRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
    }, [onClose]);

    return (
        <div className="ms-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={t('filters.filtersLabel')}
                className="ms-modal"
            >
                <header className="ms-modal-head">
                    <button onClick={onClose} aria-label={t('drawer.close')} className="ms-modal-x">
                        <IconClose size={18} weight={2.2} />
                    </button>
                    <strong>{t('filters.filtersLabel')}</strong>
                </header>

                <div className="ms-modal-body">
                    <FilterBar
                        filters={filters}
                        updateFilter={updateFilter}
                        patchFilters={patchFilters}
                        facets={facets}
                    />
                </div>

                <footer className="ms-modal-foot">
                    <button onClick={resetFilters} className="ms-modal-clear">
                        {t('filters.clearFilters')}
                    </button>
                    <button onClick={onClose} className="ms-modal-go press">
                        {t('filters.showResults', {
                            count,
                            defaultValue: `Show ${count} results`,
                        })}
                    </button>
                </footer>
            </div>
        </div>
    );
}
