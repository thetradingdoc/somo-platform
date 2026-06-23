# Conversation Mode Routing Rollout

Last updated: 2026-06-17

**Architecture:** [`KELLY_ORCHESTRATION_ARCHITECTURE.md`](../architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md)  
**Gap matrix:** [`ORCHESTRATION_GAP_MATRIX.md`](../architecture/ORCHESTRATION_GAP_MATRIX.md)

## Flags

- `CONVERSATION_MODE_ROUTING=shadow` (default): evaluate and log resolver/pivot decisions without enforcing
- `CONVERSATION_MODE_ROUTING=enforce`: enforce mode dispatch and tool firewall

Optional scoped enforcement:

- `CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES=true`
- `CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND=true`
- `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=true` — enable **after 48h clean shadow** on tenant inbound admin/billing pivots (V6–V7)

## Staged production (recommended before full enforce)

Deploy middleware with opener fixes, then set on Cloud Run `somo-middleware`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `TWILIO_OUTBOUND_WEBHOOK_URL` | `https://api.callsomo.com` | Twilio hits prod for outbound |
| `CONVERSATION_MODE_ROUTING` | `shadow` | Log pivots; tenant inbound still legacy-safe |
| `CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND` | `1` | Enforce operator outbound playbook + opener |
| `CONVERSATION_MODE_ENFORCE_OUTBOUND_SALES` | `1` | Enforce sales outbound playbook |
| `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN` | `0` → `1` after shadow | Staged tenant admin inbound (billing pivot V6–V7) |

`generate-cloudrun-env-yaml.cjs` sets operator/sales enforce defaults for `CLOUDRUN_PROFILE=production`; tenant inbound admin stays `0` until shadow telemetry is clean.

One-shot helper:

```bash
cd middleware-platform
node scripts/rollout-voice-outbound-opener.cjs --dry-run-db
node scripts/rollout-voice-outbound-opener.cjs --apply-db
node scripts/rollout-voice-outbound-opener.cjs --test-call 8622307479
```

## Rollback (<15 min) — CR-065

To reverse enforce routing without redeploying code:

```bash
gcloud run services update somo-middleware --region us-central1 --project somo-callsomo \
  --update-env-vars CONVERSATION_MODE_ROUTING=shadow
```

Verify rollback:

```bash
cd middleware-platform && GCP_PROJECT=somo-callsomo npm run verify:kelly-rails-cloudrun
# Expect CONVERSATION_MODE_ROUTING=shadow (intentional during rollback)
```

Re-enable enforce when ready:

```bash
gcloud run services update somo-middleware --region us-central1 --project somo-callsomo \
  --update-env-vars CONVERSATION_MODE_ROUTING=enforce
npm run verify:kelly-rails-cloudrun --prefix middleware-platform
```

Target: complete rollback + re-verify in **<15 minutes**.

## Rollout steps (R1–R7)

1. Deploy middleware (opener + `call_type` in Retell dynamic variables).
2. Run `fix-operator-voice-openers.cjs` on production DB.
3. Set staged env vars above on Cloud Run.
4. Verify `mode_resolved`, `pivot_evaluated`, and `opener_used` in `kelly_call_events`.
5. Outbound test: `TWILIO_OUTBOUND_WEBHOOK_URL=https://api.callsomo.com node scripts/make-outbound-call.js <phone>`.
6. After 48h clean shadow on tenant inbound, enable `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=1` (staged — not global enforce yet).
7. When all scoped flags are green, flip `CONVERSATION_MODE_ROUTING=enforce`.

## Staging SaaS tenant inbound smoke (one tenant)

Before scaling SaaS voice to many clinics, onboard **one** staging tenant end-to-end:

1. Complete trial signup on staging (`api.staging` or local with `STAGING=1`).
2. Confirm `provisionSaasTenant` created `merchant`, `clinic`, `prompt_profile`, and `voice_agent_settings` (inbound greeting + outbound opener).
3. Assign a Twilio number to the tenant customer (`twilio_phone_number`).
4. Run `npm run smoke:tenant-billing-pivot` (V6–V7 pivot wiring).
5. Place inbound call to tenant line; verify single greeting from `voice_agent_settings.greeting` and `call_opener_used` in `kelly_call_events`.
6. Document tenant id + phone in this runbook when complete.

## Current implementation status

- Core routing stack is implemented and integrated: resolver, pivot engine, dispatcher, subrails, and tool firewall.
- Shadow vs enforce behavior is controlled by `CONVERSATION_MODE_ROUTING` and mode enforcement gates.
- Remaining production hardening is focused on edge-case transition coverage, not missing architecture primitives.

## Required smokes

- V1–V3: outbound/demo isolation
- V6–V7: billing pivot + multi-intent queue
- V8–V9: cancellation + reschedule chain
- V10–V12: OPQRST exit + emergency preemption
- **V11**: OPQRST mid-flow billing pivot preserves `opqrst_accumulator`
- V14: unresolved tenant fail-closed support

## Local verification commands

```bash
cd middleware-platform
npm run test:kelly:rails:golden          # 50 unit tests
npm run verify:kelly-rails-env --prefix middleware-platform
npm run smoke:voice-routing-matrix --prefix middleware-platform
npm run test:rails:conversation-sandbox  # 7 multi-turn dialogs (enforce mode)
npm run smoke:operator-outbound
npm run smoke:tenant-billing-pivot
```

Reports: `test-results/rails-conversation-sandbox.md` after sandbox run.

## Rollback procedure

If enforce mode causes regressions on live tenants:

1. **Fast rollback:** set `CONVERSATION_MODE_ROUTING=shadow` on Cloud Run and redeploy (or disable scoped `CONVERSATION_MODE_ENFORCE_*` flags).
2. **Partial rollback:** keep global `shadow` but leave `CONVERSATION_MODE_ENFORCE_OPERATOR_OUTBOUND=1` if outbound-only is healthy.
3. **Confirm within one call:** query `kelly_call_events` for the test `session_id` — `mode_resolved.payload_json.shadow_only` should be `true` after rollback.

### Regression signals (require telemetry-p0-minimum)

| Signal | Event |
|--------|-------|
| Wrong tenant | `identity_invalid` |
| LLM off-scope | `scope_guardrail_triggered` |
| Wrong tools | `mode_violation` |
| Booking broken | `turn_resolved` without `schedule_appointment` on booking sessions |

## CI and deploy gates (2026-06-17)

- `KELLY_RAILS_ENV_PROFILE=staging npm run verify:kelly-rails-env` must pass before deploy
- `npm run verify:kelly-rails-cloudrun` checks live env including `CONVERSATION_MODE_ROUTING=enforce`
- `staging:preflight` includes Kelly + conversation mode verify

## Post-deploy checklist

1. Cloud Run image includes conversation-mode stack (`services/conversation/*`).
2. Env vars set per staged table above (shadow + scoped enforce, then global enforce when green).
3. `kelly_call_events` shows `mode_resolved`, `pivot_evaluated`, `opener_used`, and on failure paths `identity_invalid`.
4. Firebase UI deployed if provider portal or voice-setup pages changed.
5. Optional: `npm run test:e2e:tenant-audit:safe` against staging middleware before tenant inbound enforce.
6. Run `npm run test:rails:conversation-sandbox` — target 12/12 TCR after deterministic schedule gate ships.

