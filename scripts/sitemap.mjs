// Writes dist/sitemap.xml and dist/robots.txt after `vite build`.
//
// Venues and events live in Supabase, so the sitemap is generated at build
// time from the published venues and the events that haven't ended, using the
// public anon key (RLS only returns published rows). Every deploy refreshes it.
// If Supabase isn't configured or can't be reached, it still writes the fixed
// pages and never fails the build.
//
// SITE_URL picks the domain the URLs use (default https://nassaunights.com):
// set it to the property you add in Google Search Console.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Local builds: pick up .env / .env.local like Vite does (CI passes real env vars).
for (const file of ['.env', '.env.local']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const SITE = (process.env.SITE_URL || 'https://nassaunights.com').replace(/\/+$/, '');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const configured = SUPABASE_URL && ANON_KEY && !SUPABASE_URL.includes('YOUR-PROJECT');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : undefined);

async function rows(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}

const today = new Date().toISOString().slice(0, 10);
// Fixed public pages. /account, /admin and /manage are left out on purpose.
const urls = [
  { loc: '/', changefreq: 'daily', priority: '1.0', lastmod: today },
  { loc: '/events', changefreq: 'daily', priority: '0.9', lastmod: today },
  { loc: '/map', changefreq: 'daily', priority: '0.8' },
  { loc: '/community', changefreq: 'monthly', priority: '0.4' },
];

if (configured) {
  try {
    const [venues, events] = await Promise.all([
      rows('venues?select=slug,updated_at&is_published=eq.true&order=name'),
      // A null end_date is a recurring night with no end.
      rows(`events?select=id,updated_at&is_published=eq.true&or=(end_date.is.null,end_date.gte.${new Date().toISOString()})&order=start_date`),
    ]);
    for (const v of venues) urls.push({ loc: `/v/${encodeURIComponent(v.slug)}`, changefreq: 'weekly', priority: '0.8', lastmod: day(v.updated_at) });
    for (const e of events) urls.push({ loc: `/events/${e.id}`, changefreq: 'daily', priority: '0.7', lastmod: day(e.updated_at) });
    console.log(`sitemap: ${venues.length} venues, ${events.length} events`);
  } catch (err) {
    console.warn(`sitemap: couldn't load venues/events (${err.message}); writing the fixed pages only`);
  }
} else {
  console.warn('sitemap: Supabase not configured; writing the fixed pages only');
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${esc(SITE + u.loc)}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
  )
  .join('\n')}
</urlset>
`;

const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /manage
Disallow: /account

Sitemap: ${SITE}/sitemap.xml
`;

writeFileSync('dist/sitemap.xml', xml);
writeFileSync('dist/robots.txt', robots);
console.log(`sitemap: wrote ${urls.length} URLs for ${SITE}`);
