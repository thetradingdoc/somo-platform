# Somo qualification demo — verification report

**Date:** 2026-06-03 (updated pre-demo debug 2026-06-03)  
**Image:** `gcr.io/somo-callsomo/somo-middleware:10c76de`  
**Cloud Run revision:** `somo-middleware-00003-zcw`  
**Pre-demo log:** [`middleware-platform/test-results/pre-demo-debug/SUMMARY.json`](../../../middleware-platform/test-results/pre-demo-debug/SUMMARY.json)  
**Operator checklist (2026-06-04):** [`PRE_DEMO_OPERATOR_CHECKLIST_2026-06-04.md`](PRE_DEMO_OPERATOR_CHECKLIST_2026-06-04.md)

## Pre-demo debug run (2026-06-03)

**Production readiness: 6/10** (automated path GO; live voice operator-pending)

| Suite | Result |
|-------|--------|
| Kelly rails golden (46) | PASS |
| Golden conversations (10 rails) | PASS |
| Kelly language (10) | PASS (fixed `:memory:` history table) |
| ASR gate (3) | PASS |
| Somo-demo unit (30) | PASS |
| Prod routing smoke | PASS (`demo_enabled=true`) |
| Prod Playwright API (2) | PASS |
| Prod smoke:somo-demo | PASS |
| Prod duplicate phone | PASS (200 then 429 `DUPLICATE_PHONE_WINDOW`) |
| F2 `test:e2e:rcm:conversation` | PASS 12/12 — `e2e_conversation_1780498327913_c8f1483c` |
| `verify:kelly-rails-cloudrun` | **BLOCKED** — `gcloud auth login` required locally |

## Kelly Agentic Platform Scope v1 — checklist (demo-relevant)

| Area | Done | Partial | Not done |
|------|------|---------|----------|
| Agent behavior (router, payment, emergency, escape) | 5 | 2 (visit E2E prod voice, Switch 3) | 0 |
| Voice/language | 0 | 3 | 0 |
| Guardrails | 1 (duplicate DB) | 2 | 0 |
| Stability | 3 | 0 | 0 |
| Monitoring | 0 | 1 | 2 (operator viewer, alerts) |
| Demo-specific | 1 (no 404) | 2 (live call, SMS) | 0 |

**Intent router:** implemented in V2 (`routeOrchestratorLane`) — Scope doc “does not exist” is stale.

## Automated gates

| Gate | Command / probe | Result |
|------|-----------------|--------|
| Unit tests | `npm test -- --testPathPattern=somo-demo` | **30/30 pass** |
| E2E landing (mocked) | `npm run test:e2e-somo-landing` | **4/5 pass** — consent API test skips when local middleware hung (5s timeout) |
| Smoke extended | `API_BASE_URL=https://api.callsomo.com npm run smoke:somo-demo` | **PASS** — optional `use_case` + `questions_asked` accepted |
| Routing smoke | `npm run verify:prod:routing-smoke` | **PASS** |
| Prod Playwright | `npm run test:prod:smoke` | **2/2 pass** |
| Qualification curl | POST no `use_case` | **PASS** — `success:true`, `demo_request_id` returned |

### Sample qualification probe (post-deploy)

```bash
curl -s -X POST https://api.callsomo.com/api/public/somo-demo/request-call \
  -H 'Content-Type: application/json' \
  -d '{"name":"StagingQual","phone":"+1YOUR_CELL","consent":true,"questions_asked":"optional use case test"}'
```

Expected: `success: true` (not `INVALID_USE_CASE`).

## Deploy status

| Component | Status | Notes |
|-----------|--------|-------|
| Cloud Run `somo-middleware` (staging profile) | **Deployed** | Serves `https://api.callsomo.com` |
| Production image deploy | See phase4 run | Preserves existing Secret Manager env |
| Firebase hosting (`callsomo.com` landing UI) | **Deployed** | 2026-06-03 — bundle `index-DJp_EtGC.js`, Kelly copy live on callsomo.com |

## Manual gates (operator)

Complete on a real cell after UI deploy:

| ID | Task | Status |
|----|------|--------|
| Q-17 | EN call — Kelly intro, qualify ~2 min, CTA/SMS | **Pending operator** |
| Q-18 | ES call — answer in Spanish, Kelly stays in Spanish | **Pending operator** |
| Sheets | 5 EventLog types if `SOMO_SHEETS_*` set | **Pending operator** |

### Q-17 checklist

1. Open `https://callsomo.com` (after Firebase deploy) or submit via curl with your phone.
2. Answer call — expect Kelly from Somo (not Sam / “Somo demo” sales pitch).
3. Accept CTA — confirm SMS signup link if offered.
4. Optional: say “chest pain” on a throwaway test — expect 911 script, no signup.

### Q-18 checklist

1. Same form; answer first turn in Spanish (e.g. “Sí, claro”).
2. Kelly should continue in Spanish for the rest of the call.

### Sheets (if enabled)

Verify EventLog rows: `request_received`, `call_initiated`, `qualification_captured`, `cta_sent`, `call_ended`.

## Go / no-go

| Criterion | Met? |
|-----------|------|
| API qualification behavior live | **Yes** |
| Automated smoke suite | **Yes** |
| Landing UI (Kelly form) on callsomo.com | **Yes** (2026-06-03 Firebase deploy) |
| Live EN voice call | **Operator** |
| Live ES voice call | **Operator** |

**Automated GO** for qualification backend + Kelly regression. **Full prod GO** after operator completes Q-17 (EN live call).

## Known issues

- Local middleware on `:4000` can hang on HTTP after restart in dev; use Cloud Run for smoke.
- `smoke:somo-demo` flag-off test may see 429 `DUPLICATE_PHONE_WINDOW` when smoke number is locked — expected.
- `verify:kelly-rails-cloudrun` needs interactive `gcloud auth login`; manual env per [`todos/PENDING.md`](../../../todos/PENDING.md).
- Outbound qual uses `somo-demo-orchestrator`, not Kelly Rails V2 — do not infer voice demo health from golden-conversation tests alone.
