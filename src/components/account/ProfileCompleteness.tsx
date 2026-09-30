import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { profileCompleteness, type CompletenessTarget } from '../../utils/profileCompleteness';
import { IconCheck, IconChevronRight } from '../icons/Icons';

/**
 * "Complete your profile": progress ring plus a checklist that deep-links to
 * the exact tab and field. Derived entirely from the provider row (and the
 * gallery count); hides itself once everything is done.
 */
export function ProfileCompleteness({ clinic, galleryCount, onGo }: {
    clinic: Provider;
    galleryCount: number;
    onGo: (target: CompletenessTarget) => void;
}) {
    const { t } = useTranslation();
    const { items, doneCount, total, percent } = profileCompleteness(clinic, galleryCount);
    if (doneCount === total) return null;

    const R = 26;
    const C = 2 * Math.PI * R;

    return (
        <section className="acct-card acct-complete" aria-labelledby="acct-complete-title">
            <div className="acct-complete-head">
                <div className="acct-ring" role="img" aria-label={t('account.completeProgress', { percent })}>
                    <svg viewBox="0 0 64 64" width="64" height="64">
                        <circle cx="32" cy="32" r={R} className="acct-ring-track" />
                        <circle
                            cx="32" cy="32" r={R} className="acct-ring-bar"
                            strokeDasharray={`${(percent / 100) * C} ${C}`}
                            transform="rotate(-90 32 32)"
                        />
                    </svg>
                    <span>{percent}%</span>
                </div>
                <div>
                    <h2 id="acct-complete-title" className="acct-card-title">{t('account.completeTitle')}</h2>
                    <p className="acct-muted">{t('account.completeBody', { done: doneCount, total })}</p>
                </div>
            </div>

            <ul className="acct-checklist">
                {items.map((it) => (
                    <li key={it.key}>
                        <button
                            type="button"
                            className={`acct-check${it.done ? ' is-done' : ''}`}
                            onClick={() => onGo(it.target)}
                        >
                            <span className="acct-check-box" aria-hidden="true">
                                {it.done && <IconCheck size={13} weight={2.6} />}
                            </span>
                            <span className="acct-check-text">
                                <strong>{t(`account.check.${it.key}`)}</strong>
                                {!it.done && <span>{t(`account.checkHint.${it.key}`)}</span>}
                            </span>
                            <span className="acct-check-go" aria-hidden="true">
                                {it.done ? t('account.edit') : t('account.add')} <IconChevronRight size={14} weight={2.2} />
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
