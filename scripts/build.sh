#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Copy a project's README.adoc as its Antora index page, rewriting
# relative links to Antora xrefs.
# Usage: sync_readme <project-root> <antora-start-path>
sync_readme() {
  local project_root="$1"
  local start_path="$2"
  local readme="$project_root/README.adoc"
  local target="$project_root/$start_path/modules/ROOT/pages/index.adoc"

  if [ ! -f "$readme" ]; then
    echo "WARN: $readme not found, skipping"
    return
  fi

  echo "Syncing $readme -> $target"
  cp "$readme" "$target"

  # Rewrite relative doc links to Antora xrefs
  # e.g. link:doc/modules/ROOT/pages/usage.adoc[Usage Guide] -> xref:usage.adoc[Usage Guide]
  sed -i -E 's|link:doc/modules/ROOT/pages/([^[]+)\[|xref:\1[|g' "$target"
}

# Generate AsciiDoc API reference pages from Clojure source.
# Usage: gen_api_docs <project-root> <antora-start-path> <github-repo> <git-branch>
gen_api_docs() {
  local project_root="$1"
  local start_path="$2"
  local github_repo="$3"
  local git_branch="$4"

  echo "Generating API docs for $project_root ..."
  bb "$SCRIPT_DIR/gen-api-docs.clj" "{:project-root \"$project_root\" :source-paths [\"src\"] :antora-start-path \"$start_path\" :github-repo \"$github_repo\" :git-branch \"$git_branch\"}"
}

# -- Project syncs --
sync_readme "/home/ramblurr/src/github.com/outskirtslabs/client-ip" "doc"

# -- API docs --
gen_api_docs "/home/ramblurr/src/github.com/outskirtslabs/client-ip" "doc" \
  "https://github.com/outskirtslabs/client-ip" "main"

# -- Build the site --
echo "Building Antora site..."
npx antora "$ROOT_DIR/antora-playbook.yml"
echo "Done. Output in $ROOT_DIR/build/site/"
