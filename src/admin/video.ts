import { uploadBlob, uploadMedia } from '@/lib/images';

// Short venue/event videos, optimised in the admin's browser before upload.
//
// Phone videos are big (an iPhone records ~1 MB a second at 1080p, in HEVC that
// some browsers can't play), so each clip is re-encoded with ffmpeg.wasm to a
// small, universally playable H.264/AAC MP4: long side ≤ 1280 px, ≤ 30 fps,
// first 30 seconds only, "faststart" so it plays before it has fully loaded,
// plus a JPEG poster frame that pages show until someone presses play.
//
// The ffmpeg core (~30 MB of WebAssembly) is self-hosted and only fetched when
// an admin or manager actually picks a video; visitors never load it. It's the
// single-threaded build, which needs no cross-origin isolation headers.

export const VIDEO_MAX_SECONDS = 30;
/** Matches the venue-media bucket's file_size_limit (schema.sql). */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
/** Bigger inputs risk running a phone out of memory inside ffmpeg.wasm. */
export const VIDEO_INPUT_MAX_BYTES = 400 * 1024 * 1024;

export function isVideoFile(f: File) {
  return f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|3gp|mkv|avi)$/i.test(f.name);
}

export type VideoStage = 'loading' | 'optimizing' | 'poster' | 'uploading';
export type VideoProgress = (stage: VideoStage, ratio?: number) => void;

export interface PreparedVideo {
  video: Blob;
  poster: Blob | null;
  duration: number;
  /** The clip ran past 30 s and only the start was kept. */
  trimmed: boolean;
  /** Uploaded as recorded because the optimiser couldn't run. */
  original: boolean;
}

export class VideoError extends Error {}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** Duration and a poster frame via a <video> element (null if this browser can't decode it). */
function probe(file: Blob): Promise<{ duration: number; poster: Blob | null } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const finish = (r: { duration: number; poster: Blob | null } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), 10_000);
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration) || !v.videoWidth) return finish(null);
      v.currentTime = Math.min(1, v.duration / 3);
    };
    v.onseeked = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish({ duration: v.duration, poster: null });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => finish({ duration: v.duration, poster: b }), 'image/jpeg', 0.8);
    };
    v.src = url;
  });
}

const parseTime = (s: string) => {
  const m = s.match(/(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
};

async function transcode(file: File, known: number | null, onProgress?: VideoProgress): Promise<PreparedVideo> {
  onProgress?.('loading');
  const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ]);
  const ffmpeg = new FFmpeg();
  let duration = known;
  let logs: string[] = [];
  // ffmpeg's own progress event is unreliable with -t, so read time= from its log.
  ffmpeg.on('log', ({ message }) => {
    logs.push(message);
    if (duration === null && /^\s*Duration:/.test(message)) duration = parseTime(message);
    const t = message.includes('time=') ? parseTime(message.split('time=')[1]) : null;
    if (t !== null && duration) onProgress?.('optimizing', Math.min(1, t / Math.min(duration, VIDEO_MAX_SECONDS)));
  });
  try {
    await ffmpeg.load({ coreURL, wasmURL });
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const input = `in.${ext}`;
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    // Read the streams (ffmpeg with no output just prints them and exits).
    logs = [];
    await ffmpeg.exec(['-hide_banner', '-i', input]);
    const video = logs.find((l) => /Stream #.*Video:/.test(l)) ?? '';
    const audio = logs.find((l) => /Stream #.*Audio:/.test(l));
    const fps = Number(video.match(/([\d.]+) fps/)?.[1] ?? 0);
    const [w, h] = (video.match(/, (\d{2,5})x(\d{2,5})/)?.slice(1) ?? []).map(Number);

    const run = async (args: string[]) => {
      onProgress?.('optimizing', 0);
      const code = await ffmpeg.exec([
        '-i', input,
        '-t', String(VIDEO_MAX_SECONDS),
        '-map', '0:v:0', '-map', '0:a:0?',
        ...args,
        '-movflags', '+faststart', // index first, so it starts playing before it has all loaded
        '-y', 'out.mp4',
      ]);
      if (code !== 0) throw new VideoError('The video couldn’t be converted.');
      return (await ffmpeg.readFile('out.mp4')) as Uint8Array;
    };

    // Already small and web-friendly (typical of WhatsApp / Instagram exports):
    // just repackage it, which takes a moment instead of minutes.
    const webReady =
      /Video: h264\b/.test(video) && /yuv420p\b/.test(video) && (!audio || /Audio: aac\b/.test(audio)) &&
      fps > 0 && fps <= 31 && Math.max(w || 0, h || 0) <= 1920 && file.size <= 12 * 1024 * 1024;

    const encode = (maxDim: number, crf: number) =>
      run([
        // Halve 60 fps footage before scaling, not after (the scaler is a big
        // part of the work); long side ≤ maxDim, both sides even (4:2:0), never upscaled.
        '-vf',
        `${fps > 31 ? 'fps=30,' : ''}scale=w='if(gte(iw,ih),trunc(min(${maxDim},iw)/2)*2,-2)'` +
          `:h='if(gte(iw,ih),-2,trunc(min(${maxDim},ih)/2)*2)':flags=bilinear`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      ]);

    let out = webReady ? await run(['-c', 'copy']).catch(() => null) : null;
    out ??= await encode(1280, 28);
    // Rare (very busy footage): one smaller, softer encode before giving up.
    if (out.byteLength > VIDEO_MAX_BYTES) out = await encode(960, 33);
    if (out.byteLength > VIDEO_MAX_BYTES) throw new VideoError(`Even optimised, this video is over ${mb(VIDEO_MAX_BYTES)}. Try a shorter clip.`);

    onProgress?.('poster');
    let poster: Blob | null = null;
    const at = Math.min(1, (Math.min(duration ?? 3, VIDEO_MAX_SECONDS)) / 3).toFixed(2);
    if ((await ffmpeg.exec(['-ss', at, '-i', 'out.mp4', '-frames:v', '1', '-q:v', '4', '-y', 'poster.jpg'])) === 0) {
      poster = new Blob([((await ffmpeg.readFile('poster.jpg')) as Uint8Array).slice()], { type: 'image/jpeg' });
    }
    const length = Math.min(duration ?? VIDEO_MAX_SECONDS, VIDEO_MAX_SECONDS);
    return {
      video: new Blob([out.slice()], { type: 'video/mp4' }),
      poster,
      duration: Math.round(length * 10) / 10,
      trimmed: (duration ?? 0) > VIDEO_MAX_SECONDS + 0.5,
      original: false,
    };
  } finally {
    ffmpeg.terminate(); // frees the worker and its (large) memory
  }
}

/**
 * Re-encode a clip for the web. If ffmpeg.wasm can't run here (old browser,
 * out of memory), a clip that is already a playable MP4/WebM within the limits
 * is uploaded as recorded instead.
 */
export async function prepareVideo(file: File, onProgress?: VideoProgress): Promise<PreparedVideo> {
  if (file.size > VIDEO_INPUT_MAX_BYTES) {
    throw new VideoError(`That video is ${mb(file.size)}. Trim it to under ${VIDEO_MAX_SECONDS} seconds on your phone first.`);
  }
  const probed = await probe(file);
  try {
    return await transcode(file, probed?.duration ?? null, onProgress);
  } catch (err) {
    if (err instanceof VideoError) throw err;
    console.error('ffmpeg', err);
    const playable = /^video\/(mp4|webm)$/.test(file.type) && probed;
    if (playable && file.size <= VIDEO_MAX_BYTES && probed.duration <= VIDEO_MAX_SECONDS + 0.5) {
      return { video: file, poster: probed.poster, duration: Math.round(probed.duration * 10) / 10, trimmed: false, original: true };
    }
    throw new VideoError(
      `This browser couldn’t optimise the video. Use an MP4 under ${VIDEO_MAX_SECONDS} seconds and ${mb(VIDEO_MAX_BYTES)}, or try a computer.`,
    );
  }
}

/** What a venue_photos / event_media row needs for one uploaded file. */
export interface UploadedMedia {
  media_type: 'image' | 'video';
  url: string;
  storage_path: string;
  poster_url: string | null;
  poster_path: string | null;
  duration_s: number | null;
  trimmed?: boolean;
}

/** Upload a photo (compressed) or a video (optimised + poster) into a media folder. */
export async function uploadMediaFile(file: File, folder: string, onProgress?: VideoProgress): Promise<UploadedMedia> {
  if (!isVideoFile(file)) {
    const { url, path } = await uploadMedia(file, folder);
    return { media_type: 'image', url, storage_path: path, poster_url: null, poster_path: null, duration_s: null };
  }
  const v = await prepareVideo(file, onProgress);
  onProgress?.('uploading');
  const video = await uploadBlob(v.video, folder, v.original ? file.name : 'clip.mp4');
  const poster = v.poster ? await uploadBlob(v.poster, folder, 'poster.jpg').catch(() => null) : null;
  return {
    media_type: 'video',
    url: video.url,
    storage_path: video.path,
    poster_url: poster?.url ?? null,
    poster_path: poster?.path ?? null,
    duration_s: v.duration,
    trimmed: v.trimmed,
  };
}
