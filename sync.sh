#!/usr/bin/env bash
# sync.sh — Synchronize this template directory into specified target dirs
#
# Synopsis:
#   sync.sh <target> [<target> …]
#
# Description:
#   Copies the contents of the directory containing this script
#   into one or more target directories. If a target is empty
#   (ignoring .git/), performs a “full sync” and replaces occurrences
#   of the literal word "template" in files with the target’s basename.
#   If a target already has content, performs a selective sync
#   excluding package.json, README.md, and src/.
#
# Usage:
#   sync.sh my-new-project
#   sync.sh ../foo ../bar

# Exit on error, undefined var, or pipe failure.
set -euo pipefail

# Ensure at least one target directory is specified.
if (( $# < 1 )); then
  echo "Usage: $0 <target> [<target>…]" >&2
  exit 1
fi

# Determine this script’s own directory and name, so we can rsync from here
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
script_name="$(basename "${BASH_SOURCE[0]}")"

# Collect and validate absolute target paths
targets=()
for t; do
  mkdir -p "$t"                              # create if missing
  abs_t="$(cd "$t" && pwd -P)"               # resolve to absolute path
  [[ ! -w $abs_t ]] && {                     # require write permission
    echo "Error: no write access to $abs_t" >&2
    exit 1
  }
  targets+=("$abs_t")
done

# is_empty_dir <dir>
#   Return 0 if <dir> contains no entries except maybe .git/,
#   Return 1 otherwise.
is_empty_dir() {
  find "$1" -mindepth 1 \
    ! -path "$1/.git" \
    ! -path "$1/.git/*" \
    -print -quit | grep -q . \
    && return 1 \
    || return 0
}

# Base rsync options: archive mode, exclude this script and .git/,
# respect .gitignore filters.
RSYNC_OPTS=(
  --archive
  --exclude="$script_name"
  --exclude='.git/'
  --filter=':- .gitignore'
)

# Perform sync for each validated target
for target in "${targets[@]}"; do
  echo ">>> Syncing to $target"

  if is_empty_dir "$target"; then
    # Full initial sync: copy everything and replace "template"
    echo "    Empty dir -> full sync"
    rsync "${RSYNC_OPTS[@]}" "$script_dir/." "$target"

    base="$(basename "$target")"
    # Replace occurrences of 'template' in all text files
    find "$target" -type f -exec grep -Il . {} + |
      while IFS= read -r file; do
        sed -i "s/template/${base}/g" "$file"
      done

  else
    # Selective sync: do not overwrite key project files
    echo "    Non-empty dir -> selective sync"
    rsync "${RSYNC_OPTS[@]}" \
      --exclude='package.json' \
      --exclude='README.md' \
      --exclude='src/**' \
      "$script_dir/." "$target"
  fi
done
