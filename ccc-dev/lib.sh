#!/usr/bin/env bash
# Shared helpers for ccc-dev scripts

CCC_DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCC_DEV_PINS_DIR="$CCC_DEV_DIR/pins"
CCC_DEV_REPO_DIR="$CCC_DEV_DIR/ccc"
CCC_DEV_REPO_URL="https://github.com/ckb-devrel/ccc.git"

# Read the expected HEAD SHA from pins/HEAD
pinned_head() {
  local f="$CCC_DEV_PINS_DIR/HEAD"
  [ -f "$f" ] && cat "$f" || return 1
}

# Return path to pins/manifest if it exists
manifest_file() {
  local f="$CCC_DEV_PINS_DIR/manifest"
  [ -f "$f" ] && echo "$f" || return 1
}

# Check whether pins exist (manifest present)
has_pins() {
  [ -f "$CCC_DEV_PINS_DIR/manifest" ]
}

# Count merge refs in manifest (total lines minus base line)
merge_count() {
  local mf
  mf=$(manifest_file) || return 1
  echo $(( $(wc -l < "$mf") - 1 ))
}

# Export deterministic git identity for reproducible commits
# Usage: deterministic_env <epoch-seconds>
deterministic_env() {
  export GIT_AUTHOR_NAME="ci" GIT_AUTHOR_EMAIL="ci@local"
  export GIT_COMMITTER_NAME="ci" GIT_COMMITTER_EMAIL="ci@local"
  export GIT_AUTHOR_DATE="@$1 +0000" GIT_COMMITTER_DATE="@$1 +0000"
}

# Count files matching a glob pattern (pipefail-safe alternative to ls|wc -l)
# Usage: count_glob pattern  (e.g., count_glob "$dir"/local-*.patch)
count_glob() {
  local n=0
  for f in "$@"; do
    [ -f "$f" ] && n=$((n + 1))
  done
  echo "$n"
}

# Apply local patches from pins/ as deterministic commits.
# Timestamp sequence continues from patch.sh: merge_count+1 is patch.sh,
# so local patches start at merge_count+2.
# Returns 1 if any patch fails to apply (caller should add remediation advice).
# Usage: apply_local_patches <repo-dir>
apply_local_patches() {
  local repo_dir="$1"
  local mc ts patch name
  mc=$(merge_count) || mc=0
  ts=$((mc + 2))
  for patch in "$CCC_DEV_PINS_DIR"/local-*.patch; do
    [ -f "$patch" ] || return 0
    name=$(basename "$patch" .patch)
    echo "Applying local patch: $name" >&2
    if ! git -C "$repo_dir" apply "$patch"; then
      echo "ERROR: Local patch $name failed to apply." >&2
      return 1
    fi
    deterministic_env "$ts"
    git -C "$repo_dir" add -A
    git -C "$repo_dir" commit -m "local: $name"
    ts=$((ts + 1))
  done
}
