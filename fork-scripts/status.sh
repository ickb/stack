#!/usr/bin/env bash
set -euo pipefail

# Check whether a fork clone is safe to wipe.
#   Exit 0 → safe (not cloned, or matches pins exactly)
#   Exit 1 → has custom work (any changes vs pinned commit, diverged HEAD, or no pins to compare)
# Usage: fork-scripts/status.sh <fork-dir>

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

DEV_DIR="${1:?Usage: fork-scripts/status.sh <fork-dir>}"
DEV_DIR=$(cd "$DEV_DIR" && pwd)

REPO_DIR=$(repo_dir "$DEV_DIR")
PINS_DIR=$(pins_dir "$DEV_DIR")
FORK_NAME=$(basename "$DEV_DIR")

if [ ! -d "$REPO_DIR" ]; then
  echo "$FORK_NAME: clone is not present"
  exit 0
fi

PINNED=$(pinned_head "$PINS_DIR" 2>/dev/null) || {
  echo "$FORK_NAME: clone exists but no pins — custom clone"
  exit 1
}

ACTUAL=$(git -C "$REPO_DIR" rev-parse HEAD)

if [ "$ACTUAL" != "$PINNED" ]; then
  echo "$FORK_NAME: HEAD diverged from pinned HEAD:"
  echo "  pinned  $PINNED"
  echo "  actual  $ACTUAL"
  git -C "$REPO_DIR" log --oneline "$PINNED..$ACTUAL" 2>/dev/null || true
  exit 1
fi

# Compare pinned commit against working tree AND index.
# git diff <commit> catches unstaged changes; --cached catches staged-only changes
# (e.g. staged edits where the working tree was reverted).
if ! git -C "$REPO_DIR" diff "$PINNED" --quiet 2>/dev/null \
   || ! git -C "$REPO_DIR" diff --cached "$PINNED" --quiet 2>/dev/null \
   || [ -n "$(git -C "$REPO_DIR" ls-files --others --exclude-standard 2>/dev/null)" ]; then
  echo "$FORK_NAME: clone has changes relative to pins:"
  git -C "$REPO_DIR" diff "$PINNED" --stat 2>/dev/null || true
  git -C "$REPO_DIR" diff --cached "$PINNED" --stat 2>/dev/null || true
  git -C "$REPO_DIR" ls-files --others --exclude-standard 2>/dev/null || true
  exit 1
fi

echo "$FORK_NAME: clone is clean (matches pins)"
