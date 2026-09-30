import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { sendInquiry } from '../../lib/inquiries';

const MAX_MESSAGE = 1000;
const TIMES = ['morning', 'afternoon', 'evening', 'any'] as const;
type TimeChoice = (typeof TIMES)[number];
type Status = 'idle' | 'sending' | 'sent' | 'error';

const TIME_KEY: Record<TimeChoice, string> = {
    morning: 'inquiry.timeMorning',
    afternoon: 'inquiry.timeAfternoon',
    evening: 'inquiry.timeEvening',
    any: 'inquiry.timeAny',
};

/** 'email' | 'phone' | null while the field is empty or still ambiguous. */
function detectKind(value: string): 'email' | 'phone' | null {
    const v = value.trim();
    if (!v) return null;
    if (v.includes('@')) return 'email';
    return /^[\d\s+().-]+$/.test(v) ? 'phone' : null;
}

function contactValid(value: string): boolean {
    const v = value.trim();
    const kind = detectKind(v);
    if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    if (kind === 'phone') {
        const digits = v.replace(/\D/g, '').length;
        return digits >= 8 && digits <= 15;
    }
    return false;
}

export function InquiryForm({ provider, onSent }: { provider: Provider; onSent?: () => void }) {
    const { t, i18n } = useTranslation();
    const uid = useId();
    const [name, setName] = useState('');
    const [contact, setContact] = useState('');
    const [message, setMessage] = useState('');
    const [time, setTime] = useState<TimeChoice | null>(null);
    const [honeypot, setHoneypot] = useState('');
    const [touched, setTouched] = useState({ name: false, contact: false, message: false });
    const [status, setStatus] = useState<Status>('idle');
    const [errorKind, setErrorKind] = useState<'server' | 'network' | 'too_many'>('server');
    // Blocks a second submit in the same tick, before state has re-rendered.
    const inFlight = useRef(false);

    const kind = detectKind(contact);
    const errors = {
        name: name.trim().length < 2 ? t('inquiry.errName') : '',
        contact: contactValid(contact) ? '' : t('inquiry.errContact'),
        message:
            message.trim().length < 5
                ? t('inquiry.errMessage')
                : message.length > MAX_MESSAGE
                  ? t('inquiry.errTooLong', { max: MAX_MESSAGE })
                  : '',
    };
    const show = (k: keyof typeof errors) => touched[k] && errors[k];

    const reset = () => {
        setName('');
        setContact('');
        setMessage('');
        setTime(null);
        setTouched({ name: false, contact: false, message: false });
        setStatus('idle');
    };

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (inFlight.current || status === 'sending') return;
        setTouched({ name: true, contact: true, message: true });
        if (errors.name || errors.contact || errors.message) return;

        inFlight.current = true;
        setStatus('sending');
        const result = await sendInquiry({
            providerId: provider.id,
            providerName: provider.name,
            name: name.trim(),
            contact: contact.trim(),
            message: message.trim(),
            preferredTime: time ?? undefined,
            language: i18n.language?.startsWith('en') ? 'en' : 'es',
            sourceUrl: window.location.href,
            website: honeypot,
        });
        inFlight.current = false;

        if (result.ok) {
            setStatus('sent');
            onSent?.();
        } else {
            setErrorKind(result.error === 'network' ? 'network' : result.error === 'too_many' ? 'too_many' : 'server');
            setStatus('error');
        }
    }

    if (status === 'sent') {
        return (
            <div className="inq inq-success" role="status">
                <span className="inq-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path className="inq-check-path" d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                </span>
                <h3 className="inq-success-title">{t('inquiry.successTitle')}</h3>
                <p className="inq-success-body">
                    {t('inquiry.successBody', { clinic: provider.name, contact: contact.trim() })}
                </p>
                <button type="button" className="inq-link" onClick={reset}>
                    {t('inquiry.sendAnother')}
                </button>
            </div>
        );
    }

    const sending = status === 'sending';
    const hint =
        kind === 'email' ? t('inquiry.hintEmail') : kind === 'phone' ? t('inquiry.hintPhone') : t('inquiry.hintIdle');
    const errorText =
        errorKind === 'network'
            ? t('inquiry.errorNetwork')
            : errorKind === 'too_many'
              ? t('inquiry.errorTooMany')
              : t('inquiry.errorGeneric');

    return (
        <form className="inq" onSubmit={submit} noValidate aria-busy={sending}>
            <div className="inq-head">
                <h3 className="inq-title">{t('inquiry.title')}</h3>
                <p className="inq-sub">{t('inquiry.subtitle')}</p>
            </div>

            {/* Honeypot: off-screen, unfocusable, ignored by people. */}
            <div className="inq-hp" aria-hidden="true">
                <label>
                    Website
                    <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </label>
            </div>

            <div className="inq-field">
                <label htmlFor={`${uid}-name`}>{t('inquiry.nameLabel')}</label>
                <input
                    id={`${uid}-name`}
                    className={`inq-input${show('name') ? ' is-invalid' : ''}`}
                    type="text"
                    autoComplete="name"
                    maxLength={120}
                    placeholder={t('inquiry.namePlaceholder')}
                    value={name}
                    disabled={sending}
                    aria-invalid={Boolean(show('name'))}
                    aria-describedby={`${uid}-name-msg`}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setTouched((s) => ({ ...s, name: true }))}
                />
                <p id={`${uid}-name-msg`} className="inq-msg is-error" aria-live="polite">{show('name')}</p>
            </div>

            <div className="inq-field">
                <label htmlFor={`${uid}-contact`}>{t('inquiry.contactLabel')}</label>
                <input
                    id={`${uid}-contact`}
                    className={`inq-input${show('contact') ? ' is-invalid' : ''}`}
                    type="text"
                    inputMode={kind === 'phone' ? 'tel' : 'text'}
                    autoComplete="email tel"
                    autoCapitalize="none"
                    maxLength={200}
                    placeholder={t('inquiry.contactPlaceholder')}
                    value={contact}
                    disabled={sending}
                    aria-invalid={Boolean(show('contact'))}
                    aria-describedby={`${uid}-contact-msg`}
                    onChange={(e) => setContact(e.target.value)}
                    onBlur={() => setTouched((s) => ({ ...s, contact: true }))}
                />
                <p id={`${uid}-contact-msg`} className={`inq-msg${show('contact') ? ' is-error' : ''}`} aria-live="polite">
                    {show('contact') || hint}
                </p>
            </div>

            <div className="inq-field">
                <label htmlFor={`${uid}-message`}>{t('inquiry.messageLabel')}</label>
                <textarea
                    id={`${uid}-message`}
                    className={`inq-input inq-textarea${show('message') ? ' is-invalid' : ''}`}
                    rows={4}
                    placeholder={t('inquiry.messagePlaceholder')}
                    value={message}
                    disabled={sending}
                    aria-invalid={Boolean(show('message'))}
                    aria-describedby={`${uid}-message-msg`}
                    onChange={(e) => setMessage(e.target.value)}
                    onBlur={() => setTouched((s) => ({ ...s, message: true }))}
                />
                <div className="inq-row">
                    <p id={`${uid}-message-msg`} className="inq-msg is-error" aria-live="polite">{show('message')}</p>
                    <span className={`inq-count${message.length > MAX_MESSAGE ? ' is-over' : ''}`}>
                        {t('inquiry.counter', { count: message.length, max: MAX_MESSAGE })}
                    </span>
                </div>
            </div>

            <fieldset className="inq-times" disabled={sending}>
                <legend>{t('inquiry.timeLabel')}</legend>
                <div className="inq-chips" role="group">
                    {TIMES.map((k) => (
                        <button
                            key={k}
                            type="button"
                            className={`inq-chip${time === k ? ' is-on' : ''}`}
                            aria-pressed={time === k}
                            onClick={() => setTime(time === k ? null : k)}
                        >
                            {t(TIME_KEY[k])}
                        </button>
                    ))}
                </div>
            </fieldset>

            {status === 'error' && (
                <div className="inq-error" role="alert">
                    <div>
                        <strong>{t('inquiry.errorTitle')}</strong>
                        <span>{errorText}</span>
                    </div>
                    <button type="submit" className="inq-link">{t('inquiry.retry')}</button>
                </div>
            )}

            <button type="submit" className="inq-submit" disabled={sending}>
                {sending && <span className="inq-spinner" aria-hidden="true" />}
                {sending ? t('inquiry.sending') : t('inquiry.submit')}
            </button>

            <p className="inq-reassure">{t('inquiry.reassurance')}</p>
            <p className="inq-privacy">{t('inquiry.privacy')}</p>
        </form>
    );
}
