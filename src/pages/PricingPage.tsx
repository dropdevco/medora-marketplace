import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { mockProviders } from '../data/providers';
import { useProviders } from '../hooks/useProviders';
import type { Provider } from '../types/provider';
import { InquiryModal } from '../components/sales/InquiryModal';
import { LogoMark } from '../components/brand/Logo';
import {
    IconArrowRight, IconMapPin, IconClinic, IconViews, IconStar, IconBorder,
    IconClipboard, IconMapPlane, IconChart, IconCheck, IconPromoted,
    IconUS, IconMX, IconShield, IconLanguage,
} from '../components/icons/Icons';

/**
 * The services sold alongside a listing.
 *
 * Copy lives in the locale files under `pricing.addon.<key>`; only the key and
 * the icon live here, so adding a service is a translation change plus one row
 * rather than a new block of JSX. Order is deliberate: the two that convert a
 * listing into bookings come first, because they are what a clinic is actually
 * trying to buy when it asks what a listing costs.
 */
const ADDONS = [
    { key: 'whatsapp', icon: <IconClipboard size={19} weight={1.8} /> },
    { key: 'payments', icon: <IconChart size={19} weight={1.8} /> },
    { key: 'website', icon: <IconMapPlane size={19} weight={1.8} /> },
    { key: 'reminders', icon: <IconViews size={19} weight={1.8} /> },
    { key: 'seo', icon: <IconStar size={19} weight={1.8} /> },
] as const;

interface Stats { providers: number; avgRating: string; clicks: number; specialties: number }

function computeStats(list: Provider[]): Stats {
    if (list.length === 0) return { providers: 0, avgRating: '0.0', clicks: 0, specialties: 0 };
    const specialties = new Set(list.flatMap((p) => p.specialty ?? []));
    return {
        providers: list.length,
        avgRating: (list.reduce((s, p) => s + (p.rating || 0), 0) / list.length).toFixed(1),
        clicks: list.reduce((s, p) => s + (p.clicks || 0), 0),
        specialties: specialties.size,
    };
}

export function PricingPage() {
    const { t } = useTranslation();
    const [modalPlan, setModalPlan] = useState<string | null>(null);

    // Quote the real directory, not the 16-row mock fixture. The mock is only
    // a placeholder while the fetch is in flight or Supabase is unreachable.
    const { allProviders } = useProviders();
    const stats = computeStats(allProviders.length > 0 ? allProviders : mockProviders);

    const openForm = (plan: string) => setModalPlan(plan);
    const closeForm = () => setModalPlan(null);

    return (
        <div style={{ paddingTop: 68 }}>
            {/* ══ Hero ══════════════════════════════════════════════
                Asymmetric editorial split. The previous version tracked the
                cursor with a radial gold glow; it is replaced by a static
                color block and a fine rule grid that hold their shape in
                both themes and cost nothing to paint.
                ═══════════════════════════════════════════════════════ */}
            <section
                style={{
                    position: 'relative',
                    overflow: 'hidden',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--navy)',
                }}
            >
                {/* Flat diagonal color block */}
                <div
                    aria-hidden
                    style={{
                        position: 'absolute', top: 0, right: 0,
                        width: '46%', height: '100%',
                        background: 'var(--surface)',
                        borderLeft: '1px solid var(--border)',
                        transform: 'skewX(-9deg)',
                        transformOrigin: 'top right',
                        pointerEvents: 'none',
                    }}
                />
                {/* Fine rule grid */}
                <svg
                    aria-hidden
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55, pointerEvents: 'none' }}
                >
                    <defs>
                        <pattern id="salesGrid" width="56" height="56" patternUnits="userSpaceOnUse">
                            <path d="M 56 0 L 0 0 0 56" fill="none" stroke="var(--border)" strokeWidth="1" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#salesGrid)" />
                </svg>

                <div
                    style={{
                        position: 'relative', zIndex: 1,
                        maxWidth: 1180, margin: '0 auto',
                        padding: '6rem 1.5rem 5.5rem',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
                        gap: '3.5rem',
                        alignItems: 'center',
                    }}
                    className="sales-hero-grid"
                >
                    <div>
                        <span className="eyebrow">{t('sales.heroEyebrow')}</span>

                        <h1
                            className="display"
                            style={{ fontSize: 'clamp(2.9rem, 6.2vw, 4.6rem)', margin: '1rem 0 1.35rem' }}
                        >
                            {t('sales.heroTitle')}{' '}
                            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>
                                {t('sales.heroTitleHighlight')}
                            </em>
                        </h1>

                        <p
                            style={{
                                fontSize: '1.15rem',
                                color: 'var(--gray-300)',
                                lineHeight: 1.65,
                                maxWidth: 520,
                                marginBottom: '2.25rem',
                            }}
                        >
                            {t('sales.heroSubtitle')}
                        </p>

                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <PrimaryCta onClick={() => openForm('hero')}>
                                {t('sales.heroCtaPrimary')}
                            </PrimaryCta>
                            <Link
                                to="/"
                                className="press"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.95rem 1.75rem', borderRadius: 'var(--radius-pill)',
                                    background: 'var(--navy-800)', border: '1px solid var(--border-strong)',
                                    color: 'var(--white)', fontWeight: 700, fontSize: '0.98rem',
                                }}
                            >
                                <IconMapPin size={18} /> {t('sales.heroCtaSecondary')}
                            </Link>
                        </div>

                        <div
                            style={{
                                display: 'flex', flexWrap: 'wrap', gap: '1.35rem',
                                marginTop: '2.5rem', paddingTop: '1.6rem',
                                borderTop: '1px solid var(--border)',
                            }}
                        >
                            <TrustPoint icon={<IconShield size={17} />} label={t('sales.trustVerified')} />
                            <TrustPoint icon={<IconLanguage size={17} />} label={t('sales.trustBilingual')} />
                            <TrustPoint icon={<IconBorder size={17} />} label={t('sales.trustBorder')} />
                        </div>
                    </div>

                    <BorderMapArt />
                </div>
            </section>

            {/* ══ Stats ══════════════════════════════════════════════ */}
            <section style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <Reveal>
                    <div
                        style={{
                            maxWidth: 1180, margin: '0 auto',
                            padding: '3.5rem 1.5rem',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                            gap: '1.25rem',
                        }}
                    >
                        <StatTile icon={<IconClinic size={24} />} value={`${stats.providers}+`} label={t('sales.statsProviders')} accent="var(--us)" />
                        {/*
                          Profile views only appear once click tracking actually
                          records something. Until then we show a figure we can
                          stand behind rather than advertising a zero.
                        */}
                        {stats.clicks > 0 ? (
                            <StatTile icon={<IconViews size={24} />} value={stats.clicks.toLocaleString()} label={t('sales.statsViews')} accent="var(--gold)" />
                        ) : (
                            <StatTile icon={<IconClipboard size={24} />} value={String(stats.specialties)} label={t('sales.statsSpecialties')} accent="var(--gold)" />
                        )}
                        <StatTile icon={<IconStar size={24} />} value={stats.avgRating} label={t('sales.statsRating')} accent="var(--star)" />
                        <StatTile icon={<IconBorder size={24} />} value="2" label={t('sales.statsCities')} accent="var(--mx)" />
                    </div>
                </Reveal>
            </section>

            {/* ══ How it works ═══════════════════════════════════════ */}
            <section style={{ padding: '6.5rem 1.5rem' }}>
                <Reveal>
                    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
                        <SectionHead eyebrow={t('sales.howEyebrow')} title={t('sales.howTitle')} body={t('sales.howSubtitle')} />
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
                                gap: '1.35rem',
                            }}
                        >
                            <StepCard step="01" icon={<IconClipboard size={26} />} title={t('sales.step1Title')} body={t('sales.step1Body')} />
                            <StepCard step="02" icon={<IconMapPlane size={26} />} title={t('sales.step2Title')} body={t('sales.step2Body')} />
                            <StepCard step="03" icon={<IconChart size={26} />} title={t('sales.step3Title')} body={t('sales.step3Body')} />
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* ══ Coverage ═══════════════════════════════════════════ */}
            <section style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <Reveal>
                    <div
                        style={{
                            maxWidth: 1080, margin: '0 auto', padding: '5rem 1.5rem',
                            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.35rem',
                        }}
                    >
                        <CityCard
                            icon={<IconUS size={22} />}
                            accent="var(--us)"
                            city={t('sales.cityElPaso')}
                            region={t('sales.cityElPasoRegion')}
                            body={t('sales.cityElPasoBody')}
                        />
                        <CityCard
                            icon={<IconMX size={22} />}
                            accent="var(--mx)"
                            city={t('sales.cityJuarez')}
                            region={t('sales.cityJuarezRegion')}
                            body={t('sales.cityJuarezBody')}
                        />
                    </div>
                </Reveal>
            </section>

            {/* ══ Pricing ════════════════════════════════════════════ */}
            <section id="pricing" style={{ padding: '6.5rem 1.5rem', scrollMarginTop: '90px' }}>
                <Reveal>
                    <div style={{ maxWidth: 880, margin: '0 auto' }}>
                        <SectionHead eyebrow={t('sales.pricingEyebrow')} title={t('sales.pricingTitle')} body={t('sales.pricingSubtitle')} />

                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                gap: '1.35rem',
                            }}
                        >
                            <PricingCard
                                tier={t('pricing.basicTier')}
                                price="$0"
                                period={t('pricing.basicPeriod')}
                                features={[t('pricing.basicF1'), t('pricing.basicF2'), t('pricing.basicF3'), t('pricing.basicF4')]}
                                ctaLabel={t('pricing.basicCta')}
                                onCta={() => openForm('free')}
                            />
                            <PricingCard
                                featured
                                tier={t('pricing.promotedTier')}
                                price="$49"
                                period={t('pricing.perMonth')}
                                note={t('pricing.promotedMxn')}
                                badge={t('pricing.promotedBadge')}
                                features={[t('pricing.promotedF1'), t('pricing.promotedF2'), t('pricing.promotedF3'), t('pricing.promotedF4')]}
                                ctaLabel={t('pricing.promotedCta')}
                                onCta={() => openForm('promoted')}
                            />
                            <PricingCard
                                tier={t('pricing.featuredTier')}
                                price="$99"
                                period={t('pricing.perMonth')}
                                note={t('pricing.featuredMxn')}
                                features={[t('pricing.featuredF1'), t('pricing.featuredF2'), t('pricing.featuredF3'), t('pricing.featuredF4')]}
                                ctaLabel={t('pricing.featuredCta')}
                                onCta={() => openForm('featured')}
                            />
                        </div>

                        <p style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.9rem', color: 'var(--gray-400)' }}>
                            {t('pricing.terms')}
                        </p>
                    </div>
                </Reveal>
            </section>

            {/* == Add-ons ============================================
                Everything above is placement. This is the work, and it is
                where most of the revenue actually is, so it gets a section
                rather than a footnote. Priced "from": every one of these is
                scoped per clinic.
                ======================================================= */}
            <section style={{ padding: '0 1.5rem 6.5rem' }}>
                <Reveal>
                    <div style={{ maxWidth: 880, margin: '0 auto' }}>
                        <SectionHead
                            eyebrow={t('pricing.addonsEyebrow')}
                            title={t('pricing.addonsTitle')}
                            body={t('pricing.addonsSubtitle')}
                        />

                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                gap: '1rem',
                            }}
                        >
                            {ADDONS.map((addon) => (
                                <AddonCard
                                    key={addon.key}
                                    icon={addon.icon}
                                    title={t('pricing.addon.' + addon.key + '.title')}
                                    price={t('pricing.addon.' + addon.key + '.price')}
                                    body={t('pricing.addon.' + addon.key + '.body')}
                                    ctaLabel={t('pricing.addonCta')}
                                    onCta={() => openForm('addon-' + addon.key)}
                                />
                            ))}
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* ══ Closing CTA ════════════════════════════════════════ */}
            <section
                style={{
                    padding: '5.5rem 1.5rem',
                    background: 'var(--brand)',
                    color: 'var(--on-brand)',
                }}
            >
                <Reveal>
                    <div style={{ maxWidth: 660, margin: '0 auto', textAlign: 'center' }}>
                        <LogoMark size={46} idle />
                        <h2
                            className="display"
                            style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', margin: '1.35rem 0 0.9rem', color: 'inherit' }}
                        >
                            {t('sales.ctaBannerTitle')}
                        </h2>
                        <p style={{ opacity: 0.82, marginBottom: '2.25rem', fontSize: '1.05rem', lineHeight: 1.65 }}>
                            {t('sales.ctaBannerSubtitle')}
                        </p>
                        <button
                            onClick={() => openForm('closing')}
                            className="press"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                                padding: '1rem 2.1rem', borderRadius: 'var(--radius-pill)',
                                background: 'var(--navy-800)', color: 'var(--white)',
                                fontWeight: 700, fontSize: '1rem',
                                border: '1px solid var(--border)',
                            }}
                        >
                            {t('sales.ctaBannerBtn')}
                            <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={18} weight={2} /></span>
                        </button>
                    </div>
                </Reveal>
            </section>

            <footer
                style={{
                    borderTop: '1px solid var(--border)',
                    padding: '2rem 1.5rem',
                    textAlign: 'center',
                    color: 'var(--gray-400)',
                    fontSize: '0.85rem',
                }}
            >
                {t('sales.footer', { year: new Date().getFullYear() })}
            </footer>

            {modalPlan !== null && (
                <InquiryModal key={modalPlan} onClose={closeForm} plan={modalPlan} />
            )}

            {/* Hero collapses to a single column on small screens. */}
            <style>{`
                @media (max-width: 900px) {
                    .sales-hero-grid {
                        grid-template-columns: 1fr !important;
                        padding: 4rem 1rem 3.5rem !important;
                        gap: 2.5rem !important;
                    }
                }
            `}</style>
        </div>
    );
}

/* ── Hero artwork ─────────────────────────────────────────────────────
   A stylised plan-view of the two cities either side of the Rio Grande,
   with clinic pins. Vector rather than photography so it stays crisp,
   themes correctly, and adds no image weight.
   ─────────────────────────────────────────────────────────────────── */
function BorderMapArt() {
    const pins = [
        { x: 78, y: 96, side: 'us' }, { x: 132, y: 66, side: 'us' },
        { x: 196, y: 108, side: 'us' }, { x: 246, y: 74, side: 'us' },
        { x: 104, y: 218, side: 'mx' }, { x: 168, y: 254, side: 'mx' },
        { x: 232, y: 206, side: 'mx' }, { x: 286, y: 250, side: 'mx' },
    ];

    return (
        <div className="bezel idle-float" style={{ boxShadow: 'var(--shadow)' }}>
            <div className="bezel-core" style={{ overflow: 'hidden', padding: '1.1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gray-400)' }}>
                        El Paso · Ciudad Juárez
                    </span>
                    <span style={{ display: 'flex', gap: 4 }}>
                        {['var(--us)', 'var(--gold)', 'var(--mx)'].map((c) => (
                            <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                        ))}
                    </span>
                </div>

                <svg viewBox="0 0 360 320" style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10 }} role="img" aria-label="Map of clinics across the El Paso and Ciudad Juarez border">
                    <rect width="360" height="320" fill="var(--surface)" />

                    {/* Street grid, north side */}
                    <g stroke="var(--border)" strokeWidth="1.5" opacity="0.9">
                        {[40, 80, 120, 160].map((y) => <line key={y} x1="0" y1={y} x2="360" y2={y} />)}
                        {[60, 120, 180, 240, 300].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="165" />)}
                    </g>
                    {/* Street grid, south side (rotated feel via offset) */}
                    <g stroke="var(--border)" strokeWidth="1.5" opacity="0.9">
                        {[210, 250, 290].map((y) => <line key={y} x1="0" y1={y} x2="360" y2={y} />)}
                        {[45, 105, 165, 225, 285].map((x) => <line key={x} x1={x} y1="188" x2={x} y2="320" />)}
                    </g>

                    {/* The river / the border */}
                    <path d="M0 182 C 70 168, 120 196, 185 176 S 300 168, 360 178" stroke="var(--us)" strokeWidth="7" fill="none" opacity="0.28" strokeLinecap="round" />
                    <path d="M0 182 C 70 168, 120 196, 185 176 S 300 168, 360 178" stroke="var(--gold)" strokeWidth="2" fill="none" strokeDasharray="7 6" strokeLinecap="round" />

                    {/* Clinic pins */}
                    {pins.map((p, i) => (
                        <g key={i}>
                            <circle
                                cx={p.x} cy={p.y} r="9"
                                fill={p.side === 'us' ? 'var(--us)' : 'var(--mx)'}
                                opacity="0.16"
                            />
                            <circle
                                cx={p.x} cy={p.y} r="5"
                                fill={p.side === 'us' ? 'var(--us)' : 'var(--mx)'}
                                stroke="var(--navy-800)" strokeWidth="2"
                            />
                        </g>
                    ))}

                    {/* Promoted clinic — the product's paid outcome, made visible */}
                    <g>
                        <circle cx="168" cy="130" r="16" fill="var(--gold)" opacity="0.16" />
                        <circle cx="168" cy="130" r="9" fill="var(--gold)" stroke="var(--navy-800)" strokeWidth="2.5" />
                    </g>

                    {/* City labels */}
                    <text x="18" y="30" fill="var(--gray-400)" fontSize="12" fontWeight="700" letterSpacing="1.6" fontFamily="Plus Jakarta Sans, sans-serif">EL PASO, TX</text>
                    <text x="18" y="312" fill="var(--gray-400)" fontSize="12" fontWeight="700" letterSpacing="1.6" fontFamily="Plus Jakarta Sans, sans-serif">CD. JUÁREZ, CHIH</text>
                </svg>
            </div>
        </div>
    );
}

/* ── Building blocks ──────────────────────────────────────────────── */

function PrimaryCta({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="press"
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.95rem 1.35rem 0.95rem 1.85rem',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--brand)', color: 'var(--on-brand)',
                fontWeight: 700, fontSize: '0.98rem',
            }}
        >
            {children}
            {/* Button-in-button: the arrow rides in its own disc at the pill's edge. */}
            <span
                className="cta-arrow"
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.16)',
                }}
            >
                <IconArrowRight size={16} weight={2} />
            </span>
        </button>
    );
}

function TrustPoint({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', color: 'var(--gray-400)', fontWeight: 600 }}>
            <span style={{ color: 'var(--gold)', display: 'flex' }}>{icon}</span>
            {label}
        </span>
    );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
    return (
        <div style={{ marginBottom: '3.25rem', maxWidth: 620 }}>
            <span className="eyebrow">{eyebrow}</span>
            <h2 className="display" style={{ fontSize: 'clamp(2rem, 4.4vw, 3rem)', margin: '0.85rem 0 0.9rem' }}>
                {title}
            </h2>
            <p style={{ color: 'var(--gray-400)', fontSize: '1.05rem', lineHeight: 1.65 }}>{body}</p>
        </div>
    );
}

function StatTile({ icon, value, label, accent }: {
    icon: React.ReactNode; value: string; label: string; accent: string;
}) {
    return (
        <div
            className="hover-lift"
            style={{
                padding: '1.6rem',
                borderRadius: 'var(--radius)',
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                borderTop: `3px solid ${accent}`,
            }}
        >
            <span style={{ color: accent, display: 'flex', marginBottom: '0.9rem' }}>{icon}</span>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: '0.88rem', color: 'var(--gray-400)', marginTop: '0.5rem' }}>{label}</div>
        </div>
    );
}

function StepCard({ step, icon, title, body }: {
    step: string; icon: React.ReactNode; title: string; body: string;
}) {
    return (
        <div className="bezel hover-lift">
            <div className="bezel-core" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--gold)', display: 'flex' }}>{icon}</span>
                    <span
                        className="display"
                        style={{ fontSize: '2rem', color: 'var(--gray-600)', lineHeight: 1 }}
                    >
                        {step}
                    </span>
                </div>
                <h3 style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.01em' }}>{title}</h3>
                <p style={{ color: 'var(--gray-400)', fontSize: '0.92rem', lineHeight: 1.65 }}>{body}</p>
            </div>
        </div>
    );
}

function CityCard({ icon, accent, city, region, body }: {
    icon: React.ReactNode; accent: string; city: string; region: string; body: string;
}) {
    return (
        <div
            className="hover-lift"
            style={{
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${accent}`,
                borderRadius: 'var(--radius)',
                padding: '1.85rem',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '1rem' }}>
                <span style={{ color: accent, display: 'flex' }}>{icon}</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: accent }}>
                    {region}
                </span>
            </div>
            <h3 className="display" style={{ fontSize: '1.9rem', marginBottom: '0.65rem' }}>{city}</h3>
            <p style={{ color: 'var(--gray-400)', fontSize: '0.95rem', lineHeight: 1.65 }}>{body}</p>
        </div>
    );
}

function AddonCard({ icon, title, price, body, ctaLabel, onCta }: {
    icon: React.ReactNode; title: string; price: string; body: string;
    ctaLabel: string; onCta: () => void;
}) {
    return (
        <div
            style={{
                padding: '1.5rem',
                borderRadius: 'var(--radius)',
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', gap: '0.7rem',
            }}
        >
            <span
                style={{
                    width: 38, height: 38, borderRadius: 11,
                    background: 'var(--gold-dim)', color: 'var(--gold)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                {icon}
            </span>

            <h3 style={{ fontSize: '1.02rem', fontWeight: 800, lineHeight: 1.3 }}>{title}</h3>
            <p style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--gold)' }}>{price}</p>
            <p style={{ fontSize: '0.88rem', color: 'var(--gray-400)', lineHeight: 1.6, flex: 1 }}>{body}</p>

            <button
                onClick={onCta}
                className="press"
                style={{
                    alignSelf: 'flex-start',
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    background: 'none', color: 'var(--white)',
                    fontWeight: 700, fontSize: '0.86rem',
                    padding: '0.3rem 0',
                }}
            >
                {ctaLabel}
                <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={15} weight={2} /></span>
            </button>
        </div>
    );
}

function PricingCard({ tier, price, period, note, badge, features, featured = false, ctaLabel, onCta }: {
    tier: string; price: string; period: string; note?: string; badge?: string;
    features: string[]; featured?: boolean; ctaLabel: string; onCta: () => void;
}) {
    return (
        <div
            style={{
                position: 'relative',
                padding: '2.1rem',
                borderRadius: 'calc(var(--radius) + 4px)',
                background: featured ? 'var(--brand)' : 'var(--navy-800)',
                color: featured ? 'var(--on-brand)' : 'var(--white)',
                border: `1px solid ${featured ? 'var(--brand)' : 'var(--border)'}`,
                display: 'flex', flexDirection: 'column', gap: '1.5rem',
                boxShadow: featured ? 'var(--shadow)' : 'none',
            }}
        >
            {badge && (
                <div
                    style={{
                        position: 'absolute', top: '-13px', left: '2.1rem',
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.28rem 0.85rem', borderRadius: 'var(--radius-pill)',
                        background: 'var(--gold-fill)', color: 'var(--brand-identity)',
                        fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.07em',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <IconPromoted size={11} weight={2.2} /> {badge}
                </div>
            )}

            <div>
                <p
                    style={{
                        fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase',
                        letterSpacing: '0.14em', marginBottom: '0.7rem',
                        opacity: featured ? 0.8 : 1,
                        color: featured ? 'inherit' : 'var(--gray-400)',
                    }}
                >
                    {tier}
                </p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                    <span className="display" style={{ fontSize: '3.2rem' }}>{price}</span>
                    <span style={{ fontSize: '0.92rem', opacity: 0.75 }}>{period}</span>
                </div>
                {/* Half the audience budgets in pesos. Quoting only USD makes
                    them do the conversion before they can judge the price. */}
                {note && (
                    <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.35rem' }}>{note}</p>
                )}
            </div>

            <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', listStyle: 'none', flex: 1 }}>
                {features.map((f) => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.92rem', lineHeight: 1.5 }}>
                        <span style={{ color: featured ? 'var(--gold-fill)' : 'var(--gold)', flexShrink: 0, marginTop: 2, display: 'flex' }}>
                            <IconCheck size={16} weight={2.2} />
                        </span>
                        <span style={{ opacity: featured ? 0.92 : 1, color: featured ? 'inherit' : 'var(--gray-300)' }}>{f}</span>
                    </li>
                ))}
            </ul>

            <button
                onClick={onCta}
                className="press"
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    padding: '0.9rem 1.5rem', borderRadius: 'var(--radius-pill)',
                    background: featured ? 'var(--navy-800)' : 'var(--brand)',
                    color: featured ? 'var(--white)' : 'var(--on-brand)',
                    border: featured ? '1px solid var(--border)' : 'none',
                    fontWeight: 700, fontSize: '0.95rem',
                }}
            >
                {ctaLabel}
                <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
            </button>
        </div>
    );
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (!ref.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                setIsVisible(true);
                observer.unobserve(entry.target);
            },
            { threshold: 0.08, rootMargin: '60px' },
        );
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'translateY(0)' : 'translateY(28px)',
                transition: `opacity 0.7s var(--ease-out) ${delay}s, transform 0.7s var(--ease-out) ${delay}s`,
                willChange: 'opacity, transform',
            }}
        >
            {children}
        </div>
    );
}
