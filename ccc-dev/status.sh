#!/usr/bin/env bash
set -euo pipefail

# Check whether ccc-dev/ccc/ is safe to wipe.
#   Exit 0 → safe (not cloned, or matches pins exactly)
#   Exit 1 → has custom work (any changes vs pinned commit, diverged HEAD, or no pins to compare)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/ccc"
PINS_DIR="$SCRIPT_DIR/pins"

if [ ! -d "$REPO_DIR" ]; then
  echo "ccc-dev/ccc/ is not cloned"
  exit 0
fi

if [ ! -f "$PINS_DIR/HEAD" ]; then
  echo "ccc-dev/ccc/ exists but no pins/HEAD — custom clone"
  exit 1
fi

PINNED=$(cat "$PINS_DIR/HEAD")
ACTUAL=$(git -C "$REPO_DIR" rev-parse HEAD)

if [ "$ACTUAL" != "$PINNED" ]; then
  echo "HEAD diverged from pins/HEAD:"
  echo "  pinned  $PINNED"
  echo "  actual  $ACTUAL"
  git -C "$REPO_DIR" log --oneline "$PINNED..$ACTUAL" 2>/dev/null || true
  exit 1
fi

# Compare pinned commit directly against working tree.
# git diff <commit> catches unstaged AND staged changes in one shot.
if ! git -C "$REPO_DIR" diff "$PINNED" --quiet 2>/dev/null \
   || [ -n "$(git -C "$REPO_DIR" ls-files --others --exclude-standard 2>/dev/null)" ]; then
  echo "ccc-dev/ccc/ has changes relative to pins:"
  git -C "$REPO_DIR" diff "$PINNED" --stat 2>/dev/null || true
  git -C "$REPO_DIR" ls-files --others --exclude-standard 2>/dev/null || true
  exit 1
fi

echo "ccc-dev/ccc/ is clean (matches pins)"
