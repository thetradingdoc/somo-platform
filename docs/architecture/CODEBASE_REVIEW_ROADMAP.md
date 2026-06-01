# Codebase review roadmap (P0–P2)

**Last updated:** 2026-05-31  
**Purpose:** Phased, foundation-safe refactors from the 2026 codebase review. One route group per PR; identical URLs and JSON contracts.

**Related:** [SERVER_DECOMPOSITION.md](./SERVER_DECOMPOSITION.md) · [STAGING_DIAGNOSTIC_RUNBOOK.md](../testing/STAGING_DIAGNOSTIC_RUNBOOK.md) · [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md)

---

## File-size inventory (human review hotspots)

### Backend (`middleware-platform`)

| Lines | File | Risk |
|------:|------|------|
| 20,588 | `database.js` | God module — P2 only |
| 11,157 | `server.js` | Boot + inline routes — extract incrementally |
| 6,450 | `services/kelly-agent-service.js` | Kelly monolith — P2 |
| 3,624 | `routes/admin-platform.js` | Admin — out of scope |
| 3,487 | `services/kelly-tool-executor.js` | Tools — P2 |
| 3,417 | `webhooks/retell-websocket.js` | Voice WS — P2 |
| 3,360 | `routes/signup.js` | **P1 split** |
| 2,738 | `routes/voice-appointments.js` | Voice booking |

### Frontend

| Lines | File | Risk |
|------:|------|------|
| 3,660 | `unified-dashboard/patients/checkout-chat.js` | **P1 split** |
| 2,246 | `unified-dashboard/business/settings.html` | Inline JS — P2 |
| ~169 | `unified-dashboard/assets/js/voice-agent-page.js` | Good pattern |

---

## Phase P0 — Multitenancy correctness (done in code)

| PR | Change | Verify |
|----|--------|--------|
| P0-1 | `services/voice-inbound-tenant.js` — SaaS fail-closed when no `retell_agent_id` | `jest voice-inbound-tenant`, `billing:test-gate` |
| P0-2 | `voice-agent-settings.js` — no `akin-dunbar` fallback for authenticated SaaS | `test:e2e:staging-voice` |
| P0-2 | Staging DB truth in runbooks (`POSTGRES_URL`, GCS snapshot lag) | `staging:preflight`, `audit:trial-provision-drift` |

**Env:** `SAAS_VOICE_FAIL_CLOSED=1` (default on). Optional: `SAAS_VOICE_LAZY_RETELL_ON_INBOUND=1`.

---

## Phase P1 — Reviewability extractions

| PR | Change | Verify |
|----|--------|--------|
| P1-1 | `routes/voice-incoming.js` + handler extract from `server.js` | `billing:test-gate` |
| P1-2 | Split `signup.js` → `signup-trial`, `customer-auth`, `customer-account` | `test:e2e:staging-signup`, staging-voice |
| P1-3 | Split `checkout-chat.js` → `assets/js/checkout-chat/*` | Manual checkout-chat smoke |

---

## Phase P2 — Deferred

- `database.js` repository split (re-export first)
- Kelly / `kelly-tool-executor` domain modules
- `retell-websocket.js` state machine extract
- `business/settings.html`, `calendar.html`, `billing.html` script extraction
- `patient-app/_journal.tsx` split

---

## Do not touch (without explicit sign-off)

- DodgeCall demo / outbound sales default Retell agents
- Kelly tool names and Retell WS message shapes
- Trial webhook URL format (`/voice/incoming?customer_id=`)
- RCM ledger write paths

---

## Staging DB notes

- GCS `middleware-staging.db` is an **export snapshot**; may lag live Cloud Run / Postgres.
- Corrupted download → re-download to a fresh path (`PRAGMA integrity_check`).
- Email OTP: prefer `POSTGRES_URL` or manual `STAGING_EMAIL_CODE` over stale GCS for S2–S7.

---

## Verification matrix

```bash
cd middleware-platform
npm run billing:test-gate
npm run audit:trial-provision-drift
npm run staging:preflight
npm run test:e2e:staging-voice
SKIP_STARTUP_MIGRATIONS=1 npx jest __tests__/voice-inbound-tenant.test.js
```

Manual P0: inbound PSTN call → `npm run staging:call-verify -- --customer-id=…`
