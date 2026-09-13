import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { Field } from './AuthShell';
import { authButton } from './authStyles';
import { IconCheck } from '../icons/Icons';

/**
 * The listing, as the clinic can edit it.
 *
 * Only the columns the database will actually accept. `tier`, `verified`,
 * `promoted`, `featuredRank`, `rating` and `reviewCount` are missing from the
 * UPDATE grant, so a request carrying them is rejected outright — this form
 * stays in step with that on purpose rather than offering a field that would
 * silently fail. What we sell and what we measure are not the clinic's to
 * write; what the clinic knows about itself is.
 */
const EDITABLE = ['name', 'phone', 'website', 'email', 'address', 'description'] as const;
type Editable = (typeof EDITABLE)[number];

export function ClinicProfileForm({ clinic, onSaved }: {
    clinic: Provider;
    onSaved: () => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<Record<Editable, string>>(() => ({
        name: clinic.name ?? '',
        phone: clinic.phone ?? '',
        website: clinic.website ?? '',
        email: clinic.email ?? '',
        address: clinic.address ?? '',
        description: (clinic as Provider & { description?: string }).description ?? '',
    }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const set = (key: Editable, value: string) => {
        setDraft((d) => ({ ...d, [key]: value }));
        setSaved(false);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supabase) return;

        setBusy(true);
        setError(null);

        // Empty strings go back as null rather than as "", so a cleared field
        // reads as absent everywhere else in the app — `provider.phone && ...`
        // is the idiom throughout, and "" would pass a truthiness check it
        // should fail and render an empty contact row.
        const patch: Record<string, string | null> = {};
        for (const key of EDITABLE) patch[key] = draft[key].trim() || null;
        patch.updated_at = new Date().toISOString();

        const { error: err } = await supabase
            .from('providers')
            .update(patch)
            .eq('id', clinic.id);

        setBusy(false);

        if (err) { setError(err.message); return; }
        setSaved(true);
        onSaved();
    };

    return (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Field label={t('account.fieldName')}>
                <input required value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
                <Field label={t('account.fieldPhone')}>
                    <input type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
                </Field>
                <Field label={t('account.fieldEmail')}>
                    <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
            </div>

            <Field label={t('account.fieldWebsite')}>
                <input type="url" placeholder="https://" value={draft.website} onChange={(e) => set('website', e.target.value)} />
            </Field>

            <Field label={t('account.fieldAddress')} hint={t('account.fieldAddressHint')}>
                <input value={draft.address} onChange={(e) => set('address', e.target.value)} />
            </Field>

            <Field label={t('account.fieldDescription')} hint={t('account.fieldDescriptionHint')}>
                <textarea
                    maxLength={1200}
                    value={draft.description}
                    onChange={(e) => set('description', e.target.value)}
                />
            </Field>

            {error && (
                <p role="alert" style={{ color: 'var(--red)', fontSize: '0.85rem', lineHeight: 1.5 }}>{error}</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <button type="submit" disabled={busy} className="press" style={authButton}>
                    {busy ? t('account.working') : t('account.save')}
                </button>
                {saved && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--accent)', fontSize: '0.86rem', fontWeight: 700 }}>
                        <IconCheck size={15} weight={2.2} /> {t('account.saved')}
                    </span>
                )}
            </div>

            {/* Moving a pin is a geocoding job, not a text field, and the two
                columns that place a listing on the map are not in the update
                grant. Say who to ask rather than showing a dead input. */}
            <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)', lineHeight: 1.6 }}>
                {t('account.locationNote')}
            </p>
        </form>
    );
}
