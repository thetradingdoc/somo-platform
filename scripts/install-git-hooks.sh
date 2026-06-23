#!/usr/bin/env bash
# Install optional git hooks (Phase 0 CI gate on push). Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$ROOT/.git/hooks/pre-push"

cat > "$HOOKS" << 'EOF'
#!/usr/bin/env bash
# Phase 0 gate — override only with ALLOW_SKIP_CI=1 git push
if [[ "${ALLOW_SKIP_CI:-}" == "1" ]]; then
  echo "pre-push: ALLOW_SKIP_CI=1 — skipping ci:phase0"
  exit 0
fi
ROOT="$(git rev-parse --show-toplevel)"
exec npm run ci:phase0 --prefix "$ROOT"
EOF

chmod +x "$HOOKS"
echo "Installed pre-push hook → npm run ci:phase0 (override with ALLOW_SKIP_CI=1 git push)"
