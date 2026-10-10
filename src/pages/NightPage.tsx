import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useDirectory } from '@/lib/directory';
import { useNight, sharedNight, nightUrl } from '@/lib/night';
import { eventWhen } from '@/lib/events';
import { useNow } from '@/lib/useNow';

export default function NightPage() {
  const { venues, events, loading, error } = useDirectory();
  const { list: saved, save, toggle, temporary } = useNight();
  const { search } = useLocation();
  const navigate = useNavigate();
  const shared = sharedNight(search);
  const list = shared ?? saved;
  const now = useNow();
  const [notice, setNotice] = useState('');
  const url = nightUrl(list, window.location.origin);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Our Nassau night out', url });
      else { await navigator.clipboard.writeText(url); setNotice('Link copied.'); }
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setNotice('Copy the link below to share your list.'); }
  };
  return <div className="max-w-3xl mx-auto w-full px-4 py-8">
    <h1 className="text-3xl font-bold">{shared ? 'A night out, shared with you' : 'My night out'}</h1>
    <p className="mt-3 text-night-200">Save spots and events, then send the list to your friends. Your own list stays on this device.</p>
    {temporary && <p role="status" className="mt-2 text-amber-200">Browser storage is unavailable. Share your link to keep this list after closing the page.</p>}
    {shared && <button className="mt-4 px-4 py-3 rounded-xl bg-brand-500 font-bold" onClick={() => { save({ venues: [...new Set([...saved.venues, ...list.venues])].slice(0,20), events: [...new Set([...saved.events, ...list.events])].slice(0,20) }); navigate('/night', { replace: true }); setNotice('Added to your night (up to 20 spots and 20 events).'); }}>Add to my night</button>}
    {loading && <p role="status" className="mt-4">Loading your stops…</p>}
    {error && <p role="alert" className="mt-4">Could not refresh listings. Please try again later.</p>}
    {(['venues', 'events'] as const).map(kind => <section key={kind} className="mt-8">
      <h2 className="text-xl font-bold">{kind === 'venues' ? 'Spots' : 'Events'}</h2>
      {list[kind].length === 0 && <p className="mt-2 text-night-300">Nothing saved yet. <Link className="underline text-brand-300" to={kind === 'venues' ? '/' : '/events'}>Explore {kind === 'venues' ? 'spots' : 'events'}</Link>.</p>}
      <ul className="mt-3 space-y-3">{list[kind].map(id => {
        const venue = kind === 'venues' ? venues.find(v => v.id === id) : undefined;
        const event = kind === 'events' ? events.find(e => e.id === id) : undefined;
        const title = venue?.name || event?.title;
        return <li key={id} className="flex gap-3 items-center justify-between p-4 rounded-2xl border border-white/10 bg-night-900">
          <div>{title ? <Link className="font-bold text-brand-200" to={venue ? `/v/${venue.slug}` : `/events/${id}`}>{title}</Link> : <span>{loading ? 'Loading…' : 'This listing is no longer available'}</span>}
          <p className="text-sm text-night-300">{venue?.area || (event ? eventWhen(event, now) : '')}</p></div>
          {!shared && <button type="button" aria-label={`Remove ${title || 'unavailable listing'}`} className="text-sm underline p-2" onClick={() => toggle(kind, id)}>Remove</button>}
        </li>;
      })}</ul>
    </section>)}
    {(list.venues.length + list.events.length > 0) && <div className="mt-8 space-y-3">
      <button type="button" onClick={share} className="px-5 py-3 bg-brand-500 rounded-2xl font-bold">Share this night</button>
      <label className="block text-sm font-bold" htmlFor="night-link">Shareable link</label>
      <input id="night-link" className="w-full p-3 rounded-xl bg-night-900 border border-white/10 text-sm" readOnly value={url} onFocus={e => e.target.select()} />
      <p className="text-xs text-night-300">Anyone with this link can see the selected public listings. Future edits create a different link.</p>
    </div>}
    <p role="status" className="mt-3 text-brand-200">{notice}</p>
  </div>;
}
