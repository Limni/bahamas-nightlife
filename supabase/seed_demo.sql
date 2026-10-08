-- =============================================================================
-- OPTIONAL demo data — fictional spots, events and crowd history so you can see
-- the directory, live levels, popular times, events and the map populated
-- before real listings (and real visitors) exist.
--
-- Every venue's slug starts with "demo-" and every event title with "Demo ·".
-- Remove it all with:
--   delete from public.events where title like 'Demo ·%';
--   delete from public.venues where slug like 'demo-%';
-- (photos, menu items and activity history go with the venues via ON DELETE CASCADE)
--
-- Run AFTER schema.sql. Safe to re-run: venues are skipped if they exist,
-- events are recreated around "now", and the last block refreshes the demo's
-- live crowd (which fades after 15 minutes, like real phones leaving).
-- =============================================================================

insert into public.venues
  (slug, name, description, categories, vibes, area, price_level, phone, address, lat, lng, radius_m, hours, hours_note, is_published, is_featured)
values
  ('demo-neon-palms', 'Demo · Neon Palms Nightclub',
   'DEMO LISTING (fictional). Two floors, a light ceiling and DJs who keep it going until the sun comes up.',
   '{Nightclub}', '{Dancing,"DJ Sets","Late Night","Dress to Impress"}', 'Downtown / Bay Street', 3, '242-555-0201',
   'Bay St, Downtown Nassau', 25.0776, -77.3431, 70,
   '{"4":{"open":"22:00","close":"04:00"},"5":{"open":"22:00","close":"04:00"},"6":{"open":"22:00","close":"04:00"}}',
   'Cover after 11 PM · ID required', true, true),
  ('demo-skyline-rooftop', 'Demo · Skyline Rooftop Lounge',
   'DEMO LISTING (fictional). Harbour views, rum cocktails and a sunset happy hour that turns into a lounge set.',
   '{"Rooftop Bar",Lounge}', '{"Rooftop Views","Date Night","Happy Hour"}', 'Paradise Island', 3, '242-555-0202',
   'Paradise Island Dr', 25.0838, -77.3230, 50,
   '{"0":{"open":"16:00","close":"00:00"},"2":{"open":"17:00","close":"00:00"},"3":{"open":"17:00","close":"00:00"},"4":{"open":"17:00","close":"01:00"},"5":{"open":"17:00","close":"02:00"},"6":{"open":"16:00","close":"02:00"}}',
   null, true, false),
  ('demo-arawak-rum-shack', 'Demo · Arawak Rum Shack',
   'DEMO LISTING (fictional). Cold Kalik, sky juice by the jug and rake ’n’ scrape on the deck most weekends.',
   '{"Fish Fry & Bar","Rum Bar"}', '{"Local Favourite","Rake ''n'' Scrape",Outdoor}', 'Arawak Cay (Fish Fry)', 1, '242-555-0203',
   'West Bay St, Arawak Cay', 25.0786, -77.3576, 60,
   '{"0":{"open":"12:00","close":"00:00"},"1":{"open":"12:00","close":"23:00"},"2":{"open":"12:00","close":"23:00"},"3":{"open":"12:00","close":"23:00"},"4":{"open":"12:00","close":"01:00"},"5":{"open":"12:00","close":"02:00"},"6":{"open":"12:00","close":"02:00"}}',
   null, true, false),
  ('demo-cable-beach-sunset', 'Demo · Cable Beach Sunset Bar',
   'DEMO LISTING (fictional). Toes in the sand, frozen daiquiris and the best sunset on the island.',
   '{"Beach Bar"}', '{Waterfront,"Laid-back","Happy Hour"}', 'Cable Beach', 2, '242-555-0204',
   'West Bay St, Cable Beach', 25.0731, -77.4047, 90,
   '{"0":{"open":"11:00","close":"22:00"},"1":{"open":"11:00","close":"22:00"},"2":{"open":"11:00","close":"22:00"},"3":{"open":"11:00","close":"22:00"},"4":{"open":"11:00","close":"23:00"},"5":{"open":"11:00","close":"00:00"},"6":{"open":"11:00","close":"00:00"}}',
   null, true, false),
  ('demo-bay-street-taproom', 'Demo · Bay Street Taproom',
   'DEMO LISTING (fictional). Local and imported drafts, every game on a big screen, wings till late.',
   '{Pub,"Sports Bar"}', '{"Group Friendly","Laid-back"}', 'Downtown / Bay Street', 2, '242-555-0205',
   'Bay St & Charlotte St', 25.0769, -77.3398, 40,
   '{"0":{"open":"12:00","close":"23:00"},"1":{"open":"12:00","close":"00:00"},"2":{"open":"12:00","close":"00:00"},"3":{"open":"12:00","close":"00:00"},"4":{"open":"12:00","close":"01:00"},"5":{"open":"12:00","close":"02:00"},"6":{"open":"12:00","close":"02:00"}}',
   null, true, false),
  ('demo-starlight-karaoke', 'Demo · Starlight Karaoke Bar',
   'DEMO LISTING (fictional). Private rooms, a main stage and a song list that goes from Bob Marley to Beyoncé.',
   '{Karaoke}', '{"Karaoke Night","Group Friendly","Late Night"}', 'Village Road', 2, '242-555-0206',
   'Village Rd', 25.0610, -77.3155, 40,
   '{"3":{"open":"20:00","close":"02:00"},"4":{"open":"20:00","close":"02:00"},"5":{"open":"20:00","close":"03:00"},"6":{"open":"20:00","close":"03:00"},"0":{"open":"19:00","close":"00:00"}}',
   null, true, false),
  ('demo-blue-note', 'Demo · Blue Note Jazz Bar',
   'DEMO LISTING (fictional). Low lights, a short cocktail list done well and a live band from 9.',
   '{"Live Music","Cocktail Bar"}', '{"Live Band","Date Night"}', 'East Bay Street', 3, '242-555-0207',
   'East Bay St', 25.0745, -77.3260, 40,
   '{"2":{"open":"19:00","close":"01:00"},"3":{"open":"19:00","close":"01:00"},"4":{"open":"19:00","close":"01:00"},"5":{"open":"19:00","close":"02:00"},"6":{"open":"19:00","close":"02:00"},"0":{"open":"18:00","close":"00:00"}}',
   null, true, false),
  ('demo-lucky-sevens', 'Demo · Lucky Sevens Casino Lounge',
   'DEMO LISTING (fictional). Champagne, bottle service and the tables a few steps away.',
   '{Casino,Lounge}', '{"Bottle Service","Dress to Impress"}', 'Cable Beach', 4, '242-555-0208',
   'Cable Beach Resort Strip', 25.0745, -77.3985, 120,
   '{"0":{"open":"00:00","close":"23:59"},"1":{"open":"00:00","close":"23:59"},"2":{"open":"00:00","close":"23:59"},"3":{"open":"00:00","close":"23:59"},"4":{"open":"00:00","close":"23:59"},"5":{"open":"00:00","close":"23:59"},"6":{"open":"00:00","close":"23:59"}}',
   null, true, false)
on conflict (slug) do nothing;

-- A sample drinks menu for the rum shack.
insert into public.menu_items (venue_id, section, name, description, price, sort)
select v.id, m.section, m.name, m.description, m.price, m.sort
from public.venues v
cross join (values
  ('Cocktails', 'Sky Juice', 'Gin, coconut water, condensed milk', 12.00, 1),
  ('Cocktails', 'Rum Punch', 'House rum, tropical juices, nutmeg', 14.00, 2),
  ('Cocktails', 'Goombay Smash', 'Coconut rum, pineapple, apricot brandy', 15.00, 3),
  ('Beer', 'Kalik', null, 7.00, 4),
  ('Beer', 'Sands', null, 7.00, 5),
  ('Bites', 'Conch Fritters', 'With spicy calypso sauce', 12.00, 6)
) as m(section, name, description, price, sort)
where v.slug = 'demo-arawak-rum-shack'
  and not exists (select 1 from public.menu_items mi where mi.venue_id = v.id);

-- Events, placed around "now" so there's always something live and upcoming.
delete from public.events where title like 'Demo ·%';
insert into public.events (title, description, venue_id, lat, lng, address, start_date, end_date, hours, price_note, is_published, is_featured)
select e.title, e.description, v.id, e.lat, e.lng, e.address, e.start_date, e.end_date, e.hours::jsonb, e.price_note, true, e.featured
from (values
  ('Demo · Sunset Sessions', 'DEMO EVENT (fictional). Deep house on the roof from golden hour into the night.',
   'demo-skyline-rooftop', null::float8, null::float8, null,
   now() - interval '1 hour', now() + interval '4 hours', null, 'Free entry', false),
  ('Demo · Afrobeats Night', 'DEMO EVENT (fictional). Afrobeats, dancehall and soca all night with a guest DJ.',
   'demo-neon-palms', null, null, null,
   date_trunc('day', now() at time zone 'America/Nassau') at time zone 'America/Nassau' + interval '1 day 22 hours',
   date_trunc('day', now() at time zone 'America/Nassau') at time zone 'America/Nassau' + interval '2 days 4 hours',
   null, '$20 · free before 11', true),
  ('Demo · Rum & Rhythm Festival', 'DEMO EVENT (fictional). Ten nights of local bands, rum tastings and food stalls on the beach.',
   null, 25.0790, -77.3500, 'Junkanoo Beach, West Bay St',
   date_trunc('day', now() at time zone 'America/Nassau') at time zone 'America/Nassau' - interval '2 days' + interval '16 hours',
   date_trunc('day', now() at time zone 'America/Nassau') at time zone 'America/Nassau' + interval '8 days 23 hours 59 minutes',
   '{"0":{"open":"16:00","close":"23:00"},"1":{"open":"18:00","close":"23:00"},"2":{"open":"18:00","close":"23:00"},"3":{"open":"18:00","close":"23:00"},"4":{"open":"18:00","close":"00:00"},"5":{"open":"17:00","close":"01:00"},"6":{"open":"16:00","close":"01:00"}}',
   '$10 a night', true),
  ('Demo · Jazz & Wine Wednesday', 'DEMO EVENT (fictional). The house trio plus a guest vocalist.',
   'demo-blue-note', null, null, null,
   date_trunc('day', now() at time zone 'America/Nassau') at time zone 'America/Nassau' + interval '3 days 21 hours',
   date_trunc('day', now() at time zone 'America/Nassau') at time zone 'America/Nassau' + interval '4 days 1 hour',
   null, null, false)
) as e(title, description, venue_slug, lat, lng, address, start_date, end_date, hours, price_note, featured)
left join public.venues v on v.slug = e.venue_slug;

-- Eight weeks of crowd history: each venue gets a nightly curve peaking at its
-- busy hour (stronger on its big nights), with some noise.
delete from public.venue_hourly h using public.venues v where h.venue_id = v.id and v.slug like 'demo-%';
insert into public.venue_hourly (venue_id, hour_start, visitors, arrivals)
select v.id, h.t, n.visitors, ceil(n.visitors * 0.45)::int
from public.venues v
join (values
  ('demo-neon-palms', 60, 1, array[4, 5, 6]),
  ('demo-skyline-rooftop', 28, 20, array[4, 5, 6]),
  ('demo-arawak-rum-shack', 34, 22, array[5, 6, 0]),
  ('demo-cable-beach-sunset', 26, 18, array[5, 6, 0]),
  ('demo-bay-street-taproom', 20, 21, array[0, 5, 6]),
  ('demo-starlight-karaoke', 18, 23, array[4, 5]),
  ('demo-blue-note', 16, 22, array[3, 5]),
  ('demo-lucky-sevens', 22, 0, array[5, 6])
) as p(slug, size, peak, big_nights) on p.slug = v.slug
cross join generate_series(date_trunc('hour', now()) - interval '8 weeks', date_trunc('hour', now()) - interval '1 hour', interval '1 hour') as h(t)
-- Nassau hour, and the "night" it belongs to (early hours count as the night before).
cross join lateral (
  select extract(hour from h.t at time zone 'America/Nassau')::int as hr,
         extract(dow from (h.t at time zone 'America/Nassau') - interval '6 hours')::int as night
) l
cross join lateral (
  select round(p.size
    * exp(-power(((l.hr - p.peak + 36) % 24 - 12)::float8 / 2.6, 2))
    * case when l.night = any (p.big_nights) then 1 else 0.4 end
    * (0.75 + random() * 0.5))::int as visitors
) n
where n.visitors > 0
on conflict (venue_id, hour_start) do nothing;

select public.activity_refresh_stats();

-- A live crowd right now at a few spots (these phones "leave" after 15 min;
-- re-run this block to bring them back).
delete from public.presence where device_id::text like 'dddddddd-%';
insert into public.presence (device_id, venue_id, arrived_at, last_seen, counted_hour)
select ('dddddddd-0000-4000-8000-' || lpad(to_hex(p.n * 100 + g), 12, '0'))::uuid,
       v.id, now() - interval '40 minutes', now() - interval '1 minute', date_trunc('hour', now())
from (values ('demo-skyline-rooftop', 1, 22), ('demo-arawak-rum-shack', 2, 9), ('demo-blue-note', 3, 6), ('demo-bay-street-taproom', 4, 3)) as p(slug, n, crowd)
join public.venues v on v.slug = p.slug
cross join lateral generate_series(1, p.crowd) as g;

select public.activity_refresh_live(v.id) from public.venues v where v.slug like 'demo-%';
