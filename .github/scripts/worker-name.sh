#!/usr/bin/env bash
# Name of the Cloudflare Worker for a git branch. main deploys to the production Worker;
# every other branch gets its own Worker, so its rooms (and any schema changes) stay apart from main's.
set -euo pipefail

base=humanitarian-ttx
branch="${1:?usage: worker-name.sh <branch>}"

if [ "$branch" = main ]; then
  echo "$base"
  exit 0
fi

# Worker names become DNS labels (<name>.<account>.workers.dev): lowercase letters, digits and dashes.
slug=$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//' | cut -c1-40 | sed -E 's/-+$//')
if [ -z "$slug" ]; then
  echo "Branch name '$branch' has no letters or digits to name a Worker after" >&2
  exit 1
fi
echo "$base-$slug"
