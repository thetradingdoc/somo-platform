# Mandarin (ZH) product gate — F0

**Decision (pilot):** `en_only` tenants treat unsupported caller languages via **handoff**, not full Mandarin conversation.

## Scope for ZH-1-fallback

- **In scope:** `forceLanguageHandoff` when caller opens in Mandarin on `language_mode=en_only`.
- **Out of scope:** Detection-layer fixes for sustained Mandarin dialogue, tone review, or `zh-CN` locale disclosure variants beyond handoff messaging.

## Harness

- Automated: `expectForceLanguageHandoff: true` on `ZH-1-fallback`.
- Human review: ES/RU tone only (`docs/qa/reviews/multilang-*.csv`); ZH is not in the human CSV gate.

## If roadmap changes

If product later enables `en_zh` or full Mandarin converse, re-open F2 (`evaluateFirstTurnLanguage`) and add ZH rows to the human review CSV.
