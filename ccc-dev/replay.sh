#!/usr/bin/env bash
set -euo pipefail

# Usage: ccc-dev/replay.sh
#   Deterministic replay from pinned SHAs + conflict resolutions

REPO_URL="https://github.com/ckb-devrel/ccc.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/ccc"
PINS_DIR="$SCRIPT_DIR/pins"

# Find the SHA-named pins file (40-char hex filename)
pins_file() {
  local f
  for f in "$PINS_DIR"/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
        echo "$f"; return 0 ;;
    esac
  done
  return 1
}

# Skip if already cloned
if [ -d "$REPO_DIR" ]; then
  echo "ccc-dev/ccc/ already exists, skipping (remove it to redo setup)" >&2
  exit 0
fi

# Skip if no pins to replay
PINS_FILE=$(pins_file 2>/dev/null) || {
  echo "No CCC pins to replay, skipping" >&2
  exit 0
}

trap 'rm -rf "$REPO_DIR"; echo "FAILED — cleaned up ccc-dev/ccc/" >&2' ERR

BASE_SHA=$(head -1 "$PINS_FILE" | cut -d' ' -f1)
git clone --filter=blob:none "$REPO_URL" "$REPO_DIR"

# Match record.sh's conflict marker style for identical reconstruction
git -C "$REPO_DIR" config merge.conflictStyle diff3

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
    mapfile -t CONFLICTED < <(git -C "$REPO_DIR" diff --name-only --diff-filter=U)

    for FILE in "${CONFLICTED[@]}"; do
      # Extract hunks for this merge/file from the pins file
      HUNK_DIR=$(mktemp -d)
      awk -v idx="$MERGE_IDX" -v fp="$FILE" -v hdir="$HUNK_DIR" '
      /^=== / {
        split($0, a, " ")
        if (a[2] == idx && a[3] == fp) { f = hdir "/" a[4]; active = 1 }
        else { active = 0 }
        next
      }
      active { print > f }
      ' "$PINS_FILE"

      if [ -z "$(ls "$HUNK_DIR" 2>/dev/null)" ]; then
        rm -rf "$HUNK_DIR"
        echo "ERROR: No saved resolution for '$FILE' at step $MERGE_IDX ($REF_NAME)" >&2
        echo "Re-record with:  pnpm ccc:record" >&2
        exit 1
      fi

      # Reconstruct resolved file by splicing saved hunks into conflict markers
      awk -v dir="$HUNK_DIR" '
      substr($0,1,7) == "<<<<<<<" {
        n++; f = dir "/" n
        while ((getline l < f) > 0) print l
        close(f); skip = 1; next
      }
      substr($0,1,7) == ">>>>>>>" { skip = 0; next }
      skip { next }
      { print }
      ' "$REPO_DIR/$FILE" > "$REPO_DIR/${FILE}.resolved"
      mv "$REPO_DIR/${FILE}.resolved" "$REPO_DIR/$FILE"
      rm -rf "$HUNK_DIR"
      git -C "$REPO_DIR" add "$FILE"
    done

    # Overwrite MERGE_MSG so merge --continue uses our deterministic message
    echo "$MERGE_MSG" > "$REPO_DIR/.git/MERGE_MSG"
    GIT_EDITOR=true git -C "$REPO_DIR" merge --continue
  fi
done < <(awk 'NR>1 && /^=== /{exit} NR>1' "$PINS_FILE")

bash "$SCRIPT_DIR/patch.sh" "$REPO_DIR" "$MERGE_IDX"

# Verify HEAD SHA matches filename
ACTUAL=$(git -C "$REPO_DIR" rev-parse HEAD)
EXPECTED=$(basename "$PINS_FILE")
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "FAIL: replay HEAD ($ACTUAL) != pinned HEAD ($EXPECTED)" >&2
  echo "Pins are stale or corrupted. Re-record with 'pnpm ccc:record'." >&2
  exit 1
fi

# Add fork remote for pushing to phroi/ccc (SSH for auth)
git -C "$REPO_DIR" remote add fork git@github.com:phroi/ccc.git

echo "OK — replay HEAD matches pinned HEAD ($EXPECTED)"
