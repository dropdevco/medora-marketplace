import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Result { id: string; urls: string[] }

/**
 * Photos a clinic uploaded itself from its dashboard (`provider_photos`, files
 * in the public `clinic-photos` bucket), in the owner's chosen order.
 *
 * Kept separate from `providers.galleryUrls`, which holds the scraped
 * Doctoralia gallery: owners cannot write that column, so without this the
 * photos an owner adds would never appear on their public profile.
 */
export function useOwnerPhotos(providerId: string | undefined): string[] {
    const [result, setResult] = useState<Result | null>(null);

    useEffect(() => {
        if (!supabase || !providerId) return;
        let cancelled = false;
        void supabase
            .from('provider_photos')
            .select('storage_path, sort')
            .eq('provider_id', providerId)
            .order('sort', { ascending: true })
            .then(({ data }) => {
                if (cancelled) return;
                const urls = (data ?? [])
                    .map((r) => supabase!.storage.from('clinic-photos').getPublicUrl(r.storage_path).data.publicUrl)
                    .filter(Boolean);
                setResult({ id: providerId, urls });
            });
        return () => { cancelled = true; };
    }, [providerId]);

    return result && result.id === providerId ? result.urls : [];
}
