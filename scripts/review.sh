#!/usr/bin/env bash
set -euo pipefail

# Usage: review.sh [--pr <number>]
#   Fetches and displays PR review comments from GitHub.
#   Auto-detects the PR for the current branch, or pass --pr <number>.

for cmd in jq curl; do
  command -v "$cmd" &>/dev/null || { echo "ERROR: '$cmd' is required" >&2; exit 1; }
done

# Extract owner/repo from remote
remote=$(git remote get-url origin | sed 's/\.git$//' | sed 's|git@github.com:|https://github.com/|')
owner_repo=$(echo "$remote" | sed 's|https://github.com/||')

pr_number=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) pr_number="$2"; shift 2 ;;
    *) shift ;;
  esac
done

api="https://api.github.com/repos/$owner_repo"
auth_header=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  auth_header=(-H "Authorization: token $GITHUB_TOKEN")
fi

# curl with retry on transient failures (5xx, rate-limit, network errors)
fetch() {
  curl -sf --retry 3 --retry-delay 2 --retry-all-errors \
    "${auth_header[@]+"${auth_header[@]}"}" "$1"
}

# Auto-detect PR number from current branch
if [[ -z "$pr_number" ]]; then
  branch=$(git branch --show-current)
  pr_number=$(fetch "$api/pulls?head=$(echo "$owner_repo" | cut -d/ -f1):$branch&state=open" \
    | jq -r '.[0].number // empty')

  if [[ -z "$pr_number" ]]; then
    echo "No open PR found for branch '$branch'." >&2
    exit 1
  fi
fi

echo "=== PR #$pr_number — $(fetch "$api/pulls/$pr_number" | jq -r '.title') ==="
echo

# General conversation comments (issue-level)
conversation=$(fetch "$api/issues/$pr_number/comments")
count=$(echo "$conversation" | jq length)
if [[ "$count" -gt 0 ]]; then
  echo "--- Conversation ---"
  echo "$conversation" | jq -r '.[] | "[\(.user.login)] \(.created_at)\n\(.body)\n"'
fi

# Review-level comments (approve/request changes/comment summaries)
reviews=$(fetch "$api/pulls/$pr_number/reviews")
review_count=$(echo "$reviews" | jq length)
if [[ "$review_count" -gt 0 ]]; then
  echo "--- Reviews ---"
  echo "$reviews" | jq -r '.[] | select(.body != "" and .body != null) | "[\(.user.login)] \(.state)\n\(.body)\n"'
fi

# Inline code comments
inline=$(fetch "$api/pulls/$pr_number/comments")
inline_count=$(echo "$inline" | jq length)
if [[ "$inline_count" -gt 0 ]]; then
  echo "--- Inline Comments ---"
  echo "$inline" | jq -r '.[] | "[\(.user.login)] \(.path):\(.line // .original_line // "?")\n\(.body)\n"'
fi

if [[ "$count" -eq 0 && "$review_count" -eq 0 && "$inline_count" -eq 0 ]]; then
  echo "No comments yet."
fi
