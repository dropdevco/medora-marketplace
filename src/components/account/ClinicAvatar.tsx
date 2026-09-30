import { useState } from 'react';

/**
 * Round clinic picture with an initials fallback. Used by the dashboard header
 * and by the profile-picture editor so both always agree on what "no picture"
 * looks like.
 */
export function ClinicAvatar({ src, name, size = 56, className = '' }: {
    src?: string | null;
    name: string;
    size?: number;
    className?: string;
}) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = !!src && failedSrc !== src;
    const initials = name
        .split(/\s+/)
        .filter((w) => /^[\p{L}]/u.test(w))
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('') || '+';

    return (
        <span
            className={`acct-avatar ${className}`}
            style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
        >
            {showImage ? (
                <img src={src!} alt="" onError={() => setFailedSrc(src!)} draggable={false} />
            ) : (
                <span aria-hidden="true">{initials}</span>
            )}
        </span>
    );
}
