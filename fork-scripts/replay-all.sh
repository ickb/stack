#!/usr/bin/env bash
set -euo pipefail

# Replay all managed fork directories from their pins.
# Usage: fork-scripts/replay-all.sh

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

while IFS= read -r dev_dir; do
  bash "$FORK_SCRIPTS_DIR/replay.sh" "$dev_dir"
done < <(discover_fork_dirs)
