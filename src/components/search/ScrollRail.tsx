import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from '../icons/Icons';

/**
 * A horizontally scrolling row that admits it scrolls.
 *
 * Both rails in the search header hide their scrollbars — which is right on a
 * trackpad and wrong everywhere else, because the only remaining cue that
 * there is more to the right is the row being clipped mid-word, and a row that
 * happens to end on a chip boundary gives no cue at all. Reviewers read the
 * specialty rail as eight specialties, full stop.
 *
 * So: a chevron on each side, shown only on the side that has somewhere to go,
 * plus a fade over the clipped edge. Both disappear entirely when the row
 * fits, so a wide window is not taxed with controls for scrolling that cannot
 * happen.
 *
 * Deliberately not a carousel. Auto-advancing a row of filters moves the
 * control the user is reaching for, and these are targets, not content.
 */
interface ScrollRailProps {
    children: ReactNode;
    /** Class for the scrolling element itself, e.g. `ms-cats` or `ms-chiprow`. */
    className: string;
    /** How far one chevron press travels, as a share of the visible width. */
    step?: number;
    label?: string;
    role?: string;
}

/** Slack, in px, before an edge counts as scrollable. Sub-pixel layout lies. */
const EPSILON = 2;

export function ScrollRail({ children, className, step = 0.8, label, role }: ScrollRailProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ left: false, right: false });

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const left = el.scrollLeft > EPSILON;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - EPSILON;
        // Set-if-changed: this runs from a ResizeObserver, and writing the same
        // pair back on every layout pass is one dependency away from a loop.
        setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    }, []);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        measure();
        el.addEventListener('scroll', measure, { passive: true });
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        // The children changing width (a facet count arriving, a language
        // switch) moves the edges without either a scroll or a resize of the
        // rail itself, so watch the content too.
        for (const child of Array.from(el.children)) observer.observe(child);
        return () => {
            el.removeEventListener('scroll', measure);
            observer.disconnect();
        };
    }, [measure, children]);

    const nudge = (dir: -1 | 1) => {
        const el = ref.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth * step, behavior: 'smooth' });
    };

    return (
        <div className="ms-rail">
            <div ref={ref} className={className} role={role} aria-label={label}>
                {children}
            </div>

            {edges.left && <RailArrow side="left" onClick={() => nudge(-1)} />}
            {edges.right && <RailArrow side="right" onClick={() => nudge(1)} />}
        </div>
    );
}

/**
 * Hidden from assistive tech on purpose: the rail is already reachable with
 * the keyboard by tabbing through its own contents, which scrolls them into
 * view. A screen reader gaining two extra "scroll right" stops per rail is
 * noise, not access.
 */
function RailArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
    return (
        <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={onClick}
            className={`ms-rail-arrow is-${side}`}
        >
            {side === 'left' ? <IconChevronLeft size={16} weight={2.2} /> : <IconChevronRight size={16} weight={2.2} />}
        </button>
    );
}
