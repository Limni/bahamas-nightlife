# Canonical domain

The official origin is **https://nassaunights.com** (confirmed October 18, 2026).

- The application container redirects `www.nassaunights.com` to the same path and query on the official HTTPS origin with a 301. The host proxy already forwards `Host`, so this deploys through the normal app workflow without DNS, TLS, or host nginx changes. The legacy `nassaunights.limniatis.com` host remains accessible.
- `scripts/sitemap.mjs` generates a canonical HTML shell for each public sitemap route, including the homepage, venues, and events. `SITE_URL`, when provided, must equal the official origin to prevent conflicting signals.
- nginx serves those files before the SPA fallback. The separate `spa.html` fallback has no canonical, so account/admin pages and newly published routes never inherit the homepage canonical.
- `CanonicalUrl` in `src/App.tsx` updates the existing tag on navigation, strips query/fragment variants, and removes it on account/admin/manager routes. Newly published venue/event routes receive their own canonical when rendered, then gain initial-HTML tags at the next build.
- The sitemap and robots file keep using non-www URLs. A build still uses only public Supabase data and leaves authentication settings unchanged.

## Verification and rollback

Check homepage, venue, event, query-string and SPA navigation cases. Confirm www returns a 301 with path and query preserved, and non-www returns 200 without a redirect loop. Check that sitemap URLs match their HTML canonicals and that account/admin fallback HTML has no homepage canonical.

The standard `main` deployment ships these files. Revert the canonical-domain commit and redeploy to roll back. No DNS change is required in either direction. Users previously signed in on www may need to sign in again on non-www because browser sessions are per origin; existing auth redirect allowlists remain unchanged.
