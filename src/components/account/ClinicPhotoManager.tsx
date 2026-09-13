import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { IconClose, IconCheck } from '../icons/Icons';
import { authButton } from './authStyles';

interface PhotoRow {
    id: string;
    storage_path: string;
    sort: number;
}

/** 5MB. Enough for a good phone photo, small enough not to stall on clinic wifi. */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Photo upload for a claimed listing.
 *
 * This is the long-term answer to the directory's photo problem. Two thirds of
 * listings currently carry the source site's generic banner, which is why the
 * good ones are hand-curated onto the first rows — and hand-curation does not
 * scale past a few dozen. Giving a clinic a reason and a way to upload its own
 * photography is what makes that unnecessary.
 *
 * Files go to `clinic-photos/<provider_id>/...`, and the storage policy checks
 * ownership of that first path segment, so the folder layout is the
 * authorisation model rather than a convention.
 */
export function ClinicPhotoManager({ clinic }: { clinic: Provider }) {
    const { t } = useTranslation();
    const [photos, setPhotos] = useState<PhotoRow[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!supabase) return;
        const { data } = await supabase
            .from('provider_photos')
            .select('id, storage_path, sort')
            .eq('provider_id', clinic.id)
            .order('sort');
        setPhotos((data ?? []) as PhotoRow[]);
    }, [clinic.id]);

    useEffect(() => { void load(); }, [load]);

    const publicUrl = (path: string) =>
        supabase?.storage.from('clinic-photos').getPublicUrl(path).data.publicUrl ?? '';

    const upload = async (file: File) => {
        if (!supabase) return;

        if (file.size > MAX_BYTES) {
            setError(t('account.photoTooBig'));
            return;
        }

        setBusy(true);
        setError(null);
        setNotice(null);

        // Random name, original extension. Using the uploaded filename would
        // let two people overwrite each other's photo by both having an
        // IMG_0001.jpg, and would put whatever the phone called it into a
        // public URL.
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const path = `${clinic.id}/${crypto.randomUUID()}.${ext}`;

        const { error: upErr } = await supabase.storage
            .from('clinic-photos')
            .upload(path, file, { contentType: file.type });

        if (upErr) {
            setBusy(false);
            setError(upErr.message);
            return;
        }

        const { error: rowErr } = await supabase.from('provider_photos').insert({
            provider_id: clinic.id,
            storage_path: path,
            sort: photos.length,
        });

        setBusy(false);

        if (rowErr) { setError(rowErr.message); return; }
        setNotice(t('account.photoUploaded'));
        await load();
    };

    const remove = async (photo: PhotoRow) => {
        if (!supabase) return;
        setBusy(true);
        setError(null);
        // Row first: an orphaned file costs storage, an orphaned row renders a
        // broken image on a clinic's own page.
        const { error: rowErr } = await supabase.from('provider_photos').delete().eq('id', photo.id);
        if (!rowErr) await supabase.storage.from('clinic-photos').remove([photo.storage_path]);
        setBusy(false);
        if (rowErr) setError(rowErr.message);
        await load();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-400)', lineHeight: 1.6 }}>
                {t('account.photosBody')}
            </p>

            <label className="press" style={{ ...authButton, alignSelf: 'flex-start' }}>
                {busy ? t('account.working') : t('account.photoUpload')}
                <input
                    type="file"
                    accept={ACCEPT}
                    disabled={busy}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Cleared so re-picking the same file fires change again.
                        e.target.value = '';
                        if (file) void upload(file);
                    }}
                />
            </label>

            {error && <p role="alert" style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
            {notice && (
                <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--accent)', fontSize: '0.86rem', fontWeight: 700 }}>
                    <IconCheck size={15} weight={2.2} /> {notice}
                </p>
            )}

            {photos.length === 0 ? (
                <p style={{ fontSize: '0.86rem', color: 'var(--gray-500)' }}>{t('account.photosEmpty')}</p>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.7rem' }}>
                    {photos.map((photo, i) => (
                        <div key={photo.id} style={{ position: 'relative' }}>
                            <img
                                src={publicUrl(photo.storage_path)}
                                alt=""
                                style={{
                                    width: '100%', aspectRatio: '4 / 3', objectFit: 'cover',
                                    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                                    background: 'var(--surface)',
                                }}
                            />
                            {i === 0 && (
                                <span
                                    style={{
                                        position: 'absolute', bottom: 6, left: 6,
                                        padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-pill)',
                                        background: 'var(--brand)', color: 'var(--on-brand)',
                                        fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em',
                                    }}
                                >
                                    {t('account.photoCover')}
                                </span>
                            )}
                            <button
                                onClick={() => void remove(photo)}
                                disabled={busy}
                                aria-label={t('account.photoRemove')}
                                title={t('account.photoRemove')}
                                style={{
                                    position: 'absolute', top: 6, right: 6,
                                    width: 26, height: 26, borderRadius: '50%',
                                    background: 'var(--navy-800)', border: '1px solid var(--border-strong)',
                                    color: 'var(--white)', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                <IconClose size={13} weight={2.2} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
