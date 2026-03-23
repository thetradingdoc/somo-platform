# §7 Additional Issues — Full Todo Checklist

Derived from **`BOOKING_CHECKOUT_ARCHITECTURE_ANALYSIS.md`** §7.0–§7.11. Use this for tracking; many items are **partially remediated** elsewhere (voice triage parity, `autoCheckoutAfterSchedule`, BE4, etc.) — verify code before closing.

---

## 7.0 LLM non-determinism (LLM-1 – LLM-5)

- [x] **LLM-1** — Enforce explicit tool sequence in Kelly prompt; make `triage_sessions.triage_state` authoritative; improve recovery (ask missing question vs apologize).
- [x] **LLM-2** — Slot bundles + chip index so “option 2” / colloquial time maps deterministically (`schedule_appointment`).
- [x] **LLM-3** — Prompt tuning: explicit `rag_confidence < 0.7` → one clarifying question before `get_available_slots`.
- [x] **LLM-4 / gap18** — Persist language to `kelly_session_meta` / session; read on subsequent turns (verify gap18 path in prod).
- [x] **LLM-5 / A7** — On `create_appointment_checkout` success, store `payment_token` in `kelly_session_meta`; `verify_checkout_code` reads meta if args omit token.

---

## 7.1 Bugs

- [x] **BUG-011/015** — Run / verify migrations so `intake_complete_at` and related columns persist (`DEPLOYMENT_DATA_CHECKLIST.md`).
- [x] **B1** — Voice checkout: merchant missing → `res.status(500).json` (verify fixed vs doc line refs).
- [x] **B2** — Same for `existingMerchant` not found.
- [x] **B3** — Groq 413: compact prompt on fallback; keep last N messages on 413.

---

## 7.2 Architectural gaps (A1–A10)

- [x] **7.2a (A1/A5)** — Verify Retell parity closures only (do not reopen): direct-path `session_id` + `metadata.session_id`; record proof in this doc.
- [x] **7.2b (A2)** — Keep **one** shared auto-checkout path via `autoCheckoutAfterSchedule`; verify all scheduling entry points use it and remove duplicate invocation risk.
- [x] **7.2c (A3/A4/A6/A7/A8/A9/A10)** — Remaining open architecture work: dead code audit, payload naming contract, cache TTL/invalidation, token recovery, legacy API gating, API parity.

---

## 7.3 Variable / mapping (V1–V3)

- [x] **V1** — Document / standardize Retell checkout field names vs server.
- [x] **V2** — `practitioner_id` in slot bundles — specialist path coverage.
- [x] **V3** — Document `clinic_id` resolution priority (`resolveClinicIdFromRequest`).

---

## 7.4 Race / consistency (R1–R3)

- [x] **R1** — Session reuse + stale `triage_rag_results` policy.
- [x] **R2** — Deduplicate weekend normalization (`KellyToolExecutor` vs `BookingService`).
- [x] **R3** — Fix `eligibilityChecks` vs `eligibility_checks` naming as **runtime code hardening** (linked to **U7** `eligibilityChecks is not defined`).

---

## 7.5 Schedule gaps (S1–S4)

- [x] **S1** — Duplicate patient detection + phone confirmation UX.
- [x] **S2** — Insurance 409 — clear next step for user.
- [x] **S3** — Practitioner-scoped conflict vs clinic-wide capacity.
- [x] **S4** — Name mismatch warning vs continuing schedule (wrong linkage risk).

---

## 7.6 Checkout gaps (doc C1–C4 — not orchestrator C1)

- [x] **Chk-C1** — Clinic without `merchant_id` — fail fast with JSON (related B1/B2).
- [x] **Chk-C2** — Auto-checkout timeout / retry / longer timeout when email slow.
- [x] **Chk-C3** — Reject invalid `appointment_id` for checkout creation (**already closed via BE4 checkout idempotency; verify and avoid double-work**).
- [x] **Chk-C4** — `ensureMerchantForClinic` or equivalent for single-tenant.

---

## 7.7 Supporting / UX (U1–U7)

- [x] **U1** — Document upload robustness (ENOENT, paths).
- [x] **U2** — Groq 429 — orchestrator fallback + rate-limit UX.
- [x] **U3** — Dev SMS / test numbers.
- [x] **U4** — Chips clutter after conversation start.
- [x] **U5** — Time → tool call (ties LLM-2).
- [x] **U6** — Verify code 400 — clearer errors.
- [x] **U7** — Fix `eligibilityChecks is not defined` code paths (same defect family as **R3**; close together).

---

## 7.8 Triage / matching (gap1–gap18)

- [x] **gap1** — OPQRST state machine; block slots until `run_triage_rag`.
- [x] **gap2** — SpecialistResolver + `getAvailableSlotsWithSpecialist` in KellyToolExecutor.
- [x] **gap3** — Seed `provider_profiles` (2–3 rows).
- [x] **gap4** — kellyScript filter decay → LLM context.
- [x] **gap5** — Pass `price_tier` into `get_available_slots`.
- [x] **gap6** — Specialty deep-dive prompts.
- [x] **gap7** — Severity ≥8 routing / async restriction.
- [x] **gap8** — Mental health: PHQ-2/GAD-2, safety screen.
- [x] **gap9** — Async vs sync UX in prompt.
- [x] **gap10** — Document upload pause-resume + RAG image.
- [x] **gap11** — Persist OPQRST field answers (avoid asking then discarding values).
- [x] **gap12** — Build and pass structured OPQRST object into `run_triage_rag` (not only `symptom_text`).
- [x] **gap15** — Delay insurance until specialty from RAG.
- [x] **gap16** — `SpecialistResolverService.cleanupCache` schedule.
- [x] **gap17** — DB unique constraint (practitioner, start_time, status).
- [x] **gap18** — Language persist (ties LLM-4).

---

## 7.9 Booking blockers (phase 1–4 + infra)

- [x] Build/refresh the complete blocker matrix for phase 1–4 + infra from §7.9 (including missing clinic defaults, empty provider profiles, auto-checkout timeout, and other uncategorized blockers not already tracked above).
- [x] Map each blocker to owner + mitigation status (`open`, `mitigated`, `covered-by-other-section`) so this section is executable and not only descriptive.
- [x] Add E2E coverage for representative blockers per phase (at least one per phase + one infra).

---

## 7.10 UI gaps (UI1–UI11)

- [x] **UI1** — Nav link to `schedule.html` / discoverability.
- [x] **UI2** — `book.html`: “Pick from calendar” → schedule.
- [x] **UI3** — Triage → schedule handoff: `date` on slot / `triageState`.
- [x] **UI4** — Dedicated 6-digit code UI (not raw chat).
- [x] **UI5** — Slot load failure: retry / “try another date”.
- [x] **UI6** — Hold expiry: re-fetch slots.
- [x] **UI7** — Session expiry: `return=` URL.
- [x] **UI8** — Patient app booking (or document out of scope).
- [x] **UI9** — Chat modal on mobile (`schedule.html`).
- [x] **UI10** — Empty slots messaging + CTA.
- [x] **UI11** — Async lane: return path to schedule / pre-fill.

---

## 7.11 Backend gaps (BE1–BE9)

- [x] **BE1** — Apply `input-validator` to patient booking / triage / slots routes.
- [x] **BE2** — Cap triage message body length.
- [x] **BE3** — `GET` available-slots: 400 if `date` missing.
- [x] **BE4** — ~~Checkout idempotency~~ **done** (`patient_checkout`).
- [x] **BE5** — Consolidate / document Stripe webhook paths (`server.js` vs `stripe-webhook-handler`).
- [x] **BE6** — Request correlation ID (`X-Request-ID`) through booking pipeline.
- [x] **BE7** — payment-success: polling / “Confirming payment…” vs webhook delay.
- [x] **BE8** — Validate `timezone` (IANA).
- [x] **BE9** — Audit log for schedule / checkout actions.

---

## §8 File reference (doc hygiene)

- [x] Replace stale **`server.js` line ranges** in §8 with **symbol / route names** (same policy as §6).

## Cross-cutting impl items (status)

- [x] **impl-5 / C1** — Patient Orchestrator triage provenance decision implemented and documented in `PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md`.
- [x] **impl-7 (optional)** — Retell schedule defense-in-depth smoke test present (`middleware-platform/__tests__/retell-schedule-defense.test.js`).
- [x] **impl-9** — Postgres support for `voice_checkouts.triage_session_id` implemented (`database.js` ensure + insert path).
- [x] **impl-13** — Deployment data checklist includes `preferred_language` verification (`middleware-platform/docs/DEPLOYMENT_DATA_CHECKLIST.md`).

---

*Last sync: generated from `BOOKING_CHECKOUT_ARCHITECTURE_ANALYSIS.md` §7.*
