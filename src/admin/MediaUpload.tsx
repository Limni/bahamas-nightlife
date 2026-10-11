import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useFeedback } from './ui';
import { isVideoFile, uploadMediaFile, VideoError, type UploadedMedia, type VideoStage } from './video';

// Shared by PhotoManager (venue gallery) and EventMediaManager (flyers): runs a
// batch of photos/videos through compression or ffmpeg, one at a time, with a
// progress bar and one summary toast.

export interface MediaProgressState {
  done: number;
  total: number;
  label: string;
  /** Progress through the current file (videos), 0–1. */
  ratio: number;
}

const STAGE_LABEL: Record<VideoStage, string> = {
  loading: 'Loading the video optimiser…',
  optimizing: 'Optimising video',
  poster: 'Making a preview frame…',
  uploading: 'Uploading video…',
};

const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);

export function useMediaUploader({ folder, allowVideo }: { folder: string; allowVideo: boolean }) {
  const { toast } = useFeedback();
  const [progress, setProgress] = useState<MediaProgressState | null>(null);

  // Optimising a video takes a while; don't lose it to a stray tab close.
  useEffect(() => {
    if (!progress) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [progress]);

  /** Uploads each file, then hands it to save() (which inserts the row). Returns how many succeeded. */
  const run = async (files: File[], save: (m: UploadedMedia) => Promise<void>) => {
    const list = files.filter((f) => isImageFile(f) || (allowVideo && isVideoFile(f)));
    if (list.length < files.length) toast(allowVideo ? 'Only photos and videos can be added.' : 'Only photos can be added here.', 'error');
    if (list.length === 0) return 0;

    const errors: string[] = [];
    const added = { photo: 0, video: 0 };
    let trimmed = false;
    for (const [i, file] of list.entries()) {
      const video = isVideoFile(file);
      const what = video ? 'video' : 'photo';
      setProgress({ done: i, total: list.length, label: video ? STAGE_LABEL.loading : `Uploading ${what}…`, ratio: 0 });
      try {
        const m = await uploadMediaFile(file, folder, (stage, ratio) =>
          setProgress({
            done: i,
            total: list.length,
            label: stage === 'optimizing' && ratio !== undefined ? `${STAGE_LABEL.optimizing} ${Math.round(ratio * 100)}%` : STAGE_LABEL[stage],
            // The encode is most of the work; uploading the result is the rest.
            ratio: stage === 'optimizing' ? (ratio ?? 0) * 0.85 : stage === 'poster' ? 0.88 : stage === 'uploading' ? 0.9 : 0,
          }),
        );
        await save(m);
        trimmed ||= !!m.trimmed;
        added[what]++;
      } catch (e) {
        console.error(e);
        errors.push(e instanceof VideoError ? e.message : `A ${what} failed to upload${e instanceof Error && e.message ? ` (${e.message})` : ''}.`);
      }
    }
    setProgress(null);
    const ok = added.photo + added.video;
    const count = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
    if (errors.length) toast(errors.length === 1 ? errors[0] : `${errors.length} of ${list.length} failed. ${errors[0]}`, 'error');
    else toast(`${[count(added.photo, 'photo'), count(added.video, 'video')].filter(Boolean).join(' and ')} added${trimmed ? '. Long videos keep their first 30 seconds' : ''}`);
    return ok;
  };

  return { progress, run };
}

export function MediaProgress({ progress }: { progress: MediaProgressState | null }) {
  if (!progress) return null;
  const pct = ((progress.done + progress.ratio) / progress.total) * 100;
  return (
    <div className="mb-4" role="status">
      <div className="flex items-center justify-between gap-3 text-xs font-extrabold text-slate-600 mb-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> <span className="truncate">{progress.label}</span>
        </span>
        {progress.total > 1 && (
          <span className="shrink-0">
            {progress.done + 1} / {progress.total}
          </span>
        )}
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      {progress.label.startsWith('Optimising') || progress.label.startsWith('Loading the video') ? (
        <p className="mt-1 text-[11px] font-semibold text-slate-400">Videos are shrunk on this device before uploading. Keep this page open.</p>
      ) : null}
    </div>
  );
}
