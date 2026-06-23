#!/usr/bin/env bash
# Install optional git hooks (local CI gate on push). Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/.git/hooks/pre-push"

cat > "$HOOKS" << 'EOF'
#!/usr/bin/env bash
# Local CI gate — skip with SKIP_CI=1 git push
if [[ "${SKIP_CI:-}" == "1" ]]; then
  echo "pre-push: SKIP_CI=1 — skipping ci:gate"
  exit 0
fi
ROOT="$(git rev-parse --show-toplevel)"
exec "$ROOT/scripts/ci-local.sh" fast
EOF

chmod +x "$HOOKS"
echo "Installed pre-push hook → npm run ci:fast (skip with SKIP_CI=1 git push)"
