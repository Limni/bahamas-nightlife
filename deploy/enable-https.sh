#!/usr/bin/env bash
#
# enable-https.sh: install the nassaunights nginx vhost, including its :443
# block, on the host that also runs Island GO.
#
# Cloudflare connects to the origin on :443. If nassaunights has no :443 server,
# nginx answers with its default TLS server, which is Island GO. This script
# copies Island GO's certificate lines (certbot or Cloudflare Origin CA) into
# /etc/nginx/snippets/nassaunights-ssl.conf, installs the vhost, and reloads
# nginx. If `nginx -t` fails, it restores the previous files.
#
# Usage, from a checkout of this repo on the server:
#   sudo ./deploy/enable-https.sh
#
# Override paths with ISLANDGO_CONF=... if Island GO's vhost lives elsewhere.
set -euo pipefail

cd "$(dirname "$0")"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo."

ISLANDGO_CONF="${ISLANDGO_CONF:-/etc/nginx/sites-available/islandgo.limniatis.com.conf}"
VHOST_SRC="nassaunights.limniatis.com.conf"
VHOST_DST="/etc/nginx/sites-available/nassaunights.limniatis.com.conf"
VHOST_LINK="/etc/nginx/sites-enabled/nassaunights.limniatis.com.conf"
SNIPPET="/etc/nginx/snippets/nassaunights-ssl.conf"

[[ -f "$ISLANDGO_CONF" ]] || die "Island GO vhost not found at $ISLANDGO_CONF (set ISLANDGO_CONF=...)."
[[ -f "$VHOST_SRC" ]] || die "Run this from the repo checkout (missing deploy/$VHOST_SRC)."

# The certificate directives from Island GO's live vhost, first of each kind.
ssl_lines="$(grep -E '^\s*(ssl_certificate|ssl_certificate_key|ssl_dhparam|include\s+/etc/letsencrypt/options-ssl-nginx\.conf)\b' "$ISLANDGO_CONF" \
  | sed -E 's/^\s+//; s/\s*#.*$//' \
  | awk '{ if (!seen[$1]++) print }')"

grep -q '^ssl_certificate ' <<<"$ssl_lines" && grep -q '^ssl_certificate_key ' <<<"$ssl_lines" \
  || die "No ssl_certificate / ssl_certificate_key in $ISLANDGO_CONF. Check: grep -n 'listen\|ssl_' $ISLANDGO_CONF"

log "Reusing Island GO's certificate:"
sed 's/^/      /' <<<"$ssl_lines"

backup_dir="$(mktemp -d)"
[[ -f "$VHOST_DST" ]] && cp -a "$VHOST_DST" "$backup_dir/vhost"
[[ -f "$SNIPPET" ]] && cp -a "$SNIPPET" "$backup_dir/snippet"
link_existed=0; [[ -e "$VHOST_LINK" ]] && link_existed=1

restore() {
  log "Restoring previous nginx files"
  if [[ -f "$backup_dir/vhost" ]]; then cp -a "$backup_dir/vhost" "$VHOST_DST"; else rm -f "$VHOST_DST"; fi
  if [[ -f "$backup_dir/snippet" ]]; then cp -a "$backup_dir/snippet" "$SNIPPET"; else rm -f "$SNIPPET"; fi
  [[ $link_existed -eq 1 ]] || rm -f "$VHOST_LINK"
}

mkdir -p "$(dirname "$SNIPPET")"
{
  echo "# Written by deploy/enable-https.sh from $ISLANDGO_CONF on $(date -u +%F)."
  echo "# Re-run the script if Island GO's certificate paths change."
  sed 's/$/;/; s/;;$/;/' <<<"$ssl_lines"
} >"$SNIPPET"

cp "$VHOST_SRC" "$VHOST_DST"
ln -sf "$VHOST_DST" "$VHOST_LINK"

if ! nginx -t; then
  restore
  die "nginx -t failed; nothing was reloaded."
fi
systemctl reload nginx
log "nginx reloaded."

check() {
  local host="$1"
  local title
  title="$(curl -sk --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/" | grep -o '<title>[^<]*</title>' || true)"
  printf '      %-28s %s\n' "$host" "${title:-<no title>}"
}
log "Origin :443 now answers:"
check nassaunights.limniatis.com
check islandgo.limniatis.com
