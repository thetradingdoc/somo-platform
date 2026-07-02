# Shadow week runbook

Compare desk copay quotes against Kelly before enabling live copay speak.

## Enable (operator)

```bash
cd middleware-platform
npm run setup:phase2-shadow -- --clinic-id <clinic_id>
```

This script:

- Sets `copay_quote_speak_enabled=0` on the clinic prompt profile
- Sets `voice_reply_suppress_enabled=1` on voice agent settings
- Sets `shadow_week_active=1` on the clinic row

Manual alternative:

```bash
PATCH /api/tenant/clinic
{ "shadow_week_active": true }
```

## During shadow week

1. Office forwards line to Kelly (coverage or full-time per contract).
2. Staff writes copay on paper; Kelly runs eligibility in shadow (no speak).
3. Hourly: `npm run report:front-desk-ops`
4. Compare dashboard **Calls** disposition/eligibility/copay vs desk notes.

## Exit criteria

- [ ] ≥10 calls with eligibility attempted
- [ ] Copay parity ≥90% vs desk within $5
- [ ] No PHI in logs (`npm run verify:log-redaction`)
- [ ] Office manager sign-off

## Go live

1. Set `copay_quote_speak_enabled=1` on prompt profile
2. Set `voice_reply_suppress_enabled=0`
3. PATCH clinic `pilot_live_at` to ISO timestamp
4. PATCH `shadow_week_active=0`
5. Today go-live checklist → Kelly on

See [phase2-pilot-checklist.md](./phase2-pilot-checklist.md), [PILOT_ONCALL_WEEK.md](./PILOT_ONCALL_WEEK.md).
