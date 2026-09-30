import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { ACCEPTED_IMAGE_TYPES, validateImageFile, type EncodedImage } from '../../utils/imageResize';
import { ClinicAvatar } from './ClinicAvatar';
import { AvatarCropDialog } from './AvatarCropDialog';
import { clinicPublicUrl, ownedPathFromUrl, uploadClinicFile } from './uploadWithProgress';
import { useToast } from './toastContext';

/**
 * The clinic's profile picture: the round image shown on cards and at the top
 * of its public page. Deliberately separate from the gallery (Photos tab).
 *
 * Stored at `clinic-photos/<provider_id>/avatar-<timestamp>.<ext>` and written
 * to `providers."imageUrl"`. The previous avatar object is deleted afterwards,
 * but only if it is one of ours (under this provider's folder, `avatar-` name)
 * — an imageUrl inherited from a scraped source is never touched.
 */
export function ClinicAvatarUploader({ clinic, onChanged }: {
    clinic: Provider;
    onChanged: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    // Optimistic local image, tied to the imageUrl it was made against so it
    // drops itself the moment the server value changes.
    const [preview, setPreview] = useState<{ url: string; base?: string } | null>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    // The imageUrl that was just removed, so the stale prop (until reload)
    // does not flash back in.
    const [removedUrl, setRemovedUrl] = useState<string | null>(null);

    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

    const current = removedUrl !== null && clinic.imageUrl === removedUrl ? undefined : clinic.imageUrl;
    const ownPath = ownedPathFromUrl(clinic.imageUrl, clinic.id, 'avatar-');

    const pick = (file: File | undefined) => {
        if (!file || busy) return;
        setError(null);
        const v = validateImageFile(file);
        if (v === 'type') { setError(t('account.avatarBadType')); return; }
        if (v === 'size') { setError(t('account.avatarTooBig')); return; }
        setPendingFile(file);
    };

    const save = async (img: EncodedImage) => {
        if (!supabase) return;
        setPendingFile(null);
        setBusy(true);
        setError(null);
        setProgress(0);
        setPreview({ url: URL.createObjectURL(img.blob), base: clinic.imageUrl });

        const path = `${clinic.id}/avatar-${Date.now()}.${img.ext}`;
        const up = await uploadClinicFile(path, img.blob, img.contentType, setProgress);
        if (up.error) {
            setBusy(false); setProgress(null); setPreview(null);
            setError(t('account.avatarUploadError', { detail: up.error }));
            return;
        }

        const { error: dbErr } = await supabase
            .from('providers')
            .update({ imageUrl: clinicPublicUrl(path), updated_at: new Date().toISOString() })
            .eq('id', clinic.id);

        if (dbErr) {
            // Do not leave an orphan behind a failed save.
            await supabase.storage.from('clinic-photos').remove([path]);
            setBusy(false); setProgress(null); setPreview(null);
            setError(t('account.avatarUploadError', { detail: dbErr.message }));
            return;
        }

        if (ownPath && ownPath !== path) {
            await supabase.storage.from('clinic-photos').remove([ownPath]);
        }
        setBusy(false);
        setProgress(null);
        toast(t('account.avatarSaved'));
        onChanged();
    };

    const remove = async () => {
        if (!supabase) return;
        setBusy(true);
        setError(null);
        const { error: dbErr } = await supabase
            .from('providers')
            .update({ imageUrl: null, updated_at: new Date().toISOString() })
            .eq('id', clinic.id);
        if (dbErr) {
            setBusy(false);
            setError(t('account.avatarUploadError', { detail: dbErr.message }));
            return;
        }
        if (ownPath) await supabase.storage.from('clinic-photos').remove([ownPath]);
        setBusy(false);
        setConfirmRemove(false);
        setRemovedUrl(clinic.imageUrl ?? '');
        setPreview(null);
        toast(t('account.avatarRemoved'));
        onChanged();
    };

    const shown = preview && preview.base === clinic.imageUrl ? preview.url : current;

    return (
        <section id="acct-avatar" className="acct-card acct-avatar-card" aria-labelledby="acct-avatar-title">
            <div
                className={`acct-avatar-drop${dragging ? ' is-dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    pick(e.dataTransfer.files?.[0]);
                }}
            >
                <button
                    type="button"
                    className="acct-avatar-btn"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy}
                    aria-label={shown ? t('account.avatarChange') : t('account.avatarAdd')}
                >
                    <ClinicAvatar src={shown} name={clinic.name} size={104} />
                    {progress !== null && (
                        <span className="acct-avatar-progress" aria-hidden="true">
                            <svg viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="16" className="acct-ring-track" />
                                <circle
                                    cx="18" cy="18" r="16" className="acct-ring-bar"
                                    strokeDasharray={`${Math.max(4, progress * 100)} 100`}
                                    pathLength={100}
                                />
                            </svg>
                        </span>
                    )}
                    <span className="acct-avatar-overlay">{t('account.avatarChange')}</span>
                </button>
            </div>

            <div className="acct-avatar-body">
                <h2 id="acct-avatar-title" className="acct-card-title">{t('account.avatarTitle')}</h2>
                <p className="acct-muted">{t('account.avatarBody')}</p>

                <div className="acct-row">
                    <button type="button" className="acct-btn acct-btn--sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                        {busy ? t('account.working') : shown ? t('account.avatarChange') : t('account.avatarAdd')}
                    </button>
                    {shown && !busy && !confirmRemove && (
                        <button type="button" className="acct-btn acct-btn--ghost acct-btn--sm" onClick={() => setConfirmRemove(true)}>
                            {t('account.avatarRemove')}
                        </button>
                    )}
                    {confirmRemove && (
                        <span className="acct-confirm" role="group" aria-label={t('account.avatarRemoveConfirm')}>
                            <span>{t('account.avatarRemoveConfirm')}</span>
                            <button type="button" className="acct-link acct-link--danger" onClick={() => void remove()} disabled={busy}>
                                {t('account.yes')}
                            </button>
                            <button type="button" className="acct-link" onClick={() => setConfirmRemove(false)}>
                                {t('account.no')}
                            </button>
                        </span>
                    )}
                </div>

                <p className="acct-fine">{t('account.avatarSpecs')}</p>
                {error && <p role="alert" className="acct-msg acct-msg--error">{error}</p>}
            </div>

            <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                hidden
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    pick(f);
                }}
            />

            {pendingFile && (
                <AvatarCropDialog
                    file={pendingFile}
                    onCancel={() => setPendingFile(null)}
                    onConfirm={(img) => void save(img)}
                />
            )}
        </section>
    );
}
