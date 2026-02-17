#!/usr/bin/env bash
set -euo pipefail

# Patch a CCC clone for use in the stack workspace.
# Usage: ccc-dev/patch.sh <ccc-repo-dir>

REPO_DIR="${1:?Usage: patch.sh <ccc-repo-dir>}"

# Remove CCC's own lockfile so deps are recorded in the root pnpm-lock.yaml
rm -f "$REPO_DIR/pnpm-lock.yaml"

# Patch CCC packages so the stack resolves directly to .ts source:
# - "type":"module" → NodeNext treats .ts files as ESM
# - "types" export condition → TypeScript resolves .ts source before .js dist
# - "import" rewritten to .ts source → Vite/esbuild can bundle without building CCC
for pkg_json in "$REPO_DIR"/packages/*/package.json; do
  jq '.type = "module" |
    if .exports then .exports |= with_entries(
      if .value | type == "object" and has("import")
      then .value |= (
        (.import | sub("/dist/";"/src/") | sub("\\.m?js$";".ts")) as $src |
        {types: $src, import: $src} + (. | del(.import, .types))
      )
      else . end
    ) else . end' "$pkg_json" > "$pkg_json.tmp" && mv "$pkg_json.tmp" "$pkg_json"
done
