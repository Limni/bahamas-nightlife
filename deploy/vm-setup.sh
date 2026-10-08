#!/usr/bin/env bash
#
# vm-setup.sh: one-file installer for Nassau Nights on the VM. No git clone or
# GitHub token needed: the nginx vhost is embedded below (a copy of
# deploy/nassaunights.limniatis.com.conf; keep the two in sync).
#
# Copy this one file to the VM (paste it into `nano vm-setup.sh`, or scp it),
# then:
#
#   sudo bash vm-setup.sh              # install/refresh the nginx vhost (:80 + :443)
#   sudo bash vm-setup.sh --check      # just report what's there
#
# Optional, only if you don't use CI to run the container:
#   GHCR_USER=<github user> GHCR_TOKEN=<PAT with read:packages> sudo -E bash vm-setup.sh --run
#
# What the install does:
#   1. checks host port 5110 is free (or already ours);
#   2. installs the $connection_upgrade map only if Island GO hasn't already;
#   3. copies Island GO's certificate lines into /etc/nginx/snippets/nassaunights-ssl.conf
#      (Cloudflare is in Full mode, so the origin needs :443, or nginx would answer
#      this host with Island GO);
#   4. writes and enables the vhost, runs `nginx -t`, reloads, and rolls back
#      everything it changed if the test fails.
set -euo pipefail

DOMAIN="nassaunights.limniatis.com"
PORT="${PORT:-5110}"
NAME="${NAME:-nassaunights}"
IMAGE="${IMAGE:-ghcr.io/limni/bahamas-nightlife:latest}"
ISLANDGO_CONF="${ISLANDGO_CONF:-/etc/nginx/sites-available/islandgo.limniatis.com.conf}"
VHOST_DST="/etc/nginx/sites-available/$DOMAIN.conf"
VHOST_LINK="/etc/nginx/sites-enabled/$DOMAIN.conf"
SNIPPET="/etc/nginx/snippets/nassaunights-ssl.conf"
MAP_DST="/etc/nginx/conf.d/nassaunights-upgrade-map.conf"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo."
command -v nginx >/dev/null || die "nginx isn't installed on this host."

mode="${1:-install}"

title_of() {
  curl -sk --noproxy '*' --max-time 10 --resolve "$1:443:127.0.0.1" "https://$1/" | grep -o '<title>[^<]*</title>' || echo '<no title>'
}

port_owner() { ss -ltnpH "( sport = :$PORT )" 2>/dev/null | head -1; }

status() {
  log "Container:"
  if command -v docker >/dev/null; then
    docker ps --filter "name=^${NAME}$" --format '      {{.Names}}  {{.Status}}  {{.Ports}}' 2>/dev/null | grep . || echo "      (no $NAME container yet; CI's self-hosted runner starts it)"
  fi
  log "Port $PORT: $(port_owner || true)"
  log "Vhost: $([[ -L $VHOST_LINK ]] && echo enabled || echo 'not installed')"
  log "Origin :443 answers:"
  printf '      %-30s %s\n' "$DOMAIN" "$(title_of "$DOMAIN")"
  printf '      %-30s %s\n' "islandgo.limniatis.com" "$(title_of islandgo.limniatis.com)"
}

run_container() {
  command -v docker >/dev/null || die "docker isn't installed."
  if [[ -n "${GHCR_TOKEN:-}" ]]; then
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:?set GHCR_USER too}" --password-stdin >/dev/null
  fi
  log "Pulling $IMAGE"
  docker pull "$IMAGE"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # Loopback only: the host nginx is the public entry point.
  docker run -d --name "$NAME" --restart unless-stopped -p "127.0.0.1:$PORT:80" "$IMAGE" >/dev/null
  [[ -n "${GHCR_TOKEN:-}" ]] && docker logout ghcr.io >/dev/null 2>&1 || true
  log "Started $NAME on 127.0.0.1:$PORT"
}

install_nginx() {
  # 1. Port: free, or already held by our container.
  owner="$(port_owner || true)"
  if [[ -n "$owner" ]] && ! docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q "^$NAME .*:$PORT->"; then
    warn "Port $PORT is in use by something else:"
    echo "      $owner"
    die "Pick another port: PORT=5120 sudo -E bash vm-setup.sh (then set the repo variable PORT to match)."
  fi

  # 2. Upgrade map: defined once per server (Island GO normally has it).
  install_map=0
  if ! grep -rqs 'map \$http_upgrade \$connection_upgrade' /etc/nginx/; then
    install_map=1
  fi

  # 3. Certificate lines from Island GO's live vhost.
  [[ -f "$ISLANDGO_CONF" ]] || die "Island GO vhost not found at $ISLANDGO_CONF (set ISLANDGO_CONF=/path/to/its.conf)."
  ssl_lines="$(grep -E '^\s*(ssl_certificate|ssl_certificate_key|ssl_dhparam|include\s+/etc/letsencrypt/options-ssl-nginx\.conf)\b' "$ISLANDGO_CONF" \
    | sed -E 's/^\s+//; s/\s*#.*$//' \
    | awk '{ if (!seen[$1]++) print }')"
  grep -q '^ssl_certificate ' <<<"$ssl_lines" && grep -q '^ssl_certificate_key ' <<<"$ssl_lines" \
    || die "No ssl_certificate / ssl_certificate_key in $ISLANDGO_CONF."
  log "Reusing Island GO's certificate:"
  sed 's/^/      /' <<<"$ssl_lines"

  # Back up whatever we're about to replace.
  backup="$(mktemp -d)"
  for f in "$VHOST_DST" "$SNIPPET" "$MAP_DST"; do [[ -f "$f" ]] && cp -a "$f" "$backup/$(basename "$f")"; done
  link_existed=0; [[ -e "$VHOST_LINK" ]] && link_existed=1
  restore() {
    warn "Restoring the previous nginx files"
    for f in "$VHOST_DST" "$SNIPPET" "$MAP_DST"; do
      if [[ -f "$backup/$(basename "$f")" ]]; then cp -a "$backup/$(basename "$f")" "$f"; else rm -f "$f"; fi
    done
    [[ $link_existed -eq 1 ]] || rm -f "$VHOST_LINK"
  }

  mkdir -p "$(dirname "$SNIPPET")"
  {
    echo "# Written by vm-setup.sh from $ISLANDGO_CONF on $(date -u +%F)."
    sed 's/$/;/; s/;;$/;/' <<<"$ssl_lines"
  } >"$SNIPPET"

  if [[ $install_map -eq 1 ]]; then
    log "No \$connection_upgrade map found; installing $MAP_DST"
    cat >"$MAP_DST" <<'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
  fi

  # 4. The vhost (copy of deploy/nassaunights.limniatis.com.conf, port substituted).
  sed "s/127\.0\.0\.1:5110/127.0.0.1:$PORT/" >"$VHOST_DST" <<'NGINX'
# Host nginx reverse proxy for nassaunights.limniatis.com -> Nassau Nights container.
# Installed by vm-setup.sh. The container listens on 127.0.0.1:<PORT>.
upstream nassaunights_app {
    server 127.0.0.1:5110;
    keepalive 16;
}

server {
    listen      80;
    listen      [::]:80;
    server_name nassaunights.limniatis.com;

    # Allow Let's Encrypt HTTP-01 challenges before TLS is set up.
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Photo uploads go browser -> Supabase directly, not through here; this
    # just keeps headroom for anything that does pass through.
    client_max_body_size 25m;

    access_log /var/log/nginx/nassaunights.access.log;
    error_log  /var/log/nginx/nassaunights.error.log;

    location / {
        proxy_pass         http://nassaunights_app;
        proxy_http_version 1.1;

        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        $connection_upgrade;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;

        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
}

# HTTPS. Cloudflare's SSL/TLS mode is Full, so it connects to this origin on
# :443. Without this block nginx answers nassaunights on :443 with its default
# TLS server, which is Island GO.
#
# The certificate lines live in a snippet that deploy/enable-https.sh copies
# from Island GO's live vhost (certbot or Cloudflare Origin CA, whichever it
# uses). Run that script rather than copying this file by hand.
server {
    listen      443 ssl;
    listen      [::]:443 ssl;
    server_name nassaunights.limniatis.com;

    include /etc/nginx/snippets/nassaunights-ssl.conf;

    client_max_body_size 25m;

    access_log /var/log/nginx/nassaunights.access.log;
    error_log  /var/log/nginx/nassaunights.error.log;

    location / {
        proxy_pass         http://nassaunights_app;
        proxy_http_version 1.1;

        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        $connection_upgrade;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;

        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
}
NGINX
  # Hosts without IPv6 can't bind [::] (nginx -t fails), so drop those listens there.
  if [[ ! -s /proc/net/if_inet6 ]]; then
    sed -i '/listen *\[::\]/d' "$VHOST_DST"
    log "No IPv6 on this host; listening on IPv4 only."
  fi
  ln -sf "$VHOST_DST" "$VHOST_LINK"

  if ! nginx -t; then
    restore
    die "nginx -t failed; nothing was reloaded and the old files are back."
  fi
  systemctl reload nginx
  log "nginx reloaded."
}

case "$mode" in
  install|"") install_nginx; status ;;
  --check|check) status ;;
  --run|run) run_container; status ;;
  *) die "Usage: sudo bash vm-setup.sh [--check | --run]" ;;
esac
