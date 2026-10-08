#!/usr/bin/env bash
#
# deploy.sh — build / update / deploy the Nassau Nights SPA as a Docker image.
# Same workflow as Island GO's deploy.sh; the two run side by side on one VM.
#
# Usage:
#   ./deploy.sh build              Build the Docker image
#   ./deploy.sh deploy   (or: up)  Build and (re)start the container
#   ./deploy.sh update             git pull, rebuild, restart (one-shot redeploy)
#   ./deploy.sh logs               Tail container logs
#   ./deploy.sh stop               Stop and remove the running container
#   ./deploy.sh status             Show container status
#
# Config (override via env or the env file):
#   IMAGE   image name/tag        (default: nassaunights:latest)
#   NAME    container name        (default: nassaunights)
#   PORT    host port -> :80      (default: 5070 — Island GO uses 5050)
#   ENV_FILE  env file to read    (default: .env, falling back to .env.local)
#
set -euo pipefail

cd "$(dirname "$0")"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# Sourced up front so PORT/IMAGE/NAME defined in the file apply to both
# `docker build` and `docker run`.
ENV_FILE="${ENV_FILE:-.env}"
[[ -f "$ENV_FILE" ]] || ENV_FILE=".env.local"
if [[ -f "$ENV_FILE" ]]; then
  log "Loading config from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  warn "No .env / .env.local found — using defaults; app config will be missing."
fi

IMAGE="${IMAGE:-nassaunights:latest}"
NAME="${NAME:-nassaunights}"
PORT="${PORT:-5070}"

command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."

build() {
  log "Building image: $IMAGE"
  docker build \
    --build-arg VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
    --build-arg VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
    --build-arg VITE_MAP_TILE_URL="${VITE_MAP_TILE_URL:-}" \
    --build-arg VITE_MAP_ATTRIBUTION="${VITE_MAP_ATTRIBUTION:-}" \
    -t "$IMAGE" \
    .
  log "Build complete."
}

stop() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    log "Stopping and removing container: $NAME"
    docker rm -f "$NAME" >/dev/null
  else
    log "No container named $NAME to stop."
  fi
}

run() {
  stop
  log "Starting container: $NAME (http://localhost:$PORT)"
  # Bind to loopback only: the host nginx (deploy/nassaunights.limniatis.com.conf)
  # is the public entry point.
  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p "127.0.0.1:$PORT:80" \
    "$IMAGE" >/dev/null
  log "Up. Open http://localhost:$PORT"
}

deploy() {
  build
  run
  status
}

update() {
  if [[ -d .git ]]; then
    log "Pulling latest changes..."
    git pull --ff-only || warn "git pull failed or non-fast-forward — continuing with current tree."
  else
    warn "Not a git repo — skipping pull."
  fi
  deploy
}

logs()   { docker logs -f "$NAME"; }
status() { docker ps --filter "name=^${NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'; }

cmd="${1:-deploy}"
case "$cmd" in
  build)        build ;;
  deploy|up)    deploy ;;
  update)       update ;;
  logs)         logs ;;
  stop|down)    stop ;;
  status|ps)    status ;;
  *)            die "Unknown command: $cmd. Try: build | deploy | update | logs | stop | status" ;;
esac
