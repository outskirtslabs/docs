#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID 2>/dev/null || true
  kill $WATCH_PID 2>/dev/null || true
  exit
}
trap cleanup INT TERM

# --- Fast UI-only rebuild (skip api docs + readme sync) ---
rebuild() {
  echo "--- Rebuilding theme + site ---"
  (cd ui && npx gulp bundle) && \
  npx antora --stacktrace playbook.yml && \
  echo "--- Rebuild complete ---"
}

# --- Initial full build ---
echo "Running initial build..."
bash scripts/build.sh playbook.yml

# --- Start live-server (auto-reloads browser when build/site changes) ---
echo ""
echo "Starting dev server at http://localhost:8084 ..."
npx live-server build/site --port=8084 --no-browser &
SERVER_PID=$!

# --- Watch ui/src/ and rebuild on changes ---
echo "Watching ui/src/ for changes..."
echo ""

if command -v inotifywait &>/dev/null; then
  # inotifywait is efficient and debounces well
  while true; do
    inotifywait -r -q -e modify,create,delete,move ui/src/ 2>/dev/null
    rebuild
  done &
  WATCH_PID=$!
else
  # Fallback: poll every 2 seconds using find + checksums
  echo "(tip: install inotify-tools for instant change detection)"
  LAST_HASH=""
  while true; do
    HASH=$(find ui/src -type f -exec stat -c '%Y %n' {} + 2>/dev/null | sort | md5sum)
    if [ "$HASH" != "$LAST_HASH" ] && [ -n "$LAST_HASH" ]; then
      rebuild
    fi
    LAST_HASH="$HASH"
    sleep 2
  done &
  WATCH_PID=$!
fi

wait
