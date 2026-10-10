import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadEnv } from 'vite';

// Public data only. Never pass a service-role key to a frontend build.
const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
const origin = 'https://nassaunights.com';
const shell = await readFile('dist/index.html', 'utf8');
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const safeImage = value => /^https:\/\//i.test(value || '') ? value : `${origin}/icons/icon-512.png`;
const pages = [
  { path:'/', title:'Bars, clubs & events in Nassau', description:'Find bars, clubs, beach bars and events in Nassau, Bahamas. Save your favorites and plan a night out.' },
  { path:'/events', title:'Events in Nassau', description:'Discover DJ nights, live music and recurring parties in Nassau, Bahamas.' },
  { path:'/map', title:'Nassau nightlife map', description:'Explore Nassau bars and clubs on the map, with hours, directions and live activity.' },
  { path:'/community', title:'Community', description:'Suggest a spot, share an event or help update Nassau nightlife listings.' },
  { path:'/night', title:'My night out', description:'Save and share your Nassau night out.', noindex:true },
  { path:'/account', title:'Your account', description:'Your Nassau Nights account.', noindex:true },
];

async function rows(table, select, extra = '') {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&is_published=eq.true&order=id&limit=1000&offset=${offset}${extra}`, {
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Cannot prerender published ${table}: HTTP ${response.status}`);
    const batch = await response.json(); all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}

if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY && !env.VITE_SUPABASE_URL.includes('YOUR-PROJECT') && env.PRERENDER_SKIP_DATA !== '1') {
  const [venues, events] = await Promise.all([
    rows('venues', 'id,slug,name,description,cover_url,address,area,phone'),
    rows('events', 'id,title,description,image_url,start_date,end_date,hours,venue_id,address', `&or=(end_date.is.null,end_date.gte.${new Date().toISOString()})`),
  ]);
  for (const venue of venues) {
    if (!/^[a-z0-9-]+$/i.test(venue.slug)) continue;
    const path = `/v/${venue.slug}`;
    pages.push({ path, title:venue.name, description:venue.description || `${venue.name} in ${venue.area || 'Nassau'}: hours, menus and directions.`, image:venue.cover_url,
      schema:{ '@context':'https://schema.org', '@type':'LocalBusiness', name:venue.name, url:origin+path, image:safeImage(venue.cover_url), address:venue.address || venue.area || 'Nassau, Bahamas', ...(venue.phone ? { telephone:venue.phone } : {}) } });
  }
  for (const event of events) {
    if (!/^[a-z0-9-]+$/i.test(event.id)) continue;
    const venue = venues.find(v => v.id === event.venue_id);
    const path = `/events/${event.id}`;
    const weekly = event.hours && Object.keys(event.hours).length > 0;
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    pages.push({ path, title:event.title, description:event.description || `${event.title}${venue ? ` at ${venue.name}` : ''}. Event details, directions and tickets.`, image:event.image_url,
      schema:{ '@context':'https://schema.org', '@type':weekly ? 'EventSeries' : 'Event', name:event.title, url:origin+path, image:safeImage(event.image_url), description:event.description || event.title,
        ...(weekly ? { eventSchedule:Object.entries(event.hours).map(([day, hours]) => ({ '@type':'Schedule', repeatFrequency:'P1W', byDay:`https://schema.org/${days[+day]}`, startTime:hours.open, endTime:hours.close, scheduleTimezone:'America/Nassau' })) } : { startDate:event.start_date, endDate:event.end_date }),
        location:{ '@type':'Place', name:venue?.name || event.address || 'Nassau', address:event.address || venue?.address || venue?.area || 'Nassau, Bahamas' },
      } });
  }
}

for (const page of pages) {
  const title = `${page.title} — Nassau Nights`, description = page.description.slice(0,200), image = safeImage(page.image);
  const tags = `<link rel="canonical" href="${escape(origin+page.path)}" />
<meta name="robots" content="${page.noindex ? 'noindex,follow' : 'index,follow'}" />
<meta property="og:type" content="website" /><meta property="og:site_name" content="Nassau Nights" />
<meta property="og:title" content="${escape(title)}" /><meta property="og:description" content="${escape(description)}" />
<meta property="og:url" content="${escape(origin+page.path)}" /><meta property="og:image" content="${escape(image)}" />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escape(title)}" />
<meta name="twitter:description" content="${escape(description)}" /><meta name="twitter:image" content="${escape(image)}" />
${page.schema ? `<script type="application/ld+json" data-page-schema>${JSON.stringify(page.schema).replace(/</g,'\\u003c')}</script>` : ''}`;
  const html = shell.replace(/<title>.*?<\/title>/s, `<title>${escape(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escape(description)}" />`)
    .replace('</head>', `${tags}\n</head>`);
  const dir = page.path === '/' ? 'dist' : `dist${page.path}`;
  await mkdir(dir, {recursive:true}); await writeFile(`${dir}/index.html`, html);
}
await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.filter(p=>!p.noindex).map(p=>`<url><loc>${escape(origin+p.path)}</loc></url>`).join('')}</urlset>`);
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /manage\nDisallow: /account\nDisallow: /night\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`Prepared metadata for ${pages.length} public routes.`);
