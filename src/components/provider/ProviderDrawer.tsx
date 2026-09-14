import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { ratingOf, ratingSource } from '../../utils/rating';
import { portraitUrl } from '../../utils/images';
import { useGoogleReviews } from '../../hooks/useGoogleReviews';
import { ReviewCarousel } from './ReviewCarousel';
import { ClinicPhotos } from './ClinicPhotos';
import { InsuranceList } from './InsuranceList';
import { ServiceList } from './ServiceList';
import {
    IconClose, IconStar, IconMapPin, IconPhone, IconLanguage,
    IconPromoted, IconVerified, IconReviews, IconViews,
    SpecialtyIcon, CountryIcon,
} from '../icons/Icons';

interface ProviderDrawerProps {
    provider: Provider | null;
    onClose: () => void;
}

export function ProviderDrawer({ provider, onClose }: ProviderDrawerProps) {
    const { t } = useTranslation();
    const { reviews, loading: reviewsLoading } = useGoogleReviews(provider?.googlePlaceId);

    // Escape closes the drawer — expected of any overlay panel.
    useEffect(() => {
        if (!provider) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [provider, onClose]);

    if (!provider) return null;

    const rating = ratingOf(provider);
    const portrait = portraitUrl(provider.imageUrl);
    const specialtyLabel = (s: string) => t(`specialties.${s}`, { defaultValue: s });
    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const accentSoft = provider.country === 'MX' ? 'var(--mx-soft)' : 'var(--us-soft)';

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0, zIndex: 200,
                    background: 'rgba(8, 15, 28, 0.35)',
                }}
            />

            <div
                className="drawer-panel"
                role="dialog"
                aria-label={provider.name}
                style={{
                    position: 'fixed', top: 68, right: 0, bottom: 0,
                    width: '100%', maxWidth: 440,
                    zIndex: 201,
                    background: 'var(--navy-800)',
                    borderLeft: '1px solid var(--border)',
                    overflowY: 'auto',
                    animation: 'slideInRight 0.26s var(--ease-out) both',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '1.35rem 1.35rem 1.15rem',
                        borderBottom: '1px solid var(--border)',
                        position: 'sticky', top: 0,
                        background: 'var(--navy-800)', zIndex: 1,
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.7rem' }}>
                                {provider.promoted && (
                                    <Badge
                                        icon={<IconPromoted size={11} weight={2} />}
                                        label={t('drawer.promoted')}
                                        bg="var(--brand)"
                                        fg="var(--on-brand)"
                                    />
                                )}
                                {/* Paid plan and professional licence are two
                                    different claims — see ProviderCard. */}
                                {provider.verified ? (
                                    <Badge
                                        icon={<IconVerified size={11} weight={2} />}
                                        label={t('drawer.verified')}
                                        bg="var(--gold-dim)"
                                        fg="var(--gold)"
                                    />
                                ) : provider.licensed ? (
                                    <Badge
                                        icon={<IconVerified size={11} weight={2} />}
                                        label={t('drawer.licensed')}
                                        bg="var(--surface)"
                                        fg="var(--gray-400)"
                                    />
                                ) : null}
                                <Badge
                                    icon={<CountryIcon country={provider.country} size={11} weight={2} />}
                                    label={provider.country === 'MX' ? t('drawer.ciudadJuarez') : t('drawer.elPaso')}
                                    bg={accentSoft}
                                    fg={accent}
                                />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem' }}>
                                {/*
                                  The drawer never showed the portrait the
                                  result card had just shown, so clicking a
                                  card with a photo opened a panel without one.
                                  Same source, same placeholder rules.
                                */}
                                <div
                                    style={{
                                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                                        overflow: 'hidden',
                                        background: portrait ? 'var(--surface)' : accentSoft,
                                        color: accent,
                                        border: `1px solid ${portrait ? 'var(--border)' : accent}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                >
                                    {portrait ? (
                                        <img
                                            src={portrait}
                                            alt=""
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <SpecialtyIcon specialty={provider.specialty[0]} size={21} />
                                    )}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <h2 style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.015em' }}>
                                        {provider.name}
                                    </h2>
                                    <p style={{ fontSize: '0.87rem', color: 'var(--gray-400)', marginTop: '0.25rem', lineHeight: 1.45 }}>
                                        {provider.specialty.map(specialtyLabel).join(' · ')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            aria-label={t('drawer.close')}
                            title={t('drawer.close')}
                            className="press"
                            style={{
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 9, padding: '0.45rem',
                                color: 'var(--gray-300)',
                                display: 'flex', alignItems: 'center', flexShrink: 0,
                            }}
                        >
                            <IconClose size={18} weight={2} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: '1.35rem', display: 'flex', flexDirection: 'column', gap: '1.4rem', flex: 1 }}>
                    {/* Stats */}
                    <div
                        style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            padding: '1.1rem 0.75rem',
                            display: 'flex', justifyContent: 'space-around',
                        }}
                    >
                        <StatBox
                            icon={<IconStar size={19} filled style={{ color: 'var(--star)' }} />}
                            value={rating !== null ? rating.toFixed(1) : '—'}
                            label={rating !== null ? t('drawer.rating') : t('card.unrated')}
                        />
                        <Divider />
                        <StatBox
                            icon={<IconReviews size={19} style={{ color: 'var(--gray-500)' }} />}
                            value={provider.reviewCount.toLocaleString()}
                            // Which site the reviews are on is the difference
                            // between "5.0 from 1,341 patient opinions" and a
                            // number the reader has no way to weigh.
                            label={t(`drawer.reviewsOn.${ratingSource(provider)}`)}
                        />
                        <Divider />
                        <StatBox
                            icon={<IconViews size={19} style={{ color: 'var(--gray-500)' }} />}
                            value={provider.clicks.toLocaleString()}
                            label={t('drawer.profileViews')}
                        />
                    </div>

                    {/* Contact */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <DetailRow icon={<IconMapPin size={17} />} text={provider.address} />
                        {provider.phone && (
                            <DetailRow icon={<IconPhone size={17} />} text={provider.phone} href={`tel:${provider.phone}`} />
                        )}
                        {/*
                          Empty is now the common case — languages is only
                          ever populated once a clinic states it through its
                          own dashboard (see migration 0004), and most
                          listings haven't been claimed yet. Saying so plainly
                          rather than rendering a blank line is the point: the
                          review that asked for this called it out as
                          "really key when reaching out to a doctor", and a
                          silent gap reads as "nobody bothered to check"
                          rather than "we genuinely don't know yet".
                        */}
                        <DetailRow
                            icon={<IconLanguage size={17} />}
                            text={provider.languages.length > 0
                                ? provider.languages
                                    .map((l) => (l === 'en' ? t('drawer.languageEN') : t('drawer.languageES')))
                                    .join(' · ')
                                : t('drawer.languageUnknown')}
                            muted={provider.languages.length === 0}
                        />
                    </div>

                    {/* Primary action — calling the clinic is the whole point of the page. */}
                    {provider.phone && (
                        <a
                            href={`tel:${provider.phone}`}
                            className="press"
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                padding: '0.95rem 1rem', borderRadius: 'var(--radius)',
                                background: 'var(--brand)', color: 'var(--on-brand)',
                                fontWeight: 700, fontSize: '0.95rem',
                                textDecoration: 'none',
                            }}
                        >
                            <IconPhone size={17} weight={2} /> {t('drawer.callNow')}
                        </a>
                    )}

                    {/* Online booking — only shown where the Doctoralia listing
                        actually has a bookable calendar, so the button never
                        leads to a dead end. */}
                    {provider.bookingUrl && (
                        <a
                            href={provider.bookingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="press"
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                padding: '0.85rem 1rem', borderRadius: 'var(--radius)',
                                border: '1px solid var(--border)', background: 'transparent',
                                color: 'var(--text)', fontWeight: 650, fontSize: '0.92rem',
                                textDecoration: 'none',
                            }}
                        >
                            {t('drawer.bookOnline')}
                        </a>
                    )}

                    <ClinicPhotos placeId={provider.googlePlaceId} portrait={portrait} />

                    <InsuranceList insurances={provider.insurances ?? []} />

                    <ServiceList services={provider.services ?? []} />

                    <ReviewCarousel reviews={reviews} loading={reviewsLoading} />

                    {/*
                      The only route from the public directory into the clinic
                      portal, and it sits at the bottom of the listing rather
                      than in the nav on purpose: the person who should see it
                      is the one reading their own practice's page, not every
                      patient in the header.

                      Hidden once the listing is on a paid tier, which for now
                      is the closest thing we have to "already claimed".
                    */}
                    {provider.tier === 'basic' && (
                        <Link
                            to={`/claim/${provider.id}`}
                            style={{
                                display: 'block', textAlign: 'center',
                                padding: '0.7rem', borderRadius: 'var(--radius)',
                                border: '1px dashed var(--border-strong)',
                                color: 'var(--gray-400)', fontSize: '0.84rem',
                                fontWeight: 650, textDecoration: 'none',
                            }}
                        >
                            {t('drawer.claimThis')}
                        </Link>
                    )}
                </div>
            </div>
        </>
    );
}

function Badge({ icon, label, bg, fg }: { icon: React.ReactNode; label: string; bg: string; fg: string }) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.28rem',
                padding: '0.22rem 0.6rem', borderRadius: 'var(--radius-pill)',
                background: bg, color: fg,
                fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
            }}
        >
            {icon} {label}
        </span>
    );
}

function Divider() {
    return <div style={{ width: 1, background: 'var(--border)' }} />;
}

function StatBox({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
            {icon}
            <span style={{ fontWeight: 800, fontSize: '1.2rem' }}>{value}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--gray-400)', textAlign: 'center' }}>{label}</span>
        </div>
    );
}

function DetailRow({ icon, text, href, muted = false }: {
    icon: React.ReactNode; text: string; href?: string; muted?: boolean;
}) {
    const content = (
        <div
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.65rem',
                fontSize: '0.9rem', lineHeight: 1.5,
                color: href ? 'var(--gold)' : muted ? 'var(--gray-500)' : 'var(--gray-300)',
                fontWeight: href ? 600 : 400,
                fontStyle: muted ? 'italic' : 'normal',
            }}
        >
            <span style={{ flexShrink: 0, marginTop: 1, color: 'var(--gray-500)', display: 'flex' }}>{icon}</span>
            <span>{text}</span>
        </div>
    );

    return href ? <a href={href} rel="noopener noreferrer">{content}</a> : content;
}
