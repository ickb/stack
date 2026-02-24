#!/usr/bin/env bash
set -euo pipefail

# Remove a fork clone after verifying it has no pending work.
# Usage: fork-scripts/clean.sh <fork-dir>

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

DEV_DIR="${1:?Usage: fork-scripts/clean.sh <fork-dir>}"
DEV_DIR=$(cd "$DEV_DIR" && pwd)

bash "$FORK_SCRIPTS_DIR/status.sh" "$DEV_DIR"
rm -rf "$(repo_dir "$DEV_DIR")"
