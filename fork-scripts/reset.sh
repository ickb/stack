#!/usr/bin/env bash
set -euo pipefail

# Remove a fork clone and its pins (full reset).
# Usage: fork-scripts/reset.sh <fork-dir>

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

DEV_DIR="${1:?Usage: fork-scripts/reset.sh <fork-dir>}"
DEV_DIR=$(cd "$DEV_DIR" && pwd)

bash "$FORK_SCRIPTS_DIR/clean.sh" "$DEV_DIR"
rm -rf "$(pins_dir "$DEV_DIR")"
