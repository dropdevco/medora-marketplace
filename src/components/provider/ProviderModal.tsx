import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProvider } from '../../hooks/useProvider';
import { ProviderView } from './ProviderView';
import { usePageMeta } from '../../hooks/usePageMeta';
import { LogoMark } from '../brand/Logo';
import { IconClose } from '../icons/Icons';

/** Keep in sync with the `ms-pm-out` animation duration in index.css. */
const EXIT_MS = 220;
const SWIPE_CLOSE_PX = 110;

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The provider profile as a modal over whatever the visitor was looking at.
 *
 * Rendered by App's second <Routes> when the navigation carried a
 * `backgroundLocation`; the page underneath stays mounted, so search results,
 * filters, map camera and scroll position are exactly as they were. Closing
 * plays the exit animation first and only then navigates back.
 */
export function ProviderModal() {
    const { t } = useTranslation();
    const { providerId } = useParams<{ providerId: string }>();
    const { provider, loading } = useProvider(providerId);
    const navigate = useNavigate();
    const location = useLocation();

    const [closing, setClosing] = useState(false);
    const closingRef = useRef(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const closeBtnRef = useRef<HTMLButtonElement>(null);

    usePageMeta(provider);

    const close = useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setClosing(true);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.setTimeout(() => {
            // The modal is only ever mounted with a background page under it,
            // so Back lands there. `default` = no in-app history at all.
            if (location.key !== 'default') navigate(-1);
            else navigate('/', { replace: true });
        }, reduced ? 0 : EXIT_MS);
    }, [location.key, navigate]);

    // Body scroll lock (compensating the scrollbar so the page doesn't shift)
    // and focus restoration to whatever opened the modal.
    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const body = document.body;
        const prevOverflow = body.style.overflow;
        const prevPadding = body.style.paddingRight;
        const scrollbar = window.innerWidth - document.documentElement.clientWidth;
        body.style.overflow = 'hidden';
        if (scrollbar > 0) {
            const base = parseFloat(getComputedStyle(body).paddingRight) || 0;
            body.style.paddingRight = `${base + scrollbar}px`;
        }
        return () => {
            body.style.overflow = prevOverflow;
            body.style.paddingRight = prevPadding;
            if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
        };
    }, []);

    // Move focus into the dialog once, on open.
    useEffect(() => {
        closeBtnRef.current?.focus({ preventScroll: true });
    }, []);

    // Escape + focus trap. Native listener on the document: the photo
    // lightbox portals to <body> outside this dialog, and while it is open it
    // owns Escape and Tab.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const dialog = dialogRef.current;
            if (!dialog) return;
            const dialogs = document.querySelectorAll('[role="dialog"]');
            if (dialogs[dialogs.length - 1] !== dialog) return; // a nested dialog is on top
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
                return;
            }
            if (e.key !== 'Tab') return;
            const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
                .filter((el) => el.offsetParent !== null || el === document.activeElement);
            if (items.length === 0) { e.preventDefault(); return; }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (!dialog.contains(active)) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [close]);

    // Swipe-down to dismiss (bottom-sheet layout), from the grab handle / top bar.
    const drag = useRef<{ y: number; dy: number } | null>(null);
    const onGrabDown = (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') return;
        drag.current = { y: e.clientY, dy: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        panelRef.current?.style.setProperty('transition', 'none');
    };
    const onGrabMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d || !panelRef.current) return;
        d.dy = Math.max(0, e.clientY - d.y);
        panelRef.current.style.transform = `translateY(${d.dy}px)`;
    };
    const onGrabUp = () => {
        const d = drag.current;
        drag.current = null;
        const panel = panelRef.current;
        if (!d || !panel) return;
        if (d.dy > SWIPE_CLOSE_PX) {
            close();
        } else {
            panel.style.transition = 'transform 0.25s var(--ease-out)';
            panel.style.transform = '';
            window.setTimeout(() => { panel.style.transition = ''; }, 260);
        }
    };

    return createPortal(
        <div
            ref={dialogRef}
            className="ms-pm"
            data-state={closing ? 'closing' : 'open'}
            role="dialog"
            aria-modal="true"
            aria-labelledby={provider ? 'ms-pm-title' : undefined}
            aria-label={provider ? undefined : t('providerPage.modalLabel')}
            aria-busy={loading}
        >
            <div className="ms-pm-backdrop" onClick={close} aria-hidden="true" />
            <div ref={panelRef} className="ms-pm-panel">
                <div
                    className="ms-pm-bar"
                    onPointerDown={onGrabDown}
                    onPointerMove={onGrabMove}
                    onPointerUp={onGrabUp}
                    onPointerCancel={onGrabUp}
                >
                    <span className="ms-pm-grab" aria-hidden="true" />
                    <button
                        ref={closeBtnRef}
                        type="button"
                        className="ms-pm-close"
                        onClick={close}
                        aria-label={t('providerPage.close')}
                    >
                        <IconClose size={18} weight={2.2} />
                    </button>
                </div>

                <div className="ms-pm-scroll">
                    <div className="ms-pm-content">
                        {loading ? (
                            <ModalSkeleton />
                        ) : !provider ? (
                            <div style={{ maxWidth: 420, margin: '2.5rem auto 1rem', textAlign: 'center' }}>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: 'var(--gray-500)' }}>
                                    <LogoMark size={36} />
                                </div>
                                <p style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                                    {t('providerPage.notFoundTitle')}
                                </p>
                                <p style={{ fontSize: '0.9rem', color: 'var(--gray-400)', marginBottom: '1.5rem', lineHeight: 1.55 }}>
                                    {t('providerPage.notFoundBody')}
                                </p>
                                <Link
                                    to="/"
                                    className="press"
                                    style={{
                                        display: 'inline-flex', padding: '0.7rem 1.4rem',
                                        borderRadius: 'var(--radius-pill)', background: 'var(--brand)',
                                        color: 'var(--on-brand)', fontWeight: 700, fontSize: '0.9rem',
                                        textDecoration: 'none',
                                    }}
                                >
                                    {t('providerPage.backToDirectory')}
                                </Link>
                            </div>
                        ) : (
                            <ProviderView provider={provider} titleId="ms-pm-title" />
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function ModalSkeleton() {
    return (
        <div aria-hidden="true" style={{ minHeight: '60dvh' }}>
            <div className="skeleton" style={{ width: 120, height: 22, borderRadius: 999, marginBottom: '1rem' }} />
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem' }}>
                <div className="skeleton" style={{ width: 72, height: 72, borderRadius: 16, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ width: '65%', height: 28, borderRadius: 8, marginBottom: '0.7rem' }} />
                    <div className="skeleton" style={{ width: '40%', height: 16, borderRadius: 8 }} />
                </div>
            </div>
            <div className="skeleton" style={{ width: '100%', height: 96, borderRadius: 'var(--radius)', marginBottom: '1.25rem' }} />
            <div className="skeleton" style={{ width: '100%', height: 104, borderRadius: 'var(--radius)', marginBottom: '1.25rem' }} />
            <div className="skeleton" style={{ width: '80%', height: 16, borderRadius: 8 }} />
        </div>
    );
}
