# Copay multilang — simulate env (G4)

## Required for copay scenarios

```bash
export VOICE_ELIGIBILITY_SIMULATE=1
export KELLY_E2E_SKIP_TRIAGE=1
export KELLY_RAILS_V2=1
export CONVERSATION_MODE_ROUTING=enforce
```

The multilang harness sets `VOICE_ELIGIBILITY_SIMULATE=1` automatically when `copayScenario: true` on the registry row.

## Desk parity (G3)

After copay scenarios, `assertSessionCopayParity` runs when:

- `request_patient_payment` appears in `toolsUsed`, **or**
- `sessionMeta.last_copay_due` is set (pre-inquiry / quote-only path)

## Dental copay script honesty

`e2e-kelly-dental-copay-conversation.cjs` validates journey gates against **seeded** eligibility rows. Live Stedi may log an inactive payer before the simulate seed applies — read the script banner at startup.

## Commands

```bash
npm run test:eval:multilang:copay
CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang:copay
```
