/** Expire live counts even if a tab stays open or a refresh fails. */
export function activityIsFresh(updatedAt: number | null, failed: boolean, now: number) {
  return !failed && updatedAt !== null && Number.isFinite(updatedAt) && now - updatedAt < 10 * 60_000;
}
