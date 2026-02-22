#!/usr/bin/env bash
set -euo pipefail

# Usage: ccc-dev/record.sh [ref ...]
#   ref auto-detection:
#     ^[0-9a-f]{7,40}$ → commit SHA
#     ^[0-9]+$          → GitHub PR number
#     everything else   → branch name
#   No refs → just clone, no merges

REPO_URL="https://github.com/ckb-devrel/ccc.git"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR/ccc"
PATCH_DIR="$SCRIPT_DIR/pins"

# Guard: abort if ccc-dev/ccc/ has pending work
if ! bash "$SCRIPT_DIR/status.sh" >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/status.sh" >&2
  echo "" >&2
  echo "ERROR: ccc-dev/ccc/ has pending work that would be lost." >&2
  echo "Push with 'pnpm ccc:push', commit, or remove ccc-dev/ccc/ manually." >&2
  exit 1
fi

# Always start fresh — wipe previous clone and pins (preserve local patches)
LOCAL_BAK=""
if [ -d "$PATCH_DIR/local" ]; then
  LOCAL_BAK=$(mktemp -d)
  cp -r "$PATCH_DIR/local" "$LOCAL_BAK/local"
fi
rm -rf "$REPO_DIR" "$PATCH_DIR"

trap 'rm -rf "$REPO_DIR" "$PATCH_DIR" "${LOCAL_BAK:-}"; echo "FAILED — cleaned up ccc-dev/ccc/ and pins/" >&2' ERR

git clone --filter=blob:none "$REPO_URL" "$REPO_DIR"

# Record base SHA before any merges
BASE_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
git -C "$REPO_DIR" checkout -b wip

MERGE_IDX=0

for REF in "$@"; do
  MERGE_IDX=$((MERGE_IDX + 1))

  # Pin identity and dates so merge commits are deterministic across runs
  export GIT_AUTHOR_NAME="ci" GIT_AUTHOR_EMAIL="ci@local"
  export GIT_COMMITTER_NAME="ci" GIT_COMMITTER_EMAIL="ci@local"
  export GIT_AUTHOR_DATE="@$MERGE_IDX +0000"
  export GIT_COMMITTER_DATE="@$MERGE_IDX +0000"

  # Case A: full (7-40 char) hex commit SHA
  if [[ $REF =~ ^[0-9a-f]{7,40}$ ]]; then
    git -C "$REPO_DIR" fetch --depth=1 origin "$REF"
    MERGE_REF="FETCH_HEAD"

  # Case B: all digits → GitHub pull request number
  elif [[ $REF =~ ^[0-9]+$ ]]; then
    git -C "$REPO_DIR" fetch origin "pull/$REF/head:pr-$REF"
    MERGE_REF="pr-$REF"

  # Case C: branch name
  else
    git -C "$REPO_DIR" fetch origin "refs/heads/$REF:$REF"
    MERGE_REF="$REF"
  fi

  # Capture the resolved SHA for this ref before merging
  MERGE_SHA=$(git -C "$REPO_DIR" rev-parse "$MERGE_REF")

  # Use explicit merge message so record and replay produce identical commits
  MERGE_MSG="Merge $REF into wip"

  if ! git -C "$REPO_DIR" merge --no-ff -m "$MERGE_MSG" "$MERGE_REF"; then
    # Capture conflicted file list BEFORE resolution
    mapfile -t CONFLICTED < <(git -C "$REPO_DIR" diff --name-only --diff-filter=U)

    # Resolve each conflicted file with AI Coworker
    for FILE in "${CONFLICTED[@]}"; do
      pnpm --silent coworker:ask \
        -p "You are a merge conflict resolver. Output ONLY the resolved file content. Merge both sides meaningfully. No explanations, no code fences, no extra text." \
        < "$REPO_DIR/$FILE" > "$REPO_DIR/${FILE}.resolved"

      # Validate resolution
      if [ ! -s "$REPO_DIR/${FILE}.resolved" ]; then
        echo "ERROR: AI Coworker returned empty resolution for $FILE" >&2
        exit 1
      fi
      if grep -q '<<<<<<<' "$REPO_DIR/${FILE}.resolved"; then
        echo "ERROR: Conflict markers remain in $FILE after resolution" >&2
        exit 1
      fi

      mv "$REPO_DIR/${FILE}.resolved" "$REPO_DIR/$FILE"
      git -C "$REPO_DIR" add "$FILE"
    done

    # Overwrite MERGE_MSG so merge --continue uses our deterministic message
    echo "$MERGE_MSG" > "$REPO_DIR/.git/MERGE_MSG"
    GIT_EDITOR=true git -C "$REPO_DIR" merge --continue

    # Save resolved versions of conflicted files
    for FILE in "${CONFLICTED[@]}"; do
      DEST="$PATCH_DIR/resolutions/$MERGE_IDX/$FILE"
      mkdir -p "$(dirname "$DEST")"
      cp "$REPO_DIR/$FILE" "$DEST"
    done
  fi

  # Append merge SHA + ref name to REFS
  mkdir -p "$PATCH_DIR"
  echo "$MERGE_SHA $REF" >> "$PATCH_DIR/REFS"
done

bash "$SCRIPT_DIR/patch.sh" "$REPO_DIR" "$MERGE_IDX"

# Restore preserved local patches
if [ -n "$LOCAL_BAK" ] && [ -d "$LOCAL_BAK/local" ]; then
  mkdir -p "$PATCH_DIR"
  cp -r "$LOCAL_BAK/local" "$PATCH_DIR/local"
  rm -rf "$LOCAL_BAK"
fi

# Apply local patches (sorted by filename for deterministic order)
LOCAL_DIR="$PATCH_DIR/local"
if [ -d "$LOCAL_DIR" ]; then
  LOCAL_IDX=$((MERGE_IDX + 1))
  for PATCH_FILE in $(find "$LOCAL_DIR" -name '*.patch' | sort); do
    LOCAL_IDX=$((LOCAL_IDX + 1))
    PATCH_NAME=$(basename "$PATCH_FILE" .patch)
    echo "Applying local patch: $PATCH_NAME"

    export GIT_AUTHOR_NAME="ci" GIT_AUTHOR_EMAIL="ci@local"
    export GIT_COMMITTER_NAME="ci" GIT_COMMITTER_EMAIL="ci@local"
    export GIT_AUTHOR_DATE="@$LOCAL_IDX +0000"
    export GIT_COMMITTER_DATE="@$LOCAL_IDX +0000"

    git -C "$REPO_DIR" apply "$PATCH_FILE"
    git -C "$REPO_DIR" add -A
    git -C "$REPO_DIR" commit -m "$PATCH_NAME"
  done
fi

# Prepend BASE SHA as first line of REFS
mkdir -p "$PATCH_DIR"
if [ -f "$PATCH_DIR/REFS" ]; then
  REFS_CONTENT="$BASE_SHA"$'\n'"$(cat "$PATCH_DIR/REFS")"
else
  REFS_CONTENT="$BASE_SHA"
fi
echo "$REFS_CONTENT" > "$PATCH_DIR/REFS"

# Save HEAD SHA for replay integrity verification
git -C "$REPO_DIR" rev-parse HEAD > "$PATCH_DIR/HEAD"

echo "Pins recorded in $PATCH_DIR/"
echo "  BASE=$BASE_SHA"
echo "  REFS=$(wc -l < "$PATCH_DIR/REFS") lines"
if [ -d "$PATCH_DIR/resolutions" ]; then
  echo "  Resolutions: $(find "$PATCH_DIR/resolutions" -type f | wc -l) file(s)"
else
  echo "  Resolutions: none (no conflicts)"
fi
