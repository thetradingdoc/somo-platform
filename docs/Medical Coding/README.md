# Medical Coding documentation

> **Last reviewed:** 2026-05-25  
> **Canonical home** for outpatient ICD-10 / CPT / HCPCS coding on the DocLittle platform.

## Read first

| Document | Purpose |
|----------|---------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | End-to-end architecture: data layer, retrieval, voice, billing, env vars, quality metrics |
| **[OPERATIONS.md](./OPERATIONS.md)** | Import, embeddings, prod parity, eval commands (links to deployment runbooks) |

## Related deployment docs (do not duplicate here)

- [MEDICAL_CODEBOOK_SETUP.md](../deployment/MEDICAL_CODEBOOK_SETUP.md) — CMS file paths, import order, Pinecone, Stedi 837P
- [PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md) — prod row counts and MPFS migration
- [RENDER_PRODUCTION_CHECKLIST.md](../deployment/RENDER_PRODUCTION_CHECKLIST.md) — Render env vars and webhook registration

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
