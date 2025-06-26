#!/usr/bin/env bash
set -euo pipefail
#   -e: exit immediately if any command exits with non-zero
#   -u: treat unset variables as errors
#   -o pipefail: fail if any command in a pipeline fails

# Usage: ./.devcontainer/setup-local-store.sh REPO_URL REF [REPO_URL REF …]
#   REPO_URL: Git repository HTTPS or SSH URL
#   REF:      Either a commit SHA (7–40 hex chars), a PR number (digits), or a branch name
#
# Example: ./.devcontainer/setup-local-store.sh https://github.com/ckb-devrel/ccc.git 228

if [ $# -lt 2 ] || (( $# % 2 )); then
  echo "Usage: $0 REPO_URL REF [REPO_URL REF …]" >&2
  exit 1
fi

# Define workspace directories under current working directory
ROOT=$(pwd)
WORKDIR="$ROOT/.local-store"    # all cloned repos go here
CACHE="$WORKDIR/.cache"         # store last-built SHAs here
mkdir -p "$WORKDIR" "$CACHE"    # ensure directories exist

# Process each pair of arguments: repository URL + reference
while (( $# )); do
  REPO=$1; REF=$2; shift 2

  # Derive short name from repo URL (strip trailing '.git')
  NAME=$(basename "$REPO" .git)
  REPO_DIR="$WORKDIR/$NAME"

  # Clone the repo if not already cloned
  mkdir -p "$REPO_DIR"
  [ -d "$REPO_DIR/.git" ] || git clone "$REPO" "$REPO_DIR"

  # Enter repository directory quietly
  pushd "$REPO_DIR" >/dev/null

  # Fetch all remote updates and remove deleted refs
  git fetch origin --prune

  # Initialize flag for detached-SHA workflow
  DETACHED=

  # Case A: REF is a full (7–40 char) hex commit SHA
  if [[ $REF =~ ^[0-9a-f]{7,40}$ ]]; then
    # commit SHA
    BRANCH="FETCH_HEAD"
    SHA="$REF"
    DETACHED=1
    # explicitly fetch that commit
    git fetch --no-tags --depth=1 origin "$SHA"

  # Case B: REF is all digits → treat as GitHub pull request number
  elif [[ $REF =~ ^[0-9]+$ ]]; then
    REMOTE_REF="pull/$REF/head"
    BRANCH="pr-$REF"

  # Case C: otherwise, REF is a branch name under refs/heads
  else
    REMOTE_REF="refs/heads/$REF"
    # sanitize branch name (slashes → dashes)
    BRANCH=${REF//\//-}
  fi

  # If not in detached-SHA mode, fetch the specific remote ref into our origin namespace
  if [[ -z ${DETACHED:-} ]]; then
    git fetch origin "$REMOTE_REF:refs/remotes/origin/$BRANCH" --force
    # Resolve the commit SHA on origin/<branch>
    SHA=$(git rev-parse "origin/$BRANCH")
  fi

  # Prepare cache filename for this repository (single file per repo)
  CACHE_FILE="$CACHE/$NAME.sha"

  # If last-built SHA matches current SHA, skip the build
  if [[ -f $CACHE_FILE && $(<"$CACHE_FILE") == "$SHA" ]]; then
    echo "$NAME/$BRANCH @ $SHA — up to date, skipping build"
  else
    # Otherwise, reset, clean, and check out the required commit/branch
    if [[ -n ${DETACHED:-} ]]; then
      # Detached-SHA: reset to the SHA, remove untracked files, then check out the SHA
      git reset --hard FETCH_HEAD
      git clean -fd
      git -c advice.detachedHead=false checkout FETCH_HEAD
    else
      # Branch or PR: reset to origin/<branch>, remove untracked files, recreate local branch
      git reset --hard "origin/$BRANCH"
      git clean -fd
      git checkout -B "$BRANCH" "origin/$BRANCH"
    fi

    # Update cache and invoke build steps
    echo "$SHA" >"$CACHE_FILE"
    echo "Building $NAME/$BRANCH @ $SHA"
    pnpm install
    pnpm build
  fi

  # Return to the root directory before next iteration
  popd >/dev/null
done
