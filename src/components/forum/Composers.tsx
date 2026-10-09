import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ForumKind } from '../../lib/forum';
import { createReply, createThread } from '../../lib/forum';
import type { Provider } from '../../types/provider';
import { PostAsSelect, SpecialtySelect } from './ForumParts';
import { IconArrowRight } from '../icons/Icons';

/**
 * A patient's display name, remembered between questions. Public, so the
 * field says so; a first name is plenty and nothing defaults it from the
 * account email.
 */
const NAME_KEY = 'forum.displayName';
function rememberedName(): string {
    try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function rememberName(name: string) {
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* private mode */ }
}

/**
 * New question (patients) or new discussion (society).
 *
 * In the patients forum everyone asks as a person, clinicians included — a
 * clinic asking patients a question under its brand reads as an advert. In
 * Med Society every post is signed with a listing, which the policy enforces.
 */
export function ThreadComposer({ forum, clinics, onPosted, onCancel }: {
    forum: ForumKind;
    clinics: Provider[];
    onPosted: (id: string) => void;
    onCancel: () => void;
}) {
    const { t, i18n } = useTranslation();
    const asClinic = forum === 'society';
    const [name, setName] = useState(rememberedName);
    const [clinicId, setClinicId] = useState(clinics[0]?.id ?? '');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [specialty, setSpecialty] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clinic = clinics.find((c) => c.id === clinicId) ?? clinics[0];

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (asClinic && !clinic) return;
        setBusy(true);
        setError(null);
        const result = await createThread({
            forum,
            authorName: asClinic ? clinic!.name : name,
            providerId: asClinic ? clinic!.id : null,
            title,
            body,
            specialty: specialty || null,
            lang: i18n.language.startsWith('es') ? 'es' : 'en',
        });
        setBusy(false);
        if (result.error || !result.id) {
            setError(t('forum.postFailed'));
            return;
        }
        if (!asClinic) rememberName(name);
        onPosted(result.id);
    };

    const p = forum === 'patients' ? 'ask' : 'discuss';

    return (
        <form className="forum-composer ms-auth-card" onSubmit={submit}>
            {forum === 'patients' && (
                <p className="forum-note">{t('forum.disclaimerShort')}</p>
            )}

            <label className="forum-field">
                <span>{t(`forum.${p}TitleLabel`)}</span>
                <input
                    required
                    minLength={5}
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t(`forum.${p}TitlePlaceholder`)}
                    autoFocus
                />
            </label>

            <label className="forum-field">
                <span>{t(`forum.${p}BodyLabel`)}</span>
                <textarea
                    maxLength={5000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t(`forum.${p}BodyPlaceholder`)}
                />
            </label>

            <div className="forum-composer-row">
                <label className="forum-field">
                    <span>{t('forum.topic')}</span>
                    <SpecialtySelect value={specialty} onChange={setSpecialty} allLabel={t('forum.topicGeneral')} />
                </label>

                {asClinic ? (
                    <PostAsSelect clinics={clinics} value={clinic?.id ?? ''} onChange={setClinicId} />
                ) : (
                    <label className="forum-field">
                        <span>{t('forum.yourName')}</span>
                        <input
                            required
                            maxLength={80}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t('forum.yourNamePlaceholder')}
                            autoComplete="given-name"
                        />
                    </label>
                )}
            </div>
            {!asClinic && <p className="forum-hint">{t('forum.yourNameHint')}</p>}

            {error && <p role="alert" className="forum-error">{error}</p>}

            <div className="forum-actions">
                <button type="button" className="forum-btn-ghost press" onClick={onCancel}>{t('forum.cancel')}</button>
                <button type="submit" className="forum-btn press" disabled={busy}>
                    {busy ? t('account.working') : t(`forum.${p}Submit`)}
                    <IconArrowRight size={15} weight={2} />
                </button>
            </div>
        </form>
    );
}

/**
 * Answer (clinician) or follow-up (the patient who asked). The caller decides
 * which by passing `clinics` (non-empty: answer as a listing) or not.
 */
export function ReplyComposer({ threadId, clinics, followUpName, onPosted }: {
    threadId: string;
    clinics: Provider[];
    /** The asker's own name on the thread, when this is their follow-up. */
    followUpName?: string;
    onPosted: () => void;
}) {
    const { t } = useTranslation();
    const [clinicId, setClinicId] = useState(clinics[0]?.id ?? '');
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clinic = clinics.find((c) => c.id === clinicId) ?? clinics[0];
    const asClinic = !!clinic;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const result = await createReply({
            threadId,
            // A follow-up is signed like the question it follows.
            authorName: asClinic ? clinic.name : (followUpName || rememberedName() || t('forum.patient')),
            providerId: asClinic ? clinic.id : null,
            body,
        });
        setBusy(false);
        if (result.error) {
            setError(t('forum.postFailed'));
            return;
        }
        setBody('');
        onPosted();
    };

    return (
        <form className="forum-composer ms-auth-card" onSubmit={submit}>
            {asClinic && <PostAsSelect clinics={clinics} value={clinic.id} onChange={setClinicId} />}
            <label className="forum-field">
                <span>
                    {asClinic
                        ? t('forum.answerAs', { name: clinic.name })
                        : t('forum.followUpLabel')}
                </span>
                <textarea
                    required
                    maxLength={5000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={asClinic ? t('forum.answerPlaceholder') : t('forum.followUpPlaceholder')}
                />
            </label>
            {asClinic && <p className="forum-hint">{t('forum.answerHint')}</p>}
            {error && <p role="alert" className="forum-error">{error}</p>}
            <div className="forum-actions">
                <button type="submit" className="forum-btn press" disabled={busy || !body.trim()}>
                    {busy ? t('account.working') : asClinic ? t('forum.answerSubmit') : t('forum.followUpSubmit')}
                    <IconArrowRight size={15} weight={2} />
                </button>
            </div>
        </form>
    );
}
