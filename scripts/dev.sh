#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
DEV_SITE_URL="http://localhost:8084"
DEV_SOURCEMAPS="${DEV_SOURCEMAPS:-true}"
WATCH_PATHS=(ui/src components)
INOTIFY_EXCLUDE_REGEX='home-project-catalog\.adoc$'
HASH_EXCLUDE_PATH='components/home/modules/ROOT/partials/home-project-catalog.adoc'

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID 2>/dev/null || true
  kill $WATCH_PID 2>/dev/null || true
  exit
}
trap cleanup INT TERM

# --- Fast local rebuild (skip api docs + readme sync) ---
rebuild() {
  echo "--- Rebuilding theme + site ---"
  bb gen-home && \
  (cd ui && SOURCEMAPS="$DEV_SOURCEMAPS" npx gulp bundle) && \
  npx antora --stacktrace --url "$DEV_SITE_URL" playbook.yml && \
  node scripts/highlight-arborium.mjs --site-dir build/site && \
  echo "--- Rebuild complete ---"
}

rebuild_or_continue() {
  if ! rebuild; then
    echo "--- Rebuild failed; watching for further changes ---"
  fi
}

# --- Initial full build ---
echo "Running initial build..."
SOURCEMAPS="$DEV_SOURCEMAPS" bash scripts/build.sh playbook.yml --url "$DEV_SITE_URL"

# --- Start live-server (auto-reloads browser when build/site changes) ---
echo ""
echo "Starting dev server at http://localhost:8084 ..."
npx live-server build/site --port=8084 --no-browser &
SERVER_PID=$!

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
