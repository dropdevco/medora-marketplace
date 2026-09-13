import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * The signed-in user, or null.
 *
 * `loading` is not the same as "signed out", and every caller needs the
 * difference: Supabase restores a session from local storage asynchronously,
 * so a guard that treats the first render as signed-out bounces the user to
 * the login page on every refresh of a page they are allowed to see.
 *
 * `supabase` is nullable by design (see src/lib/supabase.ts), so with no
 * credentials configured this settles to "signed out" rather than throwing —
 * the directory keeps working, only the clinic portal is unreachable.
 */
export function useSession() {
    const [session, setSession] = useState<Session | null>(null);
    // With no client there is nothing to restore, so this is settled before the
    // first render rather than corrected by an effect afterwards.
    const [loading, setLoading] = useState(() => supabase !== null);

    useEffect(() => {
        if (!supabase) return;

        let mounted = true;

        supabase.auth.getSession().then(({ data }) => {
            if (!mounted) return;
            setSession(data.session);
            setLoading(false);
        });

        // Covers sign-in, sign-out, token refresh, and the same user signing
        // out in another tab.
        const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
            if (!mounted) return;
            setSession(next);
            setLoading(false);
        });

        return () => {
            mounted = false;
            sub.subscription.unsubscribe();
        };
    }, []);

    return { session, user: session?.user ?? null, loading };
}
