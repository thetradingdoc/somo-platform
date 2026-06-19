# OPQRST Provocation Policy

**Status:** Active (Field Gate v1)  
**Scope:** Kelly voice/chat front-desk agent — all specialties via `target_specialty`

## Purpose

Stop the inbound voice loop where Kelly repeats "What makes it better or worse?" because four systems (voice formatter, tool allowlists, capture guard, reroute) made independent decisions without a shared source of truth.

## Product rules

### Front desk is multi-specialty

Kelly is a **general front-desk agent**, not a dermatology-only tool. OPQRST adaptation uses:

- `triage_sessions.target_specialty` (from RAG or intake)
- [clinical-opqrst-registry.js](middleware-platform/services/clinical-opqrst-registry.js) `specialty_notes` (cardiology, psychiatry, dermatology, etc.)

Policy is **not** keyed on specialty name containing "derm".

### Provocation default: optional

| Field | Required for `opqrst_complete` (default) |
|-------|------------------------------------------|
| Onset | Yes |
| Quality | Yes |
| Severity | Yes |
| Timing | Yes |
| Provocation | **No** (optional) |
| Radiation | No (skipped for psychiatry) |
| Region | No (nice-to-have for routing) |

### Tenant override: `triage_policy: required`

When tenant policy is `required` (see [tenant-policy.js](middleware-platform/services/conversation-mode/tenant-policy.js)), provocation **is** required for `opqrstComplete`.

### Single source of truth

- **Field fill state:** `triage_sessions` row only
- **Coordinator:** [opqrst-field-gate.js](middleware-platform/services/opqrst-field-gate.js)
- **Never** use L4 `state.step` to infer which OPQRST field is missing

## Rollback

Set environment variable:

```bash
OPQRST_FIELD_GATE_ENABLED=0
```

Redeploy middleware. **Dual-path F-1:** default is gate **on** (`OPQRST_FIELD_GATE_ENABLED=1` or unset). Set `=0` for legacy step-based formatter, capture guard, and L4 allowlists (rollback only).

See [OPERATIONS.md](../runbooks/OPERATIONS.md) — OPQRST Field Gate section.

## R-5a pre-ship pivot frequency (go/no-go)

Measure: **% of clinical-mode sessions with ≥1 billing pivot before `opqrstComplete`**

Run: `node middleware-platform/scripts/opqrst-billing-pivot-frequency.cjs`

| Frequency | Decision |
|-----------|----------|
| **≥ 10%** | PR2 (pivot survival) **blocks** PR1 prod merge |
| **3–10%** | PR1 may ship to staging / non-billing tenants only until PR2 merges |
| **< 3%** | PR1 + PR2 may ship in same release train within 1 week |

### Measured result (fill before prod enable)

| Date | % | Decision | Notes |
|------|---|----------|-------|
| 2026-06-18 | 0% | same_train_ok | Dev DB: 0 clinical pivot events |
| 2026-06-18 | 0% | same_train_ok | Staging GCS DB (`middleware-staging.db`): 0/1 billing pivots during clinical |

## Kelly prompt alignment (P-1)

- Default prompt: collect OPQRST; provocation is **if relevant**, not unconditional step 2
- `triage_policy: required` tenants: provocation is mandatory before booking promotion

## Related docs

- [OPQRST_COMPLETION_AUDIT.md](./OPQRST_COMPLETION_AUDIT.md)
- [OPQRST_FIELD_GATE_ARCHITECTURE.md](./OPQRST_FIELD_GATE_ARCHITECTURE.md)
- [todos/OPQRST-FIELD-GATE.md](../../todos/OPQRST-FIELD-GATE.md)
