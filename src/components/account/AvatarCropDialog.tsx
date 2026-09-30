import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cropSquare, loadImage, type EncodedImage, type LoadedImage } from '../../utils/imageResize';

const MAX_ZOOM = 3;

/**
 * Square crop editor: drag to reposition, slider / wheel to zoom.
 * The output is produced in the browser (canvas) and never leaves the device
 * until the owner confirms.
 */
export function AvatarCropDialog({ file, onCancel, onConfirm }: {
    file: File;
    onCancel: () => void;
    onConfirm: (result: EncodedImage) => void;
}) {
    const { t } = useTranslation();
    const [loaded, setLoaded] = useState<LoadedImage | null>(null);
    const [failed, setFailed] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [off, setOff] = useState({ x: 0, y: 0 });
    const [busy, setBusy] = useState(false);
    const [frame] = useState(() => Math.max(200, Math.min(300, window.innerWidth - 72)));
    const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        let current: LoadedImage | null = null;
        loadImage(file)
            .then((l) => { if (cancelled) l.revoke(); else { current = l; setLoaded(l); } })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; current?.revoke(); };
    }, [file]);

    useEffect(() => {
        dialogRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onCancel]);

    const base = loaded ? frame / Math.min(loaded.width, loaded.height) : 1;
    const scale = base * zoom;

    const clamp = useCallback((x: number, y: number, z: number) => {
        if (!loaded) return { x: 0, y: 0 };
        const s = base * z;
        const maxX = Math.max(0, (loaded.width * s - frame) / 2);
        const maxY = Math.max(0, (loaded.height * s - frame) / 2);
        return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
    }, [loaded, base, frame]);

    const changeZoom = (z: number) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, z));
        setZoom(next);
        setOff((o) => clamp(o.x, o.y, next));
    };

    const confirm = async () => {
        if (!loaded) return;
        setBusy(true);
        try {
            const size = frame / scale;
            const sx = (loaded.width * scale / 2 - frame / 2 - off.x) / scale;
            const sy = (loaded.height * scale / 2 - frame / 2 - off.y) / scale;
            const out = await cropSquare(
                loaded,
                Math.max(0, Math.min(loaded.width - size, sx)),
                Math.max(0, Math.min(loaded.height - size, sy)),
                size,
            );
            onConfirm(out);
        } catch {
            setFailed(true);
            setBusy(false);
        }
    };

    return (
        <div className="acct-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
            <div
                ref={dialogRef}
                className="acct-modal"
                role="dialog"
                aria-modal="true"
                aria-label={t('account.cropTitle')}
                tabIndex={-1}
            >
                <h2 className="acct-modal-title">{t('account.cropTitle')}</h2>
                <p className="acct-modal-hint">{t('account.cropHint')}</p>

                {failed ? (
                    <p role="alert" className="acct-msg acct-msg--error">{t('account.avatarReadError')}</p>
                ) : (
                    <div
                        className="acct-crop-frame"
                        style={{ width: frame, height: frame }}
                        onPointerDown={(e) => {
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            dragRef.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y };
                        }}
                        onPointerMove={(e) => {
                            const d = dragRef.current;
                            if (!d) return;
                            setOff(clamp(d.ox + e.clientX - d.px, d.oy + e.clientY - d.py, zoom));
                        }}
                        onPointerUp={() => { dragRef.current = null; }}
                        onPointerCancel={() => { dragRef.current = null; }}
                        onWheel={(e) => changeZoom(zoom - e.deltaY * 0.002)}
                    >
                        {loaded && (
                            <img
                                src={loaded.url}
                                alt=""
                                draggable={false}
                                style={{
                                    width: loaded.width * scale,
                                    height: loaded.height * scale,
                                    transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
                                }}
                            />
                        )}
                        <span className="acct-crop-ring" aria-hidden="true" />
                    </div>
                )}

                <label className="acct-zoom">
                    <span>{t('account.cropZoom')}</span>
                    <input
                        type="range"
                        min={1}
                        max={MAX_ZOOM}
                        step={0.01}
                        value={zoom}
                        disabled={!loaded || failed}
                        onChange={(e) => changeZoom(Number(e.target.value))}
                    />
                </label>

                <div className="acct-modal-actions">
                    <button type="button" className="acct-btn acct-btn--ghost" onClick={onCancel} disabled={busy}>
                        {t('account.cancel')}
                    </button>
                    <button type="button" className="acct-btn" onClick={() => void confirm()} disabled={!loaded || failed || busy}>
                        {busy ? t('account.working') : t('account.cropUse')}
                    </button>
                </div>
            </div>
        </div>
    );
}
