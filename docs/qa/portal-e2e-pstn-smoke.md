# Portal E2E — PSTN manual smoke (go/no-go)

**Not automated.** Run only after:

1. Phase 1 cleanup uploaded to GCS
2. Somo `PW_MODE=create` complete (`somo-create-state.json` → `complete`)
3. `portal-e2e-did-verify.cjs` **PASS** for Somo `customer_id` on `+18623622415`

## Checklist

| Step | Action | Pass? |
|------|--------|-------|
| 1 | Call `+18623622415` from mobile (not Retell web dialer) | |
| 2 | Kelly answers with Somo practice greeting | |
| 3 | Book or reschedule a **synthetic** appointment (fake name) | |
| 4 | Confirm appointment visible in Somo portal Schedule | |
| 5 | Transfer to office # works when Kelly paused (optional) | |

## Sign-off

| Field | Value |
|-------|-------|
| Tester | |
| Date | |
| Call ID / recording ref | |
| Result | PASS / FAIL |
| Notes | |

## If FAIL

- Re-run `node scripts/portal-e2e-did-verify.cjs`
- Check Twilio voice URL vs `clinic_phone_numbers`
- Do **not** enable pilot traffic until green
