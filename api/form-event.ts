/**
 * POST /api/form-event
 *
 * Receives analytics events from the /borderhealth forms (see
 * src/components/borderhealth/track.ts) and stores them in `public.form_events`
 * (supabase/migrations/0010_form_analytics.sql).
 *
 * The server adds what the browser cannot be trusted with: country / region /
 * city from Vercel's edge headers, the user-agent, a bot flag, and a SALTED HASH
 * of the IP (never the IP itself).
 *
 * Env (Vercel → Settings → Environment Variables):
 *   VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY   required
 *   FORM_EVENT_SALT                                                  recommended
 *
 * Always answers 204 for well-formed requests so tracking can never break a form.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage & { body?: unknown; socket?: { remoteAddress?: string } };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const EVENTS = new Set([
    'page_view', 'segment_selected', 'segment_changed', 'step_view', 'first_answer', 'step_next',
    'validation_error', 'lang_switch', 'submit_attempt', 'submit_success', 'submit_error', 'abandon',
]);
const SEGMENTS = new Set(['employer', 'employee', 'provider']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|facebookexternalhit|whatsapp|curl|wget|python-requests/i;

const HITS = new Map<string, number[]>();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 120;

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const seen = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (seen.length >= MAX_PER_WINDOW) {
        HITS.set(ip, seen);
        return true;
    }
    seen.push(now);
    HITS.set(ip, seen);
    if (HITS.size > 500) {
        for (const [k, v] of HITS) if (!v.some((t) => now - t < WINDOW_MS)) HITS.delete(k);
    }
    return false;
}

function clean(v: unknown, max: number): string | null {
    if (v == null) return null;
    // eslint-disable-next-line no-control-regex
    const s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    return s || null;
}

function int(v: unknown, lo: number, hi: number): number | null {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
}

function header(req: Req, name: string): string | null {
    const v = req.headers[name];
    return clean(Array.isArray(v) ? v[0] : v, 200);
}

function decode(v: string | null): string | null {
    if (!v) return null;
    try {
        return decodeURIComponent(v);
    } catch {
        return v;
    }
}

function host(url: string | null): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, '').slice(0, 120);
    } catch {
        return null;
    }
}

export default async function handler(req: Req, res: Res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false });
    }

    const fwd = req.headers['x-forwarded-for'];
    const fwdValue = Array.isArray(fwd) ? fwd[0] : fwd;
    const ip = (fwdValue ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ ok: false });

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    if (body === undefined) {
        // sendBeacon and the dev server send an unparsed stream.
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = {}; }
    }
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

    const event = clean(b.event, 40);
    if (!event || !EVENTS.has(event)) return res.status(400).json({ ok: false });

    const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('[form-event] misconfigured: Supabase URL or service role key missing');
        return res.status(500).json({ ok: false });
    }

    const ua = header(req, 'user-agent');
    const seg = clean(b.form_segment, 20);
    const lang = clean(b.lang, 2);
    const sk = clean(b.submission_key, 40);
    const referrer = clean(b.referrer, 500);
    const salt = process.env.FORM_EVENT_SALT ?? 'medsociety-form-events';
    const today = new Date().toISOString().slice(0, 10);

    let props: Record<string, unknown> = {};
    if (b.props && typeof b.props === 'object' && !Array.isArray(b.props)) {
        const s = JSON.stringify(b.props);
        if (s.length <= 2000) props = b.props as Record<string, unknown>;
    }

    const row = {
        event,
        form_segment: seg && SEGMENTS.has(seg) ? seg : null,
        lang: lang === 'en' || lang === 'es' ? lang : null,
        step: int(b.step, 0, 50),
        step_id: clean(b.step_id, 60),
        submission_key: sk && UUID.test(sk) ? sk : null,
        props,
        visitor_id: clean(b.visitor_id, 64),
        visit_id: clean(b.visit_id, 64),
        session: clean(b.session, 20) === 'test' ? 'test' : 'live',
        ref: clean(b.ref, 80),
        page_path: clean(b.page_path, 200),
        page_query: clean(b.page_query, 500),
        referrer,
        referrer_host: host(referrer),
        utm_source: clean(b.utm_source, 80),
        utm_medium: clean(b.utm_medium, 80),
        utm_campaign: clean(b.utm_campaign, 120),
        utm_content: clean(b.utm_content, 120),
        utm_term: clean(b.utm_term, 120),
        ua: ua ? ua.slice(0, 400) : null,
        device_type: clean(b.device_type, 20),
        browser: clean(b.browser, 40),
        os: clean(b.os, 40),
        screen_w: int(b.screen_w, 0, 20000),
        screen_h: int(b.screen_h, 0, 20000),
        viewport_w: int(b.viewport_w, 0, 20000),
        viewport_h: int(b.viewport_h, 0, 20000),
        dpr: Number.isFinite(Number(b.dpr)) ? Math.min(Number(b.dpr), 10) : null,
        tz: clean(b.tz, 60),
        browser_lang: clean(b.browser_lang, 20),
        connection: clean(b.connection, 20),
        country: header(req, 'x-vercel-ip-country'),
        region: decode(header(req, 'x-vercel-ip-country-region')),
        city: decode(header(req, 'x-vercel-ip-city')),
        // Rotates daily: counts repeat visits within a day, cannot identify a person.
        ip_hash: ip === 'unknown' ? null : createHash('sha256').update(`${salt}|${today}|${ip}`).digest('hex').slice(0, 20),
        is_bot: !ua || BOT.test(ua),
    };

    try {
        const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/form_events`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify(row),
        });
        if (!r.ok) console.error('[form-event] insert failed:', r.status, (await r.text().catch(() => '')).slice(0, 300));
    } catch (e) {
        console.error('[form-event] insert threw:', String(e).slice(0, 200));
    }
    res.statusCode = 204;
    res.end();
}
