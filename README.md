# Nassau Nights

Nightlife for Nassau: bars, clubs, lounges, beach bars and tonight's events, on a dark neon site with a live map that shows **where it's buzzing right now**. A clone of [Nassau Eats](https://github.com/Limni/bahamas-nassaueats) (same directory, map, reviews, community inbox and field-friendly admin console), restyled for nights out, with **highlighted events** from Island GO and **live, GPS-based activity**.

**Stack:** React 19 + Vite + Tailwind 4, Leaflet (the same map components as Island GO and Nassau Eats), Supabase (Postgres, Auth, Storage, Realtime). No custom backend.

> **Map tiles:** Stadia Maps **Alidade Smooth Dark**. It works on `localhost` with no key. Before going live, add your domain at [stadiamaps.com](https://stadiamaps.com) (the free tier is non-commercial). Switch providers with `VITE_MAP_TILE_URL` / `VITE_MAP_ATTRIBUTION`.

## Setup

1. Create a **new** project at [supabase.com](https://supabase.com). Don't reuse Nassau Eats' project.
2. **SQL Editor:** paste and run `supabase/schema.sql`. It creates the tables, security rules, activity functions, storage buckets and starter tags, and it's safe to re-run.
   *Optional:* run `supabase/seed_demo.sql` for eight fictional venues, four events and eight weeks of crowd history, so live levels and popular times show up straight away.
3. `cp .env.example .env.local` and fill in the URL and anon key from **Project Settings → API**.
4. Create your login (**Authentication → Users → Add user**), then make it an admin:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
5. `npm install`, then `npm run dev`. The site is at http://localhost:3000 and the admin console at http://localhost:3000/admin.

## Pages

| Route | What it is |
| --- | --- |
| `/` | Explore: neon hero with a live "busy right now" board, Happening tonight, Buzzing right now, Popular this month, venue types, vibes, neighbourhoods, and the full directory (sort by Buzzing, Popular, Top rated, Nearest…) |
| `/map` | Dark map with category pins. **Heat halos** show live activity, and clusters glow with their busiest venue. **Live events pulse**, upcoming ones sit dimmed. Swipe-up cards for venues and events |
| `/events`, `/events/:id` | Highlighted events: Live / Tonight / This week / Coming up, with flyer, schedule, venue, map and tickets |
| `/v/:slug` | Venue page: live level vs. usual, a **popular-times** chart, upcoming events there, hours, drinks menu, photos, reviews |
| `/community` | Suggest a spot, report changes, or **tip us an event** |
| `/account` | Member sign-in, reviews and suggestions, plus the **live activity sharing** switch |
| `/admin` | Admin console: spots, **events** (one-off or weekly, with or without an end date), quick add, inbox, **activity**, reviews, **members**, tags, theme |

## Live activity (how "busy" works)

1. With the visitor's OK (asked once, the first time location is on) the open site sends an anonymous ping every ~2 minutes: `report_presence(device, lat, lng, accuracy)`.
2. The database works out which venue's geofence the phone is inside (`venues.radius_m` around the pin, set per venue in the editor) and keeps **one row per device**: which venue, since when, last seen. **Coordinates are never stored**, and a phone that isn't at a venue has no row. The device ID is random and rotates every night.
3. A phone counts as "here" after **4 minutes** (so driving past doesn't count) and drops off **15 minutes** after its last ping. Fuzzy indoor GPS keeps you at the venue you were already at.
4. Each counted phone adds to that venue's hourly tally. `venue_activity()` compares **phones there now** with the **average for this weekday and hour over the last 8 weeks**. The levels are Quiet, Chilled, Lively or Packed, plus "busier/quieter than usual". Popularity is ranked by visits over 30 days.
5. **Real time:** counts live in `venue_live`, which is in the Realtime publication. Every open tab refetches when it changes, and every minute anyway.
6. **Privacy floor:** fewer than 2 people always shows as 0, everywhere, including the admin console.

Spoofing is possible in principle: anyone can call the RPC with made-up coordinates. Per-device rate limits and the dwell rule blunt it, but treat levels as indicative rather than audited.

## Events (from Island GO)

An event has a start and end, optional weekly hours (for multi-day runs like a festival), a host venue (it uses that venue's pin) or its own location, a flyer, a price note and a ticket link. **Live** means it's inside its dates and today's hours. Live events flash a neon ring on the map and get a LIVE tag; **featured** events go first. Admins create them under **Admin → Events**. There are quick presets ("Tonight 10 PM–2 AM", "Sat 10 PM–3 AM"), and times are always entered in Nassau time. **Inbox** turns an "Event tip" into a pre-filled draft.

## Adding spots in the field

Open `/admin` on your phone. **Quick add** grabs your GPS; type the name, tap type, area and price, and shoot **The place** and **Drinks menu** photos, then **Save draft**. Back home, fill in hours, the activity radius, a description and the drinks menu. **Paste a menu** turns lines like `Rum Punch - 14` into items.

## Importing real spots from Google Maps

`npm run seed:google -- --dry-run`, then `npm run seed:google`. It sweeps New Providence for bars, night clubs and lounges with the Places API (New) and inserts them as **unpublished drafts**. It maps Google's place types and name clues ("rooftop", "beach", "rum") to the venue types. Needs `GOOGLE_MAPS_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (see `.env.example`). Re-running is safe.

## Themes

The admin picks the public look in **Admin → Theme**: **Neon nights** (default), **Junkanoo**, **Halloween**, **Christmas**. Every theme is dark; preview any page with `?theme=<id>`.

## Deploy

Production is **https://nassaunights.limniatis.com**, a Docker container on port `5110` next to Island GO (`5050`) and Nassau Eats (`5060`), behind the host's nginx. Pushing to `main` deploys through GitHub Actions. See **[DEPLOY.md](DEPLOY.md)**.
