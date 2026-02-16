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
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$SCRIPT_DIR/ccc"
PATCH_DIR="$SCRIPT_DIR/pins"

# Verify Claude CLI is available (needed for conflict resolution)
if [ $# -gt 0 ]; then
  if ! command -v claude &>/dev/null && ! pnpm exec claude --version &>/dev/null; then
    echo "ERROR: 'claude' CLI required for conflict resolution (npm i -g @anthropic-ai/claude-code)" >&2
    exit 1
  fi
fi

# Always start fresh — wipe previous clone and pins
rm -rf "$REPO_DIR" "$PATCH_DIR"

trap 'rm -rf "$REPO_DIR" "$PATCH_DIR"; echo "FAILED — cleaned up ccc-dev/ccc/ and pins/" >&2' ERR

git clone --filter=blob:none "$REPO_URL" "$REPO_DIR"

# Record base SHA before any merges
BASE_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
git -C "$REPO_DIR" checkout -b wip

# Prevent nested Claude Code detection when invoking claude CLI below
unset CLAUDECODE 2>/dev/null || true

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

    # Resolve each conflicted file with Claude
    for FILE in "${CONFLICTED[@]}"; do
      pnpm exec claude --print --model sonnet --no-session-persistence \
        -p "You are a merge conflict resolver. Output ONLY the resolved file content. Merge both sides meaningfully. No explanations, no code fences, no extra text." \
        < "$REPO_DIR/$FILE" > "$REPO_DIR/${FILE}.resolved"

      # Validate resolution is non-empty
      if [ ! -s "$REPO_DIR/${FILE}.resolved" ]; then
        echo "ERROR: Claude returned empty resolution for $FILE" >&2
        rm -f "$REPO_DIR/${FILE}.resolved"
        exit 1
      fi

      # Validate no conflict markers remain
      if grep -q '<<<<<<<' "$REPO_DIR/${FILE}.resolved"; then
        echo "ERROR: Conflict markers remain in $FILE after resolution" >&2
        rm -f "$REPO_DIR/${FILE}.resolved"
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

# Build CCC
rm -f "$REPO_DIR/pnpm-lock.yaml"
(cd "$REPO_DIR" && pnpm install)
(cd "$REPO_DIR" && pnpm run --if-present build:prepare && pnpm build)

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
