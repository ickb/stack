#!/usr/bin/env bash
set -euo pipefail

# Usage: fork-scripts/replay.sh <fork-dir>
#   Deterministic replay from manifest + counted resolutions + local patches

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

DEV_DIR="${1:?Usage: fork-scripts/replay.sh <fork-dir>}"
DEV_DIR=$(cd "$DEV_DIR" && pwd)

REPO_DIR=$(repo_dir "$DEV_DIR")
PINS_DIR=$(pins_dir "$DEV_DIR")
UPSTREAM=$(upstream_url "$DEV_DIR")
FORK_NAME=$(basename "$DEV_DIR")

# Skip if already cloned
if [ -d "$REPO_DIR" ]; then
  echo "$FORK_NAME: clone already exists, skipping (remove it to redo setup)" >&2
  exit 0
fi

# Skip if no pins to replay
MANIFEST=$(manifest_file "$PINS_DIR" 2>/dev/null) || {
  echo "$FORK_NAME: no pins to replay, skipping" >&2
  exit 0
}

trap 'rm -rf "$REPO_DIR"; echo "FAILED — cleaned up $FORK_NAME clone" >&2' ERR

# Read base SHA from first line of manifest
BASE_SHA=$(head -1 "$MANIFEST" | cut -d$'\t' -f1)
git clone --filter=blob:none "$UPSTREAM" "$REPO_DIR"

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
    RES_FILE="$PINS_DIR/res-${MERGE_IDX}.resolution"
    if [ ! -f "$RES_FILE" ]; then
      if [ -f "$PINS_DIR/res-${MERGE_IDX}.diff" ]; then
        echo "ERROR: Legacy diff format detected (res-${MERGE_IDX}.diff)." >&2
        echo "Re-record with:  pnpm fork:record $FORK_NAME" >&2
        exit 1
      fi
      echo "ERROR: Merge $MERGE_IDX ($REF_NAME) has conflicts but no resolution file." >&2
      echo "Re-record with:  pnpm fork:record $FORK_NAME" >&2
      exit 1
    fi

    # Apply counted resolutions (positional — no sed stripping or patch needed)
    apply_resolution_file "$REPO_DIR" "$RES_FILE"

    # Stage resolved files and complete the merge
    git -C "$REPO_DIR" add -A
    echo "$MERGE_MSG" > "$REPO_DIR/.git/MERGE_MSG"
    GIT_EDITOR=true git -C "$REPO_DIR" merge --continue
  fi
done < <(tail -n +2 "$MANIFEST")

bash "$FORK_SCRIPTS_DIR/patch.sh" "$REPO_DIR" "$(merge_count "$PINS_DIR")"

apply_local_patches "$REPO_DIR" "$PINS_DIR" || {
  echo "Re-record with:  pnpm fork:record $FORK_NAME" >&2
  exit 1
}

# Verify HEAD SHA matches pins/HEAD
ACTUAL=$(git -C "$REPO_DIR" rev-parse HEAD)
EXPECTED=$(pinned_head "$PINS_DIR")
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "FAIL: replay HEAD ($ACTUAL) != pinned HEAD ($EXPECTED)" >&2
  echo "Pins are stale or corrupted. Re-record with 'pnpm fork:record $FORK_NAME'." >&2
  exit 1
fi

# Add fork remote for pushing (SSH for auth), if configured
FORK_REMOTE=$(fork_url "$DEV_DIR" 2>/dev/null) || true
if [ -n "${FORK_REMOTE:-}" ]; then
  git -C "$REPO_DIR" remote add fork "$FORK_REMOTE"
fi

echo "OK — replay HEAD matches pinned HEAD ($EXPECTED)"
