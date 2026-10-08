import { supabase, MEDIA_BUCKET, SUBMISSION_BUCKET } from './supabase';

/**
 * Downscale + re-encode a photo in the browser before upload. Phone photos are
 * often 4–12 MB; this brings them to a few hundred KB so field uploads over
 * mobile data are quick and pages stay fast. Re-encoding also strips EXIF
 * (including GPS), so read coordinates with readPhotoGps() *before* this.
 *
 * Falls back to the original file for formats the browser can't decode.
 */
export async function compressImage(file: File, maxDim = 1800, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // e.g. HEIC on a browser that can't decode it
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const encode = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  // WebP is much smaller; Safari < 17 silently returns PNG for it, so check.
  let blob = await encode('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
  return blob && blob.size < file.size ? blob : file;
}

const extFor = (blob: Blob, fallbackName: string) => {
  const fromType = blob.type.split('/')[1]?.replace('jpeg', 'jpg');
  if (fromType && /^[a-z0-9]+$/.test(fromType)) return fromType;
  return fallbackName.includes('.') ? fallbackName.split('.').pop()!.toLowerCase() : 'jpg';
};

const uniqueName = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Compress and upload an image to the public media bucket. */
export async function uploadMedia(file: File, folder: string): Promise<{ url: string; path: string }> {
  const blob = await compressImage(file);
  const path = `${folder}/${uniqueName()}.${extFor(blob, file.name)}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    cacheControl: '31536000', // unique path per upload, so cache forever
    contentType: blob.type || file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function deleteMedia(path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(MEDIA_BUCKET).remove([path]);
}

/** Community upload: compressed harder, lands in the private inbox folder. */
export async function uploadSubmissionPhoto(file: File): Promise<string> {
  const blob = await compressImage(file, 1600, 0.78);
  const path = `inbox/${uniqueName()}.${extFor(blob, file.name)}`;
  const { error } = await supabase.storage.from(SUBMISSION_BUCKET).upload(path, blob, {
    contentType: blob.type || file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** GPS coordinates embedded in a photo's EXIF, if the device kept them. */
export async function readPhotoGps(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const { gps } = await import('exifr');
    const pos = await gps(file);
    if (pos && Number.isFinite(pos.latitude) && Number.isFinite(pos.longitude)) {
      return { lat: pos.latitude, lng: pos.longitude };
    }
  } catch {
    /* no EXIF / unsupported format */
  }
  return null;
}
