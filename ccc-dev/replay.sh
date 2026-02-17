#!/usr/bin/env bash
set -euo pipefail

# Usage: ccc-dev/replay.sh
#   Deterministic replay from pinned SHAs + conflict resolutions

REPO_URL="https://github.com/ckb-devrel/ccc.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/ccc"
PATCH_DIR="$SCRIPT_DIR/pins"

# Skip if already cloned
if [ -d "$REPO_DIR" ]; then
  echo "ccc-dev/ccc/ already exists, skipping (remove it to redo setup)" >&2
  exit 0
fi

# Skip if no pins to replay
if [ ! -f "$PATCH_DIR/REFS" ]; then
  echo "No CCC pins to replay, skipping" >&2
  exit 0
fi

trap 'rm -rf "$REPO_DIR"; echo "FAILED — cleaned up ccc-dev/ccc/" >&2' ERR

BASE_SHA=$(head -1 "$PATCH_DIR/REFS")
git clone --filter=blob:none "$REPO_URL" "$REPO_DIR"
git -C "$REPO_DIR" checkout "$BASE_SHA"
git -C "$REPO_DIR" checkout -b wip

MERGE_IDX=0
while IFS=' ' read -r SHA REF_NAME; do
  MERGE_IDX=$((MERGE_IDX + 1))
  echo "Replaying merge $MERGE_IDX: $REF_NAME ($SHA)" >&2

  # Pin identity and dates to match record.sh for deterministic commits
  export GIT_AUTHOR_NAME="ci" GIT_AUTHOR_EMAIL="ci@local"
  export GIT_COMMITTER_NAME="ci" GIT_COMMITTER_EMAIL="ci@local"
  export GIT_AUTHOR_DATE="@$MERGE_IDX +0000"
  export GIT_COMMITTER_DATE="@$MERGE_IDX +0000"

  git -C "$REPO_DIR" fetch origin "$SHA"

  # Use explicit merge message matching record.sh for deterministic commits
  MERGE_MSG="Merge $REF_NAME into wip"

  if ! git -C "$REPO_DIR" merge --no-ff -m "$MERGE_MSG" FETCH_HEAD; then
    # Apply saved conflict resolutions
    RESOLUTION_DIR="$PATCH_DIR/resolutions/$MERGE_IDX"
    if [ ! -d "$RESOLUTION_DIR" ]; then
      echo "ERROR: Conflict at step $MERGE_IDX ($REF_NAME) but no resolutions found" >&2
      exit 1
    fi

    # Get list of conflicted files to verify coverage
    mapfile -t CONFLICTED < <(git -C "$REPO_DIR" diff --name-only --diff-filter=U)

    while IFS= read -r FILE; do
      FILE="${FILE#./}"
      cp "$RESOLUTION_DIR/$FILE" "$REPO_DIR/$FILE"
      git -C "$REPO_DIR" add "$FILE"
    done < <(cd "$RESOLUTION_DIR" && find . -type f)

    # Verify all conflicted files have saved resolutions
    for FILE in "${CONFLICTED[@]}"; do
      if [ ! -f "$RESOLUTION_DIR/$FILE" ]; then
        echo "ERROR: No saved resolution for conflicted file '$FILE' at step $MERGE_IDX ($REF_NAME)" >&2
        echo "Re-record with:  ccc-dev/record.sh" >&2
        exit 1
      fi
    done

    # Overwrite MERGE_MSG so merge --continue uses our deterministic message
    echo "$MERGE_MSG" > "$REPO_DIR/.git/MERGE_MSG"
    GIT_EDITOR=true git -C "$REPO_DIR" merge --continue
  fi
done < <(tail -n +2 "$PATCH_DIR/REFS")

bash "$SCRIPT_DIR/patch.sh" "$REPO_DIR"

# Verify HEAD SHA matches recording
ACTUAL=$(git -C "$REPO_DIR" rev-parse HEAD)
EXPECTED=$(cat "$PATCH_DIR/HEAD")
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "ERROR: replay diverged from recording (expected $EXPECTED, got $ACTUAL)" >&2
  exit 1
fi
