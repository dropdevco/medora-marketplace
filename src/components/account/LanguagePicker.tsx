import { useTranslation } from 'react-i18next';
import { IconCheck } from '../icons/Icons';

/** Codes we offer, with the name each language uses for itself. */
const LANGUAGE_OPTIONS: Array<{ code: string; native: string }> = [
    { code: 'en', native: 'English' },
    { code: 'es', native: 'Español' },
    { code: 'fr', native: 'Français' },
    { code: 'de', native: 'Deutsch' },
    { code: 'pt', native: 'Português' },
    { code: 'zh', native: '中文' },
];

/**
 * Multi-select chips for the languages a clinic speaks.
 *
 * `confirmed` is the server's `languagesConfirmed`. Until a clinic answers,
 * the honest state is "Not specified yet", never a default.
 */
export function LanguagePicker({ value, onChange, confirmed }: {
    value: string[];
    onChange: (next: string[]) => void;
    confirmed: boolean;
}) {
    const { t } = useTranslation();
    // Codes already on the row that we do not offer (e.g. 'it') stay visible
    // and removable rather than silently disappearing on the next save.
    const extras = value.filter((c) => !LANGUAGE_OPTIONS.some((o) => o.code === c));
    const options = [...LANGUAGE_OPTIONS, ...extras.map((c) => ({ code: c, native: c.toUpperCase() }))];

    const toggle = (code: string) =>
        onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);

    const names = options.filter((o) => value.includes(o.code)).map((o) => o.native);

    return (
        <div>
            <div className="acct-chips" role="group" aria-label={t('account.fieldLanguages')}>
                {options.map((o) => {
                    const on = value.includes(o.code);
                    return (
                        <button
                            key={o.code}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            className={`acct-chip${on ? ' is-on' : ''}`}
                            onClick={() => toggle(o.code)}
                        >
                            {on && <IconCheck size={14} weight={2.4} />}
                            <span lang={o.code}>{o.native}</span>
                        </button>
                    );
                })}
            </div>
            <p className={`acct-status${value.length === 0 ? ' is-empty' : ''}`}>
                {value.length > 0
                    ? t('account.languagesShown', { list: names.join(', ') })
                    : confirmed ? t('account.languagesNoneConfirmed') : t('account.languagesNotSpecified')}
            </p>
        </div>
    );
}
