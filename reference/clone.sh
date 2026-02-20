#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Each line: <directory> <git-clone-url> [clone-flags...]
repos=(
  "contracts  https://github.com/ickb/contracts.git"
  "whitepaper https://github.com/ickb/whitepaper.git"
)

for entry in "${repos[@]}"; do
  read -r dir url flags <<< "$entry"
  if [ -d "$dir" ]; then
    local_head=$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo "unknown")
    remote_head=$(git ls-remote "$url" HEAD 2>/dev/null | cut -f1)
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
