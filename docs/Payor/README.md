# Payor Documentation Index

**Last Updated:** April 29, 2026  
**Scope:** Canonical payor/payer architecture, operations, source contracts, and production readiness.

## Read In This Order

1. **Architecture (source of truth)**  
   [`PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md`](./PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md)
2. **Operator runbook (CMS-authoritative path)**  
   [`PAYOR_CMS_TRACK_RUNBOOK.md`](./PAYOR_CMS_TRACK_RUNBOOK.md)
3. **Production gates and thresholds**  
   [`PRODUCTION_READINESS_BASELINE.md`](./PRODUCTION_READINESS_BASELINE.md)
4. **Source ownership and schema contracts**  
   [`PAYOR_SOURCE_CONTRACTS.md`](./PAYOR_SOURCE_CONTRACTS.md)
5. **Provider network evidence contract**  
   [`PROVIDER_NETWORK_INGESTION_CONTRACTS.md`](./PROVIDER_NETWORK_INGESTION_CONTRACTS.md)
6. **Naming convention (`payor` vs `payer`)**  
   [`PAYOR_NAMING_CONVENTION.md`](./PAYOR_NAMING_CONVENTION.md)
7. **Deferred/out-of-scope datasets**  
   [`PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md`](./PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md)

## Current Status Snapshot

- Offline ER pipeline (normalize/block/fuzzy/resolve/canonicalize) is implemented and documented.
- Runtime canonical resolver and provider network precheck are feature-flagged and documented.
- Remaining work is mostly operational/programmatic (vendor feeds, hosted dashboards, extended test matrix).

## Related Docs

- Docs parity tracker: [`../meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md`](../meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md)
- Detailed implementation checklist: [`../../todos/pending/PAYOR_ENTITY_RESOLUTION_TODOS.md`](../../todos/pending/PAYOR_ENTITY_RESOLUTION_TODOS.md)
