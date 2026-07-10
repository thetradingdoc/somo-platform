# Coding spine PHI retention — triage_rag_results and Pinecone

> **Last updated:** 2026-07-10  
> **Task:** CODING-FOUNDATION N-02  
> **Owner:** Engineering + Compliance  
> **Status:** Policy documented; `triage_rag_results` retention **not yet wired** in `cleanup-retention.js`

## Purpose

Voice and chat coding persist clinical narrative and structured triage output. This document classifies **PHI in coding tables and vector metadata**, defines **retention periods**, and lists **cleanup / legal-hold** procedures.

Related: [DATA_RETENTION_POLICY.md](./README.md#data-retention-policy) (general platform), [PHI_ENCRYPTION_AT_REST.md](./PHI_ENCRYPTION_AT_REST.md).

---

## PHI classification

### `triage_rag_results` (SQLite / Postgres mirror)

Authoritative triage output for the insurance collect spine. Written by `triage-rag-service.js`.

| Column | PHI? | Notes |
|--------|------|-------|
| `symptom_text` | **Yes** | Caller/patient symptom narrative |
| `opqrst_json` | **Yes** | Structured OPQRST (onset, quality, region, severity, etc.) |
| `patient_friendly_summary` | **Yes** | Kelly narration derived from clinical content |
| `soap_note` | **Yes** | Auto-generated clinical note when enabled |
| `specialist_context` | **Likely** | May include clinical framing |
| `differentials` | **Yes** | Diagnostic differentials |
| `red_flags` | **Yes** | Safety/triage flags |
| `icd_codes`, `cpt_codes`, `primary_icd10`, `primary_cpt`, `hcpcs_codes` | **Indirect PHI** | Codes alone are often not PHI; paired with session/patient they are PHI in context |
| `patient_id` | **Identifier** | Links to patient record |
| `session_id` | **Identifier** | Links to call/chat session |
| `coding_provenance_json` | **Metadata** | Source path only (`pinecone`, `local`, `admin`) — not clinical text |
| `seeded_for_harness` | No | Test flag — must be `0` on prod paths (G-06) |

**Billing linkage:** `resolve-insurance-codes.js` reads authoritative triage rows for RAG tenants; admin-path tenants may never write triage rows.

### `triage_sessions` (parent session)

| Policy today | 90 days (`config/retention-policy.js`) |
|--------------|----------------------------------------|
| Cleanup | `scripts/cleanup-retention.js` |

Triage session metadata may reference visit reason; treat as PHI when clinical.

### `coding_decisions` (HITL queue)

| Policy today | 7 years (2555 days) — billing audit |
|--------------|-------------------------------------|
| Contents | Resolved codes, confidence, review status — clinical context in `review_notes` if operators add them |

### Pinecone vector metadata

Two distinct index uses:

| Index use | What is stored | PHI today? |
|-----------|----------------|------------|
| **Code-metadata retrieval** (`pinecone-code-metadata-client.js`) | Chunk metadata fields: `icd10_codes`, `cpt_codes`, `hcpcs_codes` (code lists); descriptions resolved from SQLite at query time | **No patient narrative** — codebook chunks only |
| **Knowledge chunks sync** (`vector-sync-knowledge-chunks.cjs`) | `text` (up to 3500 chars), `chunk_id`, product/sku fields from `knowledge_chunks` | **No clinical triage** in current pipeline — supplement/commerce knowledge only |

**Prohibited without N-02 sign-off:** Upserting caller symptom text, OPQRST JSON, or transcript excerpts into Pinecone metadata or vector values. If a future feature indexes clinical text:

1. Complete Pinecone BAA (see [BAA checklist](./README.md#baa-compliance-checklist)).
2. Add tenant namespace isolation test (N-03).
3. Extend this doc with field-level redaction rules.
4. Add Pinecone namespace purge to tenant offboarding ([TENANT_OFFBOARDING.md](../runbooks/TENANT_OFFBOARDING.md)).

### Local `code_embeddings`

Stores embedding vectors + `description_text` from **licensed codebooks** (ICD/CPT/HCPCS/CDT descriptions), not patient utterances. Not PHI.

---

## Retention policy (coding-specific)

| Data store | Retention | Rationale | Implemented? |
|------------|-----------|-----------|--------------|
| `triage_rag_results` | **7 years** (2555 days) | Align with `coding_decisions` and CMS/payer audit lookback | **No** — add to `retention-policy.js` + cleanup |
| `triage_sessions` | 90 days | Operational triage state; clinical snippets may exist | **Yes** |
| `coding_decisions` | 7 years | Billing compliance | **Yes** |
| Pinecone code-metadata index | Indefinite (codebook) | No PHI; versioned by re-index on codebook refresh | N/A |
| Pinecone knowledge chunks | Until product retired or re-sync | No PHI today | Manual delete via Pinecone console if needed |

**Counsel review:** Confirm 7-year retention for `triage_rag_results` matches BAA and state medical-record rules. Placeholder in `retention-policy.js` for `kelly_conversation_history` (90 days) is separate from triage persistence.

---

## Deletion and minimization

### Automated cleanup (target state)

Add to `middleware-platform/config/retention-policy.js`:

```javascript
triage_rag_results: 2555,  // 7 years — pending counsel confirmation
```

Extend `scripts/cleanup-retention.js` to purge by `created_at` on `triage_rag_results` (same pattern as `triage_sessions`).

Until implemented, **do not assume** triage rows expire automatically.

### Tenant offboarding

On tenant delete:

1. Purge `triage_rag_results` where `session_id` belongs to tenant (via join on `triage_sessions` / `voice_call_log`).
2. Purge `coding_decisions` only per legal hold — default 7-year retention may require **anonymization** instead of delete.
3. Pinecone: no per-tenant clinical namespaces today; re-verify after any multi-tenant clinical index.

### Legal hold

When litigation or investigation applies:

1. Pause `cleanup-retention.js` for affected tables.
2. Record hold in `docs/compliance/legal-holds/`.
3. Do not run codebook DB restore over held data without legal approval.

### Minimization at write time

| Practice | Status |
|----------|--------|
| Do not copy full transcript into `symptom_text` when a short summary suffices | Recommended in triage-rag prompts |
| `coding_provenance_json` — provenance only, no clinical text | Implemented (F-08) |
| Redact PHI from logs (`voice-orchestration-trace`, debug flags) | Ongoing — `KELLY_DEBUG_TURN` off in prod |

---

## Verification checklist

```bash
cd middleware-platform

# Sample row — confirm no unexpected columns with raw transcript
sqlite3 "$DB_PATH" "PRAGMA table_info(triage_rag_results);"

# Count triage rows older than 7 years (should be 0 until policy enabled)
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM triage_rag_results WHERE created_at < datetime('now', '-2555 days');"

# Harness seeds must not appear on prod collect path
node scripts/verify-triage-spine.cjs

# Retention dry-run (triage_rag_results not listed until wired)
node scripts/cleanup-retention.js --dry-run
```

---

## Related documentation

- [CODING_SPINE_OUTAGE.md](../runbooks/CODING_SPINE_OUTAGE.md) — degrade paths when triage write fails
- [ARCHITECTURE.md](../Medical%20Coding/ARCHITECTURE.md) — triage → collect flow
- [VOICE_CODING_SPINE.md](../Medical%20Coding/VOICE_CODING_SPINE.md) — authoritative session binding
