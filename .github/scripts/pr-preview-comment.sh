#!/usr/bin/env bash
# Post a branch's preview URL on its open pull request, as one comment that is updated in place.
# Usage: pr-preview-comment.sh <branch> <url> [commit]
# Needs GH_TOKEN with pull-requests: write, and GITHUB_REPOSITORY (both set in GitHub Actions).
set -euo pipefail

branch="${1:?usage: pr-preview-comment.sh <branch> <url> [commit]}"
url="${2:?usage: pr-preview-comment.sh <branch> <url> [commit]}"
commit="${3:-}"
marker='<!-- preview-link -->'

pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$branch" --state open --json number --jq '.[0].number // empty')
if [ -z "$pr" ]; then
  echo "No open pull request for $branch; nothing to link."
  exit 0
fi

body="$marker
**Preview:** $url${commit:+

Deployed from $commit. Boards here are separate from production and are deleted with the branch.}"

comment=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -1)
if [ -n "$comment" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$comment" -f body="$body" > /dev/null
  echo "Updated the preview link on #$pr."
else
  gh pr comment "$pr" --repo "$GITHUB_REPOSITORY" --body "$body" > /dev/null
  echo "Linked the preview on #$pr."
fi
