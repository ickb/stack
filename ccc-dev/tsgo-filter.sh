#!/usr/bin/env bash

# tsgo wrapper that filters diagnostics from CCC source files.
#
# Stack packages import CCC .ts source directly for real-time type feedback
# across the CCC/stack boundary. This means tsgo checks CCC files under the
# stack's stricter tsconfig (verbatimModuleSyntax, noImplicitOverride,
# noUncheckedIndexedAccess) — rules CCC doesn't follow. These aren't real
# integration errors, just tsconfig-strictness mismatches.
#
# This wrapper:
#   1. Runs tsgo with noEmitOnError=false so CCC diagnostics don't block emit
#   2. Emits .js + .d.ts output normally
#   3. Reports only diagnostics from stack source files
#   4. Exits non-zero only on real stack errors

set -euo pipefail

output=$(pnpm tsgo --noEmitOnError false 2>&1) || true

# Filter out diagnostic blocks originating from ccc-dev/ccc/ paths.
# A diagnostic block = a non-indented line (the error) + subsequent indented lines (details).
filtered=$(printf '%s\n' "$output" | awk '
  !/^[[:space:]]/ { skip = ($0 ~ /ccc-dev\/ccc\//) ? 1 : 0 }
  !skip { print }
')

if printf '%s\n' "$filtered" | grep -q 'error TS'; then
  printf '%s\n' "$filtered"
  exit 1
fi
