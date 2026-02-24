#!/usr/bin/env bash
set -euo pipefail

# Usage: fork-scripts/push.sh <fork-dir> [target-branch]
#   Cherry-picks commits made after recording onto the PR branch.
#   target-branch: defaults to the last pr-* branch found.

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

DEV_DIR="${1:?Usage: fork-scripts/push.sh <fork-dir> [target-branch]}"
DEV_DIR=$(cd "$DEV_DIR" && pwd)
shift

REPO_DIR=$(repo_dir "$DEV_DIR")
PINS_DIR=$(pins_dir "$DEV_DIR")
FORK_NAME=$(basename "$DEV_DIR")

# Verify prerequisites
if [ ! -d "$REPO_DIR" ]; then
  echo "ERROR: $FORK_NAME clone does not exist. Run 'pnpm fork:record $FORK_NAME' first." >&2
  exit 1
fi

WIP_HEAD=$(pinned_head "$PINS_DIR" 2>/dev/null) || {
  echo "ERROR: No pins found. Run 'pnpm fork:record $FORK_NAME' first." >&2
  exit 1
}

# Verify we're on the wip branch
CURRENT_BRANCH=$(git -C "$REPO_DIR" branch --show-current)
if [ "$CURRENT_BRANCH" != "wip" ]; then
  echo "ERROR: Expected to be on 'wip' branch, but on '$CURRENT_BRANCH'." >&2
  CLONE_DIR=$(config_val "$DEV_DIR" '.cloneDir')
  echo "Switch back with:  cd $FORK_NAME/$CLONE_DIR && git checkout wip" >&2
  exit 1
fi

# Show commits to push
echo "Commits since recording:"
git -C "$REPO_DIR" log --oneline "$WIP_HEAD..HEAD"
echo ""

COMMIT_COUNT=$(git -C "$REPO_DIR" rev-list --count "$WIP_HEAD..HEAD")
if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "No new commits to push."
  exit 0
fi

# Determine target branch
if [ $# -gt 0 ]; then
  TARGET="$1"
else
  TARGET=$(git -C "$REPO_DIR" branch --list 'pr-*' | sed 's/^[* ]*//' | tail -1)
  if [ -z "$TARGET" ]; then
    echo "ERROR: No target branch. Pass a branch name or record a PR first." >&2
    exit 1
  fi
fi

CLONE_DIR=$(config_val "$DEV_DIR" '.cloneDir')
echo "Cherry-picking $COMMIT_COUNT commit(s) onto $TARGET..."
git -C "$REPO_DIR" checkout "$TARGET"
if ! git -C "$REPO_DIR" cherry-pick "$WIP_HEAD..wip"; then
  echo "" >&2
  echo "ERROR: Cherry-pick failed. To recover:" >&2
  echo "  cd $FORK_NAME/$CLONE_DIR" >&2
  echo "  # Resolve conflicts, then: git cherry-pick --continue" >&2
  echo "  # Or abort with: git cherry-pick --abort && git checkout wip" >&2
  exit 1
fi

echo ""
echo "Done. You are now on $TARGET with your commits applied."
echo "Push with:  cd $FORK_NAME/$CLONE_DIR && git push <remote> $TARGET:<branch>"
echo "Return to:  cd $FORK_NAME/$CLONE_DIR && git checkout wip"
