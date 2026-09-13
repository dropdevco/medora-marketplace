import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';
import { useSession } from '../hooks/useSession';
import { useMyClinic } from '../hooks/useMyClinic';
import { signOut } from '../lib/auth';
import { estimateViews } from '../utils/estimatedViews';
import { AuthShell } from '../components/account/AuthShell';
import { ClinicProfileForm } from '../components/account/ClinicProfileForm';
import { ClinicPhotoManager } from '../components/account/ClinicPhotoManager';
import { ClinicPlanPanel } from '../components/account/ClinicPlanPanel';
import { IconViews, IconClipboard, IconStar } from '../components/icons/Icons';

type Tab = 'overview' | 'profile' | 'photos' | 'plan';

/**
 * What a clinic can actually do once it has claimed a listing — which, until
 * now, was nothing.
 *
 * Single page with tabs rather than nested routes: there are four panels, they
 * all operate on one listing, and giving each its own URL would mostly buy the
 * ability to deep-link into a form nobody links to.
 */
export function DashboardPage() {
    const { t } = useTranslation();
    const { user, loading: sessionLoading } = useSession();
    const { owned, claims, loading, reload } = useMyClinic(user?.id ?? null);
    const [tab, setTab] = useState<Tab>('overview');
    const [activeId, setActiveId] = useState<string | null>(null);

    if (!sessionLoading && !user) {
        return <Navigate to="/login?next=/dashboard" replace />;
    }

    if (sessionLoading || loading) {
        return <AuthShell title={t('account.loading')} />;
    }

    // Claimed but not yet approved, or nothing at all. Both are "there is
    // nothing to manage here yet", and both need to say what happens next.
    if (owned.length === 0) {
        const pending = claims.filter((c) => c.status === 'pending');
        return (
            <AuthShell
                title={pending.length > 0 ? t('account.pendingTitle') : t('account.noClinicTitle')}
                subtitle={pending.length > 0 ? t('account.pendingBody') : t('account.noClinicBody')}
            >
                <Link
                    to="/"
                    className="press"
                    style={{
                        display: 'block', textAlign: 'center', padding: '0.85rem 1.5rem',
                        borderRadius: 'var(--radius-pill)', background: 'var(--brand)',
                        color: 'var(--on-brand)', fontWeight: 700, textDecoration: 'none',
                    }}
                >
                    {t('account.findYourClinic')}
                </Link>
                <SignOutRow />
            </AuthShell>
        );
    }

    const clinic = owned.find((p) => p.id === activeId) ?? owned[0];

    return (
        <AuthShell wide title={clinic.name} subtitle={t('account.dashboardSubtitle')}>
            {/* Most clinics own one listing; a group owns several. The picker
                only earns its space in the second case. */}
            {owned.length > 1 && (
                <select
                    value={clinic.id}
                    onChange={(e) => setActiveId(e.target.value)}
                    style={{ marginBottom: '1.25rem' }}
                    aria-label={t('account.switchClinic')}
                >
                    {owned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            )}

            <div
                role="tablist"
                style={{
                    display: 'flex', gap: '0.3rem', marginBottom: '1.6rem',
                    borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
                }}
            >
                {(['overview', 'profile', 'photos', 'plan'] as Tab[]).map((key) => (
                    <button
                        key={key}
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => setTab(key)}
                        style={{
                            background: 'none',
                            padding: '0.6rem 0.85rem',
                            fontWeight: 700,
                            fontSize: '0.88rem',
                            color: tab === key ? 'var(--white)' : 'var(--gray-500)',
                            borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
                            marginBottom: '-1px',
                        }}
                    >
                        {t(`account.tab.${key}`)}
                    </button>
                ))}
            </div>

            {tab === 'overview' && <Overview clinic={clinic} />}
            {tab === 'profile' && <ClinicProfileForm clinic={clinic} onSaved={reload} />}
            {tab === 'photos' && <ClinicPhotoManager clinic={clinic} />}
            {tab === 'plan' && <ClinicPlanPanel clinic={clinic} />}

            <SignOutRow />
        </AuthShell>
    );
}

function Overview({ clinic }: { clinic: Provider }) {
    const { t } = useTranslation();
    const { views, contacts } = estimateViews(clinic);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '0.9rem',
                }}
            >
                <Stat
                    icon={<IconViews size={18} />}
                    value={views.toLocaleString()}
                    label={t('account.statViews')}
                />
                <Stat
                    icon={<IconClipboard size={18} />}
                    value={contacts.toLocaleString()}
                    label={t('account.statContacts')}
                    alarming={contacts === 0}
                />
                <Stat
                    icon={<IconStar size={18} filled />}
                    value={clinic.reviewCount > 0 ? clinic.rating.toFixed(1) : '—'}
                    label={t('account.statRating')}
                />
            </div>

            {/*
              Said out loud, every time. These are modelled from demand signals,
              not measured from traffic, and a clinic that later finds that out
              on its own has every reason to stop believing the rest of the
              directory too. The label is the point of the number, not a caveat
              on it.
            */}
            <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)', lineHeight: 1.6 }}>
                {t('account.statsDisclaimer')}
            </p>

            {contacts === 0 && (
                <div
                    style={{
                        padding: '1.1rem 1.2rem',
                        borderRadius: 'var(--radius)',
                        background: 'var(--gold-dim)',
                        border: '1px solid var(--gold)',
                    }}
                >
                    <p style={{ fontWeight: 800, marginBottom: '0.4rem' }}>{t('account.gapTitle')}</p>
                    <p style={{ fontSize: '0.88rem', color: 'var(--gray-300)', lineHeight: 1.6 }}>
                        {t('account.gapBody', { views: views.toLocaleString() })}
                    </p>
                </div>
            )}
        </div>
    );
}

function Stat({ icon, value, label, alarming = false }: {
    icon: React.ReactNode; value: string; label: string; alarming?: boolean;
}) {
    return (
        <div
            style={{
                padding: '1.1rem',
                borderRadius: 'var(--radius)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
            }}
        >
            <span style={{ color: alarming ? 'var(--red)' : 'var(--gray-500)', display: 'flex' }}>{icon}</span>
            <p
                className="display"
                style={{ fontSize: '2rem', marginTop: '0.4rem', color: alarming ? 'var(--red)' : 'var(--white)' }}
            >
                {value}
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{label}</p>
        </div>
    );
}

function SignOutRow() {
    const { t } = useTranslation();
    return (
        <p style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button
                onClick={() => { void signOut(); }}
                style={{ background: 'none', color: 'var(--gray-500)', fontSize: '0.84rem', textDecoration: 'underline' }}
            >
                {t('account.signOut')}
            </button>
        </p>
    );
}
