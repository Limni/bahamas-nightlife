# Nassau Days: a daytime sister site (proposed, shelved)

**Idea:** `nassaudays.com` (already purchased) shows daytime places and events: beaches, cafés, brunch, tours, attractions and day events. `nassaunights.com` keeps the nightlife. A transition animation (sunrise / sunset) links them.

## Recommended architecture: one app, two "scenes"

Same codebase, database and admin console. The app picks its scene from the hostname (`nassaudays.*` → day, else night). A `?scene=day` query previews it on any domain.

- **Data:**
  - `venues.scenes text[]` and `events.scenes text[]` (`'day'`, `'night'`; both for a beach bar). Default `{night}` for existing rows.
  - Both added to `venues_manager_guard` only if admins alone should decide.
  - The directory filters by the current scene.
  - Tags get a scene too (or separate tag kinds), so day filters show day vocabularies (Beach, Café, Tour, Museum, Snorkelling…).
- **Theme:**
  - The first *light* theme. Today all themes are dark and re-point `night-*`, so it's mostly a token block.
  - Some effects (`.neon-text`, glows, heat halos) need light-background variants.
  - Map: a light basemap (Stadia `alidade_smooth`), with pin and halo styles checked on light.
- **Copy and timings:**
  - Hero "Nassau in the sun", day greetings.
  - Popular times 6 AM – 8 PM instead of noon – 5 AM.
  - The night's "6 AM boundary" logic (events, device-id rotation) is scene-specific.
- **Importer:** a day profile for `scripts/seed-google.ts` (queries: beach, café, brunch, tour, museum, attraction).
- **Admin:** a day/night filter on Spots / Events, and a scene picker in the editors.
- **Overlap with Nassau Eats:** decide whether restaurants live there or here (probably link out rather than duplicate).

## The transition

- **Within one domain** (in-app scene switch) it can be fully seamless:
  - the sky gradient shifts night → dawn, a sun rises over a waterline, neon fades out, and content swaps underneath, with no reload;
  - the View Transitions API or `motion` drives it, with a reduced-motion fallback (a cross-fade).
- **Across domains** browsers can't animate between origins, so the new site must load in between. Split the animation:
  1. play the first half on the leaving site, ending on a full-screen frame (the sun at the horizon);
  2. navigate to `https://nassaudays.com/?from=night`;
  3. the arriving site paints that exact frame from `index.html` (inline CSS, before JS) and plays the second half.
  - First visit costs ~0.5–1 s of load hidden behind the held frame; cached visits are faster.
  - Same-origin prerendering doesn't apply across sites.
- **Options:**
  - **A**: two real domains, each opening in its scene, with the split handoff;
  - **B**: one primary domain with the in-place toggle, where `nassaudays.com` just opens it in day mode.
  - **B** is smoother and avoids the sign-in problem below.

## Catches

- **Sign-ins don't carry across domains:** Supabase sessions live in each origin's `localStorage`. Bridging needs a one-time handoff (pass tokens in the URL fragment, then `setSession`). That needs care: single use, short-lived, never logged. Option B avoids it.
- **Activity consent and favourites prompts** are per origin too.
- **SEO:** one canonical URL per page and one sitemap per domain. See [domains-and-seo.md](domains-and-seo.md).
- **Infrastructure for nassaudays.com:**
  - Cloudflare DNS (proxied, Full mode);
  - add it to the vhost `server_name` (and `vm-setup.sh`);
  - add it to Supabase Auth Redirect URLs;
  - register it with Stadia;
  - GA4 (same property filtered by hostname, or a new one);
  - `SITE_URL`-per-domain sitemap generation.

## Effort

- **Code** (scene field, day theme, light map, hostname detection, transition): a few focused sessions.
- **Content** (curating and photographing day spots) is the real work.
- **Suggested first step:** build the day theme and sunrise transition behind `?scene=day` on the current site, and judge the feel before wiring the domain.
