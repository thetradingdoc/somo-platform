# Booking Blocker Matrix (Phase 1-4 + Infra)

This matrix turns section `7.9` into an executable tracker with ownership and mitigation status.

Status values:
- `open`: not mitigated
- `mitigated`: implemented and verified in code
- `covered-by-other-section`: tracked/implemented in another checklist section

## Phase 1 - Get Slots

| Blocker | Owner | Status | Mitigation |
|---|---|---|---|
| No triage session row (`TRIAGE_REQUIRED`) | Middleware | mitigated | Kelly triage guardrails block slot calls until triage/session data exists. |
| Safety red (`SAFETY_BLOCKED`) | Middleware | mitigated | Guardrails route emergencies away from booking flow. |
| Missing/low-confidence RAG result | Middleware + AI | mitigated | Confidence and differential gating in Kelly tool executor and prompts. |
| Missing clinic defaults (`clinic_id`) | Platform Config | mitigated | Request/phone/env clinic resolution + explicit 400 errors. |
| Empty provider availability | Operations + Provider Ops | open | Requires provider schedule ops and clinic-hour staffing updates. |

## Phase 2 - Schedule

| Blocker | Owner | Status | Mitigation |
|---|---|---|---|
| Duplicate patient requiring phone confirmation | Booking + FHIR | mitigated | Voice/API return structured 409 with next-step guidance. |
| Practitioner slot conflicts / race | Booking | mitigated | Practitioner-scoped conflict checks and slot uniqueness constraints. |
| Name mismatch for known patient | Booking | mitigated | Name mismatch confirmation gate before scheduling. |
| Missing required scheduling fields | Booking | mitigated | Request validation + structured error responses. |

## Phase 3 - Checkout

| Blocker | Owner | Status | Mitigation |
|---|---|---|---|
| Missing clinic merchant mapping | Payments + Ops | mitigated | `ensureMerchantForClinic` fallback + fail-fast JSON responses. |
| Auto-checkout timeout | Payments | mitigated | Increased timeout and retry in auto-checkout helper. |
| Invalid appointment id checkout | Payments | mitigated | Explicit `INVALID_APPOINTMENT_ID` rejection. |
| Checkout idempotency risk | Payments | covered-by-other-section | Covered by `BE4` (`withIdempotency('patient_checkout')`). |

## Phase 4 - Verify and Pay

| Blocker | Owner | Status | Mitigation |
|---|---|---|---|
| Missing/expired verification code | Payments + UX | mitigated | Structured verify-code errors with clear next steps. |
| Lost `payment_token` across LLM turns | AI + Voice | mitigated | Session/meta token persistence and recovery in Kelly/Retell flows. |
| Webhook confirmation delay | Payments + UX | mitigated | Payment-success polling and confirming state until settled. |

## Infrastructure

| Blocker | Owner | Status | Mitigation |
|---|---|---|---|
| Groq 429 rate limits | AI Platform | mitigated | Degraded fallback responses and user-facing retry guidance. |
| Groq 413 oversized payloads | AI Platform | mitigated | Prompt compaction fallback for 413 retries. |
| Duplicate Stripe webhook path confusion | Payments + DevEx | mitigated | Canonical `/webhooks/stripe`, legacy path gated/disabled by default; documented path policy. |
| Empty `provider_profiles` seed data | Data/Migrations | mitigated | Provider profile seed migration and specialist fallback behavior. |

