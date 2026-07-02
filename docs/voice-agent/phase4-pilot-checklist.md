# Phase 4 Pilot — Go-Live Checklist

Operator-invite onboarding → voice setup → shadow week → live.

## Batch 1 (code)

- [x] Pipeline → **Send pilot invite** on lead detail + call-ready queue
- [x] `PILOT_INVITE_ONLY=1` blocks `/signup` and `POST /api/signup`
- [x] Go-live checklist on **Today** (forward line, test call, shadow week, Kelly on)
- [x] Pay link empty states — expired, zero balance, no rails
- [x] Voice-setup preview uses **live opener** (`activeOpener`) + optional TTS play
- [x] Stripe subscription checkout → **Today onboarding checklist** (not bare settings)

## Manual ops (pilot week)

- [ ] Send invite from pipeline for office #1; confirm email + `/invite.html?code=…`
- [ ] Provider completes voice setup; place PSTN test call
- [ ] Forward main line to Kelly number; run shadow week (`npm run setup:phase2-shadow -- --clinic-id <id>`)
- [ ] Compare desk copay quotes vs dashboard; set `pilot_live_at` when ready

## Verify

```bash
cd middleware-platform
npm run verify:phase4-pilot
npm run verify:unblocked-phases
```
