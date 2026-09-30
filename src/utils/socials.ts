/**
 * Social-link normalisation for clinic profiles.
 *
 * A clinic owner will type anything into these boxes: `@drsmith`, `drsmith`,
 * `instagram.com/drsmith?igsh=abc123`, a whole pasted address bar, a phone
 * number for WhatsApp. This module turns all of that into one canonical
 * `https://` URL per network (or a precise reason it cannot), so the public
 * profile can render links without ever re-parsing user input, and so a
 * Facebook address pasted into the Instagram box is caught at the source
 * instead of becoming a broken link on a live listing.
 *
 * Pure and dependency-free on purpose: other modules (profile display, the
 * scraper backfill) import it, and `socials.test-cases.ts` runs it under Node.
 */

export type SocialNetwork =
    | 'facebook'
    | 'instagram'
    | 'tiktok'
    | 'youtube'
    | 'x'
    | 'linkedin'
    | 'whatsapp';

export interface SocialNetworkMeta {
    key: SocialNetwork;
    label: string;
    /** What to show in an empty input. */
    placeholder: string;
    /** Brand colour, for the small badge next to the field. */
    color: string;
    /** One or two characters for that badge. */
    short: string;
}

/** Display order is the order they appear in the editor. */
export const SOCIAL_NETWORKS: SocialNetworkMeta[] = [
    { key: 'instagram', label: 'Instagram', placeholder: '@yourclinic', color: '#E1306C', short: 'IG' },
    { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/yourclinic', color: '#1877F2', short: 'f' },
    { key: 'whatsapp', label: 'WhatsApp', placeholder: '+52 656 123 4567', color: '#25D366', short: 'WA' },
    { key: 'tiktok', label: 'TikTok', placeholder: '@yourclinic', color: '#111111', short: 'TT' },
    { key: 'youtube', label: 'YouTube', placeholder: '@yourclinic', color: '#FF0000', short: 'YT' },
    { key: 'x', label: 'X (Twitter)', placeholder: '@yourclinic', color: '#000000', short: 'X' },
    { key: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/yourname', color: '#0A66C2', short: 'in' },
];

/**
 * Stable error codes, not sentences — the UI maps them to translated text.
 *  - invalid          not something we can turn into a profile link
 *  - wrong_network    a link that belongs to a different network (see `wrongNetwork`)
 *  - needs_country_code  WhatsApp number without a country code
 *  - needs_url        LinkedIn handle without in/ or company/
 */
export type SocialError = 'invalid' | 'wrong_network' | 'needs_country_code' | 'needs_url';

export interface SocialResult {
    /** Canonical https URL. Absent when the input was empty or invalid. */
    url?: string;
    error?: SocialError;
    /** Short human form of `url` for previews, e.g. `@drsmith`, `+52 …`. */
    display?: string;
    /** Set with `wrong_network`: the network the pasted link actually belongs to. */
    wrongNetwork?: SocialNetwork;
}

const HOSTS: Record<SocialNetwork, string[]> = {
    facebook: ['facebook.com', 'fb.com', 'fb.me'],
    instagram: ['instagram.com', 'instagr.am'],
    tiktok: ['tiktok.com'],
    youtube: ['youtube.com', 'youtu.be'],
    x: ['x.com', 'twitter.com'],
    linkedin: ['linkedin.com', 'lnkd.in'],
    whatsapp: ['wa.me', 'whatsapp.com', 'api.whatsapp.com'],
};

/** Which network a hostname belongs to, if any. Subdomains (m., www., web.) count. */
function networkOfHost(host: string): SocialNetwork | null {
    for (const key of Object.keys(HOSTS) as SocialNetwork[]) {
        if (HOSTS[key].some((h) => host === h || host.endsWith('.' + h))) return key;
    }
    return null;
}

const LOOKS_LIKE_URL = /^(https?:\/\/|www\.|[a-z0-9-]+(\.[a-z0-9-]+)+\/|[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|me|am|be|in|co|ly)(\/|$))/i;

const RESERVED = {
    instagram: new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct', 'about', 'share']),
    x: new Set(['home', 'i', 'intent', 'share', 'search', 'hashtag', 'explore', 'settings', 'login', 'messages', 'notifications']),
    facebook: new Set(['sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'watch', 'login', 'login.php', 'help', 'policies', 'events', 'marketplace', 'photo', 'photo.php', 'permalink.php', 'story.php', 'l.php']),
} as const;

interface Parsed {
    host: string;
    segments: string[];
    params: URLSearchParams;
}

function parseUrl(raw: string): Parsed | null {
    try {
        const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
        const u = new URL(withProto);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web|l)\./, '');
        if (!host.includes('.')) return null;
        const segments = u.pathname.split('/').filter(Boolean).map((s) => {
            try { return decodeURIComponent(s); } catch { return s; }
        });
        return { host, segments, params: u.searchParams };
    } catch {
        return null;
    }
}

const ok = (url: string, display: string): SocialResult => ({ url, display });
const fail = (error: SocialError, wrongNetwork?: SocialNetwork): SocialResult =>
    wrongNetwork ? { error, wrongNetwork } : { error };

function stripAt(s: string): string {
    return s.replace(/^@+/, '');
}

/**
 * Turn whatever an owner typed into a canonical link for `network`.
 * Empty input returns `{}` (no url, no error) so "clear the field" is not an error.
 */
export function normalizeSocial(network: SocialNetwork, input: string): SocialResult {
    const raw = (input ?? '').trim();
    if (!raw) return {};
    if (/\s/.test(raw) && network !== 'whatsapp') return fail('invalid');
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) {
        // javascript:, mailto:, data: … never a profile link. (tel: is tolerated for WhatsApp.)
        if (!(network === 'whatsapp' && /^tel:/i.test(raw))) return fail('invalid');
    }

    if (network === 'whatsapp') return normalizeWhatsapp(raw);

    if (LOOKS_LIKE_URL.test(raw)) {
        const p = parseUrl(raw);
        if (!p) return fail('invalid');
        const owner = networkOfHost(p.host);
        if (owner && owner !== network) return fail('wrong_network', owner);
        if (owner !== network) return fail('invalid');
        return fromUrl(network, p);
    }

    return fromHandle(network, stripAt(raw));
}

function fromHandle(network: SocialNetwork, handle: string): SocialResult {
    // Someone pasting "instagram.com" alone, or "@" with nothing after it.
    if (!handle) return fail('invalid');
    switch (network) {
        case 'instagram':
            return /^[a-z0-9._]{1,30}$/i.test(handle)
                ? ok(`https://instagram.com/${handle}`, `@${handle}`)
                : fail('invalid');
        case 'facebook':
            return /^[a-z0-9._-]{2,80}$/i.test(handle)
                ? ok(`https://facebook.com/${handle}`, handle)
                : fail('invalid');
        case 'tiktok':
            return /^[a-z0-9._]{2,24}$/i.test(handle)
                ? ok(`https://tiktok.com/@${handle}`, `@${handle}`)
                : fail('invalid');
        case 'youtube':
            return /^[a-z0-9._-]{3,30}$/i.test(handle)
                ? ok(`https://youtube.com/@${handle}`, `@${handle}`)
                : fail('invalid');
        case 'x':
            return /^[a-z0-9_]{1,15}$/i.test(handle)
                ? ok(`https://x.com/${handle}`, `@${handle}`)
                : fail('invalid');
        case 'linkedin': {
            // "in/name" or "company/name" typed without the domain is fine;
            // a lone word is ambiguous (person or company?) so we ask.
            const m = /^(in|company|school)\/([a-z0-9À-ɏ._%-]{2,100})\/?$/i.exec(handle);
            return m
                ? ok(`https://linkedin.com/${m[1].toLowerCase()}/${m[2]}`, `${m[1].toLowerCase()}/${m[2]}`)
                : fail('needs_url');
        }
        default:
            return fail('invalid');
    }
}

function fromUrl(network: SocialNetwork, p: Parsed): SocialResult {
    const [a, b] = p.segments;
    // Every branch rebuilds the URL from its parts, which is what drops
    // tracking noise (?igsh=, ?utm_*, ?fbclid=, ?si=, #fragments) for free.
    switch (network) {
        case 'instagram': {
            if (!a || RESERVED.instagram.has(a.toLowerCase())) return fail('invalid');
            return /^[a-z0-9._]{1,30}$/i.test(a) ? ok(`https://instagram.com/${a}`, `@${a}`) : fail('invalid');
        }
        case 'facebook': {
            if (!a) return fail('invalid');
            const first = a.toLowerCase();
            if (first === 'profile.php') {
                const id = p.params.get('id');
                return id && /^\d{5,}$/.test(id)
                    ? ok(`https://facebook.com/profile.php?id=${id}`, `facebook.com/profile.php?id=${id}`)
                    : fail('invalid');
            }
            if (RESERVED.facebook.has(first)) return fail('invalid');
            if ((first === 'people' || first === 'pages') && b) {
                const c = p.segments[2];
                const path = [first, b, c].filter(Boolean).join('/');
                return ok(`https://facebook.com/${path}`, `facebook.com/${path}`);
            }
            return /^[a-z0-9._-]{2,80}$/i.test(a)
                ? ok(`https://facebook.com/${a}`, a)
                : fail('invalid');
        }
        case 'tiktok': {
            if (!a || !a.startsWith('@')) return fail('invalid');
            const h = a.slice(1);
            return /^[a-z0-9._]{2,24}$/i.test(h) ? ok(`https://tiktok.com/@${h}`, `@${h}`) : fail('invalid');
        }
        case 'youtube': {
            if (!a) return fail('invalid');
            if (a.startsWith('@')) {
                const h = a.slice(1);
                return /^[a-z0-9._-]{3,30}$/i.test(h) ? ok(`https://youtube.com/@${h}`, `@${h}`) : fail('invalid');
            }
            if ((a === 'channel' || a === 'c' || a === 'user') && b && /^[\w.%-]{2,100}$/.test(b)) {
                return ok(`https://youtube.com/${a}/${b}`, `youtube.com/${a}/${b}`);
            }
            // watch?v=, playlist, shorts, youtu.be/<video> — a video is not a channel.
            return fail('invalid');
        }
        case 'x': {
            if (!a || RESERVED.x.has(a.toLowerCase())) return fail('invalid');
            return /^[a-z0-9_]{1,15}$/i.test(a) ? ok(`https://x.com/${a}`, `@${a}`) : fail('invalid');
        }
        case 'linkedin': {
            const kind = a?.toLowerCase();
            if ((kind === 'in' || kind === 'company' || kind === 'school') && b && b.length >= 2) {
                const slug = encodeURIComponent(b).replace(/%40/g, '@');
                return ok(`https://linkedin.com/${kind}/${slug}`, `${kind}/${b}`);
            }
            return fail('invalid');
        }
        default:
            return fail('invalid');
    }
}

function formatPhone(digits: string): string {
    return `+${digits}`;
}

function normalizeWhatsapp(raw: string): SocialResult {
    let candidate = raw;

    if (LOOKS_LIKE_URL.test(raw)) {
        const p = parseUrl(raw);
        if (!p) return fail('invalid');
        const owner = networkOfHost(p.host);
        if (owner !== 'whatsapp') return owner ? fail('wrong_network', owner) : fail('invalid');
        if (p.host === 'wa.me') candidate = p.segments[0] ?? '';
        else if (p.host.endsWith('whatsapp.com')) candidate = p.params.get('phone') ?? '';
        else return fail('invalid');
    }

    // A number like "+52 (656) 123-4567" or "0052 656 123 4567".
    if (/[^\d\s()+.-]/.test(candidate)) return fail('invalid');
    let digits = candidate.replace(/\D/g, '');
    digits = digits.replace(/^00/, '');
    if (digits.length < 8 || digits.length > 15) return fail('invalid');
    // 10 digits is a national number (MX and US both use 10). wa.me needs the
    // country code, and guessing it would send patients to a stranger.
    if (digits.length === 10) return fail('needs_country_code');
    return ok(`https://wa.me/${digits}`, formatPhone(digits));
}

/**
 * Website field: accepts `clinic.mx` or `https://clinic.mx/path`, returns an
 * https/http URL. Bare domains get `https://`. Anything else is rejected.
 */
export function normalizeWebsite(input: string): { url?: string; error?: 'invalid' } {
    const raw = (input ?? '').trim();
    if (!raw) return {};
    if (/\s/.test(raw)) return { error: 'invalid' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return { error: 'invalid' };
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!/^https?:$/.test(u.protocol)) return { error: 'invalid' };
        if (!u.hostname.includes('.') || u.hostname.endsWith('.')) return { error: 'invalid' };
        return { url: u.toString().replace(/\/$/, '') };
    } catch {
        return { error: 'invalid' };
    }
}
