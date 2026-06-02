# Kelly Conversation Rails — Backlog

Status: **Phase B code complete** — ops + F2 proof pending sign-off

**Full build plan (SSOT):** [`docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md`](../../docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md)

**V2 rebuild:** [`docs/architecture/LIVE.md`](../../docs/architecture/LIVE.md#kelly-rails-v2-as-built)

---

## Phase B — Production-ready sign-off

### Switch 3 (product scope)

- **Patient:** appointment confirmation receipt (`post_payment` lane, deterministic copy)
- **Provider:** appointment on dashboard + clinical-prep summary (no video/portal link required)
- **Deferred:** session link / video SMS → [`KELLY_RAILS_PHASE_B_PLUS.md`](KELLY_RAILS_PHASE_B_PLUS.md)

### Week 0 — Dual-runtime gate

- [x] Cloud Run live env verified (2026-06-02: `somo-middleware` revision `somo-middleware-00002-zrj`, us-central1)
  - `KELLY_RAILS_V2=1`, `KELLY_ALLOW_HYBRID_GRAPH=0`, `KELLY_RAILS_ROLLOUT_PCT=1`
  - Re-check: `npm run verify:kelly-rails-cloudrun --prefix middleware-platform`
- [x] Local: `KELLY_RAILS_ENV_PROFILE=staging KELLY_RAILS_V2=1 npm run verify:kelly-rails-env --prefix middleware-platform`
- [x] `staging:preflight` runs Kelly env verify
- [ ] Runtime proof: after staging chat, `DB_PATH=<staging.db> npm run verify:kelly-rails-runtime --prefix middleware-platform [-- --session-id <id>]`

```sql
-- Staging DB (adjust session_id after one Kelly chat turn)
SELECT id, session_id, event_type, payload_json, created_at
FROM kelly_call_events
WHERE event_type = 'turn_resolved'
ORDER BY created_at DESC
LIMIT 5;
```

### Week 2–4 — Rails (code + fast tests)

- [x] Golden utterance fixture + `test:kelly:rails:golden` (router, allow-lists, executeTurn, payment, voice-payment, resolver)
- [x] Allow-list contract tests
- [x] Switch 3 confirmation receipt (no video/portal tools in `post_payment`)
- [x] `test:e2e:kelly:golden-conversations` (deterministic paths)
- [x] Pay-before-book `executeTurn` integration test
- [x] Voice payment lane test (`kelly-rails-voice-payment.test.js`)
- [x] CI: Kelly Rails Phase B step in `.github/workflows/ci.yml`
- [ ] F2 green (E7-1): `KELLY_RAILS_V2=1 KELLY_ALLOW_HYBRID_GRAPH=0 RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation --prefix middleware-platform`

**LLM golden convos 1–4:** covered by F2 gate (not duplicated in harness). See `e2e-kelly-rails-golden-conversations.cjs` when `KELLY_GOLDEN_INCLUDE_LLM=1`.

### V6-3 — Provider dashboard (manual)

After staging v2 booking:

- [ ] [`today.html`](../../unified-dashboard/business/today.html) — appointment in schedule / activity feed
- [ ] [`calendar.html`](../../unified-dashboard/business/calendar.html) — clinical prep loads: `GET /api/admin/appointments/:id/clinical-prep`
- [ ] Confirm provider value does **not** depend on video/portal link

### Audit before merge

```bash
cd middleware-platform
node scripts/phase-b-production-gap-audit.cjs
```

---

## Active execution

- **E7-1:** F2 T1–T6 locally (LLM keys, server :4000)
- **Phase B+:** [`KELLY_RAILS_PHASE_B_PLUS.md`](KELLY_RAILS_PHASE_B_PLUS.md)

## Sprint 4–5

See prior sections in git history; provider UI and RCM pipeline items unchanged.
