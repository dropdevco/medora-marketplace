export interface InquiryPayload {
    providerId: string;
    providerName: string;
    name: string;
    contact: string;
    message: string;
    preferredTime?: string;
    language: 'en' | 'es';
    sourceUrl?: string;
    /** Honeypot. Real users never fill it. */
    website?: string;
}

export type InquiryOutcome =
    | { ok: true }
    | { ok: false; error: 'invalid' | 'too_many' | 'server' | 'network' };

/** Posts a patient question to /api/inquiry. Never throws. */
export async function sendInquiry(payload: InquiryPayload): Promise<InquiryOutcome> {
    try {
        const res = await fetch('/api/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.ok) return { ok: true };
        if (res.status === 429) return { ok: false, error: 'too_many' };
        if (res.status === 400) return { ok: false, error: 'invalid' };
        return { ok: false, error: 'server' };
    } catch {
        return { ok: false, error: 'network' };
    }
}
