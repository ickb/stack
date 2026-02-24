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
PINS_DIR="$SCRIPT_DIR/pins"

# ---------------------------------------------------------------------------
# resolve_conflict <conflicted-file> <merge-idx> <file-rel-path>
#   Tiered merge conflict resolution (diff3 markers required):
#     Tier 0: Deterministic — one side matches base → take the other (0 tokens)
#     Tier 1: Strategy classification — LLM picks OURS/THEIRS/BOTH/GENERATE (~5 tokens)
#     Tier 2: Code generation — LLM generates merged code for hunks only
#   Outputs the resolved file to stdout.
#   Appends per-hunk entries to sidecar file (collected into pins after merge).
# ---------------------------------------------------------------------------
resolve_conflict() {
  local FILE="$1" M_IDX="$2" F_REL="$3"
  local COUNT WORK i OURS BASE THEIRS

  COUNT=$(awk 'substr($0,1,7)=="<<<<<<<"{n++} END{print n+0}' "$FILE")
  [ "$COUNT" -gt 0 ] || { echo "ERROR: no conflict markers in $FILE" >&2; return 1; }

  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' RETURN

  # Extract ours / base / theirs for each conflict hunk
  awk -v dir="$WORK" '
  substr($0,1,7) == "<<<<<<<" { n++; section = "ours"; next }
  index($0, "|||||||") == 1   { section = "base";  next }
  substr($0,1,7) == "=======" { section = "theirs"; next }
  substr($0,1,7) == ">>>>>>>" { section = ""; next }
  section { print > (dir "/c" n "_" section) }
  ' "$FILE"

  # Ensure ours/theirs files exist even for empty hunks (edit/delete conflicts)
  for i in $(seq 1 "$COUNT"); do
    touch "$WORK/c${i}_ours" "$WORK/c${i}_theirs"
  done

  # Tier 0: Deterministic resolution (no LLM needed)
  local NEED_LLM=()
  for i in $(seq 1 "$COUNT"); do
    OURS="$WORK/c${i}_ours"; BASE="$WORK/c${i}_base"; THEIRS="$WORK/c${i}_theirs"
    if [ ! -f "$BASE" ]; then
      NEED_LLM+=("$i"); continue
    fi
    if diff -q "$OURS" "$BASE" >/dev/null 2>&1; then
      cp "$THEIRS" "$WORK/r$i"
      echo "  conflict $i: deterministic (take theirs)" >&2
    elif diff -q "$THEIRS" "$BASE" >/dev/null 2>&1; then
      cp "$OURS" "$WORK/r$i"
      echo "  conflict $i: deterministic (take ours)" >&2
    elif diff -q "$OURS" "$THEIRS" >/dev/null 2>&1; then
      cp "$OURS" "$WORK/r$i"
      echo "  conflict $i: deterministic (sides identical)" >&2
    else
      NEED_LLM+=("$i")
    fi
  done

  # --- helper: verify, write hunks to .resolutions sidecar, reconstruct to stdout ---
  _finish() {
    for i in $(seq 1 "$COUNT"); do
      [ -f "$WORK/r$i" ] || { echo "ERROR: missing resolution for conflict $i in $FILE" >&2; return 1; }
    done
    # Write hunks to a sidecar file (appended to flat file after parallel jobs finish)
    for i in $(seq 1 "$COUNT"); do
      echo "=== $M_IDX $F_REL $i ===" >> "$FILE.resolutions"
      cat "$WORK/r$i" >> "$FILE.resolutions"
    done
    awk -v dir="$WORK" '
    substr($0,1,7) == "<<<<<<<" { n++; f = dir "/r" n; while ((getline l < f) > 0) print l; close(f); skip = 1; next }
    substr($0,1,7) == ">>>>>>>" { skip = 0; next }
    skip { next }
    { print }
    ' "$FILE"
  }

  [ ${#NEED_LLM[@]} -eq 0 ] && { _finish; return; }

  # Tier 1: Strategy classification (~5 output tokens per conflict)
  local CLASSIFY_INPUT="" STRATEGIES NUM STRATEGY REST NEED_GENERATE=()
  for i in "${NEED_LLM[@]}"; do
    CLASSIFY_INPUT+="=== CONFLICT $i ===
--- ours ---
$(cat "$WORK/c${i}_ours")
--- base ---
$(cat "$WORK/c${i}_base" 2>/dev/null || echo "(unavailable)")
--- theirs ---
$(cat "$WORK/c${i}_theirs")

"
  done

  STRATEGIES=$(echo "$CLASSIFY_INPUT" | pnpm --silent coworker:ask \
    -p "For each conflict, respond with ONLY the conflict number and one strategy per line:
N OURS       — keep ours (theirs is outdated/superseded)
N THEIRS     — keep theirs (ours is outdated/superseded)
N BOTH_OT    — concatenate ours then theirs
N BOTH_TO    — concatenate theirs then ours
N GENERATE   — needs custom merge
No explanations.")

  while IFS=' ' read -r NUM STRATEGY REST; do
    [[ "${NUM:-}" =~ ^[0-9]+$ ]] || continue
    case "$STRATEGY" in
      OURS)    cp "$WORK/c${NUM}_ours" "$WORK/r$NUM";   echo "  conflict $NUM: classified → OURS" >&2 ;;
      THEIRS)  cp "$WORK/c${NUM}_theirs" "$WORK/r$NUM"; echo "  conflict $NUM: classified → THEIRS" >&2 ;;
      BOTH_OT) cat "$WORK/c${NUM}_ours" "$WORK/c${NUM}_theirs" > "$WORK/r$NUM"; echo "  conflict $NUM: classified → BOTH (ours first)" >&2 ;;
      BOTH_TO) cat "$WORK/c${NUM}_theirs" "$WORK/c${NUM}_ours" > "$WORK/r$NUM"; echo "  conflict $NUM: classified → BOTH (theirs first)" >&2 ;;
      GENERATE) NEED_GENERATE+=("$NUM"); echo "  conflict $NUM: classified → GENERATE" >&2 ;;
      *) NEED_GENERATE+=("$NUM"); echo "  conflict $NUM: unrecognized '$STRATEGY', falling back to GENERATE" >&2 ;;
    esac
  done <<< "$STRATEGIES"

  [ ${#NEED_GENERATE[@]} -eq 0 ] && { _finish; return; }

  # Tier 2: Code generation (only for GENERATE conflicts — hunks only output)
  local GENERATE_INPUT="" GENERATED
  for i in "${NEED_GENERATE[@]}"; do
    GENERATE_INPUT+="=== CONFLICT $i ===
--- ours ---
$(cat "$WORK/c${i}_ours")
--- base ---
$(cat "$WORK/c${i}_base" 2>/dev/null || echo "(unavailable)")
--- theirs ---
$(cat "$WORK/c${i}_theirs")

"
  done

  GENERATED=$(echo "$GENERATE_INPUT" | pnpm --silent coworker:ask \
    -p "Merge each conflict meaningfully. Output '=== RESOLUTION N ===' header followed by ONLY the merged code. No explanations, no code fences.")

  echo "$GENERATED" | awk -v dir="$WORK" '
  /^=== RESOLUTION [0-9]+ ===$/ { if (f) close(f); f = dir "/r" $3; buf = ""; next }
  f && /^[[:space:]]*$/ { buf = buf $0 "\n"; next }
  f { if (buf != "") { printf "%s", buf > f; buf = "" }; print > f }
  END { if (f) close(f) }
  '

  _finish
}

# Guard: abort if ccc-dev/ccc/ has pending work
if ! bash "$SCRIPT_DIR/status.sh" >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/status.sh" >&2
  echo "" >&2
  echo "ERROR: ccc-dev/ccc/ has pending work that would be lost." >&2
  echo "Push with 'pnpm ccc:push', commit, or remove ccc-dev/ccc/ manually." >&2
  exit 1
fi

# Always start fresh — wipe previous clone and pins
rm -rf "$REPO_DIR" "$PINS_DIR"

cleanup_on_error() {
  rm -rf "$REPO_DIR" "$PINS_DIR"
  echo "FAILED — cleaned up ccc-dev/ccc/ and pins/" >&2
}
trap cleanup_on_error ERR

git clone --filter=blob:none "$REPO_URL" "$REPO_DIR"

# Enable diff3 conflict markers so conflict resolution can see the base version
git -C "$REPO_DIR" config merge.conflictStyle diff3

# Capture default branch name and base SHA before any merges
DEFAULT_BRANCH=$(git -C "$REPO_DIR" branch --show-current)
BASE_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
git -C "$REPO_DIR" checkout -b wip

MERGE_IDX=0
REFS_TMP=$(mktemp)
RESOLUTIONS_TMP=$(mktemp)

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

  # Append merge ref line
  echo "$MERGE_SHA $REF" >> "$REFS_TMP"

  # Use explicit merge message so record and replay produce identical commits
  MERGE_MSG="Merge $REF into wip"

  if ! git -C "$REPO_DIR" merge --no-ff -m "$MERGE_MSG" "$MERGE_REF"; then
    # Capture conflicted file list BEFORE resolution
    mapfile -t CONFLICTED < <(git -C "$REPO_DIR" diff --name-only --diff-filter=U)

    # Resolve conflicted files with AI Coworker (parallel, hunks-only)
    PIDS=()
    for FILE in "${CONFLICTED[@]}"; do
      resolve_conflict "$REPO_DIR/$FILE" "$MERGE_IDX" "$FILE" \
        > "$REPO_DIR/${FILE}.resolved" &
      PIDS+=($!)
    done

    # Wait for all resolutions and check exit codes
    for i in "${!PIDS[@]}"; do
      if ! wait "${PIDS[$i]}"; then
        echo "ERROR: AI Coworker failed for ${CONFLICTED[$i]}" >&2
        exit 1
      fi
    done

    # Validate, apply resolutions, and collect hunk entries
    for FILE in "${CONFLICTED[@]}"; do
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

      # Append per-file resolution hunks to resolutions temp file
      cat "$REPO_DIR/${FILE}.resolutions" >> "$RESOLUTIONS_TMP"
      rm "$REPO_DIR/${FILE}.resolutions"
    done

    # Overwrite MERGE_MSG so merge --continue uses our deterministic message
    echo "$MERGE_MSG" > "$REPO_DIR/.git/MERGE_MSG"
    GIT_EDITOR=true git -C "$REPO_DIR" merge --continue
  fi
done

bash "$SCRIPT_DIR/patch.sh" "$REPO_DIR" "$MERGE_IDX"

# Build the final pins file: base + refs + resolutions, named by HEAD SHA
HEAD_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
mkdir -p "$PINS_DIR"

{
  echo "$BASE_SHA $DEFAULT_BRANCH"
  [ -s "$REFS_TMP" ] && cat "$REFS_TMP"
  [ -s "$RESOLUTIONS_TMP" ] && cat "$RESOLUTIONS_TMP"
} > "$PINS_DIR/$HEAD_SHA"
rm -f "$REFS_TMP" "$RESOLUTIONS_TMP"

RESOLUTION_COUNT=$(grep -c '^=== ' "$PINS_DIR/$HEAD_SHA" 2>/dev/null || echo 0)

echo "Pins recorded in $PINS_DIR/"
echo "  BASE=$BASE_SHA ($DEFAULT_BRANCH)"
echo "  Merges: $MERGE_IDX ref(s)"
if [ "$RESOLUTION_COUNT" -gt 0 ]; then
  echo "  Resolutions: $RESOLUTION_COUNT hunk(s)"
else
  echo "  Resolutions: none (no conflicts)"
fi
echo "  HEAD=$HEAD_SHA"
