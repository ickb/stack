#!/usr/bin/env bash

# tsgo wrapper that filters diagnostics from managed fork source files.
#
# Stack packages import fork .ts source directly for real-time type feedback
# across the fork/stack boundary. This means tsgo checks fork files under the
# stack's stricter tsconfig (verbatimModuleSyntax, noImplicitOverride,
# noUncheckedIndexedAccess) — rules forks may not follow. These aren't real
# integration errors, just tsconfig-strictness mismatches.
#
# This wrapper:
#   1. Reads fork entry names from forks/config.json
#   2. If none are cloned, runs plain tsgo (no filtering needed)
#   3. Otherwise runs tsgo with noEmitOnError=false so fork diagnostics don't block emit
#   4. Reports only diagnostics from stack source files
#   5. Exits non-zero only on real stack errors

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Build filter pattern from cloned fork entries
FILTER_PARTS=()
for name in $(jq -r 'keys[]' "$ROOT/forks/config.json" 2>/dev/null); do
  [ -d "$ROOT/forks/$name" ] && FILTER_PARTS+=("forks/$name/")
done

# No managed repos cloned — run plain tsgo
if [ ${#FILTER_PARTS[@]} -eq 0 ]; then
  exec pnpm tsgo
fi

# Build AWK filter pattern (pipe-separated)
FILTER_PATTERN=$(printf '%s\n' "${FILTER_PARTS[@]}" | paste -sd'|')

output=$(pnpm tsgo --noEmitOnError false 2>&1) || true

# Filter out diagnostic blocks originating from fork paths.
# A diagnostic block = a non-indented line (the error) + subsequent indented lines (details).
filtered=$(printf '%s\n' "$output" | awk -v pat="$FILTER_PATTERN" '
  !/^[[:space:]]/ { skip = ($0 ~ pat) ? 1 : 0 }
  !skip { print }
')

if printf '%s\n' "$filtered" | grep -q 'error TS'; then
  printf '%s\n' "$filtered"
  exit 1
fi
