# Somo — Money Movement & Multilang Eval Task Backlog (v3)

**Supersedes:** v2 backlog sections below. v3 adds patient-facing SMS assertions (H5), `dateOfService` hygiene (M1b), and strict 3-run baseline (R2).

**Stakeholder line (2026-07-04):** Simulate money path is patient-SMS-aware; `copay_payment 3/3` now requires SMS body quality, not just token. ES/RU `copay_eligibility` failures were **reply locale**, not thin eligibility.

**Strict baseline:** `MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1` → **14/16** majority pass.

| Tag | Pass |
|-----|------|
| booking | **3/3** |
| cancel | 1/3 (EN-2 **3/3**; ES-3 / RU-3 open) |
| copay_eligibility | **3/3** |
| copay_payment | **3/3** (H5 SMS asserts) |
| inquiry | 4/4 |

---

## P0 — Scoreboard (H1–H5)

| ID | Task | Status |
|----|------|--------|
| H1 | `copayPayment: false` on EN-3/ES-2/RU-2; merge guard | Done |
| H2 | `isCopayPaymentScenario`; scope payment asserts | Done |
| H3 | Fail `schedule_appointment` when `schedule_appointment_success` false | Done |
| H4 | `checkRescheduleReplyCoherence` for cancel-only reply | Done |
| **H5** | Copay SMS: `formatCopayPaymentSms` (EN/ES/RU); `sms_body` on `payment_link_sent`; harness asserts no `undefined`, no commerce copy, locale markers | **Done** |
| **R2** | Strict 3-run majority baseline before pilot docs | **Done** (14/16, 2026-07-04) |

---

## P0 — Money movement (M1–M4, M1b)

| ID | Task | Status |
|----|------|--------|
| M1 | Simulate-only mock copay; payer normalization | Done |
| **M1b** | Default `dateOfService` on direct-tools `/insurance/collect` | **Done** |
| M2 | `quote_delivered` persist on hard_number | Done |
| M3 | Payment turn routing | Done |
| M4 | `copay_payment` tag | **3/3** strict |

---

## P1 — Live Stedi (M5–M6)

| ID | Task | Status |
|----|------|--------|
| M5 | Eligibility logging in multilang eval | Done |
| M6 | `test:eval:multilang:stedi-live` + `stedi-live-copay-run.md` | **Pending** — run after M1b (approved env); not auto-run in CI |

---

## P1 — Booking (B1–B3)

| ID | Task | Status |
|----|------|--------|
| B1 | ES-1 booking complete | **Done** — 3/3 strict |
| B2 | RU-1 booking complete | **Done** — Cyrillic confirm + slot preserve |
| B3 | Disposition when schedule fails | Done |

---

## P1 — Language (L1–L3)

| ID | Task | Status |
|----|------|--------|
| L3a | Insurance gate prefers localized `insurance_quote` over English `collect-insurance` message | **Done** — `copay_eligibility 3/3` |
| L3b | EN-2 reschedule reply (not cancel-only after reschedule tool) | **Done** — reply repair + cancel defer; **3/3** |
| L1/L2 | Monolingual opener | Partial |

---

## Corrected framing (ES-2 / RU-2)

- Eligibility resolves `hard_copay` ($20 / $30) in both languages.
- Prior `copay_eligibility 1/3` was **English voice quote** (`out.message` from `collect-insurance.js`), not Stedi/thin path.
- Fixed in `gates/insurance.js` by preferring `getDeterministicReply('insurance_quote', locale)`.

---

## Verification

```bash
cd middleware-platform
npx jest __tests__/copay-sms-format.test.js __tests__/multilang-eval-assertions.test.js __tests__/insurance-collect-date-of-service.test.js
MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang
npm run test:eval:multilang:stedi-live   # requires STEDI_API_KEY, VOICE_ELIGIBILITY_SIMULATE=0
```

---

## M1 production decision (Option A)

When `VOICE_ELIGIBILITY_SIMULATE=1`, mock copays only. Production: `VOICE_ELIGIBILITY_SIMULATE=0`. M1b ensures `dateOfService` is set before live Stedi.
