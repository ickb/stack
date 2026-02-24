#!/usr/bin/env bash
set -euo pipefail

# Usage: ccc-dev/replay.sh
#   Deterministic replay from manifest + resolution diffs + local patches

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
REPO_DIR="$CCC_DEV_REPO_DIR"
PINS_DIR="$CCC_DEV_PINS_DIR"

# Skip if already cloned
if [ -d "$REPO_DIR" ]; then
  echo "ccc-dev/ccc/ already exists, skipping (remove it to redo setup)" >&2
  exit 0
fi

# Skip if no pins to replay
MANIFEST=$(manifest_file 2>/dev/null) || {
  echo "No CCC pins to replay, skipping" >&2
  exit 0
}

trap 'rm -rf "$REPO_DIR"; echo "FAILED — cleaned up ccc-dev/ccc/" >&2' ERR

# Read base SHA from first line of manifest
BASE_SHA=$(head -1 "$MANIFEST" | cut -d$'\t' -f1)
git clone --filter=blob:none "$CCC_DEV_REPO_URL" "$REPO_DIR"

# Match record.sh's conflict marker style and SHA abbreviation for identical markers
git -C "$REPO_DIR" config merge.conflictStyle diff3
git -C "$REPO_DIR" config core.abbrev 40

git -C "$REPO_DIR" checkout "$BASE_SHA"
git -C "$REPO_DIR" checkout -b wip

# Replay merges from manifest (skip line 1 = base)
MERGE_IDX=0
while IFS=$'\t' read -r SHA REF_NAME; do
  MERGE_IDX=$((MERGE_IDX + 1))
  echo "Replaying merge $MERGE_IDX: $REF_NAME ($SHA)" >&2

  deterministic_env "$MERGE_IDX"

  git -C "$REPO_DIR" fetch origin "$SHA"

  # Use explicit merge message matching record.sh for deterministic commits
  MERGE_MSG="Merge $REF_NAME into wip"

  # Merge by SHA (matching record.sh) so conflict markers are identical
  if ! git -C "$REPO_DIR" merge --no-ff -m "$MERGE_MSG" "$SHA"; then
    RES_DIFF="$PINS_DIR/res-${MERGE_IDX}.diff"
    if [ ! -f "$RES_DIFF" ]; then
      echo "ERROR: Merge $MERGE_IDX ($REF_NAME) has conflicts but no resolution diff." >&2
      echo "Re-record with:  pnpm ccc:record" >&2
      exit 1
    fi

    # Apply resolution diff to fix all conflicts for this merge step
    patch -p1 -d "$REPO_DIR" < "$RES_DIFF"

    # Stage resolved files and complete the merge
    git -C "$REPO_DIR" add -A
    echo "$MERGE_MSG" > "$REPO_DIR/.git/MERGE_MSG"
    GIT_EDITOR=true git -C "$REPO_DIR" merge --continue
  fi
done < <(tail -n +2 "$MANIFEST")

bash "$CCC_DEV_DIR/patch.sh" "$REPO_DIR" "$(merge_count)"

apply_local_patches "$REPO_DIR" || {
  echo "Re-record with:  pnpm ccc:record" >&2
  exit 1
}

# Verify HEAD SHA matches pins/HEAD
ACTUAL=$(git -C "$REPO_DIR" rev-parse HEAD)
EXPECTED=$(pinned_head)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "FAIL: replay HEAD ($ACTUAL) != pinned HEAD ($EXPECTED)" >&2
  echo "Pins are stale or corrupted. Re-record with 'pnpm ccc:record'." >&2
  exit 1
fi

# Add fork remote for pushing to phroi/ccc (SSH for auth)
git -C "$REPO_DIR" remote add fork git@github.com:phroi/ccc.git

echo "OK — replay HEAD matches pinned HEAD ($EXPECTED)"
