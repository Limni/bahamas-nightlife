# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Read this before making changes.

## What this is

**Nassau Nights** (https://nassaunights.limniatis.com) is a nightlife guide for Nassau, Bahamas: bars, clubs, lounges, beach bars and events. It is a **clone of Nassau Eats** (`Limni/bahamas-nassaueats`), restyled as a dark neon site, with two features the eats site doesn't have:

- **Highlighted events**, ported from Island GO (`Limni/bahamas-exp`). Events are one-off (a date range) or **weekly/recurring** (weekly hours, optionally with no end date: "Ladies Night every Friday"), and live ones pulse on the map.
- **Live radio** from a partner broadcaster (100 Jamz, Joy FM, Kiss FM, Y98 FM): an opt-in station picker and a mini-player that keeps playing across pages.
- **Live, GPS-based activity.** Visitors who opt in send anonymous presence pings. The database turns them into "how busy is it now" per venue, compared with that venue's usual for the weekday and hour (8-week average), plus 30-day popularity. It updates in real time over Supabase Realtime.

Everything else is Nassau Eats: directory, map, venue pages with drinks menus/photos/reviews, member accounts, community suggestions and the phone-friendly admin console. On top, admins can make members **venue managers** who update their own venues from `/manage`, and **editors** who add and edit any spot in the admin console (and nothing else).

It is a static React SPA with **no custom backend** (the one exception is a Supabase Edge Function, `invite-member`, for member invitations). All data, auth and file storage go through **its own Supabase project** (not Nassau Eats'), protected by Postgres row-level security (RLS). It is deployed as an nginx Docker container on the same VM as Island GO (port 5050) and Nassau Eats (5060), on port **5110**.

- Repo: `https://github.com/Limni/bahamas-nightlife` (branch `main`)
- Supabase project: a new one per `README.md` setup (fill `.env.local`; none is committed).

## Commands

```bash
npm install
npm run dev          # Vite dev server on http://localhost:3000 (all interfaces)
npm run build        # production build -> dist/, then scripts/sitemap.mjs writes sitemap.xml + robots.txt
npm run preview      # serve dist/
npm run lint         # type-check only (tsc --noEmit); there is no ESLint
npm run seed:google  # import Google Places venues as drafts (see below)
```

Run `npm run lint`, `npm run build`, and `node --test tests/canonical-build.test.mjs`, then check changes in a browser (see "Verifying UI changes"). The focused tests cover canonical HTML generation and origin consistency.

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
| hls.js | 1.7 | lazy, **light** build (`hls.js/light`, typed via `src/hls-light.d.ts`); loaded only when someone plays an HLS station outside Safari |
| @ffmpeg/ffmpeg + @ffmpeg/core | 0.12 | admin-only, lazy: re-encodes short videos in the browser (single-thread core, self-hosted ~32 MB wasm) |

Path alias: `@/` → `src/` (in both `vite.config.ts` and `tsconfig.json`).

## Repository layout

```
index.html                 HTML shell (fonts via CSS, manifest, theme-color #0a0714, Google Analytics gtag G-FWM1NM6DRJ)
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
    favorites.tsx          FavoritesProvider/useFavorites: the member's favourite spot ids, toggle, signed-out prompt
    radio.tsx              RadioProvider/useRadio: radio settings + stations, playback (one stream), now-playing
                           parser/poller, Media Session, GA events; attachStream() (hls.js on demand)
    activity.tsx           ActivityProvider/useActivity: consent, nightly device id, presence pings,
                           venue_activity() fetch + Realtime; heatFor()/HEAT_META levels; usePopularTimes()
    crawl.ts               bar crawl planner: candidates, scoring at arrival time, beam search, travel estimates,
                           swapStop, planCustom (hand-picked + shared links), bestOrder, googleMapsUrl, Nassau time helpers
    events.ts              isEventLive/Ended/Soon, nextSession/eventNextStart, isRecurring/recurrenceLabel,
                           eventPosition (own pin or venue's), eventWhen labels
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
    TabBar.tsx             pill tabs that scroll sideways when they don't fit, with edge arrows (venue page)
    MenuList.tsx           MenuSections (a drinks or food menu: item photos, hearts, Fan favourite),
                           useMenuLikes, LikeSignInPrompt
    ActivityConsent.tsx    one-time opt-in card, Account toggle, "You're at X" banner
    Reviews.tsx            ReviewsSection (summary, own review form, list)
    Lightbox.tsx           full-screen photo/video viewer
    Media.tsx              MediaStill (photo, or video poster + play badge), VideoBadge, toLightbox
    Radio.tsx              RadioButton ("Live radio"), RadioSheet (station picker), RadioDock (mini-player),
                           StationLogo, EqBars
    FavoriteButton.tsx     heart that saves a spot to favourites (overlay / hero / tile variants)
    SetupNotice.tsx        shown when Supabase env vars are missing
  pages/
    Explore.tsx            "/" landing + directory
    MapPage.tsx            "/map"
    VenuePage.tsx          "/v/:slug" (tabs: overview, drinks, food, photos, reviews)
    EventsPage.tsx         "/events"
    EventPage.tsx          "/events/:id"
    Community.tsx          "/community" suggestions form + community wins
    CrawlPage.tsx          "/crawl" bar crawl planner (form, timeline, route map, share/swap/shuffle)
    Account.tsx            "/account" sign in/up/reset, profile, my reviews, my suggestions
  admin/                   "/admin/*" console and "/manage/*" venue manager (lazy-loaded, never in the visitor bundle)
    AdminApp.tsx           admin login gate, shell, nav, routes
    ManagerApp.tsx         "/manage": venue managers' shell (My venues, Events), reusing the editors below
    console.tsx            ConsoleProvider/useConsole: role admin|editor|manager, link base, the manager's venueIds
    VenueManagers.tsx      VenueManagersPanel (admin, on a spot) + MemberVenues (admin, on a member)
    ui.tsx                 FeedbackProvider (toasts + confirm), Field, Panel, Button, Toggle
    VenuesList.tsx         all spots incl. drafts, "needs info" flags
    QuickAdd.tsx           field capture: GPS + photos -> draft
    VenueEditor.tsx        full editor (incl. activity radius)
    EventsList.tsx         all events (upcoming / live / drafts / past)
    EventEditor.tsx        create/edit an event (Nassau-time inputs, presets, flyers & videos)
    EventMediaManager.tsx  an event's flyers + short videos (event_media): upload, reorder, caption, delete
    ActivityAdmin.tsx      live counts, 24h visitors chart, per-venue table
    PhotoManager.tsx       gallery/menu photo upload (+ short videos in the gallery), reorder, caption, cover, delete
    MediaUpload.tsx        useMediaUploader + MediaProgress: batch photo/video upload with progress, shared by both
    video.ts               ffmpeg.wasm video optimiser (prepareVideo) and uploadMediaFile()
    favorites.tsx          useFavoriteCounts (venue_favorite_counts RPC) + FavoriteCount badge
    MenuEditor.tsx         menu items + paste-a-menu parser (parseMenuText)
    LocationField.tsx      map pin, GPS, paste Google Maps link (parseCoordinates)
    HoursEditor.tsx        7-day hours editor
    TagPicker.tsx          pick/add tags inline
    Inbox.tsx              community suggestions triage
    ReviewsModeration.tsx  hide/unhide/delete member reviews
    TagsManager.tsx        manage category/vibe/area vocabularies
    ThemeSettings.tsx      pick the public site theme
    RadioAdmin.tsx         /admin/radio: player switch, partner credit, stations (test stream / now playing, logo, order)
    UsersAdmin.tsx         member accounts: search, admin access, suspend, confirm, reset, delete
supabase/
  schema.sql               THE database definition (idempotent, re-runnable)
  seed_demo.sql            optional fictional venues ("demo-*"), events ("Demo ·") and 8 weeks
                           of crowd history + a live crowd
  functions/invite-member/ Edge Function (Deno): admin-only invites (generateLink + our own styled email)
docs/                      design notes for unbuilt/partly built features (bar crawl phases 2–3, day site, domains/SEO)
scripts/
  seed-google.ts           Google Places importer (Node, service-role key)
  sitemap.mjs              runs after `vite build`: dist/sitemap.xml + robots.txt from published venues/events
deploy/                    host nginx vhost, HTTPS installer, vm-setup.sh (no-clone installer)
Dockerfile, nginx.conf     container build + in-container SPA server
deploy.sh                  manual build/run script (same shape as Island GO's)
.github/workflows/deploy.yml  CI: build on GitHub -> GHCR -> self-hosted runner runs it
README.md, DEPLOY.md       human docs
```

## Routes

| Route | Page | Notes |
| --- | --- | --- |
| `/` | Explore | eager-loaded; everything else is `lazy()`. Any public URL takes `?theme=<id>` to preview a theme in that tab (`?theme=off` ends it), and `?radio=preview` to preview the radio player (`?radio=off` ends it) |
| `/map` | MapPage | `?focus=<venue id>` opens that venue's drawer, `?event=<event id>` an event's |
| `/v/:slug` | VenuePage | `?tab=menu\|food\|photos\|reviews` (the "menu" tab is labelled Drinks; Food shows only when there's a food menu) |
| `/events` | EventsPage | `?range=tonight\|week\|featured` selects the range chip |
| `/events/:id` | EventPage | also loads past events and (for admins) drafts |
| `/crawl` | CrawlPage | `?night=YYYY-MM-DD&from=&to=` (minutes after the night's midnight, past 1440 = next morning), `party`, `area`*, `vibe`*, `price`, `n` (stops), `mode=walk\|mix\|taxi`, `first=<venue id>`, `seed`, `pick=1` (hand-picked), `stops=<ids>` (reopens exactly these stops in this order; someone else's link opens as "shared with you"). "Start near me" is never in the URL |
| `/community` | Community | `?kind=new_spot\|update\|closed\|event\|other&venue=<id>&field=menu\|photos\|hours\|phone` pre-fills the form |
| `/account` | Account | `?mode=signup`, `?next=/path` (in-app paths only; validated by `safeNext`); `#activity` is the sharing switch |
| `/manage/*` | ManagerApp | `/manage` (My venues), `/manage/v/:id` (own venues only; `#menu` etc. scroll to a panel), `/manage/events`, `/manage/events/new?venue=`, `/manage/events/:id`. Signed out → `/account?next=/manage` |
| `/admin/*` | AdminApp | Editors get only `/admin`, `/admin/new`, `/admin/v/:id` (anything else redirects to `/admin`). Admins: `/admin`, `/admin/new`, `/admin/v/:id`, `/admin/events`, `/admin/events/new?venue=&notes=`, `/admin/events/:id`, `/admin/inbox`, `/admin/activity`, `/admin/reviews`, `/admin/users`, `/admin/tags`, `/admin/theme`, `/admin/radio` |
| `*` | → `/` | |

Public pages render inside `<Layout/>` (5 tabs: Explore, Map, Events, Community, Account). `/admin` does not; it has its own light shell. The admin console is reachable **only by URL**, except an "Admin console" button on `/account` for admins. `/manage` has its own light shell too, linked from a **Venue manager** card on `/account` for members who manage a venue.

Provider order in `App.tsx`: `BrowserRouter > ThemeProvider > AuthProvider > FavoritesProvider > DirectoryProvider > LocationProvider > ActivityProvider > FiltersProvider > Suspense > Routes`. `RadioProvider` wraps the public `<Layout/>` (not the admin), so a stream survives route changes; it stops when you leave for `/admin` or `/manage`.

## Data layer (client)

- **`DirectoryProvider`** loads **all published venues**, **published events that haven't ended**, all tags, and the `venue_ratings` view once, and filters client-side. It exposes `venueById` too. At Nassau scale (hundreds of rows) this keeps search instant.
  - The last response is cached in `localStorage` under `directory:v1`, so repeat visits paint immediately before the network returns.
  - It re-fetches on Supabase Realtime changes to `venues` and `events` (both in the `supabase_realtime` publication).
  - Events are optional: without the table the app works with none.
  - `refreshRatings()` re-fetches only the rating summaries. Call it after a review changes.
  - Ratings are optional: if the view doesn't exist (migration not run), the app still works.
- **`FavoritesProvider`** (`lib/favorites.tsx`) loads the signed-in member's `venue_favorites` ids (most recent first; RLS returns only their own) and toggles them optimistically (23505 = already saved, kept; any other error reverts). The same query run signed out tells it whether the table exists (`available`; hearts hide until the schema is re-run). A signed-out tap shows a fixed sign-in prompt and remembers the spot in `sessionStorage` `favorites:pending`, saved as soon as they sign in (cleared if they dismiss the prompt).
- **`LocationProvider`** starts a single `watchPosition` when something calls `enable()` (the map on mount, or "Near me"), or automatically if permission was already granted.
- **`ActivityProvider`** (`lib/activity.tsx`) is the live-activity client:
  - **Consent** in `localStorage` `activity:consent` (`on`/`off`; null = not asked). Nothing is sent before `on`. Turning it on calls the location `enable()`.
  - **Device id**: random UUID in `activity:device`, rotated when the Nassau "night" (date of now − 6 h) changes.
  - **Pings**: while visible, on New Providence (+ slack), every 2 min, or after ≥ 50 s if moved ≥ 75 m: `rpc('report_presence', …)`. The result is the venue this device is counted at (`here`).
  - **Reading**: `rpc('venue_activity')` on mount, every 60 s while visible, on tab focus, and (debounced) on Realtime changes to `venue_live`. Cached in `activity:v1` for at most 10 min (stale live data misleads).
  - `heatOf(id)` → `{ level: quiet|chill|lively|packed, label, color, score, vsUsual, usual }` via `heatFor()`: level = live ÷ max(peak_avg, 6); vs usual = live ÷ typical_now (>1.3 busier, <0.7 quieter). `isBusy(id)` = anyone there now. `buzzScore()` sorts "Buzzing".
  - `usePopularTimes(venueId)` reads `venue_typical` into a 7×24 grid.
- **`FiltersProvider`** holds `{ q, categories, vibes, areas, prices, openNow, busyNow }`, persisted in `sessionStorage` (`filters:v1`) and shared by Explore and Map. `matchesFilters` uses **OR within a group and AND across groups**. Search is accent-insensitive and needs every term to match name, description, area, address, categories or vibes. `busyNow` needs the activity predicate: `matchesFilters(r, f, now, isBusy)`.
- **`AuthProvider`** exposes `session`, `profile`, `isAdmin` (via the `is_admin()` RPC), `loading`, `recovering` (true after a password-reset link), `invited` (true after an invitation link, until a password is set; `supabase.ts` reads the link type and any `error_code` from the URL hash before the client clears it, as `authLinkType` / `authLinkError`), and `signIn` / `signUp` / `sendReset` / `updatePassword` / `updateName` / `signOut`. The admin console signs in through the same Supabase client, so one session covers both.
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
| `venue_photos` | gallery + menu photos, gallery videos | `kind 'gallery'\|'menu'\|'food_menu'` (`menu` = photos of the **drinks** menu, the original kind), **`media_type 'image'\|'video'`** (videos only in the gallery), `url`, `storage_path` (for deletes), `poster_url`/`poster_path` (videos), `duration_s`, `caption`, `sort` |
| `event_media` | an event's flyers + short videos | `event_id` (cascade), `media_type`, `url`, `storage_path`, `poster_url`/`poster_path`, `duration_s`, `caption ≤200`, `sort`. Trigger `event_media_sync` (security definer) keeps `events.image_url`/`image_path` = the first image by sort, else the first video's poster. Existing single flyers were copied in once by `schema.sql` |
| `menu_items` | structured menus | **`menu 'drinks'\|'food'`** (added later; existing items were sorted once by food-sounding section names), `section`, `name`, `description`, `price numeric(10,2)`, `sort`, `photo_url`/`photo_path` (one optional photo, `<venue_id>/items/…`), **`like_count`** (kept by a security-definer trigger on `menu_item_likes`; re-running the schema recounts) |
| `venue_managers` | who manages which venue | `(venue_id, user_id)` PK (a member can manage several venues, a venue can have several managers), `created_by`, `created_at`. Cascades with the venue and the auth user |
| `editors` | who may edit spots in the admin console | `user_id` PK → `auth.users` (cascade), `created_by`, `created_at`. `is_editor()` (security definer) = listed **and** not suspended. Granted/removed with `admin_set_editor()` |
| `venue_favorites` | members' favourite spots | `(venue_id, user_id)` PK, `user_id` default `auth.uid()` → `profiles`, `created_at`. Cascades with the venue and the member. Totals only via `venue_favorite_counts()` |
| `menu_item_likes` | likes on menu items | `(item_id, user_id)` PK (one like per member per item), `user_id` default `auth.uid()` → `profiles`, `created_at`. Cascades with the item and the member |
| `tags` | filter vocabularies | `kind 'category'\|'vibe'\|'area'`, `label`, `sort`; unique `(kind,label)`; seeded with starter values |
| `submissions` | community suggestions | `kind 'new_spot'\|'update'\|'closed'\|'event'\|'other'`, `venue_id`, `venue_name`, `fields text[]`, `message`, `contact_name`, `contact_email`, `credit_ok`, `photo_paths text[]` (≤6), `status 'new'\|'reviewing'\|'done'\|'dismissed'`, `admin_note` (private), `resolved_at` (trigger-set), `user_id` (default `auth.uid()`, null for anonymous) |
| `profiles` | public member profile | `id` → `auth.users`, `display_name` (1–40 chars). Created by the `on_auth_user_created` trigger from sign-up metadata `display_name`. Existing users are backfilled |
| `site_settings` | one row (`id = true`) of site-wide settings | `theme` (theme id, default `'neon'`; format-checked only, so new themes need no migration), **`radio_enabled`** (default false), `radio_partner` (≤ 80, "Presented by"), `radio_partner_url`, `updated_at`. In the Realtime publication |
| `radio_stations` | the partner's radio stations | `slug` (unique, stable: analytics + "last station"), `name`, `frequency`, `tagline` (genre line), `stream_url` / `backup_url` / `meta_url` (**https only**, checked), `website`, `logo_url`/`logo_path` (`venue-media` `radio/<id>/…`), `color` (`#rrggbb`), `sort`, `is_enabled`. Seeded with 100 Jamz, Joy FM, Kiss FM and Y98 FM (no stream URLs) |
| `events` | highlighted nights | `title`, `description`, `venue_id` (nullable, `on delete set null`), own `lat`/`lng`/`address` (else the venue's pin is used), `start_date`, `end_date` (check end ≥ start; **null = repeats until further notice**), `hours jsonb` (weekly windows; set = a weekly event), `image_url`/`image_path` (**derived** from `event_media`, see below; don't write them from the app), `price_note ≤80`, `ticket_url`, `is_published`, `is_featured`, timestamps. In Realtime |
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
| `venues`, `venue_photos`, `menu_items` | published rows (or the photos/items of published rows) for anyone; everything for admins and **editors**; their own venues (drafts too) for managers | admins; **editors** insert and update any venue (not delete; featured is kept by the guard trigger) and fully manage all photos and menu items; **managers** update their venues (not insert/delete a venue) and fully manage their photos and menu items |
| `editors` | own row (+ admins) | admins only (via `admin_set_editor()`) |
| `venue_managers` | own rows (+ admins) | admins only |
| `tags` | everyone | admins |
| `site_settings` | everyone | admins update (no insert/delete; the row is seeded) |
| `radio_stations` | enabled stations **with a stream URL** for anyone; all for admins | admins |
| `submissions` | admins | **anyone can insert**, but only as `status='new'` with no `admin_note`/`resolved_at` and `user_id` null or self; admins update/delete |
| `profiles` | everyone (only `display_name` exists) | the owner updates their own (not while suspended); admins update any |
| `events` | published for anyone; everything for admins; managers also see their venues' drafts | admins; managers insert/update/delete events whose `venue_id` is one of their venues (they can't move one elsewhere or create one without a venue) |
| `event_media` | media of published events for anyone; all for admins; managers their venues' events (drafts too) | admins; managers of the event's venue |
| `presence` | nobody | only `report_presence()` / housekeeping (security definer) |
| `venue_live`, `venue_typical`, `venue_stats` | everyone (aggregates only) | only the activity functions |
| `venue_hourly` | admins | only the activity functions |
| `venue_favorites` | own rows only (+ admins); totals for admins (all spots) and managers (their spots) via `venue_favorite_counts()` | members insert their own on **published** spots (not while suspended) and delete their own; admins delete |
| `menu_item_likes` | own rows only (+ admins); the public sees `menu_items.like_count` | members insert their own on items of **published** spots (not while suspended) and delete their own; admins delete |
| `reviews` | non-hidden for everyone; own (even hidden) for the author; all for admins | members insert their own on **published** spots (not while suspended); authors (not while suspended) and admins update; authors and admins delete |

Only admins may change `reviews.is_hidden`. The `reviews_guard` trigger forces `false` on member inserts and raises an error if a non-admin changes it.

### Views and RPCs

- `venue_ratings` view (`security_invoker = on`) returns `venue_id, rating_avg, rating_count` over **non-hidden** reviews.
- `recent_contributions(p_limit)` (security definer) is the public "community wins" feed: first name only, opted-in (`credit_ok`), `status='done'`.
- `contribution_count()` returns the number of applied suggestions.
- `my_submissions()` returns the signed-in member's own suggestions **without `admin_note`**. Execute is revoked from `public` and `anon`.
- `is_admin()`; `is_suspended()` (the caller's `auth.users.banned_until` is in the future; used by the review/profile write policies, because an already-issued access token outlives a ban by up to an hour)
- **Member admin** (security definer, each checks `is_admin()`; execute revoked from `public`/`anon`):
  - `admin_list_users(p_search, p_filter all|admins|suspended|unconfirmed, p_limit ≤200, p_offset)` → `auth.users` + profile name, admin flag, review/hidden/suggestion counts, `total_count`. The only place emails are returned.
  - `admin_set_admin(p_user, p_admin)`: can't demote yourself (so an admin always remains) or promote a suspended account.
  - `admin_suspend_user(p_user, p_until)`: sets `banned_until` (capped at 100 years, never `infinity`, which Auth can't parse) and deletes their `auth.sessions`; null lifts it. Not yourself, not an admin.
  - `admin_confirm_user(p_user)`: sets `email_confirmed_at` when the confirmation email never arrived.
  - `admin_delete_user(p_user)`: clears their `storage.objects` ownership (Auth refuses to delete users who own objects; the suggestion photos stay), then deletes from `auth.users`. Profile and reviews cascade; suggestions stay, unlinked. Not yourself, not an admin.
  - `admin_list_users` also returns `invited_at` and takes `p_filter = 'invited'` (invited, not yet accepted). Its result columns changed once, so `schema.sql` drops it before creating it.
- **Editors:** `is_editor()` (granted to anon/authenticated; the app calls it to decide console access) and `admin_set_editor(p_user, p_editor)` (admins only; can't make a suspended account an editor). `admin_list_users` returns `is_editor` and takes `p_filter = 'editors'`.
- **Favourites:** `venue_favorite_counts()` (security definer) → `venue_id, favorites`: every spot for admins, the caller's managed spots for managers, nothing for others. Execute revoked from `public`/`anon`. Never returns who favourited.
- **Venue managers:** `is_venue_manager(p_venue)`, `can_manage_media(p_name)` (storage policies), `is_restricted_writer()` (an `anon`/`authenticated` caller who isn't an admin; the guard triggers use it, so security-definer functions, the service role and the SQL editor pass), and `admin_venue_managers(p_venue)` → `user_id, email, display_name, created_at` (admins only). `admin_list_users` also returns `venue_count` and takes `p_filter = 'managers'`.
- **Edge Function `invite-member`** (`supabase/functions/invite-member/index.ts`, deployed by the owner; "Verify JWT" on). Body `{ email, display_name?, make_admin?, redirect_to? }`. It checks `is_admin()` **with the caller's token**, then uses the service-role key (only ever inside the function) for `auth.admin.generateLink({ type: 'invite' })`: that creates the account and the one-time accept link **without Supabase sending anything**. Supabase's own invite email isn't used because the free plan can't edit templates (and its mailer only reaches the project team). User metadata: `display_name` (→ the profile via `handle_new_user`) and `invited_by` (the inviter's display name). `make_admin` also inserts into `admins`. If secrets `RESEND_API_KEY` + `INVITE_FROM` are set it emails our styled invitation (`inviteEmail()` in the same file: inline styles + tables, HTML-escaped names, plain-text part) via the Resend API → `{ user_id, emailed: true }`; otherwise, or if sending fails, `{ user_id, emailed: false, link, warning? }` and the admin shares the link. 403 non-admin, 400 bad email, 409 already registered; re-inviting someone who hasn't accepted makes a fresh link.
- **Activity** (all security definer):
  - `report_presence(p_device uuid, p_lat, p_lng, p_accuracy)` → venue id or null. Granted to anon/authenticated. Rate-limited to one ping per device per 45 s. Accuracy ≤ 100 m: nearest published venue whose `radius_m` (+ ≤ 30 m GPS slack) contains the fix (bounding-box prefilter). Accuracy > 100 m: keeps the device at its current venue if the fix still covers it, else changes nothing. Not at a venue → the device's row is deleted. A visit counts after **DWELL = 4 min**; it stops counting **STALE = 15 min** after the last ping; each counted visit adds 1 visitor per hour (and 1 arrival per visit) to `venue_hourly`. Runs `activity_housekeeping()` on ~2% of pings.
  - `venue_activity()` → `venue_id, live_count, typical_now, peak_avg, visits_30d` for published venues with any activity. Lazily rebuilds averages (`activity_refresh_stats()`) at most hourly under an advisory lock. Live counts under 2 are reported as 0.
  - Internal, execute revoked from API roles: `activity_live_count`, `activity_refresh_live`, `activity_housekeeping`, `activity_refresh_stats`. `haversine_m()` helper.
  - Optional `pg_cron` job (end of `schema.sql`) runs housekeeping every minute so `venue_live` decays even with nobody pinging.
  - The DWELL / STALE / floor values are repeated in several functions and mirrored in the client copy (`ActivityConsent.tsx`, `ActivityAdmin.tsx`). Change them together.

### Storage buckets

- `venue-media` is **public read**; admins (and managers, for their venues/events; editors, for any `<venue_id>/…` path but not `events/…` or `radio/…`) can write. **25 MB per file**; images plus `video/mp4`, `video/webm`, `video/quicktime`. Paths are `<venue_id>/<gallery|menu>/<timestamp>-<rand>.<ext>` (event flyers and videos: `events/<event_id>/…`; a video's poster sits next to it as a `.jpg`), uploaded with a 1-year cache. A unique path per upload means replacing an image changes its URL. Deleting a video row must delete both `storage_path` and `poster_path`.
- `submission-uploads` is **private**. Anyone may upload into `inbox/` (8 MB max, images only); only admins can read (the admin Inbox uses signed URLs) or delete.

### Hours format

`hours` is `{ "0": {"open":"11:00","close":"22:00"}, … }`, keyed by weekday with `"0"` = Sunday. A missing day means closed. A `close` earlier than `open` means the hours run past midnight, and `00:00–23:59` means open 24 hours. All logic in `src/lib/hours.ts` uses **America/Nassau** time regardless of the visitor's timezone. Events use the same format for optional weekly windows; the admin enters event start/end as Nassau wall-clock time (`toNassauInput` / `fromNassauInput` in `EventEditor.tsx`).

## Features (what each part does)

### Explore (`/`)
- **Hero:** a `.neon-board` panel. A time-of-night greeting (Nassau time) with a matching one-tap suggestion (beach bars / waterfront / happy hour / dancing on Fri–Sat / live bands / open late; shown only if that tag exists). Headline "Nassau after dark." in flickering neon. Search + filters, quick buttons (Buzzing now, Open now, Near me, Events, Plan a crawl), live stats that are also shortcuts (spots → all spots, open now / buzzing → that filter via `apply()`, events tonight → `/events?range=tonight`), and a "Help light up the map" opt-in when location isn't on yet. On desktop: the **live board**, which shows the busiest venues now, else tonight's events, else the scene's venue types.
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
- **Drinks** and **Food** (separate menus, `MenuSections`): items by section with leader lines and BSD prices, an item photo (tap → lightbox through that menu's item photos), a **heart** with the like count (optimistic; signed-out taps show a sign-in prompt with `next=`), and a **Fan favourite** badge on the most-liked items (≥ 3 likes, at most a third of the menu and 3), plus that menu's photos. **Photos**, **Reviews** as in Nassau Eats.
- The overview links to each menu that has content.

### Events (`/events`, `/events/:id`)
- List grouped Live / Tonight / This week / Coming up, with range chips (Everything, Tonight, Next 7 days, Featured). Live cards get `.neon-edge` and a LIVE tag.
- **Recurring nights** (`isRecurring`: weekly hours and a run longer than a day, or no end) are labelled "Every Fri · 10 PM", "Tonight · 10 PM · every Fri" or "… · until Nov 20". Sorting, "tonight" and "this week" use the **next session** (`nextSession` / `eventNextStart`), never `start_date`, which for a long-running weekly night is months old. The directory loads events with `end_date` null or in the future.
- Detail: flyer hero (cropped banner, `image_url`), then the **flyers & videos** from `event_media` above About: the selected one large (a flyer uncropped, `max-h-[80vh]`, tap → `Lightbox`; a video inline with `preload="none"` and its poster), with a thumbnail strip when there are several (all open in the Lightbox, videos play there). Falls back to `image_url` when there are no rows (or the table is missing); images that fail to load are dropped, when (Nassau time; weekly schedule when set, recurring ones as "Every Friday" with since/until and only the nights it runs), price, tickets link, host venue card with its live level, directions, mini map, "On map" (`/map?event=`).

### Bar crawl planner (`/crawl`, `lib/crawl.ts`)
Phase 1 of [docs/bar-crawl.md](docs/bar-crawl.md) (read it before extending this; phases 2–3 are designed there):
- Plans 2–6 stops in the browser from directory data: open while they're there (`openState` at arrival/leave), rating, own favourites, vibes, **usual crowd at that hour** (`venue_typical`, fetched for the night's two weekdays, paged), events on then (`isEventLive`), party size ("Group Friendly" vibe, roomy types; 8+ get "call ahead"), and an energy curve (bar → lounge → club). Beam search orders them; stays shrink (60/45 min) or stops drop when spots close early, with a note.
- **Travel is estimated** (straight line × 1.35; walk 80 m/min; taxi 6 min + 400 m/min; walk ≤ 15 min in Walk + taxi, ≤ 22 min in Walk; taxi legs ≤ 22 min). **No drive mode** on purpose. Map lines are straight. Google Maps does turn-by-turn.
- **Pick my own spots** tab: search and add up to 8 spots (favourites offered as quick adds), reorder, **Optimise order** (`bestOrder`: keeps the first stop, tries every order of the rest for the least travel), **Build my route** (`planCustom`: times the route in exactly that order; closed-then spots and long walks/rides are flagged, not dropped). An auto plan's **Edit these stops** moves it into this tab.
- The request and chosen stop ids live in the URL (share = copy the link); GPS ("Start near me") is never put in it, so a recipient is never asked for their location. Swap one stop, or "Try another route" (seeded shuffle that retries until the stops change).
- **Shared links** always reopen exactly the shared stops (`planCustom`, times recomputed; spots no longer listed are dropped with a note). Opened by someone else (the planning tab keeps `sessionStorage` `crawl:mine`), the page shows just the plan, Directions and Share, with **Create your own crawl** at the bottom, which opens the planner.
- Entry points: Explore hero "Plan a crawl", venue page "Plan a bar crawl starting here" (`?first=`). Listed in the sitemap.

### Live activity sharing (`components/ActivityConsent.tsx`)
- `ActivityConsentCard` asks once, when location is on and consent is unset (not on `/account`). Nothing is sent until "Count me in".
- `ActivitySharingToggle` on `/account` (signed in or out) with the privacy explanation.
- `HereBanner` thanks the visitor while they're counted at a venue (hidden on `/map`).
- The privacy copy states the rules (venue only, nightly ID, ≥ 2 people). Keep it true if the SQL changes.

### Live radio (`lib/radio.tsx`, `components/Radio.tsx`, `admin/RadioAdmin.tsx`)
- **Opt-in only:** nothing is created, buffered or fetched until a visitor taps a station (`preload="none"`, a fresh `Audio` per play). "Pause" is a **stop** (detach the source): a paused live stream keeps downloading and resumes behind live. One stream at a time.
- **Entry points:** a "Live radio" pill in the Explore hero and in the desktop header (`RadioButton`, hidden unless `radio_enabled` and a station has a stream). It opens `RadioSheet`: a 2×2 grid of station tiles (logo or initials, frequency, now playing or genre line, state), "Presented by" the partner. Starting a station closes the sheet; the last station is remembered (`localStorage` `radio:last`).
- **Mini-player** (`RadioDock`): above the phone tab bar / bottom-right on desktop (with a volume slider; phones use hardware volume), LIVE dot, now playing, stop/play, close; tapping it reopens the picker. On `/map` it shrinks to a pill (bottom-left on phones, bottom-centre on desktop) so it doesn't cover the map controls. While docked it sets the CSS variable **`--radio-dock`** on `<html>`; other bottom-floating UI (`HereBanner`, `ActivityConsentCard`, the theme preview pill, `main`'s bottom padding) adds it to its `bottom`. New floating UI must do the same.
- **Failures:** the main stream fails → `backup_url` once → "Off air right now · tap play to retry". A live stream `ended` counts as a failure.
- **Formats:** MP3/AAC (Icecast/Shoutcast) attach synchronously so `play()` stays inside the tap (iOS). HLS (`.m3u8`) plays natively in Safari, elsewhere via the lazy hls.js light chunk. Streams must be **HTTPS** (DB check; mixed content won't play).
- **Now playing** (`parseNowPlaying`): Icecast `status-json.xsl`, Shoutcast v2 JSON / v1 XML, AzuraCast, Radio.co, play-history XML (`<song><title><artist>`, e.g. 100 Jamz's securenetsystems feed), generic `title`/`artist`, or plain text; ALL CAPS is title-cased. Polled every 30 s for all stations while the picker is open, every 20 s for the current station while it plays, never while stopped or the tab is hidden. A host that blocks cross-origin requests simply shows the genre line (fix: ask the host to allow it, or proxy it through nginx).
- **Lock screen / headset:** Media Session metadata (track, station · frequency, logo) and play/pause/stop; next/previous track switches station.
- **Analytics (GA4):** `radio_play` `{station, station_name}` and `radio_listen` `{station, minutes: 5}` every 5 minutes of playing. Register `station` as a custom dimension in GA4 to report per station.
- **Preview:** `?radio=preview` (Admin → Radio → **Preview on the site**, `initRadioPreview()` in `main.tsx`, `sessionStorage` `radio:preview`) shows the player in that tab even while it's off, with every enabled station the viewer can read: all of them for admins (RLS), so stations without a stream appear, marked "Preview · no stream yet". A "Previewing the radio player ×" pill ends it. Previews never write the `radio:v1` cache or send GA events. Visitors trying the URL only see ready stations.
- **Admin** (`/admin/radio`, admins only): master switch (saves at once) + partner name/link; station list with status (Ready / Needs stream URL / Off), reorder, and a form per station with **Test** (plays the stream in the console), **Check** (reads now playing), logo upload (512 px, `radio/<id>/`), brand colour, Enabled, delete.
- The station's brand colour appears only on its logo frame and its tile's selected edge; everything else follows the site theme.

### Favourites (`lib/favorites.tsx`, `components/FavoriteButton.tsx`)
- A heart on every spot card (`VenueCard` photo corner, `VenueRow` right edge; a sibling of the card's link, never inside it), beside Share on the venue page hero (published spots only), and a **Save** tile in the map drawer.
- `/account` → **My favourites** (above My reviews): `VenueRow`s, most recently saved first; spots since unpublished or deleted drop out (they're not in the directory). Un-hearting removes one.
- Admins see **♥ n** on each Spots row and "n favourites" in the spot editor header; managers see the count on their venue cards and in the editor (`useFavoriteCounts`). Who favourited is never shown.

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
- Arriving from an **invitation** link: "Welcome to Nassau Nights", with name (pre-filled from the invite) + password, then the signed-in view. An expired or used email link shows a notice above the sign-in form.
- Signed in: avatar initial, editable display name, email (shown privately), Admin console link (admins), Sign out, **My favourites**, **My reviews**, and **My suggestions** with status (Received / In progress / Applied / Not applied).

### Venue manager (`/manage`)
- An admin assigns members to venues (spot editor → **Managers**: search members, add/remove; or Members → a member → **Venues they manage**). A member can manage several venues.
- Members with at least one venue get a **Venue manager** card on `/account` (their venues + "Open venue manager").
- `/manage` (light, phone-first, bottom tabs My venues / Events / Account): venue cards (Live/Draft, rating, live level, upcoming events; Edit details, Menus, New event, View page), then the **same editors as the admin** under `ConsoleProvider` with `role: 'manager'`: `VenueEditor` without the activity radius, Visibility controls (a read-only note instead), slug, delete or Managers panel; `TagPicker` without "New"; `EventEditor` limited to their venues (no "not at a listed spot", no Featured); `EventsList` filtered to their venues. `PhotoManager` / `MenuEditor` work unchanged.
- Enforced in the database, not just the UI: `is_venue_manager(venue)` (assigned **and** not suspended) in extra policies on venues/photos/menu items/events and the `venue-media` bucket (`can_manage_media(name)`: `<venue_id>/…` or `events/<event_id>/…`). Guard triggers (`venues_manager_guard`, `events_manager_guard`, `menu_items_like_guard`) silently keep admin-only columns for API callers who aren't admins: `is_published`, `is_featured`, `featured_until`, `slug`, `radius_m`, `google_place_id` (editors may change `is_published`, `slug` and `radius_m`), events' `is_featured`, and `like_count` for everyone. Reviews and likes keep their own policies, so managers can't touch them.

### Editors (`/admin` with role `editor`)
- An admin makes a member an editor under **Members** (Make editor / Remove editor; an **Editor** badge and filter). Admins don't need it.
- The console checks `is_admin()` then `is_editor()`. Editors get `EDITOR_SCOPE` (`role: 'editor'`), a header reading "Editor", and only **Spots** and **Quick add** (desktop nav and phone bar); every other admin route redirects to `/admin`. The Inbox count isn't loaded for them.
- In `VenueEditor` they get everything except **Featured**, **Delete**, **Managers** and the **Events here** panel: details, photos/videos, menus, hours, location + activity radius, tags (existing ones; `TagPicker` hides "New" for non-admins), **Published** and the slug. Favourite counts aren't shown (the RPC gives editors none).
- Enforced in the database: `is_editor()` policies on venues (select/insert/update), `venue_photos`, `menu_items` and spot paths in `venue-media`; `venues_manager_guard` (now `before insert or update`) forces `is_featured`/`featured_until`/`google_place_id` for any non-admin API caller and, for non-editors (managers), also keeps `is_published`/`slug`/`radius_m`. No delete policy, so they can't remove spots. `/account` shows them an **Edit spots** button.

### Admin console (`/admin`)
- **Login gate:** Supabase email + password. Accounts that are neither admin nor editor see SQL to grant the first admin. The console is phone-first and light (`colorScheme: light`): a 5-tab bottom bar (Spots, Events, Quick add, Inbox, Activity); Reviews / Members / Tags / Theme are icons in the phone header.
- **Events:** list (Upcoming / Live now / Drafts / Past, with "No pin" and "Weekly" flags) and editor: title, description, price note, ticket link; **One-off** (start/end in **Nassau time** with presets: Tonight 10 PM–2 AM, Fri/Sat 10 PM–3 AM, Sun 4–9 PM) or **Every week** (night chips + one time window, or different times per night via `HoursEditor`; weekly presets; first night; **No end date** on by default, else a last night). A weekly run is stored as `start_date` = 6 AM on the first night and `end_date` = 6 AM after the last night (null with no end), so overnight sessions count and the night before doesn't; host venue (drafts included) and/or its own location; **Flyers & videos** (`EventMediaManager`, after the first save, to `events/<id>/`: several flyers and short videos, reorder, caption; the first flyer is "Main"); Published / Featured; delete removes every media file. The venue editor links to "New event" with the venue preset, and an Inbox "Event tip" becomes **Create event** (`?venue=&notes=`).
- **Activity:** phones counted now, venues buzzing, 30-day visits, a 24-hour visitors-per-hour chart (`venue_hourly`), and a per-venue table (level, live, usual now, 30-day visits, radius).
- **Spots:** search; All / Live / Drafts / Needs info views. "Gap" badges show a missing pin, hours, photos or menu.
- **Quick add**, built for the field:
  - It grabs GPS immediately.
  - Fill in name, area, category, price, phone and notes.
  - "The place", "Drinks menu" and "Food menu" camera buttons (`capture="environment"`) plus a library picker; tap a queued photo's tag to cycle gallery → drinks menu → food menu.
  - If GPS isn't available, the location comes from the photo's EXIF data.
  - **Save draft** inserts the venue (unpublished), uploads the photos, sets the first gallery photo as the cover, and opens the editor.
  - `?name=&notes=&from=<submissionId>` pre-fills it from an Inbox suggestion and marks that suggestion "reviewing".
- **Editor:** sections for Basics, Photos, Drinks & food menus, Location (with the **activity radius** slider, 15–300 m), Hours, Events here, Contact and Visibility.
  - A sticky save bar shows unsaved changes, with a `beforeunload` warning.
  - Publishing saves everything; publishing without a pin asks for confirmation.
  - Featured has an optional end date. The slug is editable, and an empty slug is regenerated.
  - Delete also removes the spot's storage files.
- **PhotoManager:** camera or library upload with progress, reorder (left/right), inline caption, set as cover, delete (also deletes the storage object). It auto-sets the cover for the first photo and reports EXIF GPS to the editor. The **gallery** also takes **short videos** ("Add a short video", and the library picker): see "Videos" below. A video's "use as cover" sets its poster; the cover is always an image.
- **MenuEditor** (`menu` prop; the editor's "Drinks & food menus" panel switches between the two, each with its own menu photos): add or edit items one at a time, or **Paste a menu**. Each item has a photo square (tap to add/replace, × to remove; old files are deleted), its like count, and a ⇄ button to move it to the other menu. Deleting an item deletes its photo; deleting a spot deletes item photos too. `parseMenuText` treats each line as an item with a trailing price (`Conch Fritters - 12`, `$12`, `12.50`). `Name | price | description` adds a description. A line ending in `:`, or a short ALL-CAPS line with no digits, starts a section.
- **LocationField:** tap the map or drag the pin, "I'm here — use my GPS", or paste a Google Maps URL or `lat, lng`. `parseCoordinates` handles `!3d…!4d…`, `@lat,lng` and plain pairs; short `maps.app.goo.gl` links can't be expanded in the browser.
- **Inbox:** tabs New / In progress / Done / Dismissed.
  - Signed URLs for photos, plus **one-tap "add to gallery / drinks menu / food menu"**, which downloads the photo from the private bucket and re-uploads it to the media bucket.
  - "Create draft" for new-spot suggestions, "Create event" for event tips, and a private note per suggestion.
  - Marking a suggestion Done credits the sender's first name publicly if they opted in.
- **Reviews:** Latest / 1–2 stars / Hidden. Hide (stops it counting; the author still sees it) or Delete.
- **Members** (`/admin/users`, a header icon on phones): **Invite** (email, optional name, "Make them an admin too"; calls `invite-member` and says so if the function isn't deployed). When no email went out, a share box shows the link with Copy / WhatsApp / Email app (`mailto:`) / Share…, server-side search by name/email/id, All / Admins / Managers / Suspended / Invited / Unconfirmed, 50 at a time. A **Manager · n** badge and, expanded, **Venues they manage** (add/remove). Pending invites show an **Invited** badge and **Resend invite**. Expanding a member shows joined / last sign-in / confirmation, rename (display name), Make/Remove admin, Confirm email, **Send password reset** (`resetPasswordForEmail`, back to `/account`), Suspend for 1 / 7 / 30 days or indefinitely (signs them out; they can't sign in, review or rename), Lift suspension, Delete account, plus their reviews (hide/unhide) and suggestions. Your own row has no account actions; admins must be demoted before they can be suspended or deleted. Setting someone's password isn't offered (needs the service-role key; send a reset instead).
- **Tags:** add, reorder and remove the category / vibe / area options, with usage counts. Removing a tag doesn't strip it from existing spots.
- **Theme:** cards for each site theme with a mini preview, **Preview** (opens `/?theme=<id>` in a new tab) and **Make live**, which updates `site_settings.theme` for every visitor.
- Admin UI uses `useFeedback()` toasts and confirms. **Never use `window.alert` / `window.confirm`.**

### Images (`lib/images.ts`)
`compressImage` downscales to 1800 px (1600 px for community uploads) and re-encodes as WebP, falling back to JPEG when the browser silently returns PNG for WebP (older Safari). Re-encoding **strips EXIF**, so call `readPhotoGps(file)` **before** compressing. Formats the browser can't decode (e.g. HEIC on Chrome) are uploaded as the original file. Always render user-supplied image URLs with `<SafeImg>` (or `<EventArt>` for flyers), which fall back to the neon placeholder on error.

### Videos (`admin/video.ts`)
Gallery and event videos are optimised in the uploader's browser with **ffmpeg.wasm** (`@ffmpeg/ffmpeg` + the single-thread `@ffmpeg/core`, loaded via `?url` imports only when a video is picked; never in visitor chunks; no COOP/COEP needed). `prepareVideo(file)`:
- rejects inputs over 400 MB; keeps the **first 30 s** (`VIDEO_MAX_SECONDS`; longer clips are cut, and the toast says so);
- reads the streams first. Small web-ready clips (H.264 yuv420p, AAC or no audio, ≤ 30 fps, ≤ 1920 px, ≤ 12 MB: typical WhatsApp/Instagram exports) are only **remuxed** (`-c copy`, instant);
- otherwise re-encodes to **H.264 CRF 28 `veryfast`, long side ≤ 1280 px (even dims), ≤ 30 fps (`fps=30` before the bilinear scale), AAC 96k, `+faststart`**; over 25 MB → one retry at 960 px / CRF 33, then an error. Rotation metadata (portrait phone clips) is applied;
- grabs a JPEG **poster** frame at ~1 s. Progress comes from parsing `time=` in ffmpeg's log; the worker is `terminate()`d after each clip;
- if ffmpeg can't run, a playable MP4/WebM already within 30 s / 25 MB is uploaded as is (poster from a `<video>` + canvas), else a `VideoError` explains.
Timing reference (headless Chromium, one core): 40 s 1080p60 → 2 MB 720p30 in ~95 s; 8 s HEVC `.mov` ~27 s; a 20 s WhatsApp clip ~1 s. Phones are slower, hence "keep this page open" and a `beforeunload` guard. Vite: `optimizeDeps.exclude` the ffmpeg packages and `worker.format: 'es'`; nginx gzips `application/wasm`.
Public pages show videos as their poster with a play badge (`MediaStill`) and only load the file on play (`preload="none"`/`"metadata"`) to spare Supabase egress. Rows read before the migration have no `media_type`: `isVideo()` treats that as an image.

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
| `RESEND_API_KEY`, `INVITE_FROM` | Supabase **Edge Functions → Secrets** (not the repo) | optional; let `invite-member` email invitations itself. Without them admins share the invite link |
| `SITE_URL` | GitHub **variable** (Docker build arg) / env | domain for `sitemap.xml` / `robots.txt`, default `https://nassaunights.com` (set it to the Search Console property) |
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
- **Container:** `Dockerfile` is a two-stage build (`node:22-alpine` → `nginx:1.27-alpine`). `npm ci` falls back to `npm install` because the lockfile is generated on Windows and lacks Linux optional binaries. `nginx.conf` provides per-route canonical HTML and the SPA fallback to `spa.html`, immutable `/assets/` caching, and `no-cache` for `index.html` and `sw.js`.
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
- **Second domain:** the vhost's `server_name` also lists `nassaunights.com` and `www.nassaunights.com` (the container redirects www to https://nassaunights.com, preserving path and query). That zone must be proxied by Cloudflare in **Full** (not strict) mode, because the origin reuses Island GO's certificate. SEO uses the official https://nassaunights.com origin; auth email links still use `window.location.origin`. See `docs/domains-and-seo.md`.
- **Manual deploy:** `./deploy.sh build|deploy|update|logs|stop|status`. It reads `.env`, then `.env.local`.
- **Analytics / SEO:** GA4 (`G-FWM1NM6DRJ`) is a plain gtag snippet in `index.html`; SPA route changes are counted by GA4 enhanced measurement (history events), so there is no router hook. `scripts/sitemap.mjs` builds the sitemap at build time with the anon key (RLS = published only) and never fails the build (no Supabase → fixed pages only). nginx serves `/sitemap.xml` and `/robots.txt` as files with a 1-hour cache.

## Supabase dashboard settings the app depends on

- **Authentication → Sign In / Providers:** allow new sign-ups (required for member accounts). The provider is email + password.
- **Authentication → URL Configuration:** Site URL is the primary domain; redirect URLs must list every domain the site is served on (`https://nassaunights.com/**`, `https://www.nassaunights.com/**`, `https://nassaunights.limniatis.com/**`) plus `http://localhost:3000/**`, or auth emails fall back to the Site URL.
- **Authentication → Emails → SMTP:** the built-in mailer is heavily rate-limited and only delivers to the project's team members, so configure custom SMTP before launch or sign-up confirmation and password-reset emails will stall. (Invitations don't depend on it; see below.)
- **Edge Functions:** deploy `invite-member`, plus optional secrets `RESEND_API_KEY` / `INVITE_FROM` for automatic invitation emails (see DEPLOY.md, "Member invitations").
- **Admins:** `insert into public.admins (user_id) select id from auth.users where email = '…';`

## Conventions and gotchas

- **`useEffect` must not return a value.** `useEffect(() => window.scrollTo(0,0), …)` crashed the whole app on load (React treats the return value as a cleanup function). Always use a block body: `useEffect(() => { doThing(); }, [...])`.
- **Nothing may be wider than a phone screen**, or mobile browsers widen the page and let you zoom out of the UI. Give every `grid` a column template at the base size (`grid grid-cols-1 sm:grid-cols-2`, never a bare `grid`): an implicit grid column grows to its widest item's untruncated text, so `truncate` stops working. Chip/tab rows that scroll need `max-w-full overflow-x-auto`. Long unbroken text (links, emails) wraps via `overflow-wrap: break-word` on `body`; inside flex rows add `min-w-0` + `truncate`. Check a change by comparing `document.documentElement.scrollWidth` with `clientWidth` at 375 px (Playwright `isMobile: true` allows widths under 500).
- **lucide-react 1.x has no brand icons.** Importing `Instagram` or `Facebook` fails the type-check.
- **Line endings:** the repo is edited on Windows. `.gitattributes` forces LF for `*.sh`, `*.conf`, `*.yml` and `Dockerfile`, because a CRLF `deploy.sh` breaks on Linux. Keep new server-side files covered.
- **Lockfile:** generated on Windows. Don't "fix" Linux `npm ci` failures by editing the lock; the Dockerfile already falls back.
- **Colour classes:** use `night` / `brand` / `glow` / `heat-*` (plus `emerald` for open and `amber` for featured), not new hex colours, except as one-off gradient stops and the per-category pin colours in `markers.ts`.
- **Images:** user or remote images go through `<SafeImg>`. Uploads go through `uploadMedia` / `uploadSubmissionPhoto` (compressed, unique paths). Delete storage objects when deleting rows (`storage_path`).
- **Sharing a page:** use `shareLink()` / `canNativeShare()` (`lib/share.ts`), never `navigator.share` directly: the native share sheet is for touch devices only; on computers it copies the link (the crawl page shows the link in a box with Copy link).
- **Admin feedback:** `useFeedback().toast/confirm`, never browser dialogs.
- **Bundle split:** the admin code and Leaflet pages are `lazy()`. Don't import `src/admin/*` from public pages. Vendor chunks (react, supabase, leaflet, motion) are split in `vite.config.ts`.
- **Security:** keep all authorization in RLS and security-definer RPCs. Never trust the client for `is_hidden`, `status`, `admin_note`, or `user_id`. Public RPCs must never expose emails or `admin_note`.
- **Shared editors:** anything under `src/admin/` that `/manage` also renders (VenueEditor, EventEditor, EventsList, TagPicker, PhotoManager, MenuEditor…) must build links from `useConsole().base` and hide admin-only controls when `role === 'manager'` (and featured/delete/managers/events when `role === 'editor'`). A new admin-only column needs adding to the guard trigger too.
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
- **Radio:** the seeded stations have no stream URLs. The stations' public web players use session-tokened stream addresses (e.g. 100 Jamz's securenetsystems URL returns 403 without one), so the broadcaster must supply direct HTTPS stream URLs (and now-playing feeds) before the player is switched on.
- **Not built:**
  - OAuth logins (Google/Apple);
  - review photos, replies, likes, and review reporting by visitors;
  - sponsorship payments/billing and analytics;
  - automated tests;
  - an "Admin" link in the public nav (deliberately omitted);
  - multi-island support (Nassau / New Providence only; `NASSAU`, the tile precache bounds and the tag seeds assume it).
