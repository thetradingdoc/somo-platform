# Month-1 Safe Launch Runbook

This runbook enables the patient portal "monitoring month" mode where wallet/payment and patient chat are hard-disabled.

## Required Environment Flags

- `FEATURE_PATIENT_WALLET_ENABLED=0`
- `FEATURE_PATIENT_CHAT_ENABLED=0`

These default to disabled when unset, but set them explicitly in deploy config for clarity.

## Smoke Test Commands

Run after deploy against the target environment (`API_BASE` and `SESSION_ID` required):

```bash
API_BASE="https://api.example.com" SESSION_ID="patient-session-id" \
curl -sS -H "x-session-id: $SESSION_ID" "$API_BASE/api/patient/features"
```

Expected:
- `features.wallet_enabled === false`
- `features.chat_enabled === false`

Wallet endpoints (all should return `503` + `"Wallet is temporarily disabled"`):

```bash
curl -sS -X POST -H "Content-Type: application/json" -H "x-session-id: $SESSION_ID" \
  "$API_BASE/api/patient/wallet/deposit" -d '{"amount":10,"method":"test"}'
curl -sS -H "x-session-id: $SESSION_ID" "$API_BASE/api/patient/wallet/transactions"
curl -sS -X POST -H "Content-Type: application/json" -H "x-session-id: $SESSION_ID" \
  "$API_BASE/api/patient/wallet/pay-claim" -d '{"claimId":"demo-claim"}'
```

Chat endpoints (both should return `503` + `"Chat is temporarily disabled"`):

```bash
curl -sS -X POST -H "Content-Type: application/json" -H "x-session-id: $SESSION_ID" \
  "$API_BASE/api/patient/triage/message" -d '{"message":"hello"}'
curl -sS -H "x-session-id: $SESSION_ID" "$API_BASE/api/patient/triage/history?session_id=test"
```

UI checks:
- Patient bottom tabs do not show Wallet.
- `book.html` does not show "Book with guided chat".
- `triage.html` redirects to booking when chat is disabled.
- `appointments.html` shows "Billing is paused during monitoring month." instead of Pay now.

## Rollback Steps

If month-1 mode must be lifted:

1. Set:
   - `FEATURE_PATIENT_WALLET_ENABLED=1`
   - `FEATURE_PATIENT_CHAT_ENABLED=1`
2. Redeploy middleware.
3. Re-run the smoke test commands above and verify endpoints no longer return `503`.
4. Verify patient UI surfaces return:
   - wallet tab visible,
   - guided chat visible,
   - triage route reachable.
