#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PLAYBOOK="${1:?Usage: build.sh <playbook.yml>}"
shift

# -- Generate home project catalog partial --
echo "Generating home project catalog partial..."
(cd "$ROOT_DIR" && bb gen-home)

# -- Build UI theme --
echo "Building UI theme..."
(cd "$ROOT_DIR/ui" && node scripts/build-ui.mjs bundle)

# -- Build the site --
echo "Building Antora site..."
antora --stacktrace "$@" "$ROOT_DIR/$PLAYBOOK"

# -- Apply static syntax highlighting --
echo "Applying Arborium syntax highlighting..."
node "$ROOT_DIR/scripts/highlight-arborium.mjs" --site-dir "$ROOT_DIR/build/site"

echo "Done. Output in $ROOT_DIR/build/site/"
