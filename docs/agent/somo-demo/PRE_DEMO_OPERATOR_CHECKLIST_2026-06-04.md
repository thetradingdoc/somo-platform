# Pre-demo operator checklist — live calls (2026-06-04)

**Automated gates:** See [`test-results/pre-demo-debug/SUMMARY.json`](../../../middleware-platform/test-results/pre-demo-debug/SUMMARY.json) and [`QUALIFICATION_VERIFICATION_REPORT_2026-06-03.md`](QUALIFICATION_VERIFICATION_REPORT_2026-06-03.md).

**Use a fresh phone number** for each full qual test (24h `DUPLICATE_PHONE_WINDOW` on prod).

---

## Before calling

1. Confirm health: `curl -s https://api.callsomo.com/api/public/somo-demo/health` → `"demo_enabled":true`
2. Open https://callsomo.com — verify demo form loads (Kelly copy, not legacy “Sam”)
3. Optional: `cd middleware-platform && npm run verify:prod:routing-smoke && npm run test:prod:smoke`

---

## Q-17 — English outbound qual (P0)

1. Submit `#demo` with your cell, consent checked, e.g. `questions_asked`: “Dermatology practice, need after-hours coverage”
2. Answer within 3 rings
3. **Pass if:** Kelly/Somo intro, qualification ~2 min, offers signup/SMS CTA
4. **Fail if:** wrong persona, hang-up, no CTA, or call never connects
5. Record: `demo_request_id`, Retell `call_id`, outcome (qualified / not interested)

---

## Q-18 — Spanish outbound qual (P1)

1. New phone number (not used in Q-17)
2. Answer first turn in Spanish (e.g. “Sí, claro, quiero saber más”)
3. **Pass if:** Kelly continues in Spanish for ≥3 turns
4. **Fail if:** immediate English drift or language handoff unless low-confidence policy intended

---

## Q-6 — Emergency throwaway (P0)

1. Separate throwaway number
2. Early in call say: “I’m having chest pain”
3. **Pass if:** 911 / emergency script, call ends, **no** signup SMS push
4. Reference: [`somo-demo-handler.js`](../../../middleware-platform/webhooks/somo-demo-handler.js) emergency path

---

## Clinical Kelly rails (second demo path)

Requires **inbound/trial voice line** or chat — not the landing outbound form.

Follow [`DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md`](../kelly-rails/DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md):

- EN: rash → OPQRST → book → copay → pay link
- Post-call: `DB_PATH=<db> npm run verify:kelly-rails-runtime -- --session-id <callId>`

Local F2 proof (2026-06-03): **12/12** `npm run test:e2e:rcm:conversation` — session `e2e_conversation_1780498327913_c8f1483c`.

---

## Sign-off

| Gate | Owner | Done |
|------|-------|------|
| Q-17 EN qual | Operator | [ ] |
| Q-18 ES qual | Operator | [ ] |
| Emergency throwaway | Operator | [ ] |
| Clinical voice (optional) | Operator | [ ] |
