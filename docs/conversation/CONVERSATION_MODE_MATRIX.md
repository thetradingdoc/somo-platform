# Conversation Mode Matrix

Last updated: 2026-06-16

Maps `call_type × direction × tenant_policy × intent → conversation_mode`.

## Top-level modes

| Mode | Description |
|------|-------------|
| `demo_qual` | Somo product demo — no clinical/billing tools |
| `outbound_sales` | Sales outbound playbook |
| `operator_outbound` | Operator callback/update — no clinical tools |
| `tenant_inbound_admin` | Tenant inbound — scheduling, FAQ, admin flows |
| `tenant_inbound_clinical` | Tenant inbound — symptom/triage flows |
| `tenant_billing` | Copay/payment link flows |
| `tenant_records` | Medical records Q&A |
| `emergency_safety` | Emergency preemption — handoff only |

## Resolution at call start

| call_type | direction | tenant_policy | first_intent | → mode |
|-----------|-----------|---------------|--------------|--------|
| `somo_demo` | inbound | * | * | `demo_qual` |
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

## Environment

- `CONVERSATION_MODE_ROUTING=shadow` — log decisions, no enforcement (default)
- `CONVERSATION_MODE_ROUTING=enforce` — hard mode dispatch + tool firewall

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

## As-is status (2026-06-16)

- Implemented: resolver + per-turn pivoting + mode dispatch + subrail routing + mode tool firewall.
- Implemented: session SSOT fields for `conversation_mode`, `active_subrail`, pending/completed intent queues, and subrail accumulators.
- Verified: booking, copay, appt lookup, outbound reminder, urgent, Spanish booking, Mandarin copay (sandbox avg ~9.4/10).
- Open tuning: outbound reminder phrasing (8/10), mixed-intent queue drain on cross-rail turns.
