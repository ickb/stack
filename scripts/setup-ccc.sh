#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/setup-ccc.sh [ref ...]
#   ref auto-detection:
#   - ^[0-9a-f]{7,40}$ → commit SHA
#   - ^[0-9]+$          → GitHub PR number
#   - everything else   → branch name
#   No args → just clone, no merges

REPO_URL="https://github.com/ckb-devrel/ccc.git"

# Skip if already cloned (remove ccc/ to redo setup)
if [ -d ccc ]; then
  echo "ccc/ already exists, skipping (remove it to redo setup)" >&2
  exit 0
fi
git clone "$REPO_URL" ccc

cd ccc
git checkout -b wip

CLAUDE="../node_modules/.bin/claude"
unset CLAUDECODE 2>/dev/null || true

for REF in "$@"; do
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

  if ! git merge --no-ff --no-edit "$MERGE_REF"; then
    # Resolve each conflicted file with Claude
    while IFS= read -r FILE; do
      "$CLAUDE" --print --model sonnet --no-session-persistence \
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
    done < <(git diff --name-only --diff-filter=U)

    GIT_EDITOR=true git merge --continue
  fi
done

# Build CCC
pnpm build:prepare && pnpm build
