// Sharing a page: phones get the native share sheet (WhatsApp, Messages…).
// On a computer, browsers that support navigator.share open the operating
// system's share dialog, which feels out of place, so there we just copy the
// link instead.

/** A touch device with a share sheet. */
export const canNativeShare = () =>
  typeof navigator !== 'undefined' && !!navigator.share && typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** Share (phones) or copy (computers). 'copied' means show a "Link copied" note; 'failed' means the clipboard was refused. */
export async function shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  if (canNativeShare()) {
    try {
      await navigator.share({ title, url });
    } catch {
      /* dismissed */
    }
    return 'shared';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
