#!/usr/bin/env bash
set -euo pipefail

# Usage: pr.sh [--base <branch>] [--title <title>] [--body <body>]
#   Opens a GitHub PR creation page. Uses Claude to generate title/body if not provided.

command -v jq &>/dev/null || { echo "ERROR: 'jq' is required" >&2; exit 1; }

branch=$(git branch --show-current)
repo=$(git remote get-url origin | sed 's/\.git$//' | sed 's|git@github.com:|https://github.com/|')
base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
base=${base:-master}

title="" body=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --title) title="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ "$branch" == "$base" ]]; then
  echo "Already on $base, nothing to open a PR for." >&2
  exit 1
fi

if ! git rev-parse --verify "origin/$branch" &>/dev/null; then
  echo "Warning: $branch has not been pushed to origin. Push first or the PR link will 404." >&2
fi

# Generate title/body with Claude, fall back to branch name + commit log
if [[ -z "$title" || -z "$body" ]]; then
  log=$(git log "$base"..HEAD --no-merges --format="- %s")

  if command -v claude &>/dev/null; then
    # Prevent nested Claude Code detection
    unset CLAUDECODE 2>/dev/null || true

    if output=$(claude --print --model sonnet --no-session-persistence \
      -p 'Output ONLY a JSON object with "title" (concise, under 70 chars) and "body" (markdown with ## Why and ## Changes sections). Be brief.' <<EOF
Branch: $branch

Commits:
$log

Diff stat:
$(git diff "$base"...HEAD --stat)
EOF
    ); then
      # Parse null-delimited title and body from JSON
      { IFS= read -rd '' parsed_title; IFS= read -rd '' parsed_body; } \
        < <(sed '/^```\(json\)\?$/d' <<< "$output" | jq -rj '[.title // "", "\u0000", .body // "", "\u0000"] | add') || true
      [[ -z "$title" && -n "${parsed_title:-}" ]] && title="$parsed_title"
      [[ -z "$body" && -n "${parsed_body:-}" ]] && body="$parsed_body"
    fi
  fi

  # Fallback
  [[ -z "$title" ]] && title="$branch"
  [[ -z "$body" ]] && body="## Changes
$log"
fi

# Open PR creation page
urlencode() { printf '%s' "$1" | jq -sRr @uri; }
url="$repo/compare/$base...$branch?quick_pull=1&title=$(urlencode "$title")&body=$(urlencode "$body")"

if [[ -n "${BROWSER:-}" ]]; then "$BROWSER" "$url"
elif command -v xdg-open &>/dev/null; then xdg-open "$url"
elif command -v open &>/dev/null; then open "$url"
else echo "$url"
fi
