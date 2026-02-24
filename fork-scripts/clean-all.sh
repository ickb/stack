#!/usr/bin/env bash
set -euo pipefail

# Clean all managed fork clones (status-check each before removing).
# Usage: fork-scripts/clean-all.sh

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

for dev_dir in $(discover_fork_dirs); do
  bash "$FORK_SCRIPTS_DIR/clean.sh" "$dev_dir" || true
done
