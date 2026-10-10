# Deploying nassaunights.limniatis.com

Same setup as Island GO (`islandgo.limniatis.com`) and Nassau Eats (`nassaueats.limniatis.com`), on the same VM. Pushing to `main` builds the Docker image on a **GitHub-hosted runner** and pushes it to **GHCR**. A **self-hosted runner** on the VM then pulls and runs it, so the VM never builds.

| | Island GO | Nassau Eats | Nassau Nights |
| --- | --- | --- | --- |
| Repo | `Limni/bahamas-exp` | `Limni/bahamas-nassaueats` | `Limni/bahamas-nightlife` |
| Image | `ghcr.io/limni/bahamas-exp` | `ghcr.io/limni/bahamas-nassaueats` | `ghcr.io/limni/bahamas-nightlife` |
| Container | `island-explorer` | `nassaueats` | `nassaunights` |
| Host port | `5050` | `5060` | **`5110`** (bound to 127.0.0.1; 5070 is taken by another app on the VM) |
| nginx vhost | `islandgo.limniatis.com.conf` (+ `admin-islandgo…`) | `nassaueats.limniatis.com.conf` | `nassaunights.limniatis.com.conf` |
| nginx upstream | `islandgo_app` | `nassaueats_app` | `nassaunights_app` |
| `$connection_upgrade` map | `conf.d/islandgo-upgrade-map.conf` | reuses Island GO's | **reuses Island GO's** — don't define it again |
| Admin | separate host `admin-islandgo.limniatis.com` | path `/admin` | path `/admin` on the same host |
| Supabase project | its own | its own | **its own** (a new project — see step 5) |

## 1. DNS (Cloudflare)

Add a record named `nassaunights`. Make it either an A/AAAA record pointing at the VM, or a CNAME to `islandgo.limniatis.com`. Set it to **Proxied (orange)**.

`nassaunights.limniatis.com` is a first-level subdomain, so the free `*.limniatis.com` Universal SSL certificate covers it.

### Second domain: `nassaunights.com`

The same app also answers on **`nassaunights.com`** and **`www.nassaunights.com`** (both are in the vhost's `server_name`; neither redirects).

- **DNS:** add `nassaunights.com` to Cloudflare as its own zone (switch the registrar's nameservers to Cloudflare's). In that zone, add `@` and `www`, each either an A record to the VM or a CNAME to `nassaunights.limniatis.com`, all **Proxied (orange)**. Cloudflare's free Universal SSL covers `nassaunights.com` and `www.nassaunights.com` at the edge.
- **SSL/TLS mode for that zone: Full** (not Full strict). The origin presents Island GO's certificate, which isn't for `nassaunights.com`. Full mode doesn't check the hostname; Full (strict) would fail with a 526. For strict, create a Cloudflare **Origin Certificate** for `nassaunights.com, *.nassaunights.com` and point a separate `:443` server block at it.
- **On the VM:** copy the new `deploy/vm-setup.sh` over and run `sudo bash vm-setup.sh` again. `--check` then lists what `nassaunights.com` answers too.

## 2. Host nginx

**No clone needed:** `deploy/vm-setup.sh` is a single self-contained file with the vhost embedded. Get it onto the VM by pasting it into `nano vm-setup.sh` (from GitHub's file view → *Raw*), or with `scp deploy/vm-setup.sh <vm>:`. Then:

```bash
sudo bash vm-setup.sh            # install/refresh the vhost (:80 + :443), nginx -t, reload, rollback on failure
sudo bash vm-setup.sh --check    # container, port, vhost and what :443 answers for each host
```

It checks port 5110 is free (or already the `nassaunights` container's), installs the `$connection_upgrade` map only if Island GO hasn't, reuses Island GO's certificate lines, and drops `[::]` listens on hosts without IPv6. Re-running it is safe. Keep the embedded vhost in sync with `deploy/nassaunights.limniatis.com.conf` when you change either.

Or, from a clone of the repo:

```bash
# Check the upgrade map already exists (from Island GO). Expect one hit in conf.d/islandgo-upgrade-map.conf.
grep -rn 'connection_upgrade' /etc/nginx/
#   -> found:    skip the map file
#   -> not found: sudo cp deploy/nassaunights-upgrade-map.conf /etc/nginx/conf.d/

sudo ./deploy/enable-https.sh
```

Cloudflare's SSL/TLS mode is **Full**, so it reaches the server on :443. The vhost therefore needs a :443 block. Without one, nginx answers `nassaunights.limniatis.com` with its default TLS server, which is **Island GO**. `enable-https.sh` copies the `ssl_certificate*` lines from Island GO's live vhost into `/etc/nginx/snippets/nassaunights-ssl.conf`, installs the vhost, runs `nginx -t`, and reloads nginx. If the test fails, it puts the old files back. At the end it prints the page title each host serves, so you can confirm the right app answers.

Island GO's certificate works for nassaunights because Cloudflare's Full mode doesn't check the origin certificate's hostname, and a Cloudflare Origin CA certificate for `*.limniatis.com` covers it anyway. If you ever switch to **Full (strict)** with a certbot certificate, issue one for nassaunights and point the snippet at it.

## 3. Self-hosted runner for this repo

Runners are registered **per repository** on personal accounts, so Island GO's runner won't pick up this repo's jobs. Register a second runner on the same VM in its own folder:

GitHub → `bahamas-nightlife` → **Settings → Actions → Runners → New self-hosted runner → Linux**. Run the commands it shows, but inside a new directory:

```bash
mkdir ~/actions-runner-nassaunights && cd ~/actions-runner-nassaunights
# ...download + ./config.sh --url https://github.com/Limni/bahamas-nightlife --token <token>
sudo ./svc.sh install && sudo ./svc.sh start
```

The runner user already has Docker access from the Island GO setup.

## 4. Repo secrets and variables

Go to **Settings → Secrets and variables → Actions**.

| Secret | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |

Optional **Variables**:
- `PORT`: overrides the default `5110`. If you change it, change the vhost upstream too.
- `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION`: switch the map tile provider.

## 5. Outside the server

- **Stadia Maps** (map tiles): create a free account at stadiamaps.com and add `nassaunights.limniatis.com`, `nassaunights.com` and `www.nassaunights.com` as allowed domains. Until you do, the map will show no tiles on the live site. It works on localhost without this.
- **Supabase**: Nassau Nights uses its **own** Supabase project (not Nassau Eats'). Create it, run `supabase/schema.sql` in the SQL Editor, and put its URL and anon key in the repo secrets above. Under Authentication → URL Configuration, set **Site URL** to the domain you want auth emails to point at by default (e.g. `https://nassaunights.com`), and add **Redirect URLs** `https://nassaunights.com/**`, `https://www.nassaunights.com/**`, `https://nassaunights.limniatis.com/**` and `http://localhost:3000/**`. The app asks for a redirect back to whichever domain the visitor is on; Supabase only honours ones in that list (otherwise it falls back to the Site URL).
- **Member invitations** (Admin → Members → Invite):
  1. **Function (required):** Edge Functions → **Deploy a new function** → **Via editor**, name it exactly `invite-member`, paste `supabase/functions/invite-member/index.ts` and deploy. Leave **Verify JWT** on. (With the CLI: `supabase functions deploy invite-member`.) The project URL and keys are provided to it automatically; the service-role key never leaves Supabase.

     That's enough to invite people: the console makes the invite and gives you the link to send with **Copy**, **WhatsApp**, **Email app** or the phone's share sheet. It doesn't use Supabase's own invite email or its templates, so the free plan is fine.
  2. **Automatic styled emails (optional):** the function emails its own Nassau Nights invitation through [Resend](https://resend.com) (free: 100 emails a day, 3,000 a month):
     - Sign up, then **Domains → Add domain** `nassaunights.com` and add the DNS records it shows in Cloudflare (**DNS only**, not proxied). Wait for "Verified".
     - **API Keys → Create** (permission: Sending access).
     - In Supabase: Edge Functions → **Secrets** → add `RESEND_API_KEY` (the key) and `INVITE_FROM` (for example `Nassau Nights <hello@nassaunights.com>`; the address must be on the verified domain). No redeploy needed.

     If sending ever fails, the console falls back to showing the link, with the reason.

  Invite links return to `/account` on the domain the admin is using, so that domain must be in the Redirect URLs above. They expire after 24 hours (Authentication → Emails → "Email OTP expiration"); **Resend invite** makes a fresh one.
- **Optional, pg_cron**: Database → Extensions → enable `pg_cron`, then run the `cron.schedule(...)` line at the end of `schema.sql`. Live levels then fade on the minute even when nobody has the site open; without it they fade on the next ping or page view.

## 6. Deploy

Push to `main`, or go to **Actions → Build & Deploy → Run workflow**.

## Manual deploy (no CI)

Without a clone, pull the image CI built (needs a GitHub token with `read:packages`, because the package is private):

```bash
GHCR_USER=<github-user> GHCR_TOKEN=<token> sudo -E bash vm-setup.sh --run   # pull + run on 127.0.0.1:5110
```

Or build on the VM from a clone:

```bash
git clone https://github.com/Limni/bahamas-nightlife.git && cd bahamas-nightlife
cp .env.example .env    # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
./deploy.sh deploy      # build + run on 127.0.0.1:5110
./deploy.sh update      # later: git pull + rebuild + restart
```

Builds use a lot of memory on a small VM. That's why CI does the build, and you should prefer CI here too.

## Checks after the first deploy

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'     # island-explorer :5050, nassaunights 127.0.0.1:5110
curl -sI http://127.0.0.1:5110/ | head -1             # 200 from the container
curl -sI -H 'Host: nassaunights.limniatis.com' http://127.0.0.1/ | head -1   # 200 via host nginx
curl -sI -H 'Host: islandgo.limniatis.com'  http://127.0.0.1/ | head -1    # Island GO still answers
# :443 is what Cloudflare actually uses. Expect "Nassau Nights", not "Nassau GO".
curl -sk --resolve nassaunights.limniatis.com:443:127.0.0.1 https://nassaunights.limniatis.com/ | grep -o '<title>[^<]*</title>'
```

## Review improvements: required rollout before merging

The `codex/nassau-review-improvements` change adds a submission Edge Function,
service-only quota RPCs, and `venues.visit_notes`. The website deployment alone
is insufficient. The public anon key cannot apply database DDL; the project
owner must run the schema in the Supabase SQL Editor or use a database connection.
Never place a service-role key in `VITE_*` or frontend build arguments.

1. Test the complete rollout in a staging Supabase project first. Set a random
   `SUBMISSION_RATE_SALT` secret of at least 32 characters in that project's Edge
   Function secrets, and deploy `supabase/functions/submit-suggestion/index.ts`
   as `submit-suggestion`, keeping JWT verification enabled. Supabase provides
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` automatically.
2. Run the complete, idempotent `supabase/schema.sql`. This removes direct public
   suggestion inserts and photo uploads. The previous frontend cannot submit
   after this step, so coordinate the frontend release in the same short window.
3. Deploy the frontend from this change. Confirm guest and member suggestions,
   a photo, retrying the same request, and a seventh request returning 429 in
   staging. Verify the gateway supplies `X-Forwarded-For`: the function uses the
   last appended address for guests, salted/hashed before storage. If a custom
   proxy changes that contract, configure a trusted address source before rollout.
4. Confirm venue managers can save practical notes only on their assigned venues.
   Check the resulting HTML source for a venue/event's social preview, and that
   `/sitemap.xml` lists published detail pages.
5. Repeat the coordinated rollout on production after approval. Keep the PR draft
   until the backend prerequisites are ready. A frontend-only rollback leaves
   old submissions unavailable; use a coordinated rollback or fix forward.

Limits: six new request IDs per sender per hour, 120 globally per hour, six photos,
8 MB each and 32 MB for the entire multipart request. Failed attempts consume a
reservation; the same payload/ID may resume after two minutes. Completed IDs remain
reserved so delayed retries cannot create duplicates. Reservations contain salted
sender hashes, never raw IP addresses; completed suggestions and their contact
fields retain the existing moderation access rules. Monitor reservation storage
and review a retention policy before pruning completed IDs. Abandoned partial
uploads can be cleaned from the private bucket after checking that no submission
references them; keep retry reservations together with their uploads until that
cleanup. Do not expose the salt or request table to public clients.

Social cards and the sitemap use published data at **build time**. Rebuild after
publishing/removing listings or changing event details so link previews catch up.
Visitors still receive live directory updates. Build-time data fetch failures fail
the build instead of silently publishing incomplete metadata. CI uses
`PRERENDER_SKIP_DATA=1` and fake public credentials, so PR checks never need
production secrets or write to production.

Validation: Node 24 runs `npm ci`, `npm test`, `npm run lint`, `npm run build`.
Tests include an isolated PostgreSQL-compatible PGlite database for the added
migration, quotas, permission grants and retry behavior; they do not replace the
staging checks of Supabase Auth, Storage, gateway headers, RLS and Realtime.
`deno check supabase/functions/submit-suggestion/index.ts` checks the Edge Function.
