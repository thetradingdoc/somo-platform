#!/bin/bash
# Create GitHub Pull Request for somo-platform.
# Usage: gh pr create --title "..." --body "..." (preferred)
# Or set GITHUB_TOKEN and run this script with TITLE/BODY env vars.

REPO="richiejeremiah/somo-platform"
BASE="${BASE:-main}"
HEAD="${HEAD:-$(git branch --show-current)}"

TITLE="${TITLE:?Set TITLE=...}"
BODY="${BODY:?Set BODY=...}"

if command -v gh >/dev/null 2>&1; then
  exec gh pr create --repo "$REPO" --base "$BASE" --head "$HEAD" --title "$TITLE" --body "$BODY"
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Install GitHub CLI (gh) or set GITHUB_TOKEN."
  echo "Manual: https://github.com/$REPO/compare/$BASE...$HEAD?expand=1"
  exit 1
fi

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -d "$(jq -n --arg title "$TITLE" --arg body "$BODY" --arg head "$HEAD" --arg base "$BASE" \
    '{title: $title, body: $body, head: $head, base: $base}')" \
  "https://api.github.com/repos/$REPO/pulls"
