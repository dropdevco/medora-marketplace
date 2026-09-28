import { lazy, Suspense, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';
import { useProvider } from '../hooks/useProvider';
import { useGoogleReviews } from '../hooks/useGoogleReviews';
import { usePortraitPhoto } from '../hooks/usePortraitPhoto';
import { ratingOf, ratingSource } from '../utils/rating';
import { formatPrice } from '../utils/currency';
import { profileViews } from '../utils/profileViews';
import { ReviewCarousel } from '../components/provider/ReviewCarousel';
import { ClinicPhotos } from '../components/provider/ClinicPhotos';
import { InsuranceList } from '../components/provider/InsuranceList';
import { ServiceList } from '../components/provider/ServiceList';
import { LogoMark } from '../components/brand/Logo';
import {
    IconChevronLeft, IconStar, IconMapPin, IconPhone, IconLanguage,
    IconPromoted, IconVerified, IconReviews, IconViews, IconGlobe,
    SpecialtyIcon, CountryIcon,
} from '../components/icons/Icons';

const NAV_HEIGHT = 68;

/** The map is the heaviest thing on this page — never pay for it before it scrolls into view. */
const ProviderMap = lazy(() =>
    import('../components/map/ProviderMap').then((m) => ({ default: m.ProviderMap })),
);

/**
 * The dedicated page for one provider — what used to be a side-panel pop-up
 * (`ProviderDrawer`) that covered the results list. A URL of its own is the
 * whole point: it can be bookmarked, shared, opened in a new tab, and it
 * survives a refresh, none of which a `selectedProvider` piece of page state
 * ever could.
 */
export function ProviderPage() {
    const { t } = useTranslation();
    const { providerId } = useParams<{ providerId: string }>();
    const { provider, loading } = useProvider(providerId);
    const navigate = useNavigate();
    const location = useLocation();

    usePageMeta(provider);

    const goBack = () => {
        // `location.key === 'default'` means this tab has no in-app history to
        // go back to — a direct link or a hard refresh — so Back has nothing
        // to land on and would leave the app entirely (or do nothing).
        if (location.key !== 'default') navigate(-1);
        else navigate('/');
    };

    if (loading) {
        return (
            <div className="ms-page" style={{ paddingTop: NAV_HEIGHT }}>
                <div style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem 1.25rem' }}>
                    <div className="skeleton" style={{ width: 140, height: 30, borderRadius: 8, marginBottom: '1.5rem' }} />
                    <div className="skeleton" style={{ width: '100%', height: 180, borderRadius: 'var(--radius)', marginBottom: '1.25rem' }} />
                    <div className="skeleton" style={{ width: '60%', height: 28, borderRadius: 8, marginBottom: '0.75rem' }} />
                    <div className="skeleton" style={{ width: '40%', height: 18, borderRadius: 8 }} />
                </div>
            </div>
        );
    }

    if (!provider) {
        return (
            <div className="ms-page" style={{ paddingTop: NAV_HEIGHT }}>
                <div style={{
                    maxWidth: 480, margin: '0 auto', padding: '4rem 1.25rem', textAlign: 'center',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem', color: 'var(--gray-500)' }}>
                        <LogoMark size={40} />
                    </div>
                    <p style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                        {t('providerPage.notFoundTitle')}
                    </p>
                    <p style={{ fontSize: '0.9rem', color: 'var(--gray-400)', marginBottom: '1.75rem', lineHeight: 1.55 }}>
                        {t('providerPage.notFoundBody')}
                    </p>
                    <Link
                        to="/"
                        className="press"
                        style={{
                            display: 'inline-flex', padding: '0.7rem 1.4rem',
                            borderRadius: 'var(--radius-pill)', background: 'var(--brand)',
                            color: 'var(--on-brand)', fontWeight: 700, fontSize: '0.9rem',
                            textDecoration: 'none',
                        }}
                    >
                        {t('providerPage.backToDirectory')}
                    </Link>
                </div>
            </div>
        );
    }

    return <ProviderPageBody provider={provider} onBack={goBack} />;
}

/**
 * Sets `document.title` and the `<meta name="description">` for the loaded
 * provider, restoring whatever the app had before once the page unmounts —
 * this route is one page in a full SPA nav tree, not a standalone document,
 * so it must give the title back rather than leave the next page wearing it.
 */
function usePageMeta(provider: Provider | null) {
    const { t, i18n } = useTranslation();

    useEffect(() => {
        if (!provider) return;

        const previousTitle = document.title;
        const metaEl = document.querySelector('meta[name="description"]');
        const previousDescription = metaEl?.getAttribute('content') ?? null;

        document.title = t('providerPage.pageTitle', {
            name: provider.name,
            defaultValue: `${provider.name} — MedSociety`,
        });

        const specialtyLabel = provider.specialty
            .map((s) => t(`specialties.${s}`, { defaultValue: s }))
            .join(', ');
        const description = t('providerPage.pageDescription', {
            name: provider.name,
            specialty: specialtyLabel,
            city: provider.city,
            defaultValue: `${provider.name} — ${specialtyLabel} in ${provider.city}. Ratings, prices, insurance and contact info on MedSociety.`,
        });
        metaEl?.setAttribute('content', description);

        return () => {
            document.title = previousTitle;
            if (metaEl && previousDescription !== null) metaEl.setAttribute('content', previousDescription);
        };
    }, [provider, t, i18n.language]);
}

function ProviderPageBody({ provider, onBack }: { provider: Provider; onBack: () => void }) {
    const { t, i18n } = useTranslation();
    const { reviews, loading: reviewsLoading } = useGoogleReviews(provider.googlePlaceId);
    const { url: portrait } = usePortraitPhoto(provider);

    const rating = ratingOf(provider);
    const specialtyLabel = (s: string) => t(`specialties.${s}`, { defaultValue: s });
    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const accentSoft = provider.country === 'MX' ? 'var(--mx-soft)' : 'var(--us-soft)';
    const views = profileViews(provider);
    const hasCoords = Number.isFinite(provider.lat) && Number.isFinite(provider.lng);

    const directionsUrl = hasCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${provider.lat},${provider.lng}`
            + (provider.googlePlaceId ? `&destination_place_id=${encodeURIComponent(provider.googlePlaceId)}` : '')
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(provider.address)}`;

    return (
        <div className="ms-page" style={{ paddingTop: NAV_HEIGHT }}>
            <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>
                <button
                    onClick={onBack}
                    className="press"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        background: 'none', color: 'var(--gray-400)', fontWeight: 650,
                        fontSize: '0.85rem', padding: '0.3rem 0', marginBottom: '1.25rem',
                    }}
                >
                    <IconChevronLeft size={16} weight={2} /> {t('providerPage.backToResults')}
                </button>

                <div className="ms-provider-layout">
                    {/* ── Main column ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem', minWidth: 0 }}>
                        {/* Header */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.2rem' }}>
                            {provider.promoted && (
                                <Badge icon={<IconPromoted size={11} weight={2} />} label={t('drawer.promoted')} bg="var(--brand)" fg="var(--on-brand)" />
                            )}
                            {provider.verified ? (
                                <Badge icon={<IconVerified size={11} weight={2} />} label={t('drawer.verified')} bg="var(--gold-dim)" fg="var(--gold)" />
                            ) : provider.licensed ? (
                                <Badge icon={<IconVerified size={11} weight={2} />} label={t('drawer.licensed')} bg="var(--surface)" fg="var(--gray-400)" />
                            ) : null}
                            <Badge
                                icon={<CountryIcon country={provider.country} size={11} weight={2} />}
                                label={provider.country === 'MX' ? t('drawer.ciudadJuarez') : t('drawer.elPaso')}
                                bg={accentSoft}
                                fg={accent}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                            <div
                                style={{
                                    width: 72, height: 72, borderRadius: 16, flexShrink: 0,
                                    overflow: 'hidden',
                                    background: portrait ? 'var(--surface)' : accentSoft,
                                    color: accent,
                                    border: `1px solid ${portrait ? 'var(--border)' : accent}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                {portrait ? (
                                    <img src={portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <SpecialtyIcon specialty={provider.specialty[0]} size={32} />
                                )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <h1 style={{ fontSize: '1.7rem', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.015em' }}>
                                    {provider.name}
                                </h1>
                                <p style={{ fontSize: '0.95rem', color: 'var(--gray-400)', marginTop: '0.35rem', lineHeight: 1.5 }}>
                                    {provider.specialty.map(specialtyLabel).join(' · ')}
                                </p>
                            </div>
                        </div>

                        {/* Stats */}
                        <div
                            style={{
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)', padding: '1.1rem 0.75rem',
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
                                label={t(`drawer.reviewsOn.${ratingSource(provider)}`)}
                            />
                            <Divider />
                            <StatBox
                                icon={<IconViews size={19} style={{ color: 'var(--gray-500)' }} />}
                                value={views.toLocaleString(i18n.language)}
                                label={t('drawer.profileViews')}
                            />
                        </div>

                        {provider.priceFromMxn != null && (
                            <p style={{ fontSize: '0.95rem' }}>
                                <span style={{ color: 'var(--gray-400)' }}>{t('providerPage.pricesFrom')} </span>
                                <strong style={{ color: 'var(--gold)' }}>{formatPrice(provider.priceFromMxn, i18n.language)}</strong>
                            </p>
                        )}

                        {/* Languages — only ever a stated fact, never a guess. */}
                        <DetailRow
                            icon={<IconLanguage size={17} />}
                            text={provider.languagesConfirmed && provider.languages.length > 0
                                ? provider.languages
                                    .map((l) => (l === 'en' ? t('drawer.languageEN') : t('drawer.languageES')))
                                    .join(' · ')
                                : t('drawer.languageUnknown')}
                            muted={!provider.languagesConfirmed || provider.languages.length === 0}
                        />

                        <ClinicPhotos placeId={provider.googlePlaceId} portrait={portrait} />

                        <InsuranceList insurances={provider.insurances ?? []} />

                        <ServiceList services={provider.services ?? []} collapsible={false} />

                        <ReviewCarousel reviews={reviews} loading={reviewsLoading} />

                        {provider.tier === 'basic' && (
                            <Link
                                to={`/claim/${provider.id}`}
                                style={{
                                    display: 'block', textAlign: 'center',
                                    padding: '0.8rem', borderRadius: 'var(--radius)',
                                    border: '1px dashed var(--border-strong)',
                                    color: 'var(--gray-400)', fontSize: '0.86rem',
                                    fontWeight: 650, textDecoration: 'none',
                                }}
                            >
                                {t('drawer.claimThis')}
                            </Link>
                        )}
                    </div>

                    {/* ── Sidebar ── */}
                    <aside className="ms-provider-sidebar">
                        <div
                            style={{
                                background: 'var(--navy-800)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)', padding: '1.25rem',
                                display: 'flex', flexDirection: 'column', gap: '0.9rem',
                                boxShadow: 'var(--shadow-sm)',
                            }}
                        >
                            <h2 style={{
                                fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
                                textTransform: 'uppercase', color: 'var(--gray-500)', margin: 0,
                            }}>
                                {t('providerPage.contact')}
                            </h2>

                            <DetailRow icon={<IconMapPin size={17} />} text={provider.address} />
                            {provider.postalCode && (
                                <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)', marginTop: '-0.5rem', marginLeft: '1.55rem' }}>
                                    {provider.city}, {provider.country} · {provider.postalCode}
                                </p>
                            )}
                            {provider.phone && (
                                <DetailRow icon={<IconPhone size={17} />} text={provider.phone} href={`tel:${provider.phone}`} />
                            )}
                            {provider.email && (
                                <DetailRow icon={<IconGlobe size={17} />} text={provider.email} href={`mailto:${provider.email}`} />
                            )}
                            {provider.website && (
                                <DetailRow
                                    icon={<IconGlobe size={17} />}
                                    text={t('providerPage.website')}
                                    href={provider.website}
                                    external
                                />
                            )}

                            {provider.phone && (
                                <a
                                    href={`tel:${provider.phone}`}
                                    className="press"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        padding: '0.9rem 1rem', borderRadius: 'var(--radius)',
                                        background: 'var(--brand)', color: 'var(--on-brand)',
                                        fontWeight: 700, fontSize: '0.92rem', textDecoration: 'none',
                                    }}
                                >
                                    <IconPhone size={17} weight={2} /> {t('drawer.callNow')}
                                </a>
                            )}

                            {provider.bookingUrl && (
                                <a
                                    href={provider.bookingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="press"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        padding: '0.8rem 1rem', borderRadius: 'var(--radius)',
                                        border: '1px solid var(--border)', background: 'transparent',
                                        color: 'var(--text)', fontWeight: 650, fontSize: '0.9rem', textDecoration: 'none',
                                    }}
                                >
                                    {t('drawer.bookOnline')}
                                </a>
                            )}

                            <a
                                href={directionsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="press"
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                    padding: '0.8rem 1rem', borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)', background: 'transparent',
                                    color: 'var(--text)', fontWeight: 650, fontSize: '0.9rem', textDecoration: 'none',
                                }}
                            >
                                <IconMapPin size={16} weight={2} /> {t('providerPage.getDirections')}
                            </a>

                            <div style={{ height: 200, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                                {hasCoords ? (
                                    <Suspense fallback={<MapPlaceholder />}>
                                        <ProviderMap
                                            lat={provider.lat}
                                            lng={provider.lng}
                                            name={provider.name}
                                            address={provider.address}
                                            directionsUrl={directionsUrl}
                                        />
                                    </Suspense>
                                ) : (
                                    <MapPlaceholder />
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}

function MapPlaceholder() {
    return (
        <div style={{
            width: '100%', height: '100%', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--surface)',
        }} />
    );
}

function Badge({ icon, label, bg, fg }: { icon: React.ReactNode; label: string; bg: string; fg: string }) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.28rem',
                padding: '0.22rem 0.6rem', borderRadius: 'var(--radius-pill)',
                background: bg, color: fg, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
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

function DetailRow({ icon, text, href, muted = false, external = false }: {
    icon: React.ReactNode; text: string; href?: string; muted?: boolean; external?: boolean;
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
            <span style={{ wordBreak: 'break-word' }}>{text}</span>
        </div>
    );

    if (!href) return content;
    return (
        <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
            {content}
        </a>
    );
}
