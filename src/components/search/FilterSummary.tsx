import { useTranslation } from 'react-i18next';
import type { ProviderFilters, SortMode, Specialty } from '../../types/provider';
import { IconClose } from '../icons/Icons';
import { RADIUS_OPTIONS } from '../../utils/geo';

const SORTS: SortMode[] = ['relevance', 'rating', 'reviews', 'distance', 'price'];

interface FilterSummaryProps {
    filters: ProviderFilters;
    updateFilter: <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => void;
    patchFilters: (patch: Partial<ProviderFilters>) => void;
    resetFilters: () => void;
    count: number;
    activeCount: number;
    /** False when the searched code matches no provider we hold. */
    postalKnown: boolean;
}

/**
 * The line above the results: how many, in what order, and what is narrowing
 * them.
 *
 * It sits inside the scrolling column rather than in the sticky toolbar,
 * because it is a caption for the list — the same place Airbnb puts "613
 * places in Ruidoso". Every active filter appears here as a removable chip,
 * which is what stands between a user and wondering why the directory looks
 * so small.
 */
export function FilterSummary({
    filters, updateFilter, patchFilters, resetFilters, count, activeCount,
    postalKnown,
}: FilterSummaryProps) {
    const { t } = useTranslation();

    const drop = <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) =>
        () => updateFilter(key, value);

    const remove = <T,>(list: T[], v: T) => list.filter((x) => x !== v);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '0.6rem', flexWrap: 'wrap',
            }}>
                <span style={{ fontSize: '0.88rem', color: 'var(--gray-400)' }}>
                    <strong style={{ color: 'var(--white)', fontWeight: 800, fontSize: '1.05rem' }}>
                        {count.toLocaleString()}
                    </strong>
                    {' '}{t('filters.providersFoundSuffix', { count })}
                </span>

                {/* Wraps: on a 375px screen the filters button, the sort select
                    and the view toggle do not fit on one line, and without this
                    they pushed the page 130px wider than the viewport. */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    flexWrap: 'wrap', minWidth: 0,
                }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                            {t('filters.sortLabel', { defaultValue: 'Sort' })}
                        </span>
                        <select
                            value={filters.sort}
                            onChange={(e) => updateFilter('sort', e.target.value as SortMode)}
                            style={{
                                background: 'var(--navy-800)', color: 'var(--white)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-pill)',
                                fontSize: '0.82rem', fontWeight: 700,
                                padding: '0.35rem 0.6rem',
                            }}
                        >
                            {SORTS
                                // Nearest is only an order when we have a point
                                // to measure from.
                                .filter((s) => s !== 'distance' || filters.postalCode)
                                .map((s) => (
                                    <option key={s} value={s}>
                                        {t(`filters.sort.${s}`, { defaultValue: s })}
                                    </option>
                                ))}
                        </select>
                    </label>

                </div>
            </div>

            {(activeCount > 0) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {filters.postalCode && (
                        <PostalChip
                            code={filters.postalCode}
                            known={postalKnown}
                            radiusKm={filters.radiusKm}
                            onRadius={(km) => updateFilter('radiusKm', km)}
                            onClear={() => patchFilters({ postalCode: '', radiusKm: filters.radiusKm })}
                        />
                    )}

                    {filters.country && (
                        <FilterChip
                            label={filters.country === 'MX' ? t('filters.juarez') : t('filters.elPaso')}
                            onRemove={drop('country', '')}
                        />
                    )}

                    {filters.specialty.map((s: Specialty) => (
                        <FilterChip
                            key={s}
                            label={t(`specialties.${s}`)}
                            onRemove={() => updateFilter('specialty', remove(filters.specialty, s))}
                        />
                    ))}

                    {filters.insurances.map((i) => (
                        <FilterChip
                            key={i}
                            label={i}
                            onRemove={() => updateFilter('insurances', remove(filters.insurances, i))}
                        />
                    ))}

                    {filters.languages.map((l) => (
                        <FilterChip
                            key={l}
                            label={t(`languages.${l}`, { defaultValue: l.toUpperCase() })}
                            onRemove={() => updateFilter('languages', remove(filters.languages, l))}
                        />
                    ))}

                    {filters.minRating > 0 && (
                        <FilterChip
                            label={t('filters.ratingChip', {
                                rating: filters.minRating,
                                defaultValue: `${filters.minRating}+ stars`,
                            })}
                            onRemove={drop('minRating', 0)}
                        />
                    )}

                    {filters.bookableOnly && (
                        <FilterChip
                            label={t('filters.bookable', { defaultValue: 'Books online' })}
                            onRemove={drop('bookableOnly', false)}
                        />
                    )}

                    {filters.verifiedOnly && (
                        <FilterChip
                            label={t('filters.verified', { defaultValue: 'Verified credentials' })}
                            onRemove={drop('verifiedOnly', false)}
                        />
                    )}

                    {filters.withPricing && (
                        <FilterChip
                            label={filters.maxPriceMxn != null
                                ? `≤ $${filters.maxPriceMxn.toLocaleString()}`
                                : t('filters.withPricing', { defaultValue: 'Publishes prices' })}
                            onRemove={() => patchFilters({ withPricing: false, maxPriceMxn: null })}
                        />
                    )}

                    <button
                        onClick={resetFilters}
                        style={{
                            fontSize: '0.82rem', color: 'var(--gold)',
                            background: 'none', fontWeight: 700, padding: '0.2rem 0.3rem',
                        }}
                    >
                        {t('filters.clearFilters')}
                    </button>
                </div>
            )}
        </div>
    );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.28rem 0.4rem 0.28rem 0.7rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.79rem', fontWeight: 600,
                background: 'var(--navy-800)', color: 'var(--gray-200)',
                border: '1px solid var(--border)',
                maxWidth: '15rem',
            }}
        >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}
            </span>
            <button
                onClick={onRemove}
                aria-label={`Remove ${label}`}
                title={`Remove ${label}`}
                style={{ display: 'flex', background: 'none', color: 'inherit', padding: '0.1rem', flexShrink: 0 }}
            >
                <IconClose size={13} weight={2.2} />
            </button>
        </span>
    );
}

/** The location chip doubles as the radius control while a code is active. */
function PostalChip({ code, known, radiusKm, onRadius, onClear }: {
    code: string; known: boolean; radiusKm: number;
    onRadius: (km: number) => void; onClear: () => void;
}) {
    const { t } = useTranslation();
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.24rem 0.4rem 0.24rem 0.7rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.79rem', fontWeight: 600,
                background: known ? 'var(--navy-800)' : 'transparent',
                color: known ? 'var(--gray-200)' : 'var(--gold)',
                border: `1px solid ${known ? 'var(--border)' : 'var(--gold)'}`,
            }}
        >
            {known ? t('filters.nearPostal', { code }) : t('filters.postalNoMatch', { code })}

            {known && (
                <select
                    aria-label={t('filters.radiusLabel')}
                    value={radiusKm}
                    onChange={(e) => onRadius(Number(e.target.value))}
                    style={{
                        background: 'var(--surface)', color: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-pill)',
                        fontSize: '0.74rem', fontWeight: 700,
                        padding: '0.12rem 0.28rem',
                    }}
                >
                    {RADIUS_OPTIONS.map((km) => (
                        <option key={km} value={km}>{t('filters.radiusKm', { km })}</option>
                    ))}
                </select>
            )}

            <button
                onClick={onClear}
                aria-label={t('filters.clearPostal')}
                title={t('filters.clearPostal')}
                style={{ display: 'flex', background: 'none', color: 'inherit', padding: '0.1rem' }}
            >
                <IconClose size={13} weight={2.2} />
            </button>
        </span>
    );
}
