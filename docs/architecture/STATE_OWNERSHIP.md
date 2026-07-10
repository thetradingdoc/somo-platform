# Session state ownership (Gate G1)

**Decision:** `kelly_rails_session_projection` is the single authoritative session-state store for Kelly Rails V2 and conversation-mode orchestration.

## Authoritative store

| Store | Role |
|-------|------|
| **`kelly_rails_session_projection`** | **SSOT** — lane, step, `flags_json`, appointment binding, tenant columns |
| `kelly_conversation_history` | Turn history (Phase 2 scope; not session flags) |
| `triage_sessions` | Clinical OPQRST / RAG row keyed by `session_id` (clinical facts, not lane/step) |

## Deprecated / mirror-only paths

| Store | Role |
|-------|------|
| `kelly_session_meta_kv` | **Deprecated write path** for orchestration keys. Commerce/checkout keys only (`meta-kv-policy.js`). Orchestration writes throw in non-prod and alert in prod. |
| `kelly_session_meta` | Legacy flat meta; do not add new readers |
| Postgres projection mirror | Eventual-consistency mirror when `KELLY_RAILS_SSOT_POSTGRES=1`; SQLite projection wins on read |

## Write authority

- **Turn pipeline:** `persistRailsSessionState()` in `services/kelly-rails/session-ssot.js` — sole writer for lane/step/flags projection.
- **Conversation mode (L4 enforce):** `mergeConversationStateUpdates()` / `saveConversationSession()` → projection only when `CONVERSATION_MODE_ROUTING=enforce`. Shadow mode must not write projection.
- **Front desk intake:** `persistFrontDeskProjection()` writes `fd_*` fields into projection; meta_kv mirror is optional via `fromMirror`.
- **Triage clinical fields:** `upsertTriageSession()` → `triage_sessions`; lane flags synced via `syncTriageFieldsToProjection()` when needed.

## Read authority

- **Turn start:** `hydrateSessionForTurn()` merges projection → meta_kv fallbacks → triage row. **Projection flags win** over stale meta_kv booleans.
- **L2 conversation load:** `loadConversationSession()` uses the same hydrate path as execute-turn.
- **Front desk:** `readFrontDeskState()` reads `fd_*` from projection first, meta_kv fallback only.

## Migrations 074 / 076 (tenant NOT NULL preflight)

Migrations `074_projection_triage_not_null` and `076_tenant_columns_not_null_preflight` refuse to apply while `clinic_id` is NULL on projection or triage rows. Before deploy:

```bash
cd middleware-platform
node scripts/verify-tenant-columns-null-free.cjs
node scripts/verify-migrations-074-076.cjs
```

Run backfill (`scripts/backfill-site-context-tenant-columns.cjs`) if nulls are reported.

## Verification

- Jest: `meta-kv-policy`, `kelly-rails-session-ssot`, `opqrst-pivot-survival`, `triage-session-id-unique`, `phase1-state-ssot` (hydrate / load / remap / shadow).
- Grep: orchestration keys must not be written to meta_kv except via `fromMirror` commerce mirror.
