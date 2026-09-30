/**
 * Client-side image preparation for clinic uploads.
 *
 * Phones hand over 4-12MB photos. Uploading those over clinic wifi is slow and
 * serving them on a listing is wasteful, so everything is re-encoded in the
 * browser first: the profile picture is cropped to a square and capped at
 * 800px, gallery photos are only capped (1600px on the long edge).
 */

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Ceiling on what we agree to *read*; the uploaded result is far smaller. */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export type ImageValidation = 'ok' | 'type' | 'size';

export function validateImageFile(file: File): ImageValidation {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'type';
    if (file.size > MAX_SOURCE_BYTES) return 'size';
    return 'ok';
}

export interface LoadedImage {
    img: HTMLImageElement;
    width: number;
    height: number;
    url: string;
    revoke: () => void;
}

/** Decode a File into an <img>. EXIF orientation is applied by the browser. */
export function loadImage(file: Blob): Promise<LoadedImage> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({
            img, url,
            width: img.naturalWidth,
            height: img.naturalHeight,
            revoke: () => URL.revokeObjectURL(url),
        });
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
    });
}

export interface EncodedImage {
    blob: Blob;
    ext: 'webp' | 'jpg';
    contentType: string;
}

/** WebP when the browser can encode it (Chrome, Firefox, Safari 17+), else JPEG. */
export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.85): Promise<EncodedImage> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((webp) => {
            if (webp && webp.type === 'image/webp') {
                resolve({ blob: webp, ext: 'webp', contentType: 'image/webp' });
                return;
            }
            canvas.toBlob((jpg) => {
                if (jpg) resolve({ blob: jpg, ext: 'jpg', contentType: 'image/jpeg' });
                else reject(new Error('encode'));
            }, 'image/jpeg', quality);
        }, 'image/webp', quality);
    });
}

function makeCanvas(w: number, h: number) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    // Transparent PNGs become JPEG when WebP is unavailable; paint white first
    // so they do not turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    return { canvas, ctx };
}

/**
 * Crop a square region and downscale it.
 * `sx, sy, size` describe the source square in natural-pixel coordinates.
 */
export async function cropSquare(
    loaded: LoadedImage,
    sx: number, sy: number, size: number,
    maxOut = 800,
): Promise<EncodedImage> {
    const out = Math.max(1, Math.min(maxOut, Math.round(size)));
    const { canvas, ctx } = makeCanvas(out, out);
    ctx.drawImage(loaded.img, sx, sy, size, size, 0, 0, out, out);
    return canvasToBlob(canvas, 0.85);
}

/** Cap the long edge at `maxEdge` without cropping. */
export async function downscale(file: File, maxEdge = 1600): Promise<EncodedImage> {
    const loaded = await loadImage(file);
    try {
        const scale = Math.min(1, maxEdge / Math.max(loaded.width, loaded.height));
        const w = Math.max(1, Math.round(loaded.width * scale));
        const h = Math.max(1, Math.round(loaded.height * scale));
        const { canvas, ctx } = makeCanvas(w, h);
        ctx.drawImage(loaded.img, 0, 0, w, h);
        return await canvasToBlob(canvas, 0.85);
    } finally {
        loaded.revoke();
    }
}
