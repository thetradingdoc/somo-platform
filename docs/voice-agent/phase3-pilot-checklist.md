# Phase 3 NYC Pilot — PMS Connect Checklist

## Phase 3A complete (Somo adapter)

Run: `npm run verify:phase3-sandbox` from `middleware-platform/`

- [x] `services/pms/` hub + `somo` adapter + circuit breaker
- [x] Kelly PMS context + write-back hooks
- [x] Settings/admin PMS UI + tenant auth
- [x] Data orchestration — roster import, patient match, tenant flags, E10 digest, PHI isolation test

Run data gate alone: `npm run verify:phase3-data`

Evidence: `middleware-platform/var/evidence/phase3/sandbox-acceptance.json`

## Phase 3B — Athena medical (code complete)

Run after setting `.env` creds and discovering IDs:

```bash
npm run verify:athena-token
npm run discover:athena-sandbox
npm run setup:phase3-athena
npm run verify:phase3-athena
npm run verify:athena-voice
```

- [x] `athena-client.js` — 2-legged OAuth + REST wrapper
- [x] `athena-adapter.js` — lookup, schedule, book, notes, shadow appointments
- [x] Settings + admin **Connect Athena** UI
- [x] Setup/verify scripts + unit tests
- [ ] TRF + BAA approved (ops — required for production scheduling scope)
- [ ] Live preview book smoke with sandbox patient phone

Evidence (after verify): `middleware-platform/var/evidence/phase3/athena-sandbox-acceptance.json`

## Phase 3B deferred — Dental only

- [ ] Dentrix Ascend — Henry Schein API Exchange
- [ ] Eaglesoft — partner API access

## Google Calendar policy

When `pms_type=somo`, Google Calendar is optional mirror. When `pms_type=athena`, Athena is SSOT (`mirror_google: false`). See `docs/voice-agent/phase3-google-calendar-policy.md`.

## Ops

- `GET /api/admin/tenants/pms-health`
- Architecture: `docs/architecture/PMS_CONNECT_ARCHITECTURE.md`
- Athena setup: `docs/voice-agent/phase3-athena-setup.md`
