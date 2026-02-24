#!/usr/bin/env bash
set -euo pipefail

# Check status of all managed fork directories.
# Exits non-zero if any fork has pending work.
# Usage: fork-scripts/status-all.sh

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

EXIT=0
for dev_dir in $(discover_fork_dirs); do
  bash "$FORK_SCRIPTS_DIR/status.sh" "$dev_dir" || EXIT=1
done
exit $EXIT
