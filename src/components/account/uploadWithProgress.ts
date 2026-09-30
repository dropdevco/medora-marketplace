import { supabase } from '../../lib/supabase';

/**
 * Upload a blob to the `clinic-photos` bucket with byte-level progress.
 *
 * supabase-js does not expose upload progress, so this talks to the storage
 * REST endpoint directly with the signed-in user's own JWT: same credentials,
 * same RLS policy (folder = provider id), just XHR so `upload.onprogress`
 * exists. If the environment or session is missing it falls back to the SDK
 * call, without progress.
 */
export async function uploadClinicFile(
    path: string,
    blob: Blob,
    contentType: string,
    onProgress?: (fraction: number) => void,
): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'offline' };

    const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!base || !anon || !token) {
        const { error } = await supabase.storage.from('clinic-photos').upload(path, blob, { contentType });
        onProgress?.(1);
        return { error: error?.message ?? null };
    }

    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}/storage/v1/object/clinic-photos/${encoded}`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('apikey', anon);
        xhr.setRequestHeader('Content-Type', contentType);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('cache-control', 'max-age=31536000');
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(1); resolve({ error: null }); return; }
            let msg = `Upload failed (${xhr.status})`;
            try { msg = JSON.parse(xhr.responseText).message ?? msg; } catch { /* keep default */ }
            resolve({ error: msg });
        };
        xhr.onerror = () => resolve({ error: 'network' });
        xhr.send(blob);
    });
}

export function clinicPublicUrl(path: string): string {
    return supabase?.storage.from('clinic-photos').getPublicUrl(path).data.publicUrl ?? '';
}

/** Storage path of a public clinic-photos URL that belongs to `providerId`, else null. */
export function ownedPathFromUrl(url: string | undefined | null, providerId: string, prefix = ''): string | null {
    if (!url) return null;
    const marker = '/clinic-photos/';
    const i = url.indexOf(marker);
    if (i < 0) return null;
    const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
    return path.startsWith(`${providerId}/${prefix}`) ? path : null;
}
