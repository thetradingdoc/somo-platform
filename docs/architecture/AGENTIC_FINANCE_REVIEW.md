# Agentic Finance — Detailed Agent Review

**Date:** 2026-07-09  
**Scope:** Kelly as a healthcare fintech front-desk agent for medical and dental practices  
**Sources:** as-built code under `middleware-platform/`, orchestration docs, `todos/PENDING.md`, production plan log  
**Status:** Honest product/engineering assessment (what ships today vs what is still blocked)

---

## Executive verdict

Kelly is a **voice-first front-desk + revenue agent** for clinics: she books, quotes patient responsibility, and **collects money via secure off-call Stripe links** — not by taking card numbers on the phone.

| Question | Answer |
|----------|--------|
| Does the agent take payments **on the call** today? | **No.** Card PAN/CVV on voice is forbidden by product, prompts, and payment policy. |
| Does it handle **copay** today? | **Yes** — quote on call → SMS/email Stripe link → patient pays on `/patients/pay.html` (or API-hosted pay page). |
| Are billing/copay codes complete? | **Medical lookup: strong** (full ICD-10-CM + MPFS CPT + HCPCS). **Copay dollars: pilot seeds only.** **Dental CDT: stub** (~29 real descriptions of 427). |
| Is this “Agentic Finance”? | **Yes, as link-based RCM collection** with deterministic rails, eligibility spine, and settlement — not as voice card capture or Mastercard/Visa Agent Pay for clinic RCM. |
| What blocks “full production finance”? | **Live Stedi 271** (task 6.10) and **Dentrix CONNECTED** (vendor). Stripe + Somo calendar path is demoable now. |

---

## What “Agentic Finance” means here

For Somo, Agentic Finance is **not** a chatbot that charges a card mid-sentence. It is an **orchestrated money path** owned by deterministic rails:

1. **Identify** the patient / site of care (tenant DID + site context).
2. **Quote** patient responsibility (eligibility / hard copay number).
3. **Authorize collection** only after quote + identity gates pass.
4. **Send a PHI-safe payment link** (SMS/email).
5. **Settle** via Stripe webhook / mark-paid and optionally write notes back to PMS.

The LLM is bounded: mode firewall + lane tool allowlists + payment/insurance **gates** own the money turns. The model does not freestyle card collection.

```mermaid
flowchart LR
  subgraph call [On the call]
    V[Voice / Retell]
    R[Rails gates]
    Q[Copay quote]
    L[Send pay link]
  end
  subgraph offcall [Off the call]
    S[Stripe Elements]
    W[Webhook settlement]
    P[Provider portal / RCM]
  end
  V --> R --> Q --> L --> S --> W --> P
```

---

## Direct answers

### Payments on calls

| Capability | Status | Notes |
|------------|--------|-------|
| Speak estimated / hard copay | **Live** | Insurance gate + `insurance_quote` deterministic copy (EN/ES/ZH + RU prompts) |
| Send SMS/email payment link | **Live** | `request_patient_payment` → `rcm-payment-request-service` → `sendCopayPaymentLink` |
| Patient pays with card on secure page | **Live** | Stripe PaymentIntent; needs `STRIPE_*` keys |
| Collect card number / CVV on voice | **Not a product** | Explicitly blocked in prompts, tools, `payment-input-policy.js` |
| Mastercard / Visa “Agent Pay” for clinic copay | **Not live for RCM** | Commerce-oriented paths; not the Kelly copay lane |

### Copay today

**End-to-end path that works in sandbox / pilot:**

1. Patient asks about cost / insurance / “send me the link.”
2. **Insurance gate** (`kelly-rails/gates/insurance.js`) collects payer/member/DOB → sets `copay_amount`, `quote_delivered`.
3. Eligibility may be **Stedi live** or **`VOICE_ELIGIBILITY_SIMULATE=1`** mock (BCBS/Aetna/UHC table).
4. **Payment gate** (`gates/payment.js`) requires hard amount + pay signal / `pay_invoice` step.
5. Tool creates RCM payment request + tokenized URL; SMS/email sent.
6. Patient opens link → Stripe → settlement (`rcm-payment-settlement.js`).

**Caveats:**

- `payment_complete` can be set when the **link is sent**, not only when Stripe succeeds — receipt language can be optimistic vs settlement.
- Prod live PSTN copay still operator-gated (`CR-036` in `todos/PENDING.md`).
- Without Stripe keys, link creation may succeed but charge page fails.

### Eligibility precedence (M-01 / architecture Fix #1) — CLOSED

**Gov-01 / Ver-01 (2026-07-10):** The simulate-vs-`plan_rules` override bug described in the external architecture PDF is **closed in code**.

**Live `collect_insurance` path:**

1. Kelly executor [`collect-insurance.js`](../../middleware-platform/services/kelly-tool-executor/collect-insurance.js) → POST `/voice/insurance/collect` → [`PaymentFlowService.resolveAmountDue`](../../middleware-platform/routes/voice-appointments.js) on the HTTP route.
2. After HTTP success, Kelly executor calls [`resolveAmountDue`](../../middleware-platform/services/resolve-amount-due.js) again for session meta / journey gates.
3. In `resolve-amount-due.js`, when `eligibility_quality === 'simulate'`, the resolver **does not** return the flat simulate copay — it **falls through** to `computeVisitQuote` / seeded **`plan_rules`**. Non-simulate hard copays (Stedi 271 / `hard_copay`) still win first.

**Ver-02:** This document never claimed an open simulate-over-`plan_rules` bug; it correctly describes copay dollars as **`plan_rules` seeds**. The PDF Fix #1 was **pre-fix / stale** relative to current code.

**Evidence:** `npm test -- simulate-eligibility-precedence.test.js` (3/3 pass); code trace 2026-07-10. See [KELLY_CODING_MASTER_EXECUTION_PLAN.md](../Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md) §0.A.

---

## 1. Voice Orchestration

**Purpose:** Admit the call, classify routing world, greet correctly, then hand turns to the right brain (Kelly Rails vs script-only sales vs navigation).

| Piece | Location | Maturity |
|-------|----------|----------|
| Twilio admission | `services/voice-incoming-handler.js` | Production |
| Retell WebSocket | `webhooks/retell-websocket.js` | Production |
| Routing worlds | `services/voice-routing-world.js` | Production |
| Openers | `services/call-opener-resolver.js` | Production |
| Identity admission | `services/voice-identity-admission.js` | Production |
| Landing demo outbound | `routes/somo-demo-public.js` + `somo-demo-handler.js` | **Restored 2026-07** |

**Routing worlds:** `tenant`, `platform_support`, `demo`, `operator_outbound` / `sales_outbound`, `navigation`, `unidentified`.

**Critical rule:** Kelly Rails (clinical/booking/payment) **does not run** on `demo`, `platform_support`, `navigation`, or `unidentified` (`shouldBlockKellyTurn`). Company DID (+363) is **sales / support**, not practice front desk.

**Demoable:** Tenant DID front desk; +363 sales qual; landing demo outbound call form (restored).

**Gaps:** Live PSTN vertical matrix still operator-run; 862 practice DID fail-closed until a real tenant is bound.

---

## 2. Data Orchestration

**Purpose:** Know *who* is calling, *which clinic*, *which patient*, and keep session state consistent across turns.

| Concern | SSOT / module | Maturity |
|---------|---------------|----------|
| Session state | `kelly_rails_session_projection` via `kelly-rails/session-ssot.js` | Production |
| Site of care | `call-site-context.js` | Production (fail-closed when unverified) |
| Clinical facts | `triage_sessions` | Production |
| Dialog history | `kelly_conversation_history` | Production |
| FHIR patients | `fhir-service.js`, `fhir-voice-lookup.js` | Partial (local/Somo strong; vendor sync weaker) |
| meta_kv | Mirror for legacy readers | Partial (policy-gated) |

**Finance relevance:** Payment and site-sensitive tools require verified (or not-required) site context. Wrong clinic = blocked tools, not silent bleed.

**Gaps:** Retention counsel (G2); Postgres mirror optional; patient portal pages retired (G4) — pay success still served on API/hosting path.

---

## 3. Agent Orchestration

**Purpose:** Bounded LLM + tools under firewall — not an unconstrained agent.

| Piece | Module | Maturity |
|-------|--------|----------|
| Turn entry | `kelly-turn-resolver.js` | Production (V2) |
| LLM engine | `kelly-agent-service.js` | Production |
| Tools | `kelly-tool-executor.js` | Production |
| Mode firewall | `conversation-mode/mode-tool-firewall.js` | Production (`enforce` on prod) |
| Prompts | `kelly-prompt-builder.js`, prompt profiles | Production |

**Controls:**

- Turn timeout ~25s (`KELLY_TURN_TIMEOUT_MS`)
- History ~20 turns (`KELLY_MAX_HISTORY_TURNS`)
- Turn rate limit (`VOICE_TURN_RATE_LIMIT_MAX`)
- `request_patient_payment` blocked outside billing / `copay_link` modes

**Gaps:** Legacy `processTurn` must stay gated; education/derm pipelines are flag-gated and can confuse routing if mis-profiled.

---

## 4. Rail Orchestration

**Purpose:** Deterministic **lanes and gates** own money and booking turns before the LLM speaks.

### Lanes (L4)

| Lane | Job | Finance role |
|------|-----|--------------|
| `basic_intake` | Name / contact / DOB | Identity before pay |
| `clinical` | OPQRST / triage | Not money; can hand off to book |
| `booking` | Schedule / confirm | Often precedes copay |
| `payment` | Pay invoice / insurance / receipt | **Core money lane** |
| `post_payment` | Confirmation | After link / settlement narrative |
| `reschedule` / cancel | Move or cancel | Adjacent ops |
| `account` / `records` / `support` | Billing FAQ, records, handoff | Partial / support |

### Subrails (L2)

`booking`, `cancellation`, `opqrst`, `copay_link`, `self_pay`, `records_qa`, `handoff`

### Gate order (first owner wins)

Safety → **payment** → records → lookup → reschedule → cancel → clinical / OPQRST → **schedule** → conflict → LLM

**Maturity:** Production-ready for schedule / cancel / payment / insurance gates with strong automated multilang coverage.

**Gaps:** Provider-slot admission still partial; cancel multilang historically more fragile than booking/copay; self-pay subrail is thinner than the payment gate.

---

## 5. Eligibility Orchestration

**Purpose:** Answer “what does the patient owe?” from insurance benefits.

| Path | Status |
|------|--------|
| Code spine (270/271, parser, circuit breaker) | **Built** |
| Simulated eligibility (`VOICE_ELIGIBILITY_SIMULATE=1`) | **Demo / eval default** — deterministic mock copays |
| Live Stedi Healthcare API | **Blocked for multilingual live sign-off** (PENDING **6.10**) |
| Spoken quote on call | **Works** when amount resolves |

**Key modules:** `eligibility-orchestrator.js`, `insurance-service.js`, `stedi-271-parser.js`, `gates/insurance.js`, `collect-insurance.js`

**Honest claim:** You can demo **quote → link** with simulate. You should **not** claim production live 271 for every payer until 6.10 closes.

---

## 6. EHR Orchestration

**Purpose:** Read/write practice system of record (patients, appointments, notes).

| Adapter | Status | Demo role |
|---------|--------|-----------|
| **Somo** (local FHIR + BookingService) | **Live / pilot SoR** | What demos book against today |
| **Athena** | Partial (sandbox client) | Needs credentials / BAA |
| **Dentrix** | Code ready, **not CONNECTED** | Blocked on Henry Schein / vendor |
| **Eaglesoft** | Stub | All ops throw not configured |

**Hub:** `services/pms/pms-hub.js` (timeouts, circuit breaker, eligibility/copay note write-backs when adapter supports them).

---

## 7. Payment Orchestration

**Purpose:** Create, deliver, and settle patient responsibility.

| Step | Module | Status |
|------|--------|--------|
| Hard amount resolution | `PaymentFlowService` / journey gates | Live |
| Create pay request + token | `rcm-payment-request-service.js` | Live |
| SMS / email link | `sms-service.js` (`sendCopayPaymentLink`) | Live (Twilio) |
| Checkout UI | Stripe Elements on pay page | Live with keys |
| Settlement | `rcm-payment-settlement.js` + webhooks | Live |
| Escrow / Circle | `escrow-orchestrator-service.js` | Flag-gated / stub for clinic RCM |
| Card-on-call | — | **Forbidden** |

**Env:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `PUBLIC_PAY_BASE_URL` / `APP_PUBLIC_URL`, `RCM_PAY_TOKEN_TTL_HOURS`

---

## 8. Loop Orchestration

**Purpose:** What happens *after* or *around* the call — CRM, outbound, reminders, sequences.

| Loop | Status |
|------|--------|
| Platform sales → CRM lead (`inbound_platform`) | Live (code); operator bind/verify ongoing |
| Outbound sales / operator dial | Live rails |
| Sequence engine | Partial |
| Appointment reminder subrail | Thin / partial |
| Telemedicine reminder scheduler | Separate path |
| Landing demo request → outbound call → lead upsert | Live (restored) |

**Not the same as:** continuous clinical care management loops (those are thinner than front-desk RCM).

---

## Languages

### Production matrix (tenant front desk)

| Language | Code | Rails prompts | Intent / OPQRST | Copay SMS | Eval |
|----------|------|---------------|-----------------|-----------|------|
| English | `en` | ✓ | ✓ | ✓ | ✓ |
| Spanish | `es` | ✓ | ✓ | ✓ | ✓ |
| Russian | `ru` | ✓ | ✓ | ✓ | ✓ |
| Mandarin | `zh` | ✓ | ✓ | ✓ | ✓ |

**Detection:** Heuristic sticky lock (`kelly-rails/language.js`) — script hints, explicit “speak Spanish…”, confidence threshold (`KELLY_LANG_MIN_CONFIDENCE`, default ~0.6). Mid-call switch is logged and generally ignored (language lock).

**Platform sales (+363):** **English only** v1. ES/RU sales qual deferred.

**Also parseable but not first-class presets:** pt, fr, de, sw, ar (config maps exist; full gate copy + eval is EN/ES/RU/ZH).

**Limitations:**

- ASR errors can mis-detect (ES/PT overlap).
- Cancel path historically weaker than booking/copay in multilang evals.
- Live Stedi multilang sign-off still open (6.10).
- Automated harness reported strong (plan log ~19/19); **live PSTN proof in all four languages** still operator work.

---

## Conversation ability — limitations

| Limitation | Effect |
|------------|--------|
| **Mode isolation** | Sales / demo / platform_support cannot pivot into clinical or billing tools (emergency still preempts). |
| **Tool firewall** | Wrong mode → tool rejected + violation log. |
| **Gate ownership** | On payment/schedule steps, LLM tool list is stripped; gates speak deterministic copy. |
| **No card on voice** | Even if user reads a card number, policy rejects / agent refuses. |
| **Site context** | Unverified site → site-sensitive tools blocked. |
| **History / timeout** | ~20 turns; ~25s turn budget → timeout reply. |
| **Multi-intent** | Queue drains after primary rail completes (e.g. pay then reschedule). |
| **Script-only worlds** | Demo / platform sales / unidentified → no full Kelly Rails. |
| **Eligibility realism** | Without live Stedi, quotes are simulated — fine for demo, not for payer claims. |

Kelly is excellent at **structured front-desk + money-link** conversations. She is **not** a free-form financial advisor, not a claims adjudicator, and not a card-present terminal.

---

## What can be demoed in full today

### A. Dental / medical **tenant** front desk (strongest)

On a **tenant practice DID** with Somo calendar + Stripe test + eligibility simulate:

1. Inbound greeting (EN or ES/RU/ZH)
2. Book appointment → calendar row
3. Collect insurance → **spoken copay quote** (simulate)
4. “Send me the link” → SMS/email
5. Patient pays on Stripe test page
6. Provider Today / Calls / RCM surfaces reflect activity
7. Optional: cancel / reschedule / handoff to human

### B. Platform sales (+363)

1. Company line → Kelly sales qual (English)
2. Practice type → pain → value → signup CTA
3. CRM lead capture  
**Not** a clinical or copay demo.

### C. Landing demo call (restored 2026-07)

1. Form on callsomo.com → `POST /api/public/somo-demo/request-call`
2. Outbound Twilio ring → demo handler persona  
**Not** tenant RCM; confirmation email skips placeholder addresses.

### D. Multilang automated proof

EN/ES/RU/ZH booking / copay / eligibility **harness** paths — strong for engineering confidence; still pair with live PSTN for sales claims.

---

## Medical & dental codes (billing / copay)

Hard copay numbers are **not** read from a full payer benefit file. Kelly resolves a **service code** (CPT or CDT), then matches seeded **`plan_rules`** (+ optional **`fee_schedules`**) via `payer-quote-service` / `resolve-amount-due`. Codebooks support lookup, triage pairing, and claim envelopes; **patient responsibility accuracy = seed quality**, not codebook size.

### What code systems we have

| System | In repo (approx) | Completeness | Used for billing/copay? |
|--------|------------------|--------------|-------------------------|
| **ICD-10-CM** FY2025 | **74,260** (`Knowledge/ICD-10 Files/FY2025…/icd10cm-codes-2025.txt`) | Full CDC code-description dump | Diagnosis / triage / pair validation; not the copay dollar key |
| **CPT** via MPFS Oct 2025 | **~17,170** (`PPRRVU2025_Oct.csv` / `PPRRVU.csv`) | Medicare-payable PFS subset — **not** full AMA CPT | Primary medical procedure key for quotes + fees |
| **HCPCS Level II** Jan 2026 | **~9,006** (ANWEB; parity min 8k) | Full CMS first-line ANWEB set | Supplies / G-codes; wellness seeds use G0438/G0439 |
| **ICD-10-PCS** FY2025 | **78,948** | Full CMS PCS file | Loaded for parity; **not** on Kelly voice/quote path |
| **CDT** “2025” seed | **427** codes (`Knowledge/CDT/cdt-codes-2025.txt`) | **~29 real ADA descriptions; ~398 placeholders** | Dental admin resolve + dental copay; not full ADA (~900+) |
| **Place of service** | **52** (`cms_place_of_service_codes.json`) | Practical CMS subset | Claim / appointment envelope |
| **Modifiers** | **~54** curated JSON (+ HCPCS RIC-7 rows) | Common claim set, not exhaustive | Telehealth / claim modifiers |
| **Fee schedules** | MPFS import + `fee_schedules` table | Medicare allowed amounts when imported | Allowed amount for quotes / RCM |
| **Plan rules** | Pilot seeds only | Tiny vs real payer catalogs | **Hard spoken copay** |

Parity gates (`verify-codebook-parity.js`): ICD ≥70k, CPT ≥15k, HCPCS ≥8k, PCS ≥75k, POS ≥50, modifiers ≥40. CDT is **not** in that parity gate.

### How codes feed the money path

```text
symptoms / visit type
  → coding spine (ICD + CPT/CDT resolve)
  → computeVisitQuote(payer, plan, service_code)
  → plan_rules match → hard copay $
  → payment gate → Stripe link
```

- Voice tools: `search_icd10_codes`, `search_cpt_codes`, `search_hcpcs_codes`, `suggest_codes_from_symptoms`, `validate_code_pair`.
- **No `search_cdt_codes` voice tool** — dental uses admin phrase map / `searchCdtCodes` off the dual-source RAG path.
- Client-supplied `service_code` is rejected by `resolve-insurance-codes.js` (anti-hallucination).

### Copay seeds that actually set dollars

**Medical pilot** (`seeds/pilot-payer-rules.js` — payer `BCBS_PILOT`):

| Codes | plan_x copay | plan_y |
|-------|--------------|--------|
| New E/M `99202–99205` | $40 | $0 |
| Est E/M `99211–99215` | $35 | $0 |
| MH eval `90791–90792` | $50 | $0 |
| Therapy `90834`, `90837` | $30 | $0 |
| Wellness `G0438–G0439` + preventive `99385–87` / `99395–97` | $0 | $0 |

Sample allowed amounts seeded for those same codes (e.g. 99213 → $95).

**Dental pilot** (`seeds/dental-payer-rules.js` — 6 NYC dental payers):

- Explicit CDTs: `D1110`, `D1120`, `D0120`, `D0150`, `D0140`, `D0274`, `D2391`
- Cleanings `D1110`/`D1120` → **$0**; others → **$35**; wildcard `D*` → **$35**
- Fee row $120 per seeded CDT — **not** a real ADA fee schedule

### CDT honesty (dental)

Of **427** seeded codes, only **29** have real descriptions (evals, cleanings, common restorative/endo/perio/surgery/ortho/sedation). The rest are stubs like `diagnostic procedure D0100`. Full ADA CDT (~900+) is a stretch goal (`7.7-EXT`), not shipped. Dental PDFs under `Knowledge/CDT/` are **not** machine-imported.

### Accuracy verdict

| Layer | Grade | Why |
|-------|-------|-----|
| Medical code **lookup** (ICD/CPT/HCPCS) | **Strong** | Full FY2025 ICD + MPFS CPT + 2026 HCPCS when DB parity is met |
| Medical **copay $** | **Pilot-only** | Hard numbers from `plan_rules`, not live 271 benefit parse |
| Dental code **lookup** | **Weak** | Stub CDT + phrase triggers; not searchable ADA codebook |
| Dental **copay $** | **Demo seed** | 7 CDTs + `D*` wildcard across 6 payers |
| CPT licensing / commercial completeness | **Gap** | MPFS ≠ full AMA CPT; commercial-only codes may be missing |
| Prod risk | **Ops** | Docs warn prod CPT may still be DHS ~1,299 until MPFS migrated — run `verify:prod-codebook` |

**Bottom line:** We have production-grade **medical** codebooks for identifying the visit; we do **not** have production-grade **payer benefit / dental CDT fee** completeness. Spoken copay is accurate only for seeded pilot plans and codes.

Canonical detail: `docs/Medical Coding/ARCHITECTURE.md`, `VOICE_CODING_SPINE.md`.

---

## What is still an issue

| Issue | Impact | Tracker |
|-------|--------|---------|
| **Live Stedi 271** multilingual sign-off | Cannot claim real-time payer benefits in prod for all payers | PENDING **6.10** |
| **Dentrix CONNECTED** | No live Ascend write-back for CONNECTED clinics | Vendor / PENDING |
| **Eaglesoft** | Stub | Adapter throws |
| **Prod live copay PSTN** | Operator must run `verify:live-copay-call` | **CR-036** |
| **`payment_complete` timing** | May mark complete on link-send | Product honesty |
| **CDT stub / no full ADA** | Dental search & billing beyond ~29 real codes is weak | Phase **7.7-EXT** |
| **Copay = plan_rules seeds** | Unknown payer/plan → `cannot_determine`; not full benefit tables | Product / RCM |
| **CPT = MPFS not full AMA** | Commercial-only CPT may be missing | Licensing / import |
| **Platform sales languages** | EN only | Deferred |
| **Cancel multilang fragility** | Higher flake risk than book/copay | Eval history |
| **Escrow / Circle** | Not clinic RCM default | Flag-gated |
| **Card-on-call / Agent Pay for RCM** | Not product | By design |
| **Counsel retention / BAAs** | Legal/ops | PENDING operator list |

---

## Recommended demo script (honest)

> “Kelly answers your practice line, books on your calendar, checks benefits (sandbox or live when enrolled), quotes the copay, and texts a secure Stripe link — she never takes card numbers on the phone. Today we’re showing the Somo calendar + Stripe test path; live Stedi and Dentrix CONNECTED are the remaining vendor enrollments.”

---

## Key file map

| Layer | Paths |
|-------|-------|
| Voice | `voice-incoming-handler.js`, `retell-websocket.js`, `voice-routing-world.js` |
| Data | `call-site-context.js`, `kelly-rails/session-ssot.js`, `STATE_OWNERSHIP.md` |
| Agent | `kelly-turn-resolver.js`, `kelly-agent-service.js`, `mode-tool-firewall.js` |
| Rails | `kelly-rails/execute-turn.js`, `gates/payment.js`, `gates/insurance.js`, `gates/schedule.js` |
| Eligibility | `eligibility-orchestrator.js`, `insurance-service.js`, `stedi-271-parser.js` |
| EHR | `pms/pms-hub.js`, `pms/somo-adapter.js`, dentrix/athena adapters |
| Payment | `rcm-payment-request-service.js`, `rcm-payment-settlement.js`, `sms-service.js` |
| Codes | `database/repositories/medical-codes.js`, `import-{icd10,cpt,hcpcs,cdt}-codes.js`, `payer-quote-service.js`, `seeds/pilot-payer-rules.js`, `seeds/dental-payer-rules.js` |
| Loop | `outbound-call-service.js`, `sequence-engine-service.js`, sales rails |
| Docs | `KELLY_ORCHESTRATION_ARCHITECTURE.md`, `CONVERSATION_MODE_MATRIX.md`, `VOICE_ROUTING_SSOT.md`, `docs/Medical Coding/` |

---

## One-line product honesty

**Agentic Finance at Somo = voice-orchestrated eligibility + booking + PHI-safe Stripe collection.**  
It is **live as a link-based copay agent** on the Somo/Stripe path; it is **not** live as card-on-call, universal live Stedi, or Dentrix CONNECTED write-back.  
**Codes:** full medical ICD/HCPCS + MPFS CPT for lookup; **copay dollars from pilot `plan_rules`**; dental CDT is a **stub**, not a complete ADA codebook.
