#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Each line: <directory> <git-clone-url> [clone-flags...]
repos=(
  "contracts  https://github.com/ickb/contracts.git"
  "whitepaper https://github.com/ickb/whitepaper.git"
  "ccc-fee-payer https://github.com/ashuralyk/ccc.git --branch feat/fee-payer"
)

for entry in "${repos[@]}"; do
  read -r dir url flags <<< "$entry"
  if [ -d "$dir" ]; then
    local_head=$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo "unknown")
    # Extract branch from flags (--branch <name>) to compare the correct remote ref
    remote_ref="HEAD"
    if [[ "$flags" =~ --branch[[:space:]]+([^[:space:]]+) ]]; then
      remote_ref="refs/heads/${BASH_REMATCH[1]}"
    fi
    remote_head=$(git ls-remote "$url" "$remote_ref" 2>/dev/null | cut -f1)
    if [[ "$local_head" == "$remote_head" ]]; then
      echo "reference/$dir: up to date"
      continue
    fi
    echo "reference/$dir: outdated, re-cloning..."
    chmod -R u+w "$dir"
    rm -rf "$dir"
  else
    echo "reference/$dir: cloning..."
  fi
  git clone --depth 1 $flags "$url" "$dir"
  chmod -R a-w "$dir"
done
