# Domains, canonical URLs and SEO (proposed)

## Today

The same site is served, with identical content and no canonical tags, on:

- `nassaunights.com`
- `www.nassaunights.com`
- `nassaunights.limniatis.com`

(`server_name` in `deploy/nassaunights.limniatis.com.conf` and the vhost embedded in `deploy/vm-setup.sh`.)

Google doesn't penalise duplicates, but it **picks one** version of each page to show. It may pick the wrong host, and links and shares to the different hosts split ranking credit.

## Fix (small, recommended regardless of other plans)

Permanently redirect the extra hosts to the primary one in the host nginx:

```nginx
# In the :80 and :443 server blocks for the non-primary names, before proxying:
server {
    listen 443 ssl;
    server_name www.nassaunights.com nassaunights.limniatis.com;
    include /etc/nginx/snippets/nassaunights-ssl.conf;
    return 301 https://nassaunights.com$request_uri;
}
```

Then:
- keep `nassaunights.com` alone in the main server block's `server_name`;
- mirror the change in `deploy/vm-setup.sh`'s embedded vhost;
- run `nginx -t` and reload (`enable-https.sh` already rolls back on failure);
- keep all three in Supabase Auth Redirect URLs for a while (old emails still point at them).

**Caveat:** the admin console on `nassaunights.limniatis.com` would then redirect too. Sessions are per origin, so you sign in again once on `nassaunights.com`.

**Alternative** (no redirects): add `<link rel="canonical" href="https://nassaunights.com{path}">` per page, set from the router (one small component that updates the tag on route change). Redirects are simpler and stronger.

## If the day site happens

- Pages shown on both domains (a spot tagged day *and* night) need **one canonical** on the domain of its primary scene. A spot that's day-only opened on the night domain should redirect to the day domain.
- **One sitemap per domain:** `scripts/sitemap.mjs` writes `sitemap-night.xml` / `sitemap-day.xml` (and robots files). nginx serves the right one per `$host`. Each domain gets its own Search Console property.
