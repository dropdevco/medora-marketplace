import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeSocial, SOCIAL_NETWORKS, type SocialNetwork } from '../../utils/socials';
import { IconCheck } from '../icons/Icons';

export type SocialDraft = Record<SocialNetwork, string>;

/**
 * One row per network. Owners may type a handle, a bare username, a phone
 * number (WhatsApp) or paste a whole URL; the row shows, live, the exact link
 * that will be saved, or why it cannot be.
 */
export function SocialLinksEditor({ value, onChange, showAllErrors }: {
    value: SocialDraft;
    onChange: (key: SocialNetwork, next: string) => void;
    /** Reveal errors on untouched rows too (after a failed save attempt). */
    showAllErrors: boolean;
}) {
    const { t } = useTranslation();
    const [touched, setTouched] = useState<Set<SocialNetwork>>(new Set());

    return (
        <div className="acct-socials">
            {SOCIAL_NETWORKS.map((n) => {
                const raw = value[n.key] ?? '';
                const res = normalizeSocial(n.key, raw);
                const showErr = !!res.error && (touched.has(n.key) || showAllErrors);
                const descId = `acct-social-${n.key}-msg`;
                const wrongLabel = res.wrongNetwork
                    ? SOCIAL_NETWORKS.find((x) => x.key === res.wrongNetwork)?.label ?? ''
                    : '';

                return (
                    <div key={n.key} className="acct-social-row">
                        <span className="acct-social-badge" style={{ background: n.color }} aria-hidden="true">
                            {n.short}
                        </span>
                        <div className="acct-social-main">
                            <label className="acct-social-label" htmlFor={`acct-social-${n.key}`}>{n.label}</label>
                            <div className="acct-social-inputwrap">
                                <input
                                    id={`acct-social-${n.key}`}
                                    value={raw}
                                    placeholder={n.placeholder}
                                    inputMode={n.key === 'whatsapp' ? 'tel' : 'text'}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    aria-invalid={showErr || undefined}
                                    aria-describedby={descId}
                                    onChange={(e) => onChange(n.key, e.target.value)}
                                    onBlur={() => setTouched((s) => new Set(s).add(n.key))}
                                />
                                {raw && (
                                    <button
                                        type="button"
                                        className="acct-social-clear"
                                        onClick={() => onChange(n.key, '')}
                                        aria-label={t('account.socialClear', { network: n.label })}
                                    >
                                        {t('account.clear')}
                                    </button>
                                )}
                            </div>
                            <p id={descId} className="acct-social-msg" aria-live="polite">
                                {showErr ? (
                                    <span className="acct-msg acct-msg--error">
                                        {t(`account.socialErr.${res.error}`, { network: wrongLabel, label: n.label })}
                                    </span>
                                ) : res.url ? (
                                    <a
                                        href={res.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="acct-social-preview"
                                        title={res.url}
                                    >
                                        <IconCheck size={13} weight={2.4} />
                                        <span>{res.url.replace(/^https:\/\//, '')}</span>
                                    </a>
                                ) : null}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
