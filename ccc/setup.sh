#!/usr/bin/env bash
set -euo pipefail

# Usage: ccc/setup.sh [--record|--replay|--help] [ref ...]
#   Modes:
#     --replay            Deterministic replay from pinned SHAs + conflict resolutions
#     --record [ref ...]  Merge refs + record SHAs and conflict resolutions
#     (no flag) [ref ...] Merge refs only (no recording)
#   ref auto-detection:
#     ^[0-9a-f]{7,40}$ → commit SHA
#     ^[0-9]+$          → GitHub PR number
#     everything else   → branch name
#   No refs → just clone, no merges

REPO_URL="https://github.com/ckb-devrel/ccc.git"
PATCH_DIR="ccc/patches"

case "${1:-}" in
  --replay)
    # Deterministic replay from pinned SHAs + saved conflict resolutions
    if [ -d ccc/.cache ]; then
      echo "ccc/.cache/ already exists, skipping (remove it to redo setup)" >&2
      exit 0
    fi
    if [ ! -f "$PATCH_DIR/REFS" ]; then
      echo "No CCC patches to replay, skipping" >&2
      exit 0
    fi

    BASE_SHA=$(head -1 "$PATCH_DIR/REFS")
    git clone "$REPO_URL" ccc/.cache
    cd ccc/.cache
    git config user.email "ci@local"
    git config user.name "ci"
    git checkout "$BASE_SHA"
    git checkout -b wip

    MERGE_IDX=0
    while IFS=' ' read -r SHA REF_NAME; do
      MERGE_IDX=$((MERGE_IDX + 1))

      git fetch origin "$SHA"

      if ! git merge --no-ff --no-edit FETCH_HEAD; then
        # Apply saved conflict resolutions
        RESOLUTION_DIR="../patches/resolutions/$MERGE_IDX"
        if [ ! -d "$RESOLUTION_DIR" ]; then
          echo "ERROR: Conflict at step $MERGE_IDX ($REF_NAME) but no resolutions found" >&2
          exit 1
        fi

        while IFS= read -r FILE; do
          FILE="${FILE#./}"
          cp "$RESOLUTION_DIR/$FILE" "$FILE"
          git add "$FILE"
        done < <(cd "$RESOLUTION_DIR" && find . -type f)

        GIT_EDITOR=true git merge --continue
      fi
    done < <(tail -n +2 "../patches/REFS")

    pnpm install --frozen-lockfile
    pnpm build:prepare && pnpm build
    # Remove CCC's workspace file so its packages join the stack workspace
    rm -f pnpm-workspace.yaml
    exit 0
    ;;

  --record)
    shift  # Remove --record, pass remaining args as refs
    RECORD=true
    ;;

  --help|-h)
    echo "Usage:"
    echo "  setup.sh [ref ...]           Merge mode (current behavior)"
    echo "  setup.sh --record [ref ...]  Merge + record SHAs and conflict resolutions"
    echo "  setup.sh --replay            Replay from pinned SHAs"
    exit 0
    ;;

  *)
    RECORD=false
    ;;
esac

# --- Merge logic ---

# Skip if already cloned (remove ccc/.cache/ to redo setup)
if [ -d ccc/.cache ]; then
  echo "ccc/.cache/ already exists, skipping (remove it to redo setup)" >&2
  exit 0
fi

# Clear stale patches before recording fresh ones
if [[ "$RECORD" == "true" ]]; then
  rm -rf "$PATCH_DIR/REFS" "$PATCH_DIR/resolutions"
fi

git clone "$REPO_URL" ccc/.cache

cd ccc/.cache
git config user.email "ci@local"
git config user.name "ci"

# Record base SHA before any merges
BASE_SHA=$(git rev-parse HEAD)
git checkout -b wip

# Prevent nested Claude Code detection when invoking claude CLI below
unset CLAUDECODE 2>/dev/null || true

MERGE_IDX=0

for REF in "$@"; do
  MERGE_IDX=$((MERGE_IDX + 1))

  # Case A: full (7-40 char) hex commit SHA
  if [[ $REF =~ ^[0-9a-f]{7,40}$ ]]; then
    git fetch --depth=1 origin "$REF"
    MERGE_REF="FETCH_HEAD"

  # Case B: all digits → GitHub pull request number
  elif [[ $REF =~ ^[0-9]+$ ]]; then
    git fetch origin "pull/$REF/head:pr-$REF"
    MERGE_REF="pr-$REF"

  # Case C: branch name
  else
    git fetch origin "refs/heads/$REF:$REF"
    MERGE_REF="$REF"
  fi

  # Capture the resolved SHA for this ref before merging
  MERGE_SHA=$(git rev-parse "$MERGE_REF")

  if ! git merge --no-ff --no-edit "$MERGE_REF"; then
    # Capture conflicted file list BEFORE resolution
    mapfile -t CONFLICTED < <(git diff --name-only --diff-filter=U)

    # Resolve each conflicted file with Claude
    for FILE in "${CONFLICTED[@]}"; do
      pnpm exec claude --print --model sonnet --no-session-persistence \
        -p "You are a merge conflict resolver. Output ONLY the resolved file content. Merge both sides meaningfully. No explanations, no code fences, no extra text." \
        < "$FILE" > "${FILE}.resolved"

      # Validate no conflict markers remain
      if grep -q '<<<<<<<' "${FILE}.resolved"; then
        echo "ERROR: Conflict markers remain in $FILE after resolution" >&2
        rm -f "${FILE}.resolved"
        exit 1
      fi

      mv "${FILE}.resolved" "$FILE"
      git add "$FILE"
    done

    GIT_EDITOR=true git merge --continue

    # Save resolved versions of conflicted files (record mode only)
    if [[ "$RECORD" == "true" ]]; then
      for FILE in "${CONFLICTED[@]}"; do
        DEST="../patches/resolutions/$MERGE_IDX/$FILE"
        mkdir -p "$(dirname "$DEST")"
        cp "$FILE" "$DEST"
      done
    fi
  fi

  # Append merge SHA + ref name to REFS (record mode only)
  if [[ "$RECORD" == "true" ]]; then
    mkdir -p "../patches"
    echo "$MERGE_SHA $REF" >> "../patches/REFS"
  fi
done

# Build CCC
pnpm install
pnpm build:prepare && pnpm build

# Remove CCC's workspace file so its packages join the stack workspace
rm -f pnpm-workspace.yaml

# --- Record patches if --record was used ---
if [[ "$RECORD" == "true" ]]; then
  cd ../..
  # Prepend BASE SHA as first line of REFS
  REFS_CONTENT="$BASE_SHA"$'\n'"$(cat "$PATCH_DIR/REFS")"
  echo "$REFS_CONTENT" > "$PATCH_DIR/REFS"

  # Clean up old format files if they exist
  rm -f "$PATCH_DIR/BASE" "$PATCH_DIR/combined.patch"

  echo "Patches recorded in $PATCH_DIR/"
  echo "  BASE=$BASE_SHA"
  echo "  REFS=$(wc -l < "$PATCH_DIR/REFS") lines"
  if [ -d "$PATCH_DIR/resolutions" ]; then
    echo "  Resolutions: $(find "$PATCH_DIR/resolutions" -type f | wc -l) file(s)"
  else
    echo "  Resolutions: none (no conflicts)"
  fi
fi
