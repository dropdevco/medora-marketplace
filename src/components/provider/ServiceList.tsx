import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderService } from '../../types/provider';

/** Show this many before collapsing behind a "+N more" toggle. */
const VISIBLE = 6;

/**
 * Services a practice publishes, with prices where it quotes them.
 *
 * Prices are list prices scraped from the provider's own profile, not quotes:
 * "Desde $1,000" means the visit starts there, and none of it accounts for
 * what an insurer covers. The disclaimer says so, because a patient who plans
 * around a number we showed them and then gets a different bill is a worse
 * outcome than one who never saw a number at all.
 */
export function ServiceList({ services }: { services: ProviderService[] }) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    if (!services.length) return null;

    const shown = expanded ? services : services.slice(0, VISIBLE);
    const hidden = services.length - shown.length;
    const anyPriced = services.some((s) => s.priceMxn != null);

    return (
        <section>
            <h3
                style={{
                    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--gray-500)',
                    margin: '0 0 0.65rem',
                }}
            >
                {t('drawer.services', { defaultValue: 'Services & prices' })}
            </h3>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {shown.map((s, i) => (
                    <li
                        key={`${s.slug ?? s.name}-${i}`}
                        style={{
                            display: 'flex', alignItems: 'baseline', gap: '0.75rem',
                            padding: '0.45rem 0',
                            borderBottom: i < shown.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                    >
                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.87rem', color: 'var(--text)' }}>
                            {s.name}
                        </span>
                        {s.priceText && (
                            <span style={{
                                fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap',
                                color: s.priceMxn != null ? 'var(--white)' : 'var(--gray-500)',
                            }}>
                                {s.priceText}
                            </span>
                        )}
                    </li>
                ))}
            </ul>

            {hidden > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="press"
                    style={{
                        marginTop: '0.6rem',
                        fontSize: '0.8rem', fontWeight: 600,
                        padding: '0.3rem 0.6rem', borderRadius: '99px',
                        border: '1px dashed var(--border)', background: 'transparent',
                        color: 'var(--gray-500)', cursor: 'pointer',
                    }}
                >
                    {t('drawer.servicesMore', { count: hidden, defaultValue: `+${hidden} more` })}
                </button>
            )}

            {anyPriced && (
                <p style={{ margin: '0.6rem 0 0', fontSize: '0.7rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>
                    {t('drawer.serviceDisclaimer', {
                        defaultValue: 'Prices are as published by the provider and may have changed. Confirm before booking.',
                    })}
                </p>
            )}
        </section>
    );
}
