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
#   excluding package.json, README.md, and src/, then merges package.json.
#
# Usage:
#   sync.sh my-new-project
#   sync.sh ../foo ../bar

# Exit immediately on:
#   - any command returning non-zero (set -e),
#   - use of unset variables (set -u),
#   - failure within a pipeline (set -o pipefail).
set -euo pipefail

# Ensure at least one target directory is given.
if (( $# < 1 )); then
  echo "Usage: $0 <target> [<target>…]" >&2
  exit 1
fi

# Determine this script’s directory and name for rsync source.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
script_name="$(basename "${BASH_SOURCE[0]}")"

# Collect and validate absolute paths for each target.
targets=()
for t; do
  # Must already exist as a directory
  if [[ ! -d $t ]]; then
    echo "Error: '$t' does not exist or is not a directory" >&2
    exit 1
  fi

  # resolve to canonical absolute path
  abs_t="$(cd "$t" && pwd -P)"           

  # Guard against syncing into a sub-directory of the template itself.
  if [[ $abs_t == "$script_dir"* ]]; then
    echo "Error: '$t' is inside template dir $script_dir" >&2
    exit 1
  fi

  # Require write permission on the target directory.
  if [[ ! -w $abs_t ]]; then
    echo "Error: no write access to $abs_t" >&2
    exit 1
  fi

  targets+=("$abs_t")
done

# is_empty_dir <dir>
#   Returns 0 (success) if <dir> contains no entries
#   except optionally a .git/ directory; returns 1 otherwise.
is_empty_dir() {
  find "$1" -mindepth 1 \
    ! -path "$1/.git" \
    ! -path "$1/.git/*" \
    -print -quit \
  | grep -q . && return 1 || return 0
}

# Base rsync options:
#   --archive            preserve permissions, timestamps, etc.
#   --exclude=script     do not copy this sync script into targets
#   --exclude='.git/'    skip Git meta directory
#   --filter=':- .gitignore' respect .gitignore rules
RSYNC_OPTS=(
  --archive
  --exclude="$script_name"
  --exclude='pnpm-lock.yaml'
  --exclude='.git/'
  --filter=':- .gitignore'
)

# Loop over each validated target and perform sync.
for target in "${targets[@]}"; do
  echo ">>> Syncing to $target"

  if is_empty_dir "$target"; then
    # Full initial sync: copy all files, then transform "template" placeholders.
    echo "    Empty dir -> full sync"
    rsync "${RSYNC_OPTS[@]}" "$script_dir/." "$target/"

    # Replace every occurrence of the literal word "template" in package.json and README.md
    base="$(basename "$target")"
    for file in "$target/package.json" "$target/README.md"; do
      [[ -f $file ]] && sed -i "s/\btemplate\b/${base}/g" "$file"
    done

  else
    # Selective sync: exclude key project files and directories.
    echo "    Non-empty dir -> selective sync"
    rsync "${RSYNC_OPTS[@]}" \
      --exclude='package.json' \
      --exclude='README.md' \
      --exclude='src/**' \
      "$script_dir/." "$target/"

    # Merge package.json: keep existing fields but apply updated template defaults.
    old="$target/package.json"
    tmpl="$script_dir/package.json"
    merged="$target/package.json.tmp"
    base="$(basename "$target")"

    jq -j -n \
      --slurpfile new <(sed "s/template/${base}/g" "$tmpl") \
      --slurpfile old "$old" \
    '
      $new[0] as $new |
      $old[0] as $old |

      # Start with full template structure, then override preserved fields.
      $new
      | .name            = $old.name
      | .version         = $old.version
      | .description     = $old.description
      | .dependencies    = ($new.dependencies + $old.dependencies)
      | .devDependencies = ($new.devDependencies + $old.devDependencies)
      | .scripts         = ($new.scripts + $old.scripts)
    ' > "$merged" \
    && mv "$merged" "$old"
  fi
done
