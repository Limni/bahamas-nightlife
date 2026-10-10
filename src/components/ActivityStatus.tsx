import { useActivity } from '@/lib/activity';
import { useNow } from '@/lib/useNow';

export function ActivityStatus() {
  const { updatedAt, available, loaded } = useActivity();
  const now = useNow();
  const minutes = updatedAt === null ? 0 : Math.max(0, Math.floor((now - updatedAt) / 60_000));
  return <p role="status" className="text-xs text-night-300 py-2">
    {!loaded ? 'Checking live activity…' : !available ? 'Live activity unavailable. Crowd levels are hidden until refreshed.' :
      `Live activity updated ${minutes === 0 ? 'just now' : `${minutes} min ago`}. Based on people sharing; no signal does not mean empty.`}
  </p>;
}
