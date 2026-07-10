# Conversation Mode Matrix

Last updated: 2026-07-04

**Architecture SSOT:** [`docs/architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md`](../architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md)  
**Gap matrix:** [`docs/architecture/ORCHESTRATION_GAP_MATRIX.md`](../architecture/ORCHESTRATION_GAP_MATRIX.md)

Maps `call_type × direction × tenant_policy × intent → conversation_mode`.

## Top-level modes

| Mode | Description |
|------|-------------|
| `platform_support` | Somo company line (+363) — **Kelly sales qualification** (practice type, pain, value demo, signup CTA, optional demo). English-only scripted rail v1. Tenant account-help + human handoff branches. No clinical/booking tools. |
| `demo_qual` | Legacy alias — under `enforce`, dispatcher routes to `platform_support` sales rail (`SCRIPT_ONLY`). Do not use for tenant booking. |
| `outbound_sales` | Sales outbound playbook (Kelly persona) |
| `operator_outbound` | Operator callback/update — no clinical tools |
| `tenant_inbound_admin` | Tenant inbound — scheduling, FAQ, admin flows |
| `tenant_inbound_clinical` | Tenant inbound — symptom/triage flows |
| `tenant_billing` | Copay/payment link flows |
| `tenant_records` | Medical records Q&A |
| `emergency_safety` | Emergency preemption — handoff only |

## Resolution at call start

| call_type | direction | tenant_policy | first_intent | → mode |
|-----------|-----------|---------------|--------------|--------|
| `somo_demo` | inbound | * | * | `platform_support` |
| `platform_support` / routing_world | inbound | * | * | `platform_support` |
| `sales_outbound` | outbound | * | * | `outbound_sales` |
| `operator_outbound` | outbound | * | * | `operator_outbound` |
| `inbound_tenant` | inbound | triage=disabled | book/general | `tenant_inbound_admin` |
| `inbound_tenant` | inbound | triage=required | symptom | `tenant_inbound_clinical` |
| `inbound_tenant` | inbound | triage=conditional | symptom | `tenant_inbound_clinical` |
| `inbound_tenant` | inbound | triage=conditional | book | `tenant_inbound_admin` |
| `inbound_tenant` | inbound | * | pay_copay | `tenant_billing` |
| `inbound_tenant` | inbound | records_enabled | records | `tenant_records` |
| * | * | * | emergency | `emergency_safety` |
| unknown + tenant unresolved | inbound | * | * | fail-closed support |

## Pivot events (per-turn)

| Event | From modes | → mode | Subrail |
|-------|------------|--------|---------|
| `billing_intent_detected` | admin, clinical, billing | `tenant_billing` | `copay_link` |
| `symptom_intent_detected` | admin (triage≠disabled) | `tenant_inbound_clinical` | `opqrst` |
| `records_intent_detected` | admin, clinical, billing | `tenant_records` | `records_qa` |
| `emergency_detected` | all | `emergency_safety` | `handoff` |
| `cancel_intent_detected` | admin, clinical | same mode | `cancellation` |
| `book_intent_detected` | admin, clinical | same mode | `booking` |

## Subrails

| Subrail | Parent modes | Entry condition |
|---------|--------------|-----------------|
| `booking` | admin, clinical | book intent or OPQRST exit `completed_book` |
| `cancellation` | admin, clinical | cancel intent |
| `opqrst` | clinical only | symptom intent, triage policy allows |
| `copay_link` | billing | billing pivot or pay intent |
| `records_qa` | records | records intent |
| `handoff` | all | handoff/emergency/dispute |

## OPQRST exit fork

| Exit state | Next action |
|------------|-------------|
| `completed_book` | → `booking` subrail |
| `completed_escalate` | → `emergency_safety` |
| `completed_refer` | → `handoff` |
| `incomplete_hold` | summarize + hold |
| `inconclusive_triage` | tenant policy action |

## Multi-intent queue

When utterance has 2+ intents (e.g. "pay copay and reschedule"):
1. Primary intent selects mode (billing wins over reschedule)
2. Secondary intents enqueued in `pending_intent_queue`
3. After primary rail completes, drain queue

## Identity admission (2026-06-17)

Before L2 dispatch, Retell calls must pass tenant identity validation (`clinic_id` or `customer_id` resolvable). Failure → fail-closed SCRIPT_ONLY handoff (en/es/zh copy), event `identity_invalid`. See `services/voice-identity-admission.js`.

## ASR normalization (2026-06-17)

Intent detection and pivot use ASR-normalized utterances (filler strip, punctuation). **Conversation history is not mutated.** See `services/conversation-mode/asr-normalize.js`.

## demo_qual under enforce (2026-07-04)

Under `CONVERSATION_MODE_ROUTING=enforce`, `demo_qual` and `somo_demo` resolve to **`platform_support`** and dispatch the Kelly sales inbound rail with `handoff: SCRIPT_ONLY`. Pivot engine treats `platform_support` as an isolated mode (no billing/clinical/book pivots; emergency + handoff only). Pivot to `demo_qual` from tenant modes remains blocked.

## Platform sales language (v1)

- **English only** on +363 / `platform_support`. ES/RU sales qual deferred.
- Outbound sales **voicemail/IVR detection** deferred (parity with `operator-outbound-rail.js` post-v1).
- Tests: `platform-sales-persona-sequence.test.js`, `platform-support-pivot-firewall.test.js` (EN baseline multilang harness).

## demo_qual history (2026-06-17)

## Environment

- `CONVERSATION_MODE_ROUTING=shadow` — log decisions, no enforcement (dev/staged default)
- `CONVERSATION_MODE_ROUTING=enforce` — hard mode dispatch + tool firewall (**production target**)
- `verify-kelly-rails-env` fails staging/prod profile when routing is not `enforce`

## Appointment lookup (2026-06-16)

| Signal | Route |
|--------|-------|
| `appt_lookup` intent ("when is my appointment", "do I have an appointment") | `cancellation` subrail → `find_booking` + `search_appointments` (deterministic lane when `use_kelly` from slot lookup) |
| Cancel/reschedule after lookup | Same subrail chain; `confirm_visit` maps to booking confirm in execute-turn |

## Subrail hardening (2026-06-16)

| Subrail | Fix |
|---------|-----|
| `booking` | `use_kelly` from slot lookup; Spanish book phrases; `confirm_visit` → booking confirm |
| `copay_link` | Mandarin/zh payment phrases; explicit `preferredLanguage` precedence |
| `operator_outbound` | `appointment_reminder` purpose + `appointment_id` context; `endCall` on goodbye |
| `cancellation` | `find_booking` respects Kelly slot lookup flag |

Sandbox verification: `npm run test:rails:conversation-sandbox` (seven scenarios, target ≥ 8/10 each).

## As-is status (2026-06-17)

- Implemented: resolver + per-turn pivoting + mode dispatch + subrail routing + mode tool firewall.
- Implemented: session SSOT fields for `conversation_mode`, `active_subrail`, pending/completed intent queues, and subrail accumulators.
- Documented: [`KELLY_ORCHESTRATION_ARCHITECTURE.md`](../architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md), [`ORCHESTRATION_GAP_MATRIX.md`](../architecture/ORCHESTRATION_GAP_MATRIX.md).
- **In progress (code):** identity admission gate, ASR normalization, deterministic schedule gate, booking conflict confirm gate, telemetry P0 minimum.
- Open: booking/spanish_booking TCR flake until schedule gate ships; clinical path harness blocked on OPQRST unification; production enforce rollout pending staging smoke.
