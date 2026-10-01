/**
 * POST /api/borderhealth-lead
 *
 * Puts the person who just finished a form into the MedSociety LayerOne (GHL)
 * sub-account as a contact, tagged by audience, with a note saying what they
 * are and where the full answers live.
 *
 * The full answers stay in Supabase (bh_responses). GHL only gets the lead:
 * name, org, email, WhatsApp, industry, city, follow-up yes/no. A fifteen
 * question survey does not belong in contact custom fields.
 *
 * This is a function rather than a fetch from the page because the page is
 * public and already carries the Supabase anon key. The PIT lives here, in
 * Vercel's environment, and never crosses to the client. The page calls this
 * best-effort after the Supabase insert succeeds: if this fails the survey
 * still counts.
 *
 * This endpoint moved here from borderhealth.dropdev.co — it now lives in the
 * medsociety Vercel project as api/borderhealth-lead.ts, served (via
 * vercel.json's rewrite of everything except /api/) at
 * POST /api/borderhealth-lead.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 * Set these in this (medsociety) Vercel project → Settings → Environment
 * Variables, production scope (also with `vercel env add`):
 *   GHL_PIT_MEDSOCIETY       private integration token for the MedSociety
 *                            sub-account. Secret. Also in 1Password
 *                            (HealthAtlas vault, GHL_PIT_MEDSOCIETY).
 *   GHL_LOCATION_MEDSOCIETY  the sub-account's location id. Defaults to the
 *                            MedSociety location below.
 *
 * GHL API versions are per-endpoint and not interchangeable:
 *   contacts/upsert, contacts/{id}/notes -> 2021-07-28
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The Vercel Node runtime pre-parses JSON bodies onto `req.body`. */
type Req = IncomingMessage & { body?: unknown; socket?: { remoteAddress?: string } };
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

const GHL_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_LOCATION = 'HkBNfpRezC5hRkWJaeSx';
const SEGMENTS = new Set(['employer', 'employee', 'provider']);

/* One person fills one form, maybe two. A burst from one address is a script.
 * In-memory resets on cold start, which still stops the case that matters. */
const HITS = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const seen = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    if (seen.length >= MAX_PER_WINDOW) return true;
    seen.push(now);
    HITS.set(ip, seen);
    if (HITS.size > 500) {
        for (const [k, v] of HITS) if (!v.some((t) => now - t < WINDOW_MS)) HITS.delete(k);
    }
    return false;
}

const str = (v: unknown, n: number): string => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

interface GhlResult {
    ok: boolean;
    status: number;
    json: Record<string, unknown> | null;
    text: string;
}

interface GhlContactPayload {
    locationId: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    source: string;
    tags: string[];
}

async function ghl(path: string, pit: string, payload: GhlContactPayload | { body: string }): Promise<GhlResult> {
    const r = await fetch(`${GHL_BASE}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${pit}`,
            Version: '2021-07-28',
            'content-type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const text = await r.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try {
        json = JSON.parse(text) as Record<string, unknown>;
    } catch {
        json = null;
    }
    return { ok: r.ok, status: r.status, json, text };
}

export default async function handler(req: Req, res: Res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedForValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ip = (forwardedForValue || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'too_many' });

    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = {};
        }
    }
    const b = (body || {}) as Record<string, unknown>;

    const segment = str(b.segment, 20);
    const email = str(b.email, 160).toLowerCase();
    const phone = str(b.phone, 40);
    const name = str(b.name, 120);
    const org = str(b.org, 160);
    const industry = str(b.industry, 80);
    const city = str(b.city, 80);
    const lang = str(b.lang, 2) === 'en' ? 'en' : 'es';
    const ref = str(b.ref, 40) || 'link';
    const session = str(b.session, 40) || 'live';
    const followUp = b.follow_up === true;
    const followKey = str(b.follow_up_key, 20);
    const whatsapp = str(b.whatsapp, 40);
    const variant = str(b.variant, 20) === 'research' ? 'research' : 'medsociety';

    if (!SEGMENTS.has(segment)) return res.status(400).json({ ok: false, error: 'bad_segment' });
    if (!email && !phone) return res.status(400).json({ ok: false, error: 'no_reach' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });

    const pit = process.env.GHL_PIT_MEDSOCIETY || '';
    const locationId = process.env.GHL_LOCATION_MEDSOCIETY || DEFAULT_LOCATION;
    if (!pit) {
        console.error('borderhealth-lead: GHL_PIT_MEDSOCIETY missing, nothing pushed');
        return res.status(500).json({ ok: false, error: 'not_configured' });
    }

    /* Test sessions get their own tag so they are one click to find and delete
     * in the CRM, and never mix with the real study tags. */
    const tags =
        session === 'test'
            ? ['borderhealth-test']
            : ['borderhealth', `borderhealth-${segment}`, followUp ? 'borderhealth-followup' : 'borderhealth-no-followup'].concat(
                  followKey === 'info_first' ? ['borderhealth-info-first'] : []
              ).concat([`borderhealth-v-${variant}`]);

    const parts = name.split(' ');
    const contact: GhlContactPayload = {
        locationId,
        firstName: parts[0] || undefined,
        lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
        name: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        companyName: org || undefined,
        source: variant === 'research' ? 'borderhealth research (MLCIC)' : 'medsociety.one/borderhealth',
        tags,
    };

    try {
        const up = await ghl('/contacts/upsert', pit, contact);
        if (!up.ok) {
            console.error('borderhealth-lead: upsert non-2xx', up.status, up.text.slice(0, 300));
            return res.status(502).json({ ok: false, error: 'upsert_failed' });
        }
        const upContact = up.json?.contact as { id?: string } | undefined;
        const id = upContact?.id || null;

        /* The note is what a human reads in the CRM. Answers live in Supabase. */
        if (id) {
            const lines = [
                `Border health study, ${segment} form (${lang}), via ${ref}${session === 'test' ? ', TEST' : ''}.`,
                industry ? `Industry or practice: ${industry}.` : null,
                city ? `Location: ${city}.` : null,
                `Follow-up: ${followKey === 'info_first' ? 'yes, but send information first' : followUp ? 'yes, 15 minute conversation' : 'no'}.`,
                whatsapp && whatsapp !== phone ? `WhatsApp: ${whatsapp}.` : null,
                'Full answers: Supabase bh_responses, match on email or phone.',
            ].filter((l): l is string => Boolean(l));
            const note = await ghl(`/contacts/${id}/notes`, pit, { body: lines.join('\n') });
            if (!note.ok) console.error('borderhealth-lead: note non-2xx', note.status, note.text.slice(0, 200));
        }

        return res.status(200).json({ ok: true, id });
    } catch (e) {
        console.error('borderhealth-lead: threw', String(e).slice(0, 200));
        return res.status(502).json({ ok: false, error: 'push_failed' });
    }
}
