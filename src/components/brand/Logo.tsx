/**
 * MedSociety brand mark.
 *
 * The mark is a shield (trust, and the two jurisdictions a patient crosses
 * between) carrying a medical cross whose lower arm tapers into a map pin —
 * the product in one glyph: verified care, findable on a map.
 *
 * The rule bisecting the shield is the border itself.
 *
 * Every fill here is a token, never a literal. A hard-coded shield colour
 * is how the old mark ended up invisible on the dark navbar: the fill and
 * the ground behind it were the same hex. --mark-bg/--mark-fg invert with
 * the theme; --accent, the seal ring, does not.
 */

interface LogoMarkProps {
    size?: number;
    /** Adds the slow idle breath. Off inside dense UI like list rows. */
    idle?: boolean;
    className?: string;
}

export function LogoMark({ size = 34, idle = false, className = '' }: LogoMarkProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="MedSociety"
            className={`${idle ? 'idle-breathe' : ''} ${className}`.trim()}
            style={{ display: 'block', flexShrink: 0 }}
        >
            {/* Shield body */}
            <path
                d="M20 2.4 L35 7.8 V21 c0 8.6-6.1 15.4-15 17.6C11.1 36.4 5 29.6 5 21 V7.8 Z"
                fill="var(--mark-bg)"
            />
            {/* Border rule — the line the product exists to span */}
            <path d="M5.6 20.4 H34.4" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="2.6 2.4" opacity="0.85" />
            {/* Cross, with the lower arm tapering into a pin point */}
            <path
                d="M17.3 10.6 h5.4 v4.9 h4.9 v5.4 h-4.9 v4.4 L20 30.4 l-2.7-5.1 v-4.4 h-4.9 v-5.4 h4.9 Z"
                fill="var(--mark-fg)"
            />
            {/* Pin dot */}
            <circle cx="20" cy="18.2" r="1.9" fill="var(--mark-bg)" />
            {/* Seal edge — the one constant across both themes */}
            <path
                d="M20 2.4 L35 7.8 V21 c0 8.6-6.1 15.4-15 17.6C11.1 36.4 5 29.6 5 21 V7.8 Z"
                stroke="var(--accent)"
                strokeWidth="1.6"
            />
        </svg>
    );
}

interface LogoProps {
    size?: number;
    /** Hides the wordmark, leaving only the shield. */
    markOnly?: boolean;
    idle?: boolean;
}

export function Logo({ size = 34, markOnly = false, idle = false }: LogoProps) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
            <LogoMark size={size} idle={idle} />
            {!markOnly && (
                <span
                    className="ms-wordmark"
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: `${size * 0.68}px`,
                        lineHeight: 1,
                        letterSpacing: '-0.01em',
                        color: 'var(--white)',
                        whiteSpace: 'nowrap',
                    }}
                >
                    Med<span style={{ color: 'var(--accent)' }}>Society</span>
                </span>
            )}
        </span>
    );
}
