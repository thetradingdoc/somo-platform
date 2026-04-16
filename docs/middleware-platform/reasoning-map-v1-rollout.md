# Reasoning Map v1 Rollout

## Purpose

`reasoning_map` is the Step-5 controller that arbitrates retrieval outputs before report synthesis.

## Feature Flag

- Env: `AGENT_REASONING_MAP_V1=true`
- Default: disabled (`false`)
- Kill switch: set to `false` and restart service.

## Batch Plan (8 + 8)

### Batch 1 (core map engine)

1. Contract + validator
2. Retrieval evidence normalization
3. Evidence scoring/ranking
4. Rails arbitration (`safety > contraindication > efficacy > preference`)
5. Negative rule set (hard blocks)
6. Positive rule set (safe recommendations)
7. Confidence policy bands (`high|medium|low`)
8. Snapshot integration (`snapshot.reasoning_map`)

### Batch 2 (production hardening)

1. LLM boundary guard (citation-only explanation)
2. Public/internal API exposure policy
3. Explainability UX payload fields
4. Observability metrics and counters
5. Unit/integration/e2e coverage
6. Replay/backfill harness
7. Shadow mode validation
8. Progressive rollout with rollback thresholds

## Shadow Mode

Use `AGENT_REASONING_MAP_V1=true` only in staging first, then:

1. Compute map for all sessions.
2. Do not gate user-facing recommendations on map output yet.
3. Track metrics:
   - `reasoning_map.generated.count`
   - `reasoning_map.safety_block.count`
   - `reasoning_map.escalated.count`
   - confidence-band distribution
4. Compare with legacy outcomes and edits.

## Minimal Acceptance Checks

- `reasoning_map` present in `session_result_snapshot` when flag enabled.
- Safety hard-block rules trigger for known unsafe combos.
- Low-confidence sessions request clarification instead of strong recommendations.
- No runtime regression when feature flag disabled.

