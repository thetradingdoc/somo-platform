# Middleware platform architecture

Last updated: 2026-06-17

## 2026-06-17 changelog

- Linked Kelly orchestration architecture SSOT and gap matrix docs.

- Added conversation-mode call-control architecture references and runtime entrypoints.
- Updated voice/Kelly ownership to include resolver + pivot + mode-dispatch integration.

## Entry points

| Path | Role |
|------|------|
| [`server.js`](server.js) | Process entry: env validation, Express app, route mounting, listen |
| [`database.js`](database.js) | SQLite (and optional Postgres sync) facade — **stable import path** for the app |
| [`webhooks/retell-websocket.js`](webhooks/retell-websocket.js) | Retell voice WebSocket → Kelly / triage |
| [`services/kelly-agent-service.js`](services/kelly-agent-service.js) | LLM turn loop (voice + chat) |

## Layering

```text
HTTP (routes/*.js)
  → services/*.js (business rules)
    → database.js facade
      → database/repositories/* (domain SQL, Phase 1+)
```

## Persistence

- **Facade:** `require('./database')` or `require('../database')` — do not change import paths during phased refactor.
- **Repositories:** [`database/repositories/`](database/repositories/) — new domain SQL lives here and is re-exported from `database.js`.
- **Migrations:** [`database/migrations/run-startup-migrations.js`](database/migrations/run-startup-migrations.js) runs ordered startup migrations; individual `migrate*()` bodies still live in `database.js` until Phase 2.

### Phase 1 repository

- [`database/repositories/medical-codes.js`](database/repositories/medical-codes.js) — ICD-10, CPT, HCPCS, `codeExists`, `code_embeddings`

## Major domains

| Domain | Routes / webhooks | Services |
|--------|-------------------|----------|
| Voice / Kelly | `routes/voice.js`, `routes/retell-functions.js`, `webhooks/retell-websocket.js` | `kelly-agent-service`, `knowledge-service`, `triage-service` |
| Billing / claims | `routes/stedi-webhooks.js`, `routes/rcm.js` | `insurance-service`, `billing-claim-envelope-service` |
| Medical coding | `routes/pdf-coding.js`, `routes/rag-search.js`; voice: `webhooks/retell-websocket.js` (`suggest_codes_from_symptoms`) | `knowledge-service` (`getCodeCandidatesDualSource`), `layer2-rag/remote-rag-client`, `semantic-search-service`, `coding-orchestrator`, `medical-coding-service` |
| Patient portal | `routes/patient-*.js` | `patient-portal-service`, `booking-service` |
| Catalog / onboarding | `routes/customer-catalog.js` | (inline DB via `db.db`) |

## Conversation-mode control plane (as built)

- **Architecture SSOT:** [`docs/architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md`](../docs/architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md)
- **Resolver:** `services/conversation-mode/conversation-mode-resolver.js`
- **Turn pivots:** `services/conversation-mode/pivot-engine.js`
- **Session wiring:** `services/conversation-mode/conversation-mode-session.js`
- **Dispatch:** `services/conversation-mode/conversation-dispatcher.js` + `rails/*` + `subrails/*`
- **Tool policy:** `services/conversation-mode/mode-tool-firewall.js`
- **Runtime integration points:** `services/kelly-turn-resolver.js`, `services/kelly-rails/execute-turn.js`, `webhooks/retell-websocket.js`

## Where to add new code

1. **New HTTP endpoint** → `routes/<domain>.js` + `register*Routes(app, deps)` in `server.js` mount section (~line 3020+ or next to related routes).
2. **New SQL for an existing table** → matching `database/repositories/<domain>.js`, then re-export from `database.js`.
3. **New schema** → `migrate*()` in `database.js` (Phase 2: move to `database/migrations/<domain>.js`) and append to startup migration list.
4. **Do not** append large blocks to `database.js` or inline handlers in `server.js` for new features.

## Related docs

- [docs/Medical Coding/ARCHITECTURE.md](../docs/Medical%20Coding/ARCHITECTURE.md) — canonical coding architecture
- [docs/Medical Coding/OPERATIONS.md](../docs/Medical%20Coding/OPERATIONS.md) — verify, eval, import links
- [docs/deployment/MEDICAL_CODEBOOK_SETUP.md](../docs/deployment/MEDICAL_CODEBOOK_SETUP.md)
- [docs/deployment/PROD_DB_PARITY.md](../docs/deployment/PROD_DB_PARITY.md)
- [docs/deployment/RENDER_PRODUCTION_CHECKLIST.md](../docs/deployment/RENDER_PRODUCTION_CHECKLIST.md)

Scripts: `npm run eval:coding`, `npm run verify:prod-codebook`, `npm run audit:eval-cpt` (see `package.json`).

## Refactor phases

See plan: monolith refactor — Phase 1 (structure + medical codes + catalog routes) complete; Phase 2+ migrations by domain, more repositories, thin `server.js`.
