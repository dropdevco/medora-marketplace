/**
 * Create a demo clinic account, so the flows can be handed to someone to try.
 *
 * Signing up through the UI gets you an account with nothing attached to it —
 * ownership is granted by review, on purpose. This does the review's half:
 * creates (or reuses) a confirmed user, picks a listing worth demoing, and
 * makes that user its owner.
 *
 * Service role only. It writes `provider_owners`, which no client may write,
 * and confirms an email address, which no client may do either.
 *
 *   npx tsx scripts/seed-demo-clinic.ts
 *   npx tsx scripts/seed-demo-clinic.ts demo@medsociety.one 'some-password'
 *
 * Re-running is safe: the user is reused, the ownership row is upserted, and
 * the listing is not modified.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
}

const EMAIL = process.argv[2] ?? 'demo-clinic@medsociety.one';
const PASSWORD = process.argv[3] ?? 'medsociety-demo-2026';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

async function findOrCreateUser(): Promise<string> {
    // createUser is the only call that can confirm an address outright, which
    // a demo account needs — nobody is going to read that inbox.
    const { data, error } = await supabase.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
    });

    if (!error && data.user) return data.user.id;

    // Already there from a previous run. There is no getUserByEmail, so page
    // the list; the demo project is small enough that one page is plenty.
    const { data: list, error: listError } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
    });
    if (listError) throw listError;

    const existing = list.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
    if (!existing) throw error ?? new Error(`Could not create or find ${EMAIL}`);

    // Reset the password so the printed credentials are always the real ones.
    await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD });
    return existing.id;
}

async function pickClinic(): Promise<{ id: string; name: string }> {
    // Something worth showing: a real photo, a believable review count, and a
    // curated rank, which means a person has already looked at it.
    const { data, error } = await supabase
        .from('providers')
        .select('id, name')
        .not('featuredRank', 'is', null)
        .order('featuredRank')
        .limit(1);

    if (error) throw error;
    if (!data?.length) throw new Error('No featured providers to demo. Run migration 0002 first.');
    return data[0] as { id: string; name: string };
}

async function main() {
    const userId = await findOrCreateUser();
    const clinic = await pickClinic();

    const { error } = await supabase
        .from('provider_owners')
        .upsert(
            { provider_id: clinic.id, user_id: userId, role: 'owner' },
            { onConflict: 'provider_id,user_id' },
        );
    if (error) throw error;

    // An approved claim on record too, so the dashboard's "under review" path
    // is not the only one anyone ever sees in the claims table.
    await supabase.from('provider_claims').upsert(
        {
            provider_id: clinic.id,
            user_id: userId,
            status: 'approved',
            evidence: 'Seeded demo account.',
            reviewed_at: new Date().toISOString(),
        },
        { onConflict: 'provider_id,user_id' },
    );

    console.log('Demo clinic account ready.');
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  clinic:   ${clinic.name}`);
    console.log('  sign in at /login, then /dashboard');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
