/**
 * Social network glyphs for the provider profile. Same house rules as
 * Icons.tsx (24×24, currentColor, round caps) — drawn as simplified marks
 * rather than official logos, so they sit quietly in both themes.
 */
import type { SVGProps } from 'react';

export interface SocialIconProps extends Omit<SVGProps<SVGSVGElement>, 'size'> {
    size?: number;
}

function Svg({ size = 18, children, ...rest }: SocialIconProps & { children: React.ReactNode }) {
    return (
        <svg
            width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" focusable="false" {...rest}
        >
            {children}
        </svg>
    );
}

export function IconFacebook(p: SocialIconProps) {
    return <Svg {...p}><path d="M14.5 21v-8h2.7l.5-3.2h-3.2V7.9c0-.9.4-1.6 1.7-1.6h1.6V3.5c-.4-.1-1.4-.2-2.4-.2-2.5 0-4 1.5-4 4.2v2.3H8.3V13h2.5v8" /></Svg>;
}
export function IconInstagram(p: SocialIconProps) {
    return (
        <Svg {...p}>
            <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </Svg>
    );
}
export function IconTikTok(p: SocialIconProps) {
    return <Svg {...p}><path d="M14 4v10.2a3.7 3.7 0 11-3.7-3.7" /><path d="M14 4c.3 2.4 2 4.1 4.5 4.3" /></Svg>;
}
export function IconYouTube(p: SocialIconProps) {
    return (
        <Svg {...p}>
            <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
            <path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" />
        </Svg>
    );
}
export function IconX(p: SocialIconProps) {
    return <Svg {...p}><path d="M4.5 4.5h4l11 15h-4z" /><path d="M19 4.5l-6.2 6.6M5 19.5l6.2-6.6" /></Svg>;
}
export function IconLinkedIn(p: SocialIconProps) {
    return (
        <Svg {...p}>
            <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
            <path d="M8 10.5V16M8 7.9v.1M11.5 16v-5.5M11.5 12.5c0-1.4 1-2.2 2.3-2.2 1.4 0 2.2.9 2.2 2.4V16" />
        </Svg>
    );
}
export function IconWhatsApp(p: SocialIconProps) {
    return (
        <Svg {...p}>
            <path d="M4 20l1.3-4.2A8 8 0 1112 20a8 8 0 01-3.8-1L4 20z" />
            <path d="M9.5 9c0 3 2.5 5.5 5.5 5.5l.9-1.3-1.9-.9-.7.7c-1-.4-1.8-1.2-2.2-2.2l.7-.7-.9-1.9z" fill="currentColor" stroke="none" />
        </Svg>
    );
}
