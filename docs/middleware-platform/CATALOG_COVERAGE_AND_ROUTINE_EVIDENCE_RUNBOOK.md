# Catalog coverage (X2) and routine evidence (Kelly)

## X2 — Automated catalog coverage metrics

The canonical implementation is `services/catalog-coverage-metrics.js` (`getCatalogCoverageMetrics`). It tolerates missing tables (older DBs) and returns counts plus **reasoning pair coverage**: share of unique `ingredient_interactions` pair keys that have a matching `knowledge_chunks.pair_key` row.

### CLI (read-only SQLite)

```bash
node middleware-platform/scripts/reasoning-catalog-coverage.cjs /path/to/data.sqlite
```

Output is JSON suitable for logs, dashboards, or CI artifacts.

### Kelly tool

`get_catalog_coverage_metrics` returns the same shape (against the process database). Intended for internal gap analysis, not patient-facing copy.

## X3 — Routine evidence contract (`evaluate_skincare_routine`)

### Canonical field: `evidence_bundle`

Successful routine evaluation returns:

- `verdict` — graph outcome (safe / caution / avoid, conflicts, reason codes, etc.).
- **`evidence_bundle`** — `{ schema_version: '1', chunks, chunk_ids, coverage }` where `chunks` always use the **unified retriever chunk shape** (same schema whether evidence came from the full orchestrator path or from legacy `ingredient_rag_chunks` fallback).

Clients should treat **`evidence_bundle`** as the single RAG/evidence surface for routine turns.

### Legacy dual shapes (opt-in)

If a client still expects **`rag_chunks`** (legacy DB row shape) and/or **`knowledge_chunk_bundle`** (`{ chunks, chunk_ids, coverage }` without `schema_version`), set:

```bash
export KELLY_ROUTINE_DUAL_RAG_SHAPES=1
```

When enabled, those fields are populated alongside `evidence_bundle`. Default is **off** (clean single bundle).

### Related environment flags

- **`KELLY_SKIP_UNIFIED_ROUTINE_BUNDLE=1`** — Skip `buildRoutineReasoningPayload` / unified chunk bundle; `evidence_bundle.chunks` are then derived from `getChunksForRoutineVerdict` and normalized to the unified chunk shape.

## Related docs

- Open Beauty Facts ingestion: `docs/OBF_INGESTION_RUNBOOK.md`
