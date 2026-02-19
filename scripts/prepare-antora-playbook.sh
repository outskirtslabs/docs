#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PLAYBOOK_INPUT="${1:?Usage: prepare-antora-playbook.sh <playbook.yml>}"

if [[ "$PLAYBOOK_INPUT" = /* ]]; then
  PLAYBOOK_PATH="$PLAYBOOK_INPUT"
else
  PLAYBOOK_PATH="$ROOT_DIR/$PLAYBOOK_INPUT"
fi

if [ ! -f "$PLAYBOOK_PATH" ]; then
  echo "Playbook not found: $PLAYBOOK_PATH" >&2
  exit 1
fi

# Only git worktrees use a .git file; normal checkouts already work with Antora.
if [ -d "$ROOT_DIR/.git" ] || [ ! -f "$ROOT_DIR/.git" ]; then
  echo "$PLAYBOOK_PATH"
  exit 0
fi

BRANCH_NAME="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "$BRANCH_NAME" ] || [ "$BRANCH_NAME" = "HEAD" ]; then
  echo "$PLAYBOOK_PATH"
  exit 0
fi

COMMON_GIT_DIR="$(git -C "$ROOT_DIR" rev-parse --git-common-dir)"
WORKTREE_GIT_REPO="$ROOT_DIR/build/.antora-local-git"
WORKTREE_PLAYBOOK="$ROOT_DIR/.antora-playbook.worktree.yml"

mkdir -p "$WORKTREE_GIT_REPO"
ln -sfn "$COMMON_GIT_DIR" "$WORKTREE_GIT_REPO/.git"

awk -v local_repo="$WORKTREE_GIT_REPO" -v branch="$BRANCH_NAME" '
  BEGIN {
    source_idx = 0
    in_first_source = 0
    inserted_worktrees = 0
  }

  /^    - url: / {
    source_idx++
    if (source_idx == 1) {
      print "    - url: " local_repo
      in_first_source = 1
      next
    }
  }

  in_first_source && /^      branches: / {
    print "      branches: " branch
    next
  }

  in_first_source && /^      worktrees: / {
    print "      worktrees: " branch
    inserted_worktrees = 1
    next
  }

  in_first_source && /^      start_path: / {
    if (!inserted_worktrees) {
      print "      worktrees: " branch
      inserted_worktrees = 1
    }
    print
    in_first_source = 0
    next
  }

  { print }
' "$PLAYBOOK_PATH" > "$WORKTREE_PLAYBOOK"

echo "$WORKTREE_PLAYBOOK"
