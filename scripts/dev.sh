#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
DEV_PORT="${DEV_PORT:-8084}"
DEV_SITE_URL="http://localhost:${DEV_PORT}"
DEV_SOURCEMAPS="${DEV_SOURCEMAPS:-true}"
DEV_PLAYBOOK="${DEV_PLAYBOOK:-playbook.yml}"
WATCH_PATHS=(ui/src components)
INOTIFY_EXCLUDE_REGEX='home-project-catalog\.adoc$'
HASH_EXCLUDE_PATH='components/home/modules/ROOT/partials/home-project-catalog.adoc'
NGINX_HELPER="$ROOT_DIR/scripts/nginx-dev.sh"
LIVE_RELOAD_TOKEN_PATH="$ROOT_DIR/build/site/_dev/reload.txt"

prepare_live_reload() {
  mkdir -p "$ROOT_DIR/build/site/_dev"
  node "$ROOT_DIR/scripts/inject-dev-live-reload.mjs" "$ROOT_DIR/build/site"
}

signal_live_reload() {
  date +%s%N > "$LIVE_RELOAD_TOKEN_PATH"
}

cleanup() {
  echo ""
  echo "Shutting down..."
  "$NGINX_HELPER" stop "$DEV_PORT" >/dev/null 2>&1 || true
  if [ -n "${WATCH_PID:-}" ]; then
    kill "$WATCH_PID" 2>/dev/null || true
  fi
  exit
}
trap cleanup INT TERM

# --- Fast local rebuild (skip api docs + readme sync) ---
rebuild() {
  echo "--- Rebuilding theme + site ---"
  bb gen-home && \
  (cd ui && SOURCEMAPS="$DEV_SOURCEMAPS" node scripts/build-ui.mjs build) && \
  npx antora --stacktrace --url "$DEV_SITE_URL" "$DEV_PLAYBOOK" && \
  node scripts/highlight-arborium.mjs --site-dir build/site && \
  prepare_live_reload && \
  "$NGINX_HELPER" reload "$DEV_PORT" && \
  signal_live_reload && \
  echo "--- Rebuild complete ---"
}

rebuild_or_continue() {
  if ! rebuild; then
    echo "--- Rebuild failed; watching for further changes ---"
  fi
}

# --- Initial full build ---
echo "Running initial build..."
SOURCEMAPS="$DEV_SOURCEMAPS" bash scripts/build.sh "$DEV_PLAYBOOK" --url "$DEV_SITE_URL"
prepare_live_reload

# --- Start local nginx server ---
echo ""
echo "Starting dev server at $DEV_SITE_URL ..."
"$NGINX_HELPER" start "$DEV_PORT"
signal_live_reload

# --- Watch source paths and rebuild on changes ---
echo "Watching ${WATCH_PATHS[*]} for changes..."
echo ""

if command -v inotifywait &>/dev/null; then
  # inotifywait is efficient and debounces well
  while true; do
    inotifywait -r -q -e modify,create,delete,move \
      --exclude "$INOTIFY_EXCLUDE_REGEX" \
      "${WATCH_PATHS[@]}" \
      2>/dev/null
    rebuild_or_continue
  done &
  WATCH_PID=$!
else
  # Fallback: poll every 2 seconds using find + checksums
  echo "(tip: install inotify-tools for instant change detection)"
  LAST_HASH=""
  while true; do
    HASH=$(find "${WATCH_PATHS[@]}" -type f ! -path "$HASH_EXCLUDE_PATH" -exec stat -c '%Y %n' {} + 2>/dev/null | sort | md5sum)
    if [ "$HASH" != "$LAST_HASH" ] && [ -n "$LAST_HASH" ]; then
      rebuild_or_continue
    fi
    LAST_HASH="$HASH"
    sleep 2
  done &
  WATCH_PID=$!
fi

wait
