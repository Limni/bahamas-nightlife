# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Read this before making changes.

## What this is

**Nassau Nights** (https://nassaunights.limniatis.com) is a nightlife guide for Nassau, Bahamas: bars, clubs, lounges, beach bars and events. It is a **clone of Nassau Eats** (`Limni/bahamas-nassaueats`), restyled as a dark neon site, with two features the eats site doesn't have:

- **Highlighted events**, ported from Island GO (`Limni/bahamas-exp`). Events have a date range and optional weekly hours, and live ones pulse on the map.
- **Live, GPS-based activity.** Visitors who opt in send anonymous presence pings. The database turns them into "how busy is it now" per venue, compared with that venue's usual for the weekday and hour (8-week average), plus 30-day popularity. It updates in real time over Supabase Realtime.

Everything else is Nassau Eats: directory, map, venue pages with drinks menus/photos/reviews, member accounts, community suggestions and the phone-friendly admin console.

It is a static React SPA with **no custom backend**. All data, auth and file storage go through **its own Supabase project** (not Nassau Eats'), protected by Postgres row-level security (RLS). It is deployed as an nginx Docker container on the same VM as Island GO (port 5050) and Nassau Eats (5060), on port **5110**.

- Repo: `https://github.com/Limni/bahamas-nightlife` (branch `main`)
- Supabase project: a new one per `README.md` setup (fill `.env.local`; none is committed).

## Commands

```bash
npm install
npm run dev          # Vite dev server on http://localhost:3000 (all interfaces)
npm run build        # production build -> dist/
npm run preview      # serve dist/
npm run lint         # type-check only (tsc --noEmit); there is no ESLint
npm run seed:google  # import Google Places venues as drafts (see below)
```

There is **no test suite**. To verify a change, run `npm run lint` and `npm run build`, then check it in a browser (see "Verifying UI changes").

## Stack (versions matter)

| Package | Version | Notes |
| --- | --- | --- |
| React / React DOM | 19.3 | `StrictMode` on, so effects run twice in dev |
| Vite | 8 (Rolldown) | Chunking is configured via `build.rolldownOptions.output.codeSplitting`, **not** Rollup's `manualChunks` |
| TypeScript | 7 | `strict`, `noUnusedLocals`, `noUnusedParameters` |
| Tailwind CSS | 4 | Vite plugin; theme tokens live in `src/index.css` `@theme`, and there is no `tailwind.config` |
| react-router-dom | 7 | `BrowserRouter`, nested routes |
| Leaflet + react-leaflet | 1.9 / 5 | plus `leaflet.markercluster` |
| motion | 13 | drawers/sheets (`motion/react`) |
| lucide-react | **1.x** | **Brand icons (Instagram, Facebook…) were removed** in 1.x. Use generic icons |
| @supabase/supabase-js | 2 | single client in `src/lib/supabase.ts` |
| exifr | 7 | lazy-imported, reads GPS from photo EXIF |

Path alias: `@/` → `src/` (in both `vite.config.ts` and `tsconfig.json`).

## Repository layout

```
index.html                 HTML shell (fonts via CSS, manifest, theme-color #0a0714)
public/
  sw.js                    service worker — caches MAP TILES ONLY (cache-first)
  manifest.webmanifest     PWA manifest
  favicon.svg, icons/      app icons (PNG 180/192/512 rendered from the SVG)
src/
  main.tsx                 mounts <App/>, registers /sw.js
  App.tsx                  providers + routes (lazy pages)
  index.css                Tailwind import, THEME TOKENS, map marker CSS, utility classes
  lib/
    supabase.ts            client + `supabaseConfigured` flag + bucket names
    auth.tsx               AuthProvider/useAuth — member accounts (session, profile, isAdmin)
    directory.tsx          DirectoryProvider (venues, upcoming events, tags, ratings) + LocationProvider
    activity.tsx           ActivityProvider/useActivity: consent, nightly device id, presence pings,
                           venue_activity() fetch + Realtime; heatFor()/HEAT_META levels; usePopularTimes()
    events.ts              isEventLive/Ended/Soon, eventPosition (own pin or venue's), eventWhen labels
    filters.tsx            FiltersProvider + matchesFilters()
    theme.tsx              ThemeProvider/useSiteTheme, initTheme(), ?theme= previews
    themes.ts              THEMES list (ids, names, swatches, hero badge)
    types.ts               shared row types + helpers (isFeatured, priceLabel, hasLocation)
    hours.ts               weekly hours in Bahamas time, open/closed state
    geo.ts                 haversine, formatDistance (mi/ft), directionsUrl, NASSAU
    markers.ts             pin styles by category, heat halos, event icons, TILE_URL/ATTRIBUTION
    images.ts              browser-side compression + uploads + EXIF GPS
    tilePrecache.ts        one-time Nassau tile seeding into the SW cache
    useNow.ts              minute-ticking clock for "open now"
  components/
    Layout.tsx             top nav (desktop) + bottom tab bar (phone), Logo
    ui.tsx                 Chip, OpenBadge, Price, HeatBadge, HeatPill, Spinner, EmptyState,
                           CoverPlaceholder, SafeImg, Stars, StarInput, RatingBadge
    VenueCard.tsx          VenueCard (grid), VenueRow (list), RailCard (carousels)
    EventCard.tsx          EventCard, EventArt (flyer or neon placeholder), LiveTag
    FilterSheet.tsx        FilterSheet modal, SearchFilterBar, QuickFilters
    VenueDrawer.tsx        DraggableSheet (shared map bottom sheet) + VenueDrawer
    EventDrawer.tsx        map sheet for an event pin
    PopularTimes.tsx       per-night usual-crowd bar chart with tonight's live level
    ActivityConsent.tsx    one-time opt-in card, Account toggle, "You're at X" banner
    Reviews.tsx            ReviewsSection (summary, own review form, list)
    Lightbox.tsx           full-screen photo viewer
    SetupNotice.tsx        shown when Supabase env vars are missing
  pages/
    Explore.tsx            "/" landing + directory
    MapPage.tsx            "/map"
    VenuePage.tsx          "/v/:slug" (tabs: overview, drinks, photos, reviews)
    EventsPage.tsx         "/events"
    EventPage.tsx          "/events/:id"
    Community.tsx          "/community" suggestions form + community wins
    Account.tsx            "/account" sign in/up/reset, profile, my reviews, my suggestions
  admin/                   "/admin/*" console (lazy-loaded, never in the visitor bundle)
    AdminApp.tsx           admin login gate, shell, nav, routes
    ui.tsx                 FeedbackProvider (toasts + confirm), Field, Panel, Button, Toggle
    VenuesList.tsx         all spots incl. drafts, "needs info" flags
    QuickAdd.tsx           field capture: GPS + photos -> draft
    VenueEditor.tsx        full editor (incl. activity radius)
    EventsList.tsx         all events (upcoming / live / drafts / past)
    EventEditor.tsx        create/edit an event (Nassau-time inputs, presets, flyer)
    ActivityAdmin.tsx      live counts, 24h visitors chart, per-venue table
    PhotoManager.tsx       gallery/menu photo upload, reorder, caption, cover, delete
    MenuEditor.tsx         menu items + paste-a-menu parser (parseMenuText)
    LocationField.tsx      map pin, GPS, paste Google Maps link (parseCoordinates)
    HoursEditor.tsx        7-day hours editor
    TagPicker.tsx          pick/add tags inline
    Inbox.tsx              community suggestions triage
    ReviewsModeration.tsx  hide/unhide/delete member reviews
    TagsManager.tsx        manage category/vibe/area vocabularies
    ThemeSettings.tsx      pick the public site theme
supabase/
  schema.sql               THE database definition (idempotent, re-runnable)
  seed_demo.sql            optional fictional venues ("demo-*"), events ("Demo ·") and 8 weeks
                           of crowd history + a live crowd
scripts/
  seed-google.ts           Google Places importer (Node, service-role key)
deploy/                    host nginx vhost, HTTPS installer, vm-setup.sh (no-clone installer)
Dockerfile, nginx.conf     container build + in-container SPA server
deploy.sh                  manual build/run script (same shape as Island GO's)
.github/workflows/deploy.yml  CI: build on GitHub -> GHCR -> self-hosted runner runs it
README.md, DEPLOY.md       human docs
```

## Routes

| Route | Page | Notes |
| --- | --- | --- |
| `/` | Explore | eager-loaded; everything else is `lazy()`. Any public URL takes `?theme=<id>` to preview a theme in that tab (`?theme=off` ends it) |
| `/map` | MapPage | `?focus=<venue id>` opens that venue's drawer, `?event=<event id>` an event's |
| `/v/:slug` | VenuePage | `?tab=menu\|photos\|reviews` (the "menu" tab is labelled Drinks) |
| `/events` | EventsPage | |
| `/events/:id` | EventPage | also loads past events and (for admins) drafts |
| `/community` | Community | `?kind=new_spot\|update\|closed\|event\|other&venue=<id>&field=menu\|photos\|hours\|phone` pre-fills the form |
| `/account` | Account | `?mode=signup`, `?next=/path` (in-app paths only; validated by `safeNext`); `#activity` is the sharing switch |
| `/admin/*` | AdminApp | `/admin`, `/admin/new`, `/admin/v/:id`, `/admin/events`, `/admin/events/new?venue=&notes=`, `/admin/events/:id`, `/admin/inbox`, `/admin/activity`, `/admin/reviews`, `/admin/tags`, `/admin/theme` |
| `*` | → `/` | |

Public pages render inside `<Layout/>` (5 tabs: Explore, Map, Events, Community, Account). `/admin` does not; it has its own light shell. The admin console is reachable **only by URL**, except an "Admin console" button on `/account` for admins.

Provider order in `App.tsx`: `BrowserRouter > ThemeProvider > AuthProvider > DirectoryProvider > LocationProvider > ActivityProvider > FiltersProvider > Suspense > Routes`.

## Data layer (client)

- **`DirectoryProvider`** loads **all published venues**, **published events that haven't ended**, all tags, and the `venue_ratings` view once, and filters client-side. It exposes `venueById` too. At Nassau scale (hundreds of rows) this keeps search instant.
  - The last response is cached in `localStorage` under `directory:v1`, so repeat visits paint immediately before the network returns.
  - It re-fetches on Supabase Realtime changes to `venues` and `events` (both in the `supabase_realtime` publication).
  - Events are optional: without the table the app works with none.
  - `refreshRatings()` re-fetches only the rating summaries. Call it after a review changes.
  - Ratings are optional: if the view doesn't exist (migration not run), the app still works.
- **`LocationProvider`** starts a single `watchPosition` when something calls `enable()` (the map on mount, or "Near me"), or automatically if permission was already granted.
- **`ActivityProvider`** (`lib/activity.tsx`) is the live-activity client:
  - **Consent** in `localStorage` `activity:consent` (`on`/`off`; null = not asked). Nothing is sent before `on`. Turning it on calls the location `enable()`.
  - **Device id**: random UUID in `activity:device`, rotated when the Nassau "night" (date of now − 6 h) changes.
  - **Pings**: while visible, on New Providence (+ slack), every 2 min, or after ≥ 50 s if moved ≥ 75 m: `rpc('report_presence', …)`. The result is the venue this device is counted at (`here`).
  - **Reading**: `rpc('venue_activity')` on mount, every 60 s while visible, on tab focus, and (debounced) on Realtime changes to `venue_live`. Cached in `activity:v1` for at most 10 min (stale live data misleads).
  - `heatOf(id)` → `{ level: quiet|chill|lively|packed, label, color, score, vsUsual, usual }` via `heatFor()`: level = live ÷ max(peak_avg, 6); vs usual = live ÷ typical_now (>1.3 busier, <0.7 quieter). `isBusy(id)` = anyone there now. `buzzScore()` sorts "Buzzing".
  - `usePopularTimes(venueId)` reads `venue_typical` into a 7×24 grid.
- **`FiltersProvider`** holds `{ q, categories, vibes, areas, prices, openNow, busyNow }`, persisted in `sessionStorage` (`filters:v1`) and shared by Explore and Map. `matchesFilters` uses **OR within a group and AND across groups**. Search is accent-insensitive and needs every term to match name, description, area, address, categories or vibes. `busyNow` needs the activity predicate: `matchesFilters(r, f, now, isBusy)`.
- **`AuthProvider`** exposes `session`, `profile`, `isAdmin` (via the `is_admin()` RPC), `loading`, `recovering` (true after a password-reset link), and `signIn` / `signUp` / `sendReset` / `updatePassword` / `updateName` / `signOut`. The admin console signs in through the same Supabase client, so one session covers both.
- Venue detail pages fetch their photos, menu items and popular times on demand. They are not part of the directory payload.
- When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing (or still `YOUR-PROJECT` placeholders), `supabaseConfigured` is `false`. The client is then created with dummy values, and pages show `<SetupNotice/>` instead of crashing.

## Database (Supabase / Postgres)

**`supabase/schema.sql` is the single source of truth.** It is written to be **idempotent**: `create … if not exists`, `add column if not exists`, `drop policy if exists` before every `create policy`, `on conflict do nothing` for seeds, and guarded `DO` blocks. You apply changes by re-running the whole file in the Supabase SQL Editor.

**Migration rules for agents:**
- Add schema changes to `schema.sql` in the same idempotent style. Don't edit app code around a missing column; change the schema.
- The anon key **cannot run DDL**. Schema changes must be run by the owner in the SQL Editor (or via a service-role/DB connection). Say so explicitly when you change the schema.
- Every table has RLS enabled with explicit policies. Keep it that way.

### Tables

| Table | Purpose | Key columns / notes |
| --- | --- | --- |
| `admins` | who is an admin | `user_id` → `auth.users`. `public.is_admin()` (security definer) checks `auth.uid()` |
| `venues` | listings | `slug` (unique, auto-generated from the name by a trigger if empty), `name`, `description`, `categories text[]` (venue types), `vibes text[]`, `area`, `price_level 1–4`, `phone`, `website`, `instagram`, `facebook`, `address`, `lat`, `lng`, `hours jsonb`, `hours_note`, `cover_url`, `is_published`, `is_featured`, `featured_until`, `google_place_id` (unique, set by the importer), **`radius_m` (15–400, default 60: activity geofence)**, `created_at`, `updated_at` (auto via trigger) |
| `venue_photos` | gallery + menu photos | `kind 'gallery'\|'menu'`, `url`, `storage_path` (for deletes), `caption`, `sort` |
| `menu_items` | structured menu | `section`, `name`, `description`, `price numeric(10,2)`, `sort` |
| `tags` | filter vocabularies | `kind 'category'\|'vibe'\|'area'`, `label`, `sort`; unique `(kind,label)`; seeded with starter values |
| `submissions` | community suggestions | `kind 'new_spot'\|'update'\|'closed'\|'event'\|'other'`, `venue_id`, `venue_name`, `fields text[]`, `message`, `contact_name`, `contact_email`, `credit_ok`, `photo_paths text[]` (≤6), `status 'new'\|'reviewing'\|'done'\|'dismissed'`, `admin_note` (private), `resolved_at` (trigger-set), `user_id` (default `auth.uid()`, null for anonymous) |
| `profiles` | public member profile | `id` → `auth.users`, `display_name` (1–40 chars). Created by the `on_auth_user_created` trigger from sign-up metadata `display_name`. Existing users are backfilled |
| `site_settings` | one row (`id = true`) of site-wide settings | `theme` (theme id, default `'neon'`; format-checked only, so new themes need no migration), `updated_at`. In the Realtime publication |
| `events` | highlighted nights | `title`, `description`, `venue_id` (nullable, `on delete set null`), own `lat`/`lng`/`address` (else the venue's pin is used), `start_date`, `end_date` (check end ≥ start), `hours jsonb` (optional weekly windows), `image_url`/`image_path`, `price_note ≤80`, `ticket_url`, `is_published`, `is_featured`, timestamps. In Realtime |
| `presence` | **one row per device** currently at a venue | `device_id` PK, `venue_id`, `arrived_at`, `last_seen`, `counted_hour`. **No RLS policies: nobody can read it**; only the security-definer functions touch it. Never stores coordinates |
| `venue_hourly` | hourly tallies | `(venue_id, hour_start)` PK, `visitors` (distinct phones that hour), `arrivals` (visits that started). Admin read only. Trimmed after 180 days |
| `venue_live` | current count per venue | `live_count` (already floored: < 2 → 0), `updated_at`. Public read, **in Realtime**; written only when the value changes |
| `venue_typical` | usual crowd | `(venue_id, dow, hour)` in Nassau time, `avg_visitors` (8-week average, over the weeks the venue was tracked). Public read |
| `venue_stats` | per-venue summary | `visits_30d` (sum of arrivals), `peak_avg` (busiest usual hour). Public read |
| `activity_meta` | single row | `stats_at` (when typical/stats were last rebuilt) |
| `reviews` | ratings + comments | `venue_id`, `user_id` (default `auth.uid()`, FK → `profiles`, so PostgREST can embed `profiles(display_name)`), `rating 1–5`, `comment ≤2000`, `is_hidden`. **Unique `(venue_id, user_id)`**: one review per member per spot |

### RLS summary

| Data | Who can read | Who can write |
| --- | --- | --- |
| `venues`, `venue_photos`, `menu_items` | published rows (or the photos/items of published rows) for anyone; everything for admins | admins only |
| `tags` | everyone | admins |
| `site_settings` | everyone | admins update (no insert/delete; the row is seeded) |
| `submissions` | admins | **anyone can insert**, but only as `status='new'` with no `admin_note`/`resolved_at` and `user_id` null or self; admins update/delete |
| `profiles` | everyone (only `display_name` exists) | the owner updates their own |
| `events` | published for anyone; everything for admins | admins only |
| `presence` | nobody | only `report_presence()` / housekeeping (security definer) |
| `venue_live`, `venue_typical`, `venue_stats` | everyone (aggregates only) | only the activity functions |
| `venue_hourly` | admins | only the activity functions |
| `reviews` | non-hidden for everyone; own (even hidden) for the author; all for admins | members insert their own on **published** spots; authors and admins update/delete |

Only admins may change `reviews.is_hidden`. The `reviews_guard` trigger forces `false` on member inserts and raises an error if a non-admin changes it.

### Views and RPCs

- `venue_ratings` view (`security_invoker = on`) returns `venue_id, rating_avg, rating_count` over **non-hidden** reviews.
- `recent_contributions(p_limit)` (security definer) is the public "community wins" feed: first name only, opted-in (`credit_ok`), `status='done'`.
- `contribution_count()` returns the number of applied suggestions.
- `my_submissions()` returns the signed-in member's own suggestions **without `admin_note`**. Execute is revoked from `public` and `anon`.
- `is_admin()`
- **Activity** (all security definer):
  - `report_presence(p_device uuid, p_lat, p_lng, p_accuracy)` → venue id or null. Granted to anon/authenticated. Rate-limited to one ping per device per 45 s. Accuracy ≤ 100 m: nearest published venue whose `radius_m` (+ ≤ 30 m GPS slack) contains the fix (bounding-box prefilter). Accuracy > 100 m: keeps the device at its current venue if the fix still covers it, else changes nothing. Not at a venue → the device's row is deleted. A visit counts after **DWELL = 4 min**; it stops counting **STALE = 15 min** after the last ping; each counted visit adds 1 visitor per hour (and 1 arrival per visit) to `venue_hourly`. Runs `activity_housekeeping()` on ~2% of pings.
  - `venue_activity()` → `venue_id, live_count, typical_now, peak_avg, visits_30d` for published venues with any activity. Lazily rebuilds averages (`activity_refresh_stats()`) at most hourly under an advisory lock. Live counts under 2 are reported as 0.
  - Internal, execute revoked from API roles: `activity_live_count`, `activity_refresh_live`, `activity_housekeeping`, `activity_refresh_stats`. `haversine_m()` helper.
  - Optional `pg_cron` job (end of `schema.sql`) runs housekeeping every minute so `venue_live` decays even with nobody pinging.
  - The DWELL / STALE / floor values are repeated in several functions and mirrored in the client copy (`ActivityConsent.tsx`, `ActivityAdmin.tsx`). Change them together.

### Storage buckets

- `venue-media` is **public read**; only admins can write. Paths are `<venue_id>/<gallery|menu>/<timestamp>-<rand>.<ext>` (event flyers: `events/<event_id>/…`), uploaded with a 1-year cache. A unique path per upload means replacing an image changes its URL.
- `submission-uploads` is **private**. Anyone may upload into `inbox/` (8 MB max, images only); only admins can read (the admin Inbox uses signed URLs) or delete.

### Hours format

`hours` is `{ "0": {"open":"11:00","close":"22:00"}, … }`, keyed by weekday with `"0"` = Sunday. A missing day means closed. A `close` earlier than `open` means the hours run past midnight, and `00:00–23:59` means open 24 hours. All logic in `src/lib/hours.ts` uses **America/Nassau** time regardless of the visitor's timezone. Events use the same format for optional weekly windows; the admin enters event start/end as Nassau wall-clock time (`toNassauInput` / `fromNassauInput` in `EventEditor.tsx`).

## Features (what each part does)

### Explore (`/`)
- **Hero:** a `.neon-board` panel. A time-of-night greeting (Nassau time) with a matching one-tap suggestion (beach bars / waterfront / happy hour / dancing on Fri–Sat / live bands / open late; shown only if that tag exists). Headline "Nassau after dark." in flickering neon. Search + filters, quick buttons (Buzzing now, Open now, Near me, Events), live stats (spots, open now, buzzing, events tonight), and a "Help light up the map" opt-in when location isn't on yet. On desktop: the **live board**, which shows the busiest venues now, else tonight's events, else the scene's venue types.
- **Browse sections** (no search/filters): Happening tonight (events rail, live first), Buzzing right now (by `buzzScore`), venue-type tiles, Popular this month (30-day visits, 3+ needed), Open right now, Featured, Find your vibe, Fresh on the scene, neighbourhoods.
- **All spots:** sort Top picks / **Buzzing** / **Popular** / Top rated (weighted `(avg·n + 3.5·3)/(n+3)`) / Nearest / A–Z / New; grid/list; removable chips. A note explains an empty Buzzing list (nobody sharing yet).
- Tapping a tile or chip calls `apply()`, which **replaces** all filters with that one and scrolls to the results.

### Map (`/map`)
Ported from Island GO's map, on a dark basemap:
- Category-coloured glyph pins, clustered until zoom 16. Featured spots get a gold border and star.
- **Heat halos:** each venue pin has a breathing halo sized and coloured by its live level (`--color-heat-*`); busier pins sit above quieter ones. Cluster bubbles glow with their busiest member (`refreshClusters()` when levels change). Icons are cached per level, so the minute refresh only swaps changed pins.
- **Highlighted events (Island GO):** live events get a neon ring that cycles through brand → glow → gold, plus a LIVE tag; upcoming ones are dimmed. Events at a listed venue are drawn as a small badge on that venue pin's shoulder (`eventIcon(live, selected, attached)`); events with their own location are full pins. Events follow the search text but not the venue filters.
- Pulsing GPS dot, follow mode, fit to results, show all, heat legend, "N buzzing · N live events" pills.
- Drawers share `DraggableSheet`: `VenueDrawer` (live level, "you're here", next event at the venue) and `EventDrawer`.

### Venue page (`/v/:slug`)
- Hero, title card with live `HeatBadge` (+ vs usual), open state, rating, Call / Directions / On map.
- **Overview:** **Live activity** card (`PopularTimes`: pick a night; bars show the usual crowd from noon to 5 AM, with after-midnight hours taken from the next weekday; tonight's current hour is outlined in the live heat colour), **Upcoming here** events, about, photos, hours, mini map, contact.
- **Drinks:** menu items by section with leader lines and BSD prices, plus menu photos. **Photos**, **Reviews** as in Nassau Eats.

### Events (`/events`, `/events/:id`)
- List grouped Live / Tonight / This week / Coming up, with range chips (Everything, Tonight, Next 7 days, Featured). Live cards get `.neon-edge` and a LIVE tag.
- Detail: flyer hero, when (Nassau time; weekly schedule when set), price, tickets link, host venue card with its live level, directions, mini map, "On map" (`/map?event=`).

### Live activity sharing (`components/ActivityConsent.tsx`)
- `ActivityConsentCard` asks once, when location is on and consent is unset (not on `/account`). Nothing is sent until "Count me in".
- `ActivitySharingToggle` on `/account` (signed in or out) with the privacy explanation.
- `HereBanner` thanks the visitor while they're counted at a venue (hidden on `/map`).
- The privacy copy states the rules (venue only, nightly ID, ≥ 2 people). Keep it true if the SQL changes.

### Reviews (`components/Reviews.tsx`)
- Average plus a 5→1 distribution, computed from loaded visible reviews. The directory's `venue_ratings` drives the badges elsewhere.
- Your own review shows first with Edit and Delete, and a notice if a moderator hid it. Otherwise you get the star picker and comment form.
- Signed-out visitors get Sign in / Create account links with `next=` back to the reviews tab.

### Community (`/community`)
- Suggestion types: new spot / update / closed / other, with a venue picker, "what changed" chips, details, and up to 6 photos (compressed, uploaded to the private bucket).
- A hidden honeypot field silently drops bots, and a per-browser throttle allows 6 per hour.
- Signed-in members don't type a name or email (both come from their account), and the suggestion is linked to their account.
- Sidebar: count of applied suggestions and the "Community wins" feed.

### Account (`/account`)
- Sign in / Create account (display name, 8+ character password) / Forgot password, then a "Choose a new password" screen when `recovering`.
- With email confirmation on (the Supabase default), sign-up shows "Check your email". Email links redirect to `/account`.
- Signed in: avatar initial, editable display name, email (shown privately), Admin console link (admins), Sign out, **My reviews**, and **My suggestions** with status (Received / In progress / Applied / Not applied).

### Admin console (`/admin`)
- **Login gate:** Supabase email + password. Non-admins see SQL to grant access. The console is phone-first and light (`colorScheme: light`): a 5-tab bottom bar (Spots, Events, Quick add, Inbox, Activity); Reviews / Tags / Theme are icons in the phone header.
- **Events:** list (Upcoming / Live now / Drafts / Past, with "No pin" flags) and editor: title, description, price note, ticket link; start/end in **Nassau time** with presets (Tonight 10 PM–2 AM, Fri/Sat 10 PM–3 AM, Sun 4–9 PM); optional weekly hours; host venue (drafts included) and/or its own location; flyer upload (after the first save, to `events/<id>/`); Published / Featured; delete removes the flyer file. The venue editor links to "New event" with the venue preset, and an Inbox "Event tip" becomes **Create event** (`?venue=&notes=`).
- **Activity:** phones counted now, venues buzzing, 30-day visits, a 24-hour visitors-per-hour chart (`venue_hourly`), and a per-venue table (level, live, usual now, 30-day visits, radius).
- **Spots:** search; All / Live / Drafts / Needs info views. "Gap" badges show a missing pin, hours, photos or menu.
- **Quick add**, built for the field:
  - It grabs GPS immediately.
  - Fill in name, area, category, price, phone and notes.
  - "Place / food" and "Menu page" camera buttons (`capture="environment"`) plus library pickers, with a tap-to-toggle gallery/menu flag per photo.
  - If GPS isn't available, the location comes from the photo's EXIF data.
  - **Save draft** inserts the venue (unpublished), uploads the photos, sets the first gallery photo as the cover, and opens the editor.
  - `?name=&notes=&from=<submissionId>` pre-fills it from an Inbox suggestion and marks that suggestion "reviewing".
- **Editor:** sections for Basics, Photos, Drinks & menu, Location (with the **activity radius** slider, 15–300 m), Hours, Events here, Contact and Visibility.
  - A sticky save bar shows unsaved changes, with a `beforeunload` warning.
  - Publishing saves everything; publishing without a pin asks for confirmation.
  - Featured has an optional end date. The slug is editable, and an empty slug is regenerated.
  - Delete also removes the spot's storage files.
- **PhotoManager:** camera or library upload with progress, reorder (left/right), inline caption, set as cover, delete (also deletes the storage object). It auto-sets the cover for the first photo and reports EXIF GPS to the editor.
- **MenuEditor:** add or edit items one at a time, or **Paste a menu**. `parseMenuText` treats each line as an item with a trailing price (`Conch Fritters - 12`, `$12`, `12.50`). `Name | price | description` adds a description. A line ending in `:`, or a short ALL-CAPS line with no digits, starts a section.
- **LocationField:** tap the map or drag the pin, "I'm here — use my GPS", or paste a Google Maps URL or `lat, lng`. `parseCoordinates` handles `!3d…!4d…`, `@lat,lng` and plain pairs; short `maps.app.goo.gl` links can't be expanded in the browser.
- **Inbox:** tabs New / In progress / Done / Dismissed.
  - Signed URLs for photos, plus **one-tap "add to gallery / add to menu"**, which downloads the photo from the private bucket and re-uploads it to the media bucket.
  - "Create draft" for new-spot suggestions, "Create event" for event tips, and a private note per suggestion.
  - Marking a suggestion Done credits the sender's first name publicly if they opted in.
- **Reviews:** Latest / 1–2 stars / Hidden. Hide (stops it counting; the author still sees it) or Delete.
- **Tags:** add, reorder and remove the category / vibe / area options, with usage counts. Removing a tag doesn't strip it from existing spots.
- **Theme:** cards for each site theme with a mini preview, **Preview** (opens `/?theme=<id>` in a new tab) and **Make live**, which updates `site_settings.theme` for every visitor.
- Admin UI uses `useFeedback()` toasts and confirms. **Never use `window.alert` / `window.confirm`.**

### Images (`lib/images.ts`)
`compressImage` downscales to 1800 px (1600 px for community uploads) and re-encodes as WebP, falling back to JPEG when the browser silently returns PNG for WebP (older Safari). Re-encoding **strips EXIF**, so call `readPhotoGps(file)` **before** compressing. Formats the browser can't decode (e.g. HEIC on Chrome) are uploaded as the original file. Always render user-supplied image URLs with `<SafeImg>` (or `<EventArt>` for flyers), which fall back to the neon placeholder on error.

### Sponsorship groundwork
`is_featured` plus an optional `featured_until`. `isFeatured(r)` is true only before the end date. Featured spots sort first under Top picks, appear in the Featured rail and get a gold star pin. Events have their own `is_featured` (first on Events and the Explore rail). Payments are not built.

## Theme and design system

The public site is **dark**. The colours are **semantic Tailwind tokens defined in `src/index.css` `@theme`**, used the conventional way round (50 = lightest):

| Token | Use |
| --- | --- |
| `night-50…950` | violet-black surfaces: `night-950` page, `night-900` cards, `night-800` raised, `night-700` borders; the light end (`50–300`) is body and muted text. Headings are `text-white` |
| `brand-50…950` | hot magenta, the primary (buttons, links, active chips). On dark, use `brand-300/400` for text and icons and `brand-500` for fills |
| `glow-50…950` | electric cyan, the second neon (gradients `from-brand-500 to-glow-500`, times, accents) |
| `heat-chill` / `heat-lively` / `heat-packed` | **fixed** activity colours (sky / amber / hot pink). Themes don't re-point them so they keep their meaning |
| `emerald-400` | "open now"; `amber-400` featured and stars |

- **Glows:** use the `@utility` classes `glow-brand`, `glow-brand-soft`, `glow-accent`, `glow-live` (Tailwind's coloured shadows always add an offset). Translucent white (`bg-white/5`, `border-white/10`) for subtle surfaces and borders.
- **Fonts:** `font-display` = **Unbounded** (wide; all `h1–h6` use it, so keep heading sizes modest), body = **DM Sans**. Both come from Google Fonts in `index.css`.
- **Utility classes in `index.css`:** `.neon-board` (hero panel), `.neon-text` + `.neon-flicker` (sign glow), `.neon-edge` (gradient hairline border for featured/live), `.leader`, `.heat-dot` (+ `.pulse`), `.no-scrollbar`, and the map classes (`.marker-circle`, `.marker-heat`, `.marker-glow-ring`, `.event-live`/`.event-dim`/`.event-ring`, `.marker-badge`, `.mini`, `.cluster-bubble`, `.pulsing-dot`). Animations stop under `prefers-reduced-motion`.
- **Admin palette:** light slate + brand accents, built for function. The brand accents follow the active site theme.
- **Map pin colours/glyphs** are per category in `markers.ts` (`CATEGORY_STYLES`, nightlife glyphs incl. hand-drawn disco ball and rum bottle). Unknown categories get a stable hashed colour; the first category decides the pin.
- **Charts** (PopularTimes, admin 24h): one hue, thin bars with 4 px rounded tops and 2 px gaps, hover/focus readout, a screen-reader table. No legend for a single series.

### Site themes

The admin picks the public look in `/admin/theme`; it's stored in `site_settings.theme` and applied as `<html data-theme="<id>">`. All themes are dark.

| Id | Name | Look |
| --- | --- | --- |
| `neon` | Neon nights | the `@theme` defaults (default) |
| `junkanoo` | Junkanoo | flamingo pink + Junkanoo gold on deep-ocean navy, waves on the hero |
| `halloween` | Halloween | pumpkin orange + witchy violet, full moon |
| `christmas` | Christmas | holly red + gold on pine-black, falling snow |

- **How it works:** each theme is a `[data-theme="<id>"]` block that re-points `night-700…950`, `brand-300…700`, `glow-300…600` and the plain variables `--page-glow-a/b`, `--board-glow-a/b`. Decorations are `.neon-board::after`. Components never branch on the theme.
- **Loading / previews / adding a theme:** as in Nassau Eats: `initTheme()` paints the cached `theme:v1` first; unknown ids fall back to `neon`; `?theme=<id>` previews per tab; a new theme needs a `THEMES` entry (`metaColor` = its `night-950`) and a CSS block, but no migration.

## Map tiles (important)

The default basemap is **Stadia Maps "Alidade Smooth Dark"**: `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png`. CARTO's free tiles (Island GO's) now need a key.
- Stadia works on localhost with no key. A live domain must be **registered in the Stadia dashboard**, or tiles fail. The free tier is non-commercial.
- To switch provider, set `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` (build-time; GitHub repo **Variables** for CI). Pick a dark style: the pins, halos and UI assume one.
- Don't use `tile.openstreetmap.org` (blocked by OSM's tile usage policy for apps).
- `public/sw.js` caches tiles cache-first (`map-tiles-v2`, a–d subdomain dropped from keys, ~3000 tiles). `tilePrecache.ts` seeds New Providence at z12–15 once per provider URL. If you change the cache name, change it in **both** files.

## Environment variables

All `VITE_*` values are **inlined at build time** and are public (they ship in the JS). Access control is RLS, not secrecy.

| Var | Where | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` locally; GitHub **secrets** in CI | required |
| `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` | optional; GitHub **variables** in CI | empty falls back to Stadia defaults |
| `GOOGLE_MAPS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `.env` / `.env.local` only | **secret**, used only by `scripts/seed-google.ts`; never prefix with `VITE_` |
| `PORT` | GitHub variable / `.env` for `deploy.sh` | host port, default `5110` |

`.env*` is git-ignored (except `.env.example`). **Never commit real secrets.** The service-role key bypasses RLS and must never reach the browser.

## Google Places importer (`scripts/seed-google.ts`)

Run with `npm run seed:google` (Node with `--env-file`). It sweeps New Providence with Places API (New) Text Search (queries `bar`, `night club` and `lounge or rooftop bar`, using recursive grid cells), keeps bars/clubs/pubs/lounges/karaoke/casinos, maps Google types and name clues ("rooftop", "beach", "rum", "lounge"…) onto the venue types, and inserts **unpublished drafts** using the service-role key.

Flags:
- `--dry-run [--out file.json]`: preview without writing.
- `--min-reviews N`: skip places with fewer reviews.
- `--query "..."` (repeatable).
- `--max-depth N`.
- `--publish`.

It is safe to re-run:
- places already imported (matched by `google_place_id`) are skipped;
- hand-added spots with the same name within about 250 m are linked rather than duplicated;
- edited data is never overwritten.

It does not import photos. It requires the `google_place_id` column, so re-run `schema.sql` first.

## Deployment

The full runbook is in **`DEPLOY.md`**. The essentials:
- **CI** (`.github/workflows/deploy.yml`): a push to `main` builds the image on `ubuntu-latest` and pushes it to `ghcr.io/limni/bahamas-nightlife` (`:latest` and `:<sha>`). Then a **self-hosted runner registered to this repo** (separate from Island GO's runner; runners are per repo) pulls the image and runs container `nassaunights` on **`127.0.0.1:5110`**. Concurrency group: `deploy-nassaunights`.
- **Container:** `Dockerfile` is a two-stage build (`node:22-alpine` → `nginx:1.27-alpine`). `npm ci` falls back to `npm install` because the lockfile is generated on Windows and lacks Linux optional binaries. `nginx.conf` provides the SPA fallback to `index.html`, immutable `/assets/` caching, and `no-cache` for `index.html` and `sw.js`.
- **Host nginx:** `deploy/nassaunights.limniatis.com.conf` defines upstream `nassaunights_app` → `127.0.0.1:5110`, with `:80` and **`:443`** server blocks. The `:443` block includes `/etc/nginx/snippets/nassaunights-ssl.conf`.
  - Cloudflare runs in **Full** mode. Without a `:443` block, nginx would answer this host with **Island GO** (its default TLS server).
  - `sudo ./deploy/enable-https.sh` copies Island GO's certificate lines into that snippet, installs and enables the vhost, runs `nginx -t`, and **rolls back on failure**.
  - `deploy/vm-setup.sh` does the same **without a clone**: one file with the vhost embedded (keep it in sync with `deploy/nassaunights.limniatis.com.conf`), plus a port check, the upgrade map only if missing, IPv4-only fallback, `--check`, and `--run` (pull + run the GHCR image).
- **Coexisting with Island GO on the same VM:**

  | | Island GO | Nassau Nights |
  | --- | --- | --- |
  | Port | 5050 | 5110 |
  | Upstream | `islandgo_app` | `nassaunights_app` |
  | Logs | `islandgo.*` | `nassaunights.*` |
  | `$connection_upgrade` map | defines it in `conf.d/islandgo-upgrade-map.conf` | **reuses** it; never define it twice. `deploy/nassaunights-upgrade-map.conf` is only for servers without it |

- **DNS:** Cloudflare `nassaunights` record, proxied. A first-level subdomain is covered by `*.limniatis.com` Universal SSL.
- **Second domain:** the vhost's `server_name` also lists `nassaunights.com` and `www.nassaunights.com` (served directly, no redirect). That zone must be proxied by Cloudflare in **Full** (not strict) mode, because the origin reuses Island GO's certificate. The app has no hard-coded domain: auth email links use `window.location.origin`.
- **Manual deploy:** `./deploy.sh build|deploy|update|logs|stop|status`. It reads `.env`, then `.env.local`.

## Supabase dashboard settings the app depends on

- **Authentication → Sign In / Providers:** allow new sign-ups (required for member accounts). The provider is email + password.
- **Authentication → URL Configuration:** Site URL is the primary domain; redirect URLs must list every domain the site is served on (`https://nassaunights.com/**`, `https://www.nassaunights.com/**`, `https://nassaunights.limniatis.com/**`) plus `http://localhost:3000/**`, or auth emails fall back to the Site URL.
- **Authentication → Emails → SMTP:** the built-in mailer is heavily rate-limited, so configure custom SMTP before launch or confirmation emails will stall.
- **Admins:** `insert into public.admins (user_id) select id from auth.users where email = '…';`

## Conventions and gotchas

- **`useEffect` must not return a value.** `useEffect(() => window.scrollTo(0,0), …)` crashed the whole app on load (React treats the return value as a cleanup function). Always use a block body: `useEffect(() => { doThing(); }, [...])`.
- **lucide-react 1.x has no brand icons.** Importing `Instagram` or `Facebook` fails the type-check.
- **Line endings:** the repo is edited on Windows. `.gitattributes` forces LF for `*.sh`, `*.conf`, `*.yml` and `Dockerfile`, because a CRLF `deploy.sh` breaks on Linux. Keep new server-side files covered.
- **Lockfile:** generated on Windows. Don't "fix" Linux `npm ci` failures by editing the lock; the Dockerfile already falls back.
- **Colour classes:** use `night` / `brand` / `glow` / `heat-*` (plus `emerald` for open and `amber` for featured), not new hex colours, except as one-off gradient stops and the per-category pin colours in `markers.ts`.
- **Images:** user or remote images go through `<SafeImg>`. Uploads go through `uploadMedia` / `uploadSubmissionPhoto` (compressed, unique paths). Delete storage objects when deleting rows (`storage_path`).
- **Admin feedback:** `useFeedback().toast/confirm`, never browser dialogs.
- **Bundle split:** the admin code and Leaflet pages are `lazy()`. Don't import `src/admin/*` from public pages. Vendor chunks (react, supabase, leaflet, motion) are split in `vite.config.ts`.
- **Security:** keep all authorization in RLS and security-definer RPCs. Never trust the client for `is_hidden`, `status`, `admin_note`, or `user_id`. Public RPCs must never expose emails or `admin_note`.
- **Activity privacy:** never store coordinates, never expose `presence` or per-device data, keep the < 2 floor in every read path, and keep the device id anonymous (not the auth user id). New activity reads go through aggregate tables or security-definer functions.
- **Comments in code** explain *why* (constraints, gotchas), matching the existing style. Keep it that way.

## Verifying UI changes

There are no tests. A practical loop:
1. `npm run lint && npm run build`. Without a `.env`, `supabaseConfigured` is a build-time `false` and the bundler drops most of the app. To check chunking, build with placeholder `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
2. **SQL:** Postgres 16 runs locally in the dev container. Stub the Supabase bits (roles `anon`/`authenticated`, `auth.users` + `auth.uid()`, `storage.buckets/objects` + `storage.foldername`, publication `supabase_realtime`), then run `schema.sql` **twice** (idempotency) and `seed_demo.sql`. Exercise `report_presence` / `venue_activity` with `set role anon` and by ageing `presence.arrived_at` to get past DWELL.
3. **UI with data, no real project:** run Vite with a fake URL (`VITE_SUPABASE_URL=https://mockproj.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite --port 3008`). Then use Playwright `page.route('**/mockproj.supabase.co/**')` to answer `rest/v1/<table>` and `rest/v1/rpc/<fn>` with fixtures, for example JSON exported from the local seeded database. Grant the context `geolocation` to test consent → ping → "You're at…". For admin, put a fake session in `localStorage['sb-mockproj-auth-token']` and answer `rpc/is_admin` with `true`. Realtime sockets simply fail.
4. Headless Chrome's minimum window width is about 500 px; use 500 px or more for phone shots.
5. Don't create real accounts, reviews, suggestions or presence pings against a production project while testing unless the owner asks.

## Status and known gaps

- **Built (2026-10-08) and verified locally:** the clone of Nassau Eats restyled as a dark neon site, events (public + admin), live activity (SQL tested against Postgres 16: geofence, dwell, fuzzy-GPS stickiness, moving between venues, leaving, the < 2 floor, rate limit, 8-week averages, re-runs), heat on the map, popular times, the admin Activity page, nightlife Google importer, demo seed. UI checked with mocked Supabase responses in headless Chromium.
- **Needs the owner to act:**
  - create the Nassau Nights Supabase project, run `schema.sql` (and optionally `seed_demo.sql`), make yourself an admin, and set the Auth URL config + SMTP as in Nassau Eats;
  - optionally enable `pg_cron` and schedule `activity_housekeeping()`;
  - register `nassaunights.limniatis.com`, `nassaunights.com` and `www.nassaunights.com` with Stadia; DNS + host nginx (`deploy/`); a self-hosted runner and the two repo secrets.
- **Not yet verified end to end:** against a real Supabase project (Realtime delivery of `venue_live`, Storage uploads of flyers), and the Docker image on the server.
- **Limits of live activity:** counts only people who opted in while the site is open (no background tracking on the web); anyone can call `report_presence` with invented coordinates (rate limits and dwell blunt it, but levels are indicative, not audited); events with their own location have no activity geofence.
- **Not built:**
  - OAuth logins (Google/Apple);
  - review photos, replies, likes, and review reporting by visitors;
  - sponsorship payments/billing and analytics;
  - automated tests;
  - an "Admin" link in the public nav (deliberately omitted);
  - multi-island support (Nassau / New Providence only; `NASSAU`, the tile precache bounds and the tag seeds assume it).
