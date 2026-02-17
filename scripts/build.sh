#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PLAYBOOK="${1:?Usage: build.sh <playbook.yml>}"

# -- Build UI theme --
echo "Building UI theme..."
(cd "$ROOT_DIR/ui" && npx gulp bundle)

# -- Build the site --
echo "Building Antora site..."
npx antora --stacktrace "$ROOT_DIR/$PLAYBOOK"
echo "Done. Output in $ROOT_DIR/build/site/"
