#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node "./scripts/test-skin-taxonomy-unit.js"
node "./scripts/test-skin-taxonomy-integration.js"
node "./scripts/test-skin-taxonomy-redteam.js"
node "./scripts/test-taxonomy-graph.js"

echo "skin taxonomy gates: PASS"
