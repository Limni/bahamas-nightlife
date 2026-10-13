# Bar crawl planner

A visitor asks for a planned night out: when, how many people, which areas, how they want to get around. The site picks and orders the stops and shows a route.

## Phase 1: built (`/crawl`)

Everything runs in the browser from data the directory already loads, so there's no new server or schema.

**Inputs** (`src/pages/CrawlPage.tsx`): the night (tonight + six more), from / until in Nassau time (4 PM – 1 AM start, 2–7 hours), party size, number of stops (auto = about one an hour, 2–6), getting around (**Walk**, **Walk + taxi**, **Taxi**; deliberately **no drive** option), areas, vibes, budget, and "Start near me" (uses GPS; never written into share links). `?first=<venue id>` makes a spot the first stop (the venue page's "Plan a bar crawl starting here").

**Planner** (`src/lib/crawl.ts`):
- **Candidates:** published spots with a pin, in the chosen areas and budget.
- **Each stop is scored at the time they'd be there:**
  - open on arrival and still open near leaving (spots without hours are allowed but penalised and flagged "call ahead");
  - weighted rating, the visitor's own favourites, vibe matches;
  - the **usual crowd at that hour** (`venue_typical`, the popular-times data) relative to the spot's peak, plus 30-day visits;
  - an **event on at that time** at the venue (`isEventLive` at arrival or mid-stay);
  - party size ≥ 6: the "Group Friendly" vibe and roomy types (club, lounge, sports bar, pub…), small cocktail/wine bars less so; ≥ 8 shows a "call ahead" phone link;
  - an **energy curve**: venue types are rated 1–3 (wine/cocktail/local bar → lounge/live music/karaoke → nightclub), with Dancing / DJ Sets counting as ≥ 2.5. Stop *i* of *k* aims for 1 + 2i/(k−1), so the night builds;
  - "Late Night" after 1 AM; a small penalty for the same type twice in a row.
- **Ordering:** beam search (width 30) over the stops, adding up scores minus leg costs. Stops last `(window − travel) / k`, clamped to 30–120 minutes, with arrivals rounded to 5 minutes; the last stop runs to the end of the night or its closing time. If *k* stops don't fit, it tries 60- and 45-minute stays, then fewer stops, and says why.
- **Travel estimates** (no routing engine yet):
  - distance = straight line × 1.35 (detour factor);
  - walking 80 m/min; taxi 6 min wait + 400 m/min;
  - **Walk + taxi** walks legs up to 15 min, taxis the rest;
  - **Walk** allows legs up to 22 min;
  - taxi legs are capped at 22 min (longer is a cross-island trip, not a crawl).
  - Leg cost = 0.08/min + 1.2 per taxi, so crawls cluster unless a spot is worth the ride.
- **Shuffle** ("Try another route") adds seeded random weight to the scores (`seed` > 0) and retries until the stops change. **Swap** replaces one stop with the next-best spot that fits there, keeping the others.

**Output:**
- a timeline with arrive/leave times, "why this one" chips (event, usual crowd, favourite, rating, vibes, group friendly) and walk/taxi legs;
- a Leaflet map with numbered pins and **straight** dashed (walk) / solid (taxi) lines;
- **Directions in Google Maps** (all stops as waypoints; walking if every leg is a walk, else driving, i.e. the taxi route);
- **Share**: the whole request and the chosen stop ids live in the URL (`night, from, to, party, area*, vibe*, price, n, mode, first, seed, near, stops`), so a shared link reopens the same plan (times recomputed; if a stop is gone or closed, it re-plans).

**Known limits of phase 1:**
- Times and distances are estimates. Harbour crossings (Paradise Island bridges) and one-way streets aren't modelled.
- Lines on the map are straight, not along streets.
- Capacity is only inferred from type and the "Group Friendly" vibe.
- It can only recommend spots that have a pin and, ideally, hours. Fill those in the admin "Needs info" view to improve plans.

## Phase 2: real routes from open map data (proposed)

**Goal:** walking/driving times and lines that follow the streets, from OpenStreetMap, with no paid API.

**Data:** the Bahamas extract from Geofabrik (`bahamas-latest.osm.pbf`, about 20 MB). OSM's New Providence road network is good; sidewalks are sparse, but foot routing uses roads. Licence ODbL: keep "© OpenStreetMap contributors" visible (the map already shows it).

**Engine options:**

| Engine | Notes |
| --- | --- |
| **Valhalla** (recommended) | One server for foot + auto (+ bicycle), costing options, matrix and isochrone APIs. The `ghcr.io/gis-ops/docker-valhalla` image builds tiles from the `.pbf` on first start. A few hundred MB RAM at this size |
| OSRM | Fastest; one `osrm-routed` per profile (foot, car), so two small containers. `table` service for matrices |
| GraphHopper | Java, one server, multiple profiles |
| openrouteservice | Hosted free tier (~2,000 directions/day) for prototyping, or self-host |

The public OSRM demo server (`router.project-osrm.org`) is for testing only, not production traffic.

**Option A: live routing service (simplest to keep fresh).**
- Run Valhalla as a container on the VM next to Nassau Nights (for example port 5111, bound to 127.0.0.1).
- Expose it through the host nginx as `/route/` on the same domains (same origin, no CORS). Rate-limit it in nginx (`limit_req`), and allow only the `route` and `sources_to_targets` endpoints.
- Refresh the extract monthly (cron: download the `.pbf`, rebuild tiles, restart).
- Client: after the planner picks the stops, call `/route/route` for each leg (or one multi-stop request) for the real duration and the polyline (decode with a few lines of code, or `@mapbox/polyline`).
- Feed real durations back into the timeline. Optionally re-run the ordering with a `sources_to_targets` matrix for the 30–60 candidates (one request).

**Option B: precomputed travel table (no runtime server).**
- A monthly GitHub Action job:
  - starts OSRM/Valhalla in Docker with the Bahamas extract;
  - reads published venues (anon key);
  - computes foot and car durations, distances and encoded polylines for every pair within ~3 km (a few hundred venues → tens of thousands of pairs → a few MB);
  - writes them to a Supabase table `venue_legs (from_id, to_id, walk_s, walk_m, drive_s, drive_m, walk_poly, drive_poly)` with the service-role key (a repo secret), or ships them as a static `/data/legs.json` in the image.
- The planner looks legs up and falls back to the straight-line estimate for venues added since the last run.
- No moving parts in production; data is up to a month stale.

**Recommendation:** start with A on the VM (it also serves "Start near me" legs from arbitrary GPS points, which B can't). Add B only if the VM's load matters.

**Phase 2 checklist:**
- [ ] Valhalla container plus `deploy/` notes (port, memory, monthly refresh script).
- [ ] nginx `location /route/` with `limit_req` and an endpoint allow-list; add it to `vm-setup.sh`'s embedded vhost too.
- [ ] `lib/routing.ts`: `routeLegs(points, mode)` → durations plus polylines, with a timeout and fallback to `legBetween()` estimates.
- [ ] The planner uses real leg times when available. The map draws polylines instead of straight lines.
- [ ] Harbour/bridge sanity: Paradise Island ↔ Downtown should route over the bridges (check the walk times there).
- [ ] Update `AGENTS.md` (map tiles / routing section, env, deployment).

## Phase 3: extras (proposed)

- **Saved crawls:** a `crawls` table `(id, user_id, title, request jsonb, stop_ids uuid[], created_at)` with RLS (own rows only), "Save" on the plan, and a **My crawls** list on `/account` next to My favourites. Shared links keep working without saving.
- **Free-text requests:** "plan a crawl for 6 on Bay Street Friday from 9, no clubs". A Supabase Edge Function calls an LLM to turn the sentence into the `CrawlRequest` fields (JSON-schema output), and optionally writes a short, fun summary of the finished plan. The API key lives in Edge Function secrets. The route itself stays our deterministic planner (reliable, free). Cost is a fraction of a cent per request; rate-limit per IP.
- **Live crawl mode:** while a saved/shared crawl is open on the night, use the existing presence data (`here` from `ActivityProvider`, when sharing is on) to show "You're at stop 2 · next: X in 8 min walk", and nudge if running late (re-time the remaining stops).
- **Capacity / groups:** an admin field `max_group` (or "takes reservations" + a link) on venues, used instead of type-based guesses; for 8+ show "Reserve" when available.
- **Safety:**
  - optional "well-lit main roads only" for walking legs (OSM `lit=yes` coverage in Nassau is patchy, so an admin-maintained "walkable at night" flag per area may be more reliable);
  - a taxi company list per area with phone numbers;
  - keep "never drink and drive" copy wherever routes appear.
- **Sponsorship hook:** featured venues could get a small boost in plans. If built, label it ("Featured") and keep it small so plans stay trustworthy.
- **Analytics:** count plans and Google-Maps handoffs (GA4 events) to see which areas people crawl.
