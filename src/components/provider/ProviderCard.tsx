import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { portraitUrl, hueOf } from '../../utils/images';
import {
    IconStar, IconMapPin, IconChevronRight, IconPromoted,
    IconVerified, IconClipboard, SpecialtyIcon, CountryIcon,
} from '../icons/Icons';

interface ProviderCardProps {
    provider: Provider;
    selected: boolean;
    onClick: (p: Provider) => void;
    /** Kilometres from the searched postal centre. Undefined outside a location search. */
    distance?: number;
    /**
     * Fires with this card's id on pointer or keyboard focus, and with null on
     * leave. The page forwards it to the map, which lights the matching pin.
     */
    onHover?: (id: string | null) => void;
}

/** Insurers are long names; two is what fits before the row starts lying about the rest. */
const INSURANCE_CHIPS = 2;

export function ProviderCard({ provider, selected, onClick, distance, onHover }: ProviderCardProps) {
    const { t } = useTranslation();
    const photo = portraitUrl(provider.imageUrl);

    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const accentSoft = provider.country === 'MX' ? 'var(--mx-soft)' : 'var(--us-soft)';
    const sideLabel = provider.country === 'MX' ? t('drawer.ciudadJuarez') : t('drawer.elPaso');

    const insurances = provider.insurances ?? [];
    const extraInsurers = Math.max(0, insurances.length - INSURANCE_CHIPS);

    return (
        <button
            onClick={() => onClick(provider)}
            aria-pressed={selected}
            style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.9rem 1rem',
                borderRadius: 'var(--radius)',
                background: selected ? 'var(--gold-dim)' : 'var(--navy-800)',
                border: `1px solid ${selected ? 'var(--gold)' : 'var(--border)'}`,
                color: 'var(--white)',
                transition: 'background var(--transition), border-color var(--transition), box-shadow var(--transition)',
                cursor: 'pointer',
                display: 'flex',
                gap: '0.85rem',
                animation: 'fadeIn 0.25s var(--ease-out) both',
            }}
            onMouseEnter={(e) => {
                onHover?.(provider.id);
                if (selected) return;
                e.currentTarget.style.borderColor = 'var(--border-strong)';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
            }}
            onMouseLeave={(e) => {
                onHover?.(null);
                if (selected) return;
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
            }}
            // Tabbing through results lights the map too — the sync is not a
            // mouse feature, it is how the two panels stay one view.
            onFocus={() => onHover?.(provider.id)}
            onBlur={() => onHover?.(null)}
        >
            {/*
              Portrait when there is a real one. Two thirds of the directory
              carries the source site's generic Open Graph banner instead, which
              portraitUrl() strips — a tinted specialty panel says "no photo"
              far more honestly than the same logo repeated down the page.
            */}
            <div
                className={photo ? undefined : 'ms-mono'}
                style={{
                    ['--mono-h' as string]: `${hueOf(provider.id)}deg`,
                    width: 74, height: 74, borderRadius: 15, flexShrink: 0, overflow: 'hidden',
                    position: 'relative',
                    background: photo ? 'var(--surface)' : undefined,
                    color: photo ? accent : undefined,
                    border: `1px solid ${provider.promoted ? 'var(--gold)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                } as React.CSSProperties}
            >
                {photo ? (
                    <img
                        src={photo}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : (
                    <SpecialtyIcon specialty={provider.specialty[0]} size={30} weight={1.6} />
                )}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {/* nowrap: in Spanish this row used to wrap onto a second line
                    and push the card past its row height. */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    flexWrap: 'nowrap', overflow: 'hidden',
                }}>
                    {provider.promoted && (
                        <Badge bg="var(--brand)" fg="var(--on-brand)">
                            <IconPromoted size={10} weight={2} /> {t('drawer.promoted')}
                        </Badge>
                    )}
                    {provider.verified && (
                        <Badge bg="var(--surface)" fg="var(--gray-300)">
                            <IconVerified size={11} weight={2} /> {t('drawer.verified')}
                        </Badge>
                    )}
                    <Badge bg={accentSoft} fg={accent}>
                        <CountryIcon country={provider.country} size={11} weight={2} /> {sideLabel}
                    </Badge>
                </div>

                <p style={{
                    fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.25,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {provider.name}
                </p>

                <p style={{
                    fontSize: '0.85rem', color: 'var(--gray-400)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {provider.specialty.map((s) => t(`specialties.${s}`, { defaultValue: s })).join(' · ')}
                </p>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.85rem',
                    flexWrap: 'nowrap', overflow: 'hidden',
                }}>
                    <RatingBadge rating={provider.rating} count={provider.reviewCount} />

                    <span style={{
                        display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0,
                        fontSize: '0.82rem', color: 'var(--gray-400)',
                    }}>
                        <IconMapPin size={14} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {provider.address || provider.city}
                        </span>
                    </span>

                    {distance != null && Number.isFinite(distance) && (
                        <span style={{
                            fontSize: '0.8rem', fontWeight: 700, color: 'var(--gray-300)',
                            whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                            {t('filters.radiusKm', { km: distance < 10 ? distance.toFixed(1) : Math.round(distance) })}
                        </span>
                    )}
                </div>

                {(provider.priceFromMxn != null || provider.bookingUrl || insurances.length > 0) && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.35rem',
                        flexWrap: 'nowrap', overflow: 'hidden',
                    }}>
                        {provider.priceFromMxn != null && (
                            <Badge bg="var(--gold-dim)" fg="var(--gold)">
                                {t('card.priceFrom', {
                                    price: `$${provider.priceFromMxn.toLocaleString()}`,
                                    defaultValue: `From $${provider.priceFromMxn.toLocaleString()}`,
                                })}
                            </Badge>
                        )}
                        {provider.bookingUrl && (
                            <Badge bg="var(--surface)" fg="var(--gray-300)">
                                <IconClipboard size={11} weight={2} />
                                {t('filters.bookable', { defaultValue: 'Books online' })}
                            </Badge>
                        )}
                        {insurances.slice(0, INSURANCE_CHIPS).map((name) => (
                            <Badge key={name} bg="transparent" fg="var(--gray-500)" outlined>
                                {name}
                            </Badge>
                        ))}
                        {extraInsurers > 0 && (
                            <Badge bg="transparent" fg="var(--gray-500)" outlined>
                                +{extraInsurers}
                            </Badge>
                        )}
                    </div>
                )}
            </div>

            <span style={{ color: 'var(--gray-500)', flexShrink: 0, alignSelf: 'center', display: 'flex' }}>
                <IconChevronRight size={18} />
            </span>
        </button>
    );
}

function Badge({ bg, fg, outlined, children }: {
    bg: string; fg: string; outlined?: boolean; children: React.ReactNode;
}) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.12rem 0.5rem', borderRadius: 'var(--radius-pill)',
                background: bg, color: fg,
                border: outlined ? '1px solid var(--border)' : 'none',
                fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap',
                maxWidth: '11rem', overflow: 'hidden', textOverflow: 'ellipsis',
                flexShrink: 0,
            }}
        >
            {children}
        </span>
    );
}

export function RatingBadge({ rating, count }: { rating: number; count: number }) {
    return (
        <span style={{
            display: 'flex', alignItems: 'center', gap: '0.28rem',
            fontSize: '0.82rem', flexShrink: 0,
        }}>
            <IconStar size={14} filled style={{ color: 'var(--star)' }} />
            <strong style={{ color: 'var(--white)', fontWeight: 800 }}>{rating.toFixed(1)}</strong>
            <span style={{ color: 'var(--gray-400)' }}>({count.toLocaleString()})</span>
        </span>
    );
}
