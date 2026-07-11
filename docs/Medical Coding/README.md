# Medical Coding documentation

> **Last reviewed:** 2026-07-10  
> **Canonical home** for outpatient ICD-10 / CPT / HCPCS coding on the Somo platform.

## Read first

| Document | Purpose |
|----------|---------|
| **[KELLY_CODING_MASTER_EXECUTION_PLAN.md](./KELLY_CODING_MASTER_EXECUTION_PLAN.md)** | **Operator closeout SSOT** — D-01, K-02, F-09 appendices + 12-week program |
| **[COVERAGE_MATRIX.md](./COVERAGE_MATRIX.md)** | Patient-facing copay grid (PY-01 living doc) |
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | End-to-end architecture: data layer, retrieval, voice, billing, env vars, quality metrics |
| **[OPERATIONS.md](./OPERATIONS.md)** | Import, embeddings, prod parity, eval commands (links to deployment runbooks) |
| **[CODING-FOUNDATION.md](../../todos/CODING-FOUNDATION.md)** | Epic backlog — **eng complete**; operator closeout (D-01, K-02, F-09) |
| **[PENDING.md § P0.5 copay](../../todos/PENDING.md)** | Post-epic deferral, plan_rules, payer-class routing |

## Related deployment docs (do not duplicate here)

- [OPERATIONS.md](./OPERATIONS.md) — CMS file paths, import order, Pinecone, Stedi 837P
- [PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md) — prod row counts and MPFS migration
- [deployment OPERATIONS.md](../deployment/OPERATIONS.md) — Cloud Run env and deploy gates

## Code entry points (middleware)

| Surface | Location |
|---------|----------|
| Retrieval hub | `middleware-platform/services/knowledge-service.js` |
| Remote RAG | `middleware-platform/services/layer2-rag/` |
| Voice tools | `middleware-platform/webhooks/retell-websocket.js` |
| Eval | `middleware-platform/scripts/evaluate-accuracy.js` |
| Codebook SQL | `middleware-platform/database/repositories/medical-codes.js` |

See also [middleware-platform/ARCHITECTURE.md](../../middleware-platform/ARCHITECTURE.md) for how coding fits in the wider middleware layout.

## Stale or superseded docs

Do **not** use these for codebook counts, import commands, or voice retrieval paths without checking this folder first:

| Doc | Issue |
|-----|--------|
| [docs/knowledge-base/README.md](../knowledge-base/README.md) | Describes ~1,299 DHS CPT and ICD 2020 sources — **outdated** |
| [docs/architecture/README.md](../architecture/README.md) § voice runbook | Mixed freshness; many tables still say `getCodeCandidates` and localhost RAG — use banner at top of that file |
| Missing file | `docs/voice-agent/medical-voice-agent-prompt.md` is referenced by `configure-retell.js` but not in repo |

## Quick commands

From `middleware-platform/`:

```bash
npm run verify:prod-codebook
npm run audit:eval-cpt
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
```

Report: `middleware-platform/tmp/coding-accuracy-report.json`
