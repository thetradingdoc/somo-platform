# Booking & Checkout Architecture — Detailed Analysis

**Generated:** March 2026 · **Last Updated:** March 2026

Comprehensive analysis of agentic tool calls, variables, functions, and constraints involved in the booking and checkout flow. Complements the constraints list with architectural issues and failure modes. **Consolidates gaps from** `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` and code review. **Aligned with** DocLittle Gap Register (Version 2.0 · March 2026).

---

## 1. Executive Summary

The listed constraints (LLM non-determinism, pattern matching, order of checks, `next_chips` empty) are **not the only issues**. This document identifies **additional architectural gaps** including:

- Dual execution paths with inconsistent guardrails
- Checkout handler bugs (response not sent on merchant error)
- Retell direct path had triage bypass — **remediated** (see §2: `session_id` / `callId` + shared server guardrails)
- Triple auto-checkout logic (three separate flows can create checkout)
- HTTP endpoints `/api/appointments/schedule` and `/api/appointments/available-slots` have no triage gates
- **~35+ distinct blockers** across slots → schedule → checkout → verify (see §7.9)
- **LLM non-determinism** is five distinct failure modes (LLM-1–LLM-5), not one; two are fixable bugs (see §7.0)
- **BUG-011/015**: `intake_complete_at` never saved until migrations run → booking gate always blocks (see §7.1)

---

## 2. Entry Points & Execution Paths

| Path | Trigger | Tool Executor | Triage Gates |
|------|---------|---------------|--------------|
| **Kelly (chat)** | `POST /api/patient/triage/message` | `KellyToolExecutor` | ✅ Full |
| **Kelly (voice)** | Retell `update.transcript` → `handleTranscript` | `KellyToolExecutor` (sessionId = callId) | ✅ Full |
| **Retell direct** | Retell `function_call` → `handleFunctionCall` | Retell handlers → HTTP | ✅ **Parity** (passes `session_id` + `callId`; DB gates when id present) |
| **Patient Orchestrator** | Kelly exception / fallback | `BookingService` directly | ⚠️ Different (RAG-based) |

### Retell direct path — triage parity (implemented)

**Problem (historical):** `handleScheduleAppointment` (and slots/reschedule) POSTed to voice endpoints **without** `session_id`, so `server.js` skipped DB triage guardrails when `sessionIdForGuard` was empty.

**Fix (current):**

- **`retell-websocket.js`** — `handleScheduleAppointment`, `handleGetAvailableSlots`, and `handleRescheduleAppointment` send **`session_id: callId`** and **`metadata: { session_id: callId }`** (plus existing `call_id` on slots). **`callId`** is the WebSocket `session_id` for the call (same id Kelly uses).
- **`server.js`** — `resolveVoiceSessionIdForGuard()` accepts `session_id`, `metadata.session_id`, or **`call_id`**. Shared **`enforceVoiceTriageGuardrailsForSession()`** applies the same safety / triage / confidence / OPQRST / intake checks to **`/voice/appointments/schedule`** and **`/voice/appointments/available-slots`** when an id is present. Slot cache keys include the session id so guarded and unguarded responses do not collide.
- **`checkBeforeScheduling`** (conversation red-flag) in `handleScheduleAppointment` remains **defense-in-depth** alongside DB gates; both are intentional.
- **`REQUIRE_TRIAGE_FOR_VOICE=1`** — optional: reject requests missing `session_id`/`call_id` on schedule, available-slots, and reschedule (**400** `SESSION_ID_REQUIRED`). See `.env.example`.

**Edge cases to test:** (1) `function_call` before any triage row → **403** `TRIAGE_INCOMPLETE` when `session_id` is set. (2) Kelly path unchanged — already sends `session_id` on schedule/slots (`KellyToolExecutor`).

---

## 3. Tool Calls & Functions (Complete Inventory)

### 3.0 Legend — what “Gates” means here

| Term | Meaning |
|------|--------|
| **Gates (Kelly)** | Checks inside `KellyToolExecutor` **before** an internal HTTP call (full triage/RAG/differentials/confidence where applicable). See `kelly-tool-executor.js`. |
| **Gates (voice HTTP)** | Checks in `server.js` on **`/voice/...`** when **`session_id`**, **`metadata.session_id`**, or **`call_id`** is present — shared helper `enforceVoiceTriageGuardrailsForSession` for schedule + available-slots; insurance uses `call_id`. Documented in [`middleware-platform/docs/VOICE_TRIAGE_PARITY.md`](../../middleware-platform/docs/VOICE_TRIAGE_PARITY.md). |
| **`—` in “Other”** | No *triage-style* gate listed in this row — **not** “no validation.” Checkout/verify still enforce merchant, tokens, appointment ownership, etc. (see §7). |
| **Path** | **Kelly only** = tool is only invoked via Kelly LLM (chat/voice transcript), not as a Retell native `function_call`. **Both** = Kelly executor and/or Retell direct handler may call the same HTTP route. |

**Retell direct** (`function_call` → `retell-websocket.js` handlers) does **not** run `KellyToolExecutor` first; it POSTs to `/voice/...`. Parity requires those POSTs to include **`session_id` / `call_id`** so voice HTTP gates apply. **`checkBeforeScheduling`** (conversation red-flags) on some handlers is **defense-in-depth** alongside DB gates — see `VOICE_TRIAGE_PARITY.md`.

**Maintainer note:** When changing triage enforcement, update this section if you touch **`KellyToolExecutor`** (`get_available_slots`, `schedule_appointment`, `collect_insurance`, …) **or** **`enforceVoiceTriageGuardrailsForSession` / `resolveVoiceSessionIdForGuard`** / **`/voice/insurance/collect`** guard blocks in **`server.js`**.

### 3.1 Booking flow tools

| Tool | Path | Kelly executor | Retell handler | HTTP endpoint | Gates (Kelly) | Gates (voice HTTP) | Other |
|------|------|----------------|----------------|---------------|----------------|---------------------|-------|
| `run_triage_rag` | **Kelly only** | `KellyToolExecutor._runTriageRAG` | *Not exposed as Retell native function* | — | N/A (creates/updates triage + RAG) | — | Intentional: triage/RAG runs through Kelly LLM, not a standalone Retell tool — avoids duplicate or unordered triage. |
| `get_available_slots` | **Both** | `_getAvailableSlots` | `handleGetAvailableSlots` | `POST /voice/appointments/available-slots` | Full: safety, RAG present/stale, differentials/specialty, confidence, triage complete, then slots/resolver. | When `session_id` / `call_id` present: same **DB** triage block as schedule (safety, triage complete, confidence, OPQRST, intake). See `VOICE_TRIAGE_PARITY.md`. | Kelly also POSTs with `session_id`. Retell sends `session_id` + `call_id`. |
| `schedule_appointment` | **Both** | `KellyToolExecutor` (schedule case) | `handleScheduleAppointment` | `POST /voice/appointments/schedule` | Full executor gates + POST includes `session_id`. | When id present: `enforceVoiceTriageGuardrailsForSession`. Retell also runs **`checkBeforeScheduling`** (conversation emergency) before HTTP. | Without id, legacy callers skip DB triage gate — use `REQUIRE_TRIAGE_FOR_VOICE` to require id. |
| `reschedule_appointment` | **Both** | Kelly case | `handleRescheduleAppointment` | `POST /voice/appointments/reschedule` | (Kelly path uses normal tool flow.) | Optional **`REQUIRE_TRIAGE_FOR_VOICE`**: 400 if no `session_id`/`call_id`. **No** full triage OPQRST block on reschedule (avoid blocking legitimate reschedule). | Retell POST includes `session_id: callId`. |
| `create_appointment_checkout` | **Both** | Kelly case | `handleCreateAppointmentCheckout` | `POST /voice/appointments/checkout` | — | — | **Other:** merchant, appointment exists, amounts; not triage gates. |
| `verify_checkout_code` | **Both** | Kelly case | `handleVerifyCheckoutCode` | `POST /voice/checkout/verify` | — | — | **Other:** token + code validity/expiry; `payment_token` recovery in meta (see LLM-5). |
| `collect_insurance` | **Both** | `_collectInsurance` | `handleCollectInsurance` | `POST /voice/insurance/collect` | Triage, RAG, OPQRST in executor. | When **`call_id`** in body (Retell always sends `call_id: callId`): **`/voice/insurance/collect`** runs triage safety + triage complete + confidence + OPQRST + intake in `server.js` — **same idea as schedule, keyed by `call_id`**, not `session_id` string name. **No bypass** on Retell direct if `call_id` is present. | Aligns with Kelly; Kelly POST includes `call_id`. |

### 3.2 Supporting Tools (affect booking context)

| Tool | Purpose |
|------|---------|
| `get_triage_session` | Read OPQRST / triage state |
| `store_triage_opqrst` | Persist OPQRST fields |
| `store_triage_rich_intake` | Persist meds, allergies, conditions |
| `request_document_upload` | Upload link for triage (e.g. rash photo) |
| `search_appointments` | Find existing appointments |
| `get_patient_claims` | Insurance/claims (calls `collect_insurance` first) |
| `end_call` | End conversation |

---

## 4. Variables & State

**Read §4.0 first.** It defines **portal vs triage vs voice `callId`** — the same vocabulary **§4.2** and **§4.3** use when describing identifiers and body fields (avoids inconsistent wording if sections are edited in isolation).

### 4.0 Session terminology (don’t confuse these)

| Concept | What it is | Typical id |
|--------|------------|------------|
| **Patient portal session** | Authenticated browser/session for **web** triage & booking (`/api/patient/...`). | `patient_portal_sessions.id` sent as **`x-session-id`**. Not the same row as `triage_sessions` unless wired by app logic. |
| **Triage / Kelly clinical session** | Row in **`triage_sessions`** keyed by **`session_id`**. Holds OPQRST, RAG link, intake, safety. | For **voice**, this **`session_id` is usually the Retell `callId`** (same string Kelly uses). |
| **Voice `callId`** | Retell’s per-call id from the WebSocket. | Passed to HTTP as **`session_id`**, **`metadata.session_id`**, and **`call_id`** (depending on route) so **`server.js`** can run triage guardrails. See §2 remediation and [`VOICE_TRIAGE_PARITY.md`](../../middleware-platform/docs/VOICE_TRIAGE_PARITY.md). |

### 4.1 DB Tables

| Table | Key Columns | Role in Booking/Checkout |
|-------|-------------|---------------------------|
| `triage_sessions` | `session_id`, `opqrst_complete`, `triage_complete`, `rag_result_id`, `intake_complete_at`, `safety_level`, `referred_to_911` | **Kelly executor** and **`/voice/...` HTTP** (when `session_id` / `call_id` present) read this for gates — see §3. |
| `triage_rag_results` | `session_id`, `target_specialty`, `rag_confidence`, `safety_level`, `urgency`, `soap_note`, `primary_icd10` | RAG output, CPT/ICD for billing |
| `patient_orchestrate_sessions` | `session_id`, `flow_state`, `conversation_history`, `turn_count`, `initial_name` | Session continuity, fraud check |
| `kelly_session_meta` | `session_id`, `payment_token`, `checkout_id`, `last_slot_bundles`, `preferred_language` | Token recovery, slot lookup; **`preferred_language`** is the session language anchor (LLM-4 / gap18: persist on first detection, read thereafter — not dead metadata). |
| `kelly_conversation_history` | `session_id`, `role`, `content` | Chat history for LLM |
| `appointments` | `id`, `clinic_id`, `patient_id`, `date`, `time`, `status`, `appointment_type` | Booked appointments |
| `voice_checkouts` | `id`, `appointment_id`, `merchant_id`, `amount`, `customer_phone`, `status` | Checkout records; ties to Stripe session / payment intent metadata |
| `payment_tokens` | `token`, `checkout_id`, `verification_code`, `verification_code_expires`, `status` | 6-digit code verification |
| `eligibility_checks` | `patient_id`, `copay_amount`, `allowed_amount`, `insurance_pays` | Insurance-based pricing |
| `visit_pricing` | `clinic_id`, `appointment_type`, `base_price`, `effective_price` | Fallback pricing |
| `idempotency_keys` | `id`, `operation_type`, `result_json`, `status` | Dedupes **`POST /api/patient/booking/schedule`** and **`POST /api/patient/appointments/:id/checkout`** (`patient_booking_schedule`, **`patient_checkout`**) — prevents double-book / duplicate Stripe sessions on retry. |

*See also:* `stripe_webhook_events` (payment settlement; §7 checkout blockers), clinic/merchant tables — not exhaustive.

### 4.2 Session identifiers (by channel)

| Context | Identifier | Source / how it reaches HTTP |
|---------|------------|--------------------------------|
| **Chat (patient portal)** | Portal session | **`x-session-id`** — patient portal auth; triage chat uses separate **`triage_sessions.session_id`** tied to Kelly state. |
| **Voice (Kelly LLM)** | `callId` ≡ Kelly **`sessionId`** | Same string as **`triage_sessions.session_id`**. Tools POST **`session_id`** + **`metadata.session_id`** to **`/voice/...`**. |
| **Retell direct** (`function_call` handlers) | `callId` | Handlers receive **`callId`**; **`handleScheduleAppointment` / `handleGetAvailableSlots` / `handleRescheduleAppointment`** send **`session_id: callId`**, **`metadata: { session_id: callId }`**, and slots also send **`call_id`**. **`handleCollectInsurance`** sends **`call_id`** (insurance route keys guards off **`call_id`**). |

### 4.3 Key variables & env (booking / voice)

| Variable / setting | Required? | Source | Notes |
|--------------------|-----------|--------|-------|
| `session_id` | For **voice HTTP triage gates** when present | Kelly tools, Retell handlers (`callId` as `session_id`) | If absent, legacy **`/voice/...`** may skip DB triage block (see §2). **`REQUIRE_TRIAGE_FOR_VOICE`** can require id. |
| `metadata.session_id` | Same as above | Kelly `schedule` POST, Retell POST bodies | Resolved with `session_id` in `resolveVoiceSessionIdForGuard` (`server.js`). |
| `call_id` | Insurance voice gates; slots context | Retell **`handleCollectInsurance`**, **`handleGetAvailableSlots`** | **`/voice/insurance/collect`** uses **`guardCallId = args.call_id`**. |
| `clinic_id` | Yes | `x-clinic-id`, body, phone→clinic, `DEFAULT_CLINIC_ID` | |
| `patient_name` | Yes (schedule) | LLM extraction, `initial_name` (fraud) | |
| `patient_phone` | Yes (schedule) | LLM, caller ID, connection | Normalized +1 |
| `patient_email` | Yes (schedule) | LLM | Required for confirmations |
| `practitioner_id` | Specialist path | Slot bundles | Often missing (M1, M5) |
| `date` / `time` | Yes (schedule) | LLM, slot selection | Weekend normalized; `ASYNC` → `11:30 AM` |
| `payment_token` | Verify | `kelly_session_meta`, tool args | Kelly recovers if dropped (LLM-5) |
| `verification_code` | Verify | User (6-digit) | ~10‑min expiry |
| `REQUIRE_TRIAGE_FOR_VOICE` | Optional env | `.env` | If **`1`**, schedule / available-slots / reschedule **require** `session_id` or `call_id` or **400** `SESSION_ID_REQUIRED`. |
| `RAG_CONFIDENCE_THRESHOLD` | Optional env | `.env` (default **0.7**) | Used by **`enforceVoiceTriageGuardrailsForSession`** and Kelly threshold logic. |
| `visit_mode` | Per schedule / appointment | Body / args; Retell default **`sync_video`** | **`sync_video`** vs **`async_review`** — affects lane, Stripe pre-auth vs capture, and UX. Passed in **`handleScheduleAppointment`** and stored on appointment. |
| **`Idempotency-Key` header** | Patient portal schedule + checkout | Client on **`POST /api/patient/booking/schedule`** and **`POST /api/patient/appointments/:id/checkout`** | In-handler pending-checkout reuse still applies; middleware adds race protection (**BE4** remediated). Voice **`/voice/appointments/schedule`** does not use this header pattern (different API surface). |

---

## 5. Data Flow: User → Slots → Schedule → Checkout → Payment

**Scope:** The diagram below is the **primary Kelly path** (patient triage chat/voice via `KellyToolExecutor`). **Entry points and session ids** differ by channel — see **§2**, **§4.0**, and [`PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md`](./PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md).

```
User: "I want to book for back pain"
    │
    ▼
[Kelly] store_triage_opqrst, store_triage_rich_intake
    │
    ▼
[Kelly] run_triage_rag → triage_rag_results, triage_sessions.triage_complete
    │
    ▼
[Kelly] get_available_slots (gated by triage)
    │     └─ SpecialistResolver OR BookingService.getAvailableSlots
    │
    ▼
[User] Picks slot (next_chips or reply parsing)
    │
    ▼
[Kelly] schedule_appointment
    │     └─ BookingService.scheduleAppointment
    │     └─ Auto-checkout (shared: autoCheckoutAfterSchedule — voice schedule, legacy API schedule, orchestrator)
    │
    ▼
[Tools / HTTP] create_appointment_checkout (if not auto-done)
    │     KellyToolExecutor · Retell handleCreateAppointmentCheckout · POST /voice/appointments/checkout
    │     └─ voice_checkouts (+ triage_session_id when provided), payment_tokens, email / Stripe context
    │
    ▼
[User] Provides 6-digit code (voice/email flow) OR continues in patient portal
    │
    ▼
[Tools / HTTP] verify_checkout_code → checkout verified
    │     KellyToolExecutor · Retell handleVerifyCheckoutCode · POST /voice/checkout/verify
    │
    ▼
[User] Payment
    │     Voice/email: pay via link; may use Circle wallet if configured
    │     Patient portal: POST /api/patient/appointments/:id/checkout → Stripe Checkout (Idempotency-Key)
    │     visit_mode (e.g. sync_video vs async_review) affects pre-auth vs capture — see §4.3
```

### 5.1 Other paths (not shown in the diagram)

| Path | How it differs |
|------|----------------|
| **Retell direct** (`function_call`) | No `KellyToolExecutor` before HTTP; POSTs to `/voice/...` with `session_id` / `call_id` for parity (§2). |
| **Patient Orchestrator** | Calls `BookingService.scheduleAppointment` directly; not the same tool chain as Kelly; `session_id` is orchestrator-scoped (see provenance doc above). |
| **Patient portal web** | `/api/patient/booking/schedule` + `/api/patient/appointments/:id/checkout` — authenticated portal session (`x-session-id`), not Retell `callId`. |
| **Legacy `/api/appointments/*`** | No triage gates; optional **410** if `LEGACY_APPOINTMENTS_API_DISABLED=1` (§6.6). |

---

## 6. Gating Logic (Conditions Required)

**Implementation:** Shared guardrails live in **`middleware-platform/services/voice-triage-guards.js`**: `resolveVoiceSessionIdForGuard`, `requireVoiceSessionIdForTriageParity`, `evaluateTriageGuardrailsForSession` (pure — used by **Patient Orchestrator** when a triage row exists), `enforceVoiceTriageGuardrailsForSession` (Express). See **`middleware-platform/docs/VOICE_TRIAGE_PARITY.md`** and **`PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md`**.

### 6.0 Remediation matrix (issues → fixes)

| Issue | Fix |
|-------|-----|
| Guard drift / invisible edits | **impl-1:** single module `voice-triage-guards.js` (above). |
| No triage row but `callId` sent early | **impl-10:** **403 `TRIAGE_NOT_STARTED`** when `getTriageSession` returns null (not conflated with incomplete triage). |
| Conflicting `session_id` vs `call_id` | **impl-14:** documented priority — **`session_id` > `metadata.session_id` > `call_id`**; tests in `__tests__/voice-triage-guards.test.js`. |
| Production voice without session ids | **`REQUIRE_TRIAGE_FOR_VOICE=1`** + startup warning in prod if unset (`server.js`). |
| Legacy integrators break on 410 | **impl-11:** **410** body includes `replacement_routes`, doc links, `error_code: LEGACY_APPOINTMENTS_API_DEPRECATED`. |
| Data blocking gates silently | **impl-6 / impl-13:** run migrations for **`intake_complete_at`**; verify **`kelly_session_meta.preferred_language`** (LLM-4 / gap18); monitor **403** `TRIAGE_*` rates — see `middleware-platform/docs/DEPLOYMENT_DATA_CHECKLIST.md`. |
| Orchestrator bypassed Kelly gates | **impl-5 (C1):** if **`getTriageSession(session.session_id)`** returns a row, **`evaluateTriageGuardrailsForSession`** runs before **`BookingService.scheduleAppointment`**; if **no** row, booking allowed (non-triage orchestrator flows). |
| Postgres checkout audit column | **impl-9:** **`voice_checkouts.triage_session_id`** ensured on Postgres (`ensureVoiceCheckoutsTriageColumnPg` + INSERT) — see `database.js`. |

### 6.1 `get_available_slots` (Kelly path)

All must be true:

- `safety_level !== 'red'`, `referred_to_911 !== true`
- `TriageRAGService.getLatestForSession(sessionId)` exists
- `session_row.rag_result_id` matches latest RAG (no stale)
- ≥1 differential or `target_specialty`
- `rag_confidence >= 0.7` (or borderline override)
- `triage_complete === true`
- `opqrst_complete === true`
- `intake_complete_at` present

### 6.2 `schedule_appointment` (Kelly path)

Same as above, plus:

- `getTriageSession(sessionId)` exists
- No red safety (unless `provider_override_emergency`)

### 6.3 `schedule_appointment` (HTTP when session_id present)

Mirrors Kelly path: **`POST /voice/appointments/schedule`** calls **`enforceVoiceTriageGuardrailsForSession`** after **`resolveVoiceSessionIdForGuard`** (`voice-triage-guards.js`).

### 6.4 `schedule_appointment` (Retell direct)

- **`checkBeforeScheduling(recentTurns)`** (conversation red flags) — **defense-in-depth** before HTTP; should still run even when DB triage is complete (see `middleware-platform/__tests__/triage-service.test.js` and **`middleware-platform/__tests__/retell-schedule-defense.test.js`** — order vs `POST /voice/appointments/schedule`).
- Email format validation; phone presence.
- **HTTP `/voice/appointments/schedule`:** when **`session_id` / `metadata.session_id` / `call_id`** is present, **`enforceVoiceTriageGuardrailsForSession`** applies the **same DB triage block** as Kelly (safety, triage complete, confidence, OPQRST, intake) — see §2. Retell handlers pass **`callId`** as those fields.
- **If no triage row exists yet** for that id → **403 `TRIAGE_NOT_STARTED`** (impl-10).
- **If no session id is sent** (legacy callers), DB triage gates are skipped unless **`REQUIRE_TRIAGE_FOR_VOICE=1`** forces **400** `SESSION_ID_REQUIRED`.

### 6.5 `collect_insurance` (voice HTTP)

- **`POST /voice/insurance/collect`** uses the **same** **`resolveVoiceSessionIdForGuard`** + **`enforceVoiceTriageGuardrailsForSession(..., 'insurance')`** when a session key is present (unified with schedule/slots; Retell typically sends **`call_id`**).
- When **`REQUIRE_TRIAGE_FOR_VOICE=1`**, **`requireVoiceSessionIdForTriageParity`** applies (must send **`session_id`** or **`call_id`**).

### 6.6 `schedule_appointment` & `available-slots` (API endpoints)

- **`POST /api/appointments/schedule`** — No triage gates. Direct API calls can schedule without triage. Kelly enforces before calling, but the endpoint does not.
- **`GET /api/appointments/available-slots`** — No triage gate. Slots can be fetched without triage when called directly.
- **Optional:** set **`LEGACY_APPOINTMENTS_API_DISABLED=1`** to return **410 Gone** with **`replacement_routes`** and doc pointers in the JSON body (impl-11) — use patient portal + `/voice/...` instead.

---

## 7. Additional Issues (Beyond Listed Constraints)

**Full checklist (every §7.0–§7.11 ID):** [`BOOKING_CHECKOUT_SECTION7_TODOS.md`](./BOOKING_CHECKOUT_SECTION7_TODOS.md)

### 7.0 LLM Non-Determinism (LLM-1 – LLM-5)

Previously listed as one vague risk. It is **five distinct failure modes** — two fixable bugs, one structural, two model behavior to monitor.

| ID | Failure Mode | Blocks Booking? | Clean Fix? | Root Cause | Effort |
|----|--------------|-----------------|------------|------------|--------|
| **LLM-1** | Tool call skipping | Sometimes | Partial | Gates block it; recovery bad. Kelly apologizes instead of asking missing question | MEDIUM |
| **LLM-2** | Time parsing failure | Yes (U5) | Yes | "I said 10 am" → "I'm not sure" — colloquial time not mapped | SMALL |
| **LLM-3** | Confidence hallucination | Occasionally | Partial | LLM ignores rag_confidence score; treats 0.68 as "close enough" or 0.72 as "uncertain" | MEDIUM |
| **LLM-4** | Language drift | No — annoying | Yes (gap18) | "yes" in English mid-convo causes switch; language re-detected each turn | TINY |
| **LLM-5** | Payment token drops | Yes (A7) | Yes | Token pushed out of 12-turn context window; recover from kelly_session_meta | SMALL |

**LLM-1 — Tool Call Skipping**: Kelly must call `store_triage_opqrst` → `run_triage_rag` → `get_available_slots` in order. Gates catch skips and return `TRIAGE_INCOMPLETE`, but recovery is poor: Kelly sometimes apologizes instead of asking the missing question. **Fix**: Enforce explicit tool sequence in system prompt; make `triage_sessions.triage_state` authoritative.

**LLM-2 — Time Parsing (U5)**: "2 PM Thursday" parses reliably. "morning", "around 10", "the first one", "that works" do not. **Fix**: Slot bundles need a chip index so patient can say "option 2" and Kelly maps deterministically.

**LLM-3 — Confidence Hallucination**: Tune via prompt with explicit examples: "If rag_confidence < 0.7 you MUST ask one clarifying question before calling get_available_slots."

**LLM-4 — Language Drift (gap18)**: Write `detected_language` to `kelly_session_meta` on first turn; read from there on every subsequent turn. ~20‑minute fix.

**LLM-5 — Payment Token Drops (A7)**: When `create_appointment_checkout` succeeds, store `payment_token` in `kelly_session_meta`. In `verify_checkout_code`, read from meta if args omit it. Fully deterministic fix.

### 7.1 Bugs

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| **BUG-011/015** | Migrations 011 + 015 not run — `intake_complete_at` never saved | DB migrations | Booking gate always blocks; `TRIAGE_INCOMPLETE` fires until migration runs |
| **B1** | Checkout handler returns plain object instead of `res.status().json()` when `merchantId` missing | `server.js` 2969–2976, 2980–2986 | Client hangs; no HTTP response sent |
| **B2** | Same for `existingMerchant` check | `server.js` 2980–2986 | Client hangs |
| **B3** | Groq 413 crash loop — fallback model gets full prompt; compact not used | LLM fallback path | Fallback also fails; keep only last 4 messages on 413 |

### 7.2 Architectural Gaps

| ID | Issue | Impact |
|----|-------|--------|
| **A1** | Retell direct path omits `session_id` → triage gates skipped | Schedule without triage when using Retell native functions |
| **A2** | Triple auto-checkout: `KellyToolExecutor` (after schedule), `/voice/appointments/schedule`, and `/api/appointments/schedule` each call checkout | Risk of multiple checkouts per appointment |
| **A3** | `KellyFunctionExecutor` exists but is unused (dead code) | Confusion; possible leftover from refactor |
| **A4** | Retell `handleCreateAppointmentCheckout` uses `customer_*`; server expects `patient_*` or `customer_*` | Works via server fallback but inconsistent |
| **A5** | `handleScheduleAppointment` does not pass `metadata: { session_id: callId }` | Triage gates never run for Retell direct |
| **A6** | Slot cache can return stale availability | Double-booking risk if TTL misconfigured |
| **A7** | `payment_token` recovery only in Kelly; Retell direct has no equivalent | Verify fails if LLM drops token |
| **A8** | `/api/appointments/schedule` has no triage gates | Direct API calls can schedule without triage |
| **A9** | `/api/appointments/available-slots` has no triage gate | Slots can be fetched without triage via direct API |
| **A10** | Auto-checkout (API path) passes `patient_*` but not `customer_*` | Works via server fallback but inconsistent with Retell |

### 7.3 Variable / Mapping Gaps

| ID | Issue | Notes |
|----|-------|-------|
| **V1** | Retell checkout payload: `customer_name`, `customer_email`, `customer_phone` | Server maps via `args.customer_* \|\| args.patient_*` |
| **V2** | `practitioner_id` often missing in slot bundles | Specialist path underused; clinic-wide fallback |
| **V3** | `clinic_id` resolution: multiple sources, priority order | Wrong tenant if misconfigured |

### 7.4 Race / Consistency

| ID | Issue | Notes |
|----|-------|-------|
| **R1** | Session wipe only when `turn_count === 0` or no session | Stale `triage_rag_results` if session ID reused |
| **R2** | Weekend normalization in both `KellyToolExecutor` and `BookingService` | Duplication; drift risk |
| **R3** | `eligibilityChecks` vs `eligibility_checks` (naming) | `server.js` 2914 raw SQL; possible typo in other code |

### 7.5 Schedule Gaps (from PATIENT_BOOKING_AND_TRIAGE_GAPS)

| ID | Issue | Impact |
|----|-------|--------|
| **S1** | Duplicate patient detection blocks schedule | Patient cannot book when name matches existing but contact differs |
| **S2** | Insurance 409 blocks flow | User asked for insurance, then blocked; unclear next step |
| **S3** | No practitioner-scoped conflict check | Overly strict; reduces capacity |
| **S4** | Name mismatch warning but schedule continues | Possible wrong patient linkage |

### 7.6 Checkout Gaps (from PATIENT_BOOKING_AND_TRIAGE_GAPS)

| ID | Issue | Impact |
|----|-------|--------|
| **C1** | Clinic has no `merchant_id` | Checkout fails (related to B1/B2) |
| **C2** | Auto-checkout 10s timeout | Can fail when email send is slow |
| **C3** | Invalid `appointment_id` accepted | Orphaned checkouts; payment link may not match |
| **C4** | No `ensureMerchantForClinic` fallback in checkout | Single-tenant clinics blocked |

### 7.7 Supporting / UX Gaps (from PATIENT_BOOKING_AND_TRIAGE_GAPS)

| ID | Issue | Impact |
|----|-------|--------|
| **U1** | Document upload fails (ENOENT, etc.) | Patient cannot attach photos for triage |
| **U2** | Groq 429 rate limit | Fallback to Orchestrator; rate-limit message helps but doesn't unblock |
| **U3** | SMS fails for test numbers | Dev/testing cannot receive SMS |
| **U4** | Chips persist after conversation starts | UX clutter |
| **U5** | "10 am" → "I'm not sure how to respond" | LLM fails to map time to `schedule_appointment` |
| **U6** | `verify_checkout_code` 400 | Wrong params, expired code, or invalid token |
| **U7** | `eligibilityChecks is not defined` | Checkout path error in some code paths |

### 7.8 Triage / Matching Gaps (gap1–gap18, condensed)

| ID | Task |
|----|------|
| gap1 | Enforce OPQRST state machine; block slots until run_triage_rag |
| gap2 | Wire SpecialistResolver + getAvailableSlotsWithSpecialist into KellyToolExecutor |
| gap3 | Seed provider_profiles: 2–3 rows |
| gap4 | Feed kellyScript (filter decay) back into LLM context |
| gap5 | Pass patient price_tier to get_available_slots |
| gap6 | Specialty-specific deep-dive questions in Kelly prompt |
| gap7 | Severity ≥8 as routing gate: force urgency, restrict async |
| gap8 | Mental health intake: PHQ-2/GAD-2, safety screen |
| gap9 | Async vs Sync UX script in prompt |
| gap10 | Document upload pause-resume: halt, wait, feed image into RAG |
| gap15 | Delay insurance collection until specialty known from RAG |
| gap16 | Call SpecialistResolverService.cleanupCache() on startup + every 60 min |
| gap17 | Add unique DB constraint on (practitioner_id, start_time, status) |
| gap18 | Persist detected language to session; read from there instead of re-detecting each turn |

*Full list: see `docs/PATIENT_BOOKING_AND_TRIAGE_GAPS.md`.*

### 7.9 Booking Blockers — Complete List (by Flow Phase)

All conditions that can prevent a user from successfully booking an appointment. **These are in addition to** the gaps above.

Executable matrix with owner and mitigation status: `docs/architecture/BOOKING_BLOCKER_MATRIX.md`.

#### Phase 1: Get Slots (Kelly path)

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| No triage session row | `TRIAGE_REQUIRED` | KellyToolExecutor |
| Safety red (emergency) | `SAFETY_BLOCKED` | KellyToolExecutor |
| No RAG result | `TRIAGE_REQUIRED` | KellyToolExecutor |
| Stale RAG (rag_result_id mismatch) | `TRIAGE_REQUIRED` | KellyToolExecutor |
| No differentials or target_specialty | `DIFFERENTIALS_REQUIRED` | KellyToolExecutor |
| Low RAG confidence (<0.7) | `LOW_CONFIDENCE` | KellyToolExecutor |
| Triage not complete | `TRIAGE_INCOMPLETE` | KellyToolExecutor |
| `intake_complete_at` missing (BUG-015) | `TRIAGE_INCOMPLETE` — always fires until migrations 011+015 run | KellyToolExecutor |
| `clinic_id` missing | 400 / "clinic_id is required" | All paths |
| `DEFAULT_CLINIC_ID` not set (voice/API) | 400 when no clinic in request | server.js |

#### Phase 1: Get Slots (Retell direct)

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| Missing `clinic_id` | "Missing clinic context for availability check" | retell-websocket |

#### Phase 2: Schedule (Kelly path)

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| Same as Phase 1 (triage gates) | Various | KellyToolExecutor |
| Validation: missing patient_name, date, time, phone/email | "Validation failed: ..." | BookingService |
| Weekend/holiday (no next business day) | "We're open Monday–Friday..." | BookingService |
| Slot no longer available (race) | "Slot not available: ..." | BookingService |
| Duplicate patient (name match, phone differs) | `duplicate: true`, `requiresPhoneConfirmation` | FHIRService → BookingService |
| Phone required for FHIR create | "Phone number is required" | BookingService catch |
| DB unique constraint / slot conflict | `slot_conflict: true` | BookingService |

#### Phase 2: Schedule (Retell direct)

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| Missing email | `requiresEmail: true` | retell-websocket |
| Invalid email format | `requiresEmail: true` | retell-websocket |
| Missing phone | `requiresPhone: true` | retell-websocket |
| Missing `clinic_id` | "Missing clinic context" | retell-websocket |
| (Plus all BookingService blockers above) | | |

#### Phase 3: Checkout (post-schedule)

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| Clinic has no `merchant_id` | B1/B2 — client hangs (no response) | server.js |
| Merchant not found in DB | B2 — client hangs | server.js |
| Auto-checkout timeout (e.g. 10s) | Checkout not created, user stuck | C2 |
| No `customer_email` on appointment | Verification code not sent | checkout handler |
| Invalid `appointment_id` | Orphaned checkout | C3 |

#### Phase 4: Verify & Pay

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| Wrong/expired verification code | `verify_checkout_code` 400 | U6 |
| `payment_token` dropped by LLM (Retell) | Verify fails | A7 |

#### Infrastructure / Environment

| Blocker | Error / Behavior | Ref |
|---------|------------------|-----|
| Groq 429 rate limit | "High demand" fallback, possible loop | U2 |
| Groq 413 wrong fallback (B3) | Compact prompt not used; fallback model also fails | LLM-5 |
| Empty slots (no providers, no availability) | User has nothing to pick | SpecialistResolver, clinic config |
| `provider_profiles` empty | Resolver returns empty; falls back to clinic-wide | gap3 |

### 7.10 UI Gaps (End-to-End Booking Pipeline)

UI-specific gaps for the patient portal booking flow. Many UX gaps (U1–U7) cover chat/voice; these focus on **web UI**, **navigation**, and **handoffs**.

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| **UI1** | **Schedule page undiscoverable** | `patient-dashboard.html`, `appointments.html` | Resolved: `schedule.html` is now discoverable via portal navigation and “Pick from calendar”. |
| **UI2** | **Book.html lacks calendar option** | `book.html` | Resolved: `book.html` now includes a “Pick from calendar” entry that leads into `schedule.html`. |
| **UI3** | **Triage → Schedule handoff brittle** | `schedule.html` chat modal | Resolved: `select_slot` handoff extracts `date` from `slot.date` or `slot.start_time` and falls back to the current calendar selection, instead of failing when `triageState.date` is missing. |
| **UI4** | **6-digit code entry in chat** | `schedule.html` chat modal | Resolved: the schedule chat UI shows a dedicated 6-digit code entry panel (`chatCodeEntry`) instead of requiring users to type the code raw in chat. |
| **UI5** | **"Unable to load availability" — no retry** | `schedule.html` | Resolved: slot-load failures/empties now surface retry CTAs (“Retry loading times”, “Try another date”). |
| **UI6** | **Hold expiry does not refresh slots** | `schedule.html` | Resolved: on hold expiry, the UI clears the selection and re-fetches slots for the selected date. |
| **UI7** | **Session expiry loses context** | `triage.html`, `schedule.html` | Resolved: session-expiry redirects preserve context via `return=` and show a return-to-calendar link when coming back to triage. |
| **UI8** | **Patient app has no booking** | `patient-app` | Documented as out-of-scope for this build: booking is handled via the web portal (schedule/triage), not via the mobile app. |
| **UI9** | **Chat modal hidden on mobile** | `schedule.html` | Resolved: “Chat with agent” button is visible on mobile (no longer `hidden sm:inline-flex`). |
| **UI10** | **No empty-slots fallback** | `schedule.html`, `triage.html` | Resolved: empty slot results prompt the user to retry or pick another date, rather than leaving empty buckets with no action. |
| **UI11** | **Async lane: hard redirect to triage** | `schedule.html` -> `triage.html` | Resolved: “Start async review” carries a `return=` back to schedule; `triage.html` exposes a return link after login/session expiry. |

### 7.11 Additional Backend Gaps (Senior Review)

Gaps not yet covered above. These affect correctness, security, and operability.

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| **BE1** | **Input validator unused** | patient booking/triage routes | Resolved: `validatePatientBookingScheduleBody`, `validatePatientAvailableSlotsQuery`, and `validatePatientTriageBody` are applied to `/api/patient/booking/schedule`, `/api/patient/booking/available-slots`, and `/api/patient/triage/message` (400 on invalid input). |
| **BE2** | **No message length limit on triage** | `handlePatientTriageMessage` | Resolved: triage messages are capped (`MAX_TRIAGE_MESSAGE_LENGTH = 4000`) with a 400 response for oversized input. |
| **BE3** | **available-slots with missing date** | `GET /api/patient/booking/available-slots` | Resolved: missing `date` is validated up-front and returns 400, avoiding undefined behavior in slot computation. |
| **BE4** | ~~**Checkout endpoint has no idempotency**~~ **Remediated** | `POST /api/patient/appointments/:id/checkout` | **`withIdempotency('patient_checkout')`** added; pending-checkout reuse remains for UX. |
| **BE5** | **Duplicate Stripe webhook paths** | server.js vs stripe-webhook-handler | Resolved: canonical endpoint is `POST /webhooks/stripe` (mounted from `routes/stripe-webhook-handler`). The legacy `POST /webhook/stripe` is disabled by default (returns 410) unless `ALLOW_LEGACY_STRIPE_WEBHOOK=1`. |
| **BE6** | **No request correlation ID** | All patient booking APIs | Resolved: correlation IDs are generated/propagated (e.g. `x-request-id` / `req.id`) across the booking/checkout pipeline for traceability and Stripe metadata. |
| **BE7** | **Patient checkout success vs webhook race** | payment-success.html | Resolved: patient “payment-success” UI polls `GET /api/patient/appointments/:id/payment-status` and shows “Confirming payment…” until settled. |
| **BE8** | **timezone not validated** | available-slots, schedule | Resolved: `isValidIanaTimezone()` enforces valid IANA timezones on voice and patient booking/scheduling routes. |
| **BE9** | **No audit log for booking actions** | BookingService, checkout | Resolved: booking/checkout transitions write audit entries via `auditBookingEvent(...)` and `db.insertAuditEvent(...)` when available. |

---

## 8. File Reference

| Area | Path |
|------|------|
| Kelly agent | `middleware-platform/services/kelly-agent-service.js` |
| Kelly tool executor | `middleware-platform/services/kelly-tool-executor.js` |
| Retell websocket | `middleware-platform/webhooks/retell-websocket.js` |
| Schedule handler | `middleware-platform/server.js` — `POST /api/appointments/schedule` (voice schedule route) |
| Checkout handler | `middleware-platform/server.js` — `handleCreateAppointmentCheckout` and `POST /api/voice/appointments/:appointmentId/checkout` |
| Verify handler | `middleware-platform/server.js` — `POST /api/voice/checkout/verify` |
| Booking service | `middleware-platform/services/booking-service.js` |
| Triage RAG | `middleware-platform/services/triage-rag-service.js` |
| Retell function schemas | `middleware-platform/retell-functions/retell-functions.json` |
| Gap consolidation | `docs/PATIENT_BOOKING_AND_TRIAGE_GAPS.md` |
| Specialist resolver | `middleware-platform/services/specialist-resolver-service.js` |
| Patient triage UI | `unified-dashboard/patients/triage.html` |
| Patient schedule UI | `unified-dashboard/patients/schedule.html` |
| Patient book entry | `unified-dashboard/patients/book.html` |
| Payment page (token) | `middleware-platform/public/payment/index.html` |

---

## 9. Gap Summary

| Category | IDs | Count | Priority |
|----------|-----|-------|----------|
| **LLM Non-Determinism** | LLM-1 – LLM-5 | 5 | CRITICAL |
| **Booking blockers** (see §7.9) | Phase 1–4 + infra | ~35 | CRITICAL |
| Architectural | A1–A10 | 10 | HIGH |
| Bugs | BUG-011/015, B1, B2, B3 | 4 | HIGH |
| Schedule | S1–S4 | 4 | HIGH |
| Checkout | C1–C4 | 4 | HIGH |
| Triage / Matching | gap1–gap18 | 14 | MEDIUM |
| UI (pipeline) | UI1–UI11 | 11 | MEDIUM |
| Backend (senior review) | BE1–BE9 | 9 | MEDIUM |
| UX / Supporting | U1–U7 | 7 | MEDIUM |
| Variable / Mapping | V1–V3 | 3 | LOW |
| Race / Consistency | R1–R3 | 3 | LOW |
| **Total gaps (distinct)** | | **~67** | |

---

## 10. Post-Implementation Rollout Checklist

All Step 7 items in `BOOKING_CHECKOUT_SECTION7_TODOS.md` are implemented (code + tests), and the patient portal/voice UI pipeline is reconciled.

Use this checklist to validate the release in each environment:

1. **Stripe webhook configuration**
   - Confirm Stripe posts to `POST /webhooks/stripe`.
   - If any legacy integration still posts to `POST /webhook/stripe`, set `ALLOW_LEGACY_STRIPE_WEBHOOK=1` temporarily while you update Stripe.
2. **End-to-end “book today” smoke test**
   - Kelly chat: triage → schedule → checkout → `payment-success` “Confirming payment…” then confirmed.
   - Retell direct: schedule/slots parity with `session_id: callId` preserved through the voice HTTP gates.
   - Patient portal: calendar-first → slot selection → continue to payment.
3. **UI resiliency checks**
   - Slot-load failure path shows retry CTAs.
   - Hold expiry refetches slots.
   - Async review path returns to schedule via the `return=` flow.
4. **Voice/API guardrail checks**
   - Invalid IANA `timezone` returns 400.
   - Missing/invalid triage/session identifiers are rejected when required by guardrails.
5. **Observability**
   - Correlation IDs exist on booking/checkout transitions.
   - Audit events exist for schedule/checkout actions where the DB supports them.

---

## 11. What to Monitor in Production

Step 7 is implemented; this section is runtime monitoring guidance rather than remaining “to-dos”.

1. **Payment settlement latency**
   - Webhook delay vs `GET /api/patient/appointments/:id/payment-status` polling duration.
2. **TRIAGE guardrail failure rates**
   - Unexpected 400/403 spikes can indicate session/callId plumbing regressions.
3. **Slot-cache invalidation + freshness**
   - Schedule/reschedule/cancel should cause subsequent slot fetches to refresh.
4. **Stripe webhook reachability**
   - Confirm each environment posts to `POST /webhooks/stripe`.
