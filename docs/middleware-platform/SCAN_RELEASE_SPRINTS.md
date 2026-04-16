# Scan Release Sprints (Pack C)

## Sprint 1 (P0): Identity Hit
- Flow: scan -> `obf_index_cache` or `live_api` -> hero card.
- Exit checks:
  - malformed barcode returns `400` + recovery guidance.
  - cache/live provenance is visible in API + UI.
  - timeout/unreachable returns retry guidance.

## Sprint 2 (P1): Safety Bridge
- Flow: tags + ingredient flags + confidence -> Analyze CTA state.
- Exit checks:
  - category route from tags (`cosmetic` / `hygiene` / `non_food`).
  - sparse data lowers CTA and prompts ingredient recovery.
  - ingredient flags surfaced in UI for quick risk cues.

## Sprint 3 (P1): Brain Handoff
- Flow: scan -> chat with pinned context -> second scan decision.
- Exit checks:
  - pinned product context is passed before chat follow-up.
  - second scan supports `compare` / `refine` / `reset`.
  - compare mode produces A vs B overlap/diff summary.
  - manual ingredient mode always uses hallucination guard copy.

## Resilience / Pipeline Gates
- Delta apply idempotency verified via `obf_delta_applied`.
- DLQ capture and retry loop verified via `obf:dlq:retry`.
- Ingestion metrics tracked: seen/upserted/failed.
- Runtime metrics tracked: cache hit/miss and fallback outcomes.

## Release Gate (Required)
- Unknown-product OCR/manual fallback must function before launch.
- Production smoke matrix:
  - 20 known
  - 20 unknown
  - 10 malformed
  - 5 no-barcode OCR/manual
- Run: `npm run smoke:release-pack-c` (set `API_BASE` and `SMOKE_KNOWN_CODES`).

