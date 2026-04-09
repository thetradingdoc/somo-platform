#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

node "./scripts/test-product-taxonomy-gold.js"
node "./scripts/test-ingredient-risk-unit.js"

echo "product+ingredient taxonomy CI: PASS"
