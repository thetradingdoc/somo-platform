# AD-01 — healthcare_clinic conditional RAG decision

**Status:** ADR recorded — **conditional on D-01** (Cloud Run Pinecone proof)  
**Date:** 2026-07-10  
**Gate:** G4 / AD-01

## Context

`healthcare_clinic` tenants use `triage_policy: disabled` in prompt profiles — admin phrase-map path instead of full OPQRST→RAG spine for some visit reasons.

## Decision

**Keep conditional RAG off for healthcare_clinic admin path** until:

1. D-01 Appendix A signed (MT-03 + Cloud Run env proven)
2. CP-05 ranking SSOT green in CI
3. Tenant matrix (AD-05) signed for pilot clinics

## Consequences

- Admin collect uses `resolve-admin-visit-codes.js` starter sets (MT-07 / AD-03)
- Full `run_triage_rag` remains available when `triage_policy: enabled` per tenant override
- Revisit after D-01 evidence in `PRODUCTION_PLAN_LOG.md`

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Enable RAG for all healthcare_clinic | Risk of coding tool bleed before F-09 sign-off |
| Disable RAG globally | Breaks medical voice golden path |

**Approver:** Product (Jay) — clinical lead sign-off via F-09
