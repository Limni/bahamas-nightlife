# Deploying nassaunights.limniatis.com

Same setup as Island GO (`islandgo.limniatis.com`) and Nassau Eats (`nassaueats.limniatis.com`), on the same VM. Pushing to `main` builds the Docker image on a **GitHub-hosted runner** and pushes it to **GHCR**. A **self-hosted runner** on the VM then pulls and runs it, so the VM never builds.

| | Island GO | Nassau Eats | Nassau Nights |
| --- | --- | --- | --- |
| Repo | `Limni/bahamas-exp` | `Limni/bahamas-nassaueats` | `Limni/bahamas-nightlife` |
| Image | `ghcr.io/limni/bahamas-exp` | `ghcr.io/limni/bahamas-nassaueats` | `ghcr.io/limni/bahamas-nightlife` |
| Container | `island-explorer` | `nassaueats` | `nassaunights` |
| Host port | `5050` | `5060` | **`5070`** (bound to 127.0.0.1) |
| nginx vhost | `islandgo.limniatis.com.conf` (+ `admin-islandgo…`) | `nassaueats.limniatis.com.conf` | `nassaunights.limniatis.com.conf` |
| nginx upstream | `islandgo_app` | `nassaueats_app` | `nassaunights_app` |
| `$connection_upgrade` map | `conf.d/islandgo-upgrade-map.conf` | reuses Island GO's | **reuses Island GO's** — don't define it again |
| Admin | separate host `admin-islandgo.limniatis.com` | path `/admin` | path `/admin` on the same host |
| Supabase project | its own | its own | **its own** (a new project — see step 5) |

## 1. DNS (Cloudflare)

Add a record named `nassaunights`. Make it either an A/AAAA record pointing at the VM, or a CNAME to `islandgo.limniatis.com`. Set it to **Proxied (orange)**.

`nassaunights.limniatis.com` is a first-level subdomain, so the free `*.limniatis.com` Universal SSL certificate covers it.

## 2. Host nginx

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
- `PORT`: overrides the default `5070`. If you change it, change the vhost upstream too.
- `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION`: switch the map tile provider.

## 5. Outside the server

- **Stadia Maps** (map tiles): create a free account at stadiamaps.com and add `nassaunights.limniatis.com` as an allowed domain. Until you do, the map will show no tiles on the live site. It works on localhost without this.
- **Supabase**: Nassau Nights uses its **own** Supabase project (not Nassau Eats'). Create it, run `supabase/schema.sql` in the SQL Editor, and put its URL and anon key in the repo secrets above. Under Authentication → URL Configuration, set **Site URL** to `https://nassaunights.limniatis.com`. The password login works without it, but auth emails link there.
- **Optional, pg_cron**: Database → Extensions → enable `pg_cron`, then run the `cron.schedule(...)` line at the end of `schema.sql`. Live levels then fade on the minute even when nobody has the site open; without it they fade on the next ping or page view.

## 6. Deploy

Push to `main`, or go to **Actions → Build & Deploy → Run workflow**.

## Manual deploy (no CI)

```bash
git clone https://github.com/Limni/bahamas-nightlife.git && cd bahamas-nightlife
cp .env.example .env    # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
./deploy.sh deploy      # build + run on 127.0.0.1:5070
./deploy.sh update      # later: git pull + rebuild + restart
```

Builds use a lot of memory on a small VM. That's why CI does the build, and you should prefer CI here too.

## Checks after the first deploy

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'     # island-explorer :5050, nassaunights 127.0.0.1:5070
curl -sI http://127.0.0.1:5070/ | head -1             # 200 from the container
curl -sI -H 'Host: nassaunights.limniatis.com' http://127.0.0.1/ | head -1   # 200 via host nginx
curl -sI -H 'Host: islandgo.limniatis.com'  http://127.0.0.1/ | head -1    # Island GO still answers
# :443 is what Cloudflare actually uses. Expect "Nassau Nights", not "Nassau GO".
curl -sk --resolve nassaunights.limniatis.com:443:127.0.0.1 https://nassaunights.limniatis.com/ | grep -o '<title>[^<]*</title>'
```
