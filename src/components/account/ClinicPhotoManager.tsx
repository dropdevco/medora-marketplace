import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { ACCEPTED_IMAGE_TYPES, downscale, validateImageFile } from '../../utils/imageResize';
import { IconClose } from '../icons/Icons';
import { clinicPublicUrl, uploadClinicFile } from './uploadWithProgress';
import { useToast } from './toastContext';

interface PhotoRow {
    id: string;
    storage_path: string;
    sort: number;
}

interface QueueItem {
    key: string;
    name: string;
    status: 'processing' | 'uploading' | 'error';
    progress: number;
    error?: string;
}

const MAX_PHOTOS = 24;

/**
 * The gallery: additional photos shown on the listing. Not the profile
 * picture (that lives at the top of the Profile tab).
 *
 * Files go to `clinic-photos/<provider_id>/...`, and the storage policy checks
 * ownership of that first path segment, so the folder layout is the
 * authorisation model rather than a convention. Rows in `provider_photos`
 * carry the display order in `sort`; the first is the cover.
 *
 * Every image is downscaled in the browser (1600px long edge) before upload,
 * because a 9MB phone photo over clinic wifi is what makes owners give up.
 */
export function ClinicPhotoManager({ clinic, onCountChange, onGoToProfile }: {
    clinic: Provider;
    onCountChange?: (n: number) => void;
    onGoToProfile?: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [photos, setPhotos] = useState<PhotoRow[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const photosRef = useRef<PhotoRow[]>([]);
    useEffect(() => { photosRef.current = photos; }, [photos]);

    const load = useCallback(async () => {
        if (!supabase) return;
        const { data } = await supabase
            .from('provider_photos')
            .select('id, storage_path, sort')
            .eq('provider_id', clinic.id)
            .order('sort');
        const rows = (data ?? []) as PhotoRow[];
        setPhotos(rows);
        setLoaded(true);
        onCountChange?.(rows.length);
    }, [clinic.id, onCountChange]);

    useEffect(() => { void load(); }, [load]);

    const uploading = queue.some((q) => q.status !== 'error');

    const addFiles = async (list: FileList | File[]) => {
        if (!supabase) return;
        setError(null);
        const files = Array.from(list);
        const room = MAX_PHOTOS - photosRef.current.length - queue.filter((q) => q.status !== 'error').length;
        if (files.length > room) setError(t('account.photosLimit', { max: MAX_PHOTOS }));

        let added = 0;
        for (const file of files.slice(0, Math.max(0, room))) {
            const key = crypto.randomUUID();
            const v = validateImageFile(file);
            if (v !== 'ok') {
                setQueue((q) => [...q, {
                    key, name: file.name, status: 'error', progress: 0,
                    error: v === 'type' ? t('account.avatarBadType') : t('account.avatarTooBig'),
                }]);
                continue;
            }
            setQueue((q) => [...q, { key, name: file.name, status: 'processing', progress: 0 }]);
            const patch = (p: Partial<QueueItem>) =>
                setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...p } : it)));

            try {
                const img = await downscale(file, 1600);
                patch({ status: 'uploading' });
                const path = `${clinic.id}/${crypto.randomUUID()}.${img.ext}`;
                const up = await uploadClinicFile(path, img.blob, img.contentType, (f) => patch({ progress: f }));
                if (up.error) throw new Error(up.error);

                const nextSort = photosRef.current.reduce((m, p) => Math.max(m, p.sort), -1) + 1;
                const { data: row, error: rowErr } = await supabase
                    .from('provider_photos')
                    .insert({ provider_id: clinic.id, storage_path: path, sort: nextSort })
                    .select('id, storage_path, sort')
                    .single();
                if (rowErr || !row) {
                    await supabase.storage.from('clinic-photos').remove([path]);
                    throw new Error(rowErr?.message ?? 'insert');
                }
                const next = [...photosRef.current, row as PhotoRow];
                photosRef.current = next;
                setPhotos(next);
                onCountChange?.(next.length);
                setQueue((q) => q.filter((it) => it.key !== key));
                added++;
            } catch (e) {
                patch({ status: 'error', error: (e as Error).message });
            }
        }
        if (added > 0) toast(t('account.photosAdded', { count: added }));
    };

    const persistOrder = async (ordered: PhotoRow[]) => {
        if (!supabase) return;
        const next = ordered.map((p, i) => ({ ...p, sort: i }));
        setPhotos(next);
        photosRef.current = next;
        const changed = next.filter((p) => photos.find((x) => x.id === p.id)?.sort !== p.sort);
        const results = await Promise.all(
            changed.map((p) => supabase!.from('provider_photos').update({ sort: p.sort }).eq('id', p.id)),
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) {
            setError(failed.error.message);
            await load();
        } else {
            toast(t('account.photosOrderSaved'));
        }
    };

    const move = (id: string, delta: number) => {
        const i = photos.findIndex((p) => p.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= photos.length) return;
        const arr = [...photos];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        void persistOrder(arr);
    };

    const makeCover = (id: string) => {
        const p = photos.find((x) => x.id === id);
        if (!p || photos[0]?.id === id) return;
        void persistOrder([p, ...photos.filter((x) => x.id !== id)]);
    };

    const dropOn = (targetId: string) => {
        const from = photos.findIndex((p) => p.id === dragId);
        const to = photos.findIndex((p) => p.id === targetId);
        setDragId(null); setOverId(null);
        if (from < 0 || to < 0 || from === to) return;
        const arr = [...photos];
        const [m] = arr.splice(from, 1);
        arr.splice(to, 0, m);
        void persistOrder(arr);
    };

    const remove = async (photo: PhotoRow) => {
        if (!supabase) return;
        setBusyId(photo.id);
        setError(null);
        // Row first: an orphaned file costs storage, an orphaned row renders a
        // broken image on a clinic's own page.
        const { error: rowErr } = await supabase.from('provider_photos').delete().eq('id', photo.id);
        if (!rowErr) await supabase.storage.from('clinic-photos').remove([photo.storage_path]);
        setBusyId(null);
        setConfirmId(null);
        if (rowErr) setError(rowErr.message);
        else toast(t('account.photoDeleted'));
        await load();
    };

    return (
        <div className="acct-form">
            <div className="acct-callout">
                <div>
                    <p className="acct-callout-title">{t('account.galleryVsAvatarTitle')}</p>
                    <p className="acct-muted">{t('account.galleryVsAvatarBody')}</p>
                </div>
                {onGoToProfile && (
                    <button type="button" className="acct-btn acct-btn--ghost acct-btn--sm" onClick={onGoToProfile}>
                        {t('account.goToAvatar')}
                    </button>
                )}
            </div>

            <div
                id="acct-gallery-drop"
                className={`acct-drop${dragOver ? ' is-over' : ''}`}
                onDragOver={(e) => {
                    if (dragId) return; // reordering a tile, not adding files
                    e.preventDefault(); setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    if (dragId) return;
                    e.preventDefault(); setDragOver(false);
                    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
                }}
            >
                <button
                    type="button"
                    className="acct-drop-btn"
                    onClick={() => inputRef.current?.click()}
                    disabled={photos.length >= MAX_PHOTOS}
                >
                    <strong>{t('account.photoDropTitle')}</strong>
                    <span>{t('account.photoDropHint', { max: MAX_PHOTOS })}</span>
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    hidden
                    accept={ACCEPTED_IMAGE_TYPES.join(',')}
                    onChange={(e) => {
                        const files = e.target.files ? Array.from(e.target.files) : [];
                        e.target.value = '';
                        if (files.length) void addFiles(files);
                    }}
                />
            </div>

            {error && <p role="alert" className="acct-msg acct-msg--error acct-msg--block">{error}</p>}

            {queue.length > 0 && (
                <ul className="acct-queue" aria-live="polite">
                    {queue.map((q) => (
                        <li key={q.key} className={`acct-queue-item is-${q.status}`}>
                            <span className="acct-queue-name">{q.name}</span>
                            {q.status === 'error' ? (
                                <span className="acct-msg acct-msg--error">
                                    {q.error}{' '}
                                    <button
                                        type="button" className="acct-link"
                                        onClick={() => setQueue((x) => x.filter((i) => i.key !== q.key))}
                                    >
                                        {t('account.dismiss')}
                                    </button>
                                </span>
                            ) : (
                                <span
                                    className="acct-bar" role="progressbar"
                                    aria-valuemin={0} aria-valuemax={100}
                                    aria-valuenow={Math.round(q.progress * 100)}
                                >
                                    <span style={{ width: `${Math.max(6, q.progress * 100)}%` }} />
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {loaded && photos.length === 0 && !uploading ? (
                <div className="acct-empty">
                    <p className="acct-empty-title">{t('account.photosEmptyTitle')}</p>
                    <p className="acct-muted">{t('account.photosEmptyBody')}</p>
                </div>
            ) : (
                <>
                    {photos.length > 1 && <p className="acct-fine">{t('account.photosReorderHint')}</p>}
                    <ul className="acct-gallery">
                        {photos.map((photo, i) => (
                            <li
                                key={photo.id}
                                className={`acct-tile${dragId === photo.id ? ' is-dragging' : ''}${overId === photo.id && dragId !== photo.id ? ' is-over' : ''}`}
                                draggable={busyId === null}
                                onDragStart={(e) => { setDragId(photo.id); e.dataTransfer.effectAllowed = 'move'; }}
                                onDragEnd={() => { setDragId(null); setOverId(null); }}
                                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(photo.id); } }}
                                onDrop={(e) => { if (dragId) { e.preventDefault(); e.stopPropagation(); dropOn(photo.id); } }}
                            >
                                <img src={clinicPublicUrl(photo.storage_path)} alt="" draggable={false} loading="lazy" />
                                {i === 0 && <span className="acct-tile-cover">{t('account.photoCover')}</span>}

                                {confirmId === photo.id ? (
                                    <div className="acct-tile-confirm" role="alertdialog" aria-label={t('account.photoDeleteConfirm')}>
                                        <p>{t('account.photoDeleteConfirm')}</p>
                                        <div>
                                            <button
                                                type="button" className="acct-btn acct-btn--danger acct-btn--sm"
                                                disabled={busyId === photo.id} onClick={() => void remove(photo)}
                                            >
                                                {busyId === photo.id ? t('account.working') : t('account.delete')}
                                            </button>
                                            <button type="button" className="acct-btn acct-btn--ghost acct-btn--sm" onClick={() => setConfirmId(null)}>
                                                {t('account.cancel')}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            type="button" className="acct-tile-x"
                                            onClick={() => setConfirmId(photo.id)}
                                            aria-label={t('account.photoRemove')} title={t('account.photoRemove')}
                                        >
                                            <IconClose size={13} weight={2.2} />
                                        </button>
                                        <div className="acct-tile-bar">
                                            <button type="button" onClick={() => move(photo.id, -1)} disabled={i === 0} aria-label={t('account.moveEarlier')} title={t('account.moveEarlier')}>&larr;</button>
                                            {i > 0 && (
                                                <button type="button" className="acct-tile-cover-btn" onClick={() => makeCover(photo.id)}>
                                                    {t('account.makeCover')}
                                                </button>
                                            )}
                                            <button type="button" onClick={() => move(photo.id, 1)} disabled={i === photos.length - 1} aria-label={t('account.moveLater')} title={t('account.moveLater')}>&rarr;</button>
                                        </div>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
