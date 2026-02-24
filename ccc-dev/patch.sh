#!/usr/bin/env bash
set -euo pipefail

# Patch a CCC clone for use in the stack workspace.
# Usage: ccc-dev/patch.sh <ccc-repo-dir> <merge-count>

# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

REPO_DIR="${1:?Usage: patch.sh <ccc-repo-dir> <merge-count>}"
MERGE_COUNT="${2:?Missing merge-count argument}"

# Remove CCC's own lockfile so deps are recorded in the root pnpm-lock.yaml
rm -f "$REPO_DIR/pnpm-lock.yaml"

# Patch CCC packages so the stack resolves directly to .ts source:
# - "type":"module" → NodeNext treats .ts files as ESM
# - "types" export condition → TypeScript resolves .ts source before .js dist
# - "import" rewritten to .ts source → Vite/esbuild can bundle without building CCC
for pkg_json in "$REPO_DIR"/packages/*/package.json; do
  jq '.type = "module" |
    if (.exports | type) == "object" then .exports |= with_entries(
      if .value | type == "object" and has("import")
      then .value |= (
        (.import | sub("/dist/";"/src/") | sub("\\.m?js$";".ts")) as $src |
        {types: $src, import: $src} + (. | del(.import, .types))
      )
      else . end
    ) else . end' "$pkg_json" > "$pkg_json.tmp" && mv "$pkg_json.tmp" "$pkg_json"
done

# Commit patched files with deterministic identity so record and replay produce the same hash
deterministic_env "$((MERGE_COUNT + 1))"
git -C "$REPO_DIR" add -A
git -C "$REPO_DIR" commit -m "patch: source-level type resolution"
