import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { InquiryModal } from '../sales/InquiryModal';
import { IconCheck, IconVerified, IconPromoted, IconChart, IconLock } from '../icons/Icons';

/**
 * What this listing's plan includes, and what it does not.
 *
 * The locked rows are shown rather than hidden. A free tier that cannot see
 * what the paid one buys has to upgrade on faith, and the three things in that
 * list — the Verified badge, the promoted pin, real analytics — are exactly
 * the things the last review decided should be worth paying for. Hiding them
 * would undo that.
 *
 * Upgrading opens the existing inquiry form rather than a checkout: there is
 * no payment flow, and a button that pretended otherwise would be the worst
 * kind of placeholder.
 */
const FEATURES = [
    { key: 'listing', tier: 'basic', icon: <IconCheck size={15} weight={2.2} /> },
    { key: 'manage', tier: 'basic', icon: <IconCheck size={15} weight={2.2} /> },
    { key: 'whatsapp', tier: 'basic', icon: <IconCheck size={15} weight={2.2} /> },
    { key: 'badge', tier: 'promoted', icon: <IconVerified size={15} weight={2} /> },
    { key: 'pin', tier: 'promoted', icon: <IconPromoted size={15} weight={2} /> },
    { key: 'newsletter', tier: 'promoted', icon: <IconPromoted size={15} weight={2} /> },
    { key: 'analytics', tier: 'featured', icon: <IconChart size={15} weight={2} /> },
    { key: 'top', tier: 'featured', icon: <IconChart size={15} weight={2} /> },
] as const;

const RANK = { basic: 0, promoted: 1, featured: 2 } as const;

export function ClinicPlanPanel({ clinic }: { clinic: Provider }) {
    const { t } = useTranslation();
    const [asking, setAsking] = useState<string | null>(null);
    const rank = RANK[clinic.tier];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
            <div
                style={{
                    padding: '1.1rem 1.2rem',
                    borderRadius: 'var(--radius)',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                }}
            >
                <p style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-500)' }}>
                    {t('account.currentPlan')}
                </p>
                <p className="display" style={{ fontSize: '1.9rem', marginTop: '0.3rem' }}>
                    {t(`pricing.${clinic.tier}Tier`)}
                </p>
            </div>

            <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', listStyle: 'none' }}>
                {FEATURES.map((feature) => {
                    const locked = RANK[feature.tier] > rank;
                    return (
                        <li
                            key={feature.key}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                                fontSize: '0.9rem', lineHeight: 1.5,
                                color: locked ? 'var(--gray-500)' : 'var(--gray-200)',
                            }}
                        >
                            <span style={{ display: 'flex', marginTop: 2, flexShrink: 0, color: locked ? 'var(--gray-500)' : 'var(--accent)' }}>
                                {locked ? <IconLock size={15} weight={2} /> : feature.icon}
                            </span>
                            <span>{t(`account.plan.${feature.key}`)}</span>
                            {locked && (
                                <span
                                    style={{
                                        marginLeft: 'auto', flexShrink: 0,
                                        padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)',
                                        background: 'var(--gold-dim)', color: 'var(--gold)',
                                        fontSize: '0.68rem', fontWeight: 800, whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t(`pricing.${feature.tier}Tier`)}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>

            {rank < RANK.featured && (
                <button
                    onClick={() => setAsking(clinic.tier === 'basic' ? 'promoted' : 'featured')}
                    className="press"
                    style={{
                        alignSelf: 'flex-start',
                        padding: '0.85rem 1.5rem',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--brand)', color: 'var(--on-brand)',
                        border: 'none', fontWeight: 700, fontSize: '0.95rem',
                    }}
                >
                    {t('account.upgrade')}
                </button>
            )}

            <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)' }}>
                <Link to="/pricing" style={{ textDecoration: 'underline' }}>{t('account.seeAllPlans')}</Link>
            </p>

            {asking && <InquiryModal key={asking} plan={asking} onClose={() => setAsking(null)} />}
        </div>
    );
}
