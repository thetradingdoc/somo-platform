# Turn Completion Contract (TCC)

A Kelly voice/chat turn is **complete** only when orchestration proves the business outcome — not when the reply sounds correct.

**Architecture:** [`KELLY_ORCHESTRATION_ARCHITECTURE.md`](./KELLY_ORCHESTRATION_ARCHITECTURE.md)

## Contract per task

| Task | Mode / subrail | Required tool(s) | Side effect |
|------|----------------|------------------|-------------|
| Appointment lookup | `tenant_inbound_admin` + `cancellation` / `appt_lookup_only` | `search_appointments` | Reply cites DB date/time |
| Book appointment (API slots) | `booking` → confirm | `get_available_slots` → `schedule_appointment` | New `appointments` row |
| Book appointment (stated time) | `booking` | `schedule_appointment` only | Patient names time + confirm; API slots optional |
| Book after conflict | `booking` + `booking_conflict` | confirm alt slot → `schedule_appointment` | Schedule gate runs before conflict on confirm |
| Re-confirm after book | `booking` | none (idempotent) | `booking_confirmed` cites existing `appointments` row |
| Copay link | `tenant_billing` + `copay_link` | `request_patient_payment` | `rcm_pay_token` in session |
| Emergency | `emergency_safety` | none | 911 / handoff disposition |
| Outbound reminder | `operator_outbound` + `appointment_id` | none (scripted) | Reminder copy + `endCall` + `reminder_delivered` |

### Booking failure outcomes (telemetry)

| Outcome | Patient copy key | When |
|---------|------------------|------|
| `booked` | `booking_confirmed` | `schedule_appointment` success |
| `no_availability` | `no_slots_available` | No provider capacity after lookup |
| `schedule_conflict` | `schedule_conflict` | Time slot taken; alternatives offered |
| `schedule_failed` | `schedule_failed` | Triage/validation/HTTP error |
| `provider_mismatch` | `provider_mismatch` | Named provider has no matching bundle |

Event: `booking_outcome` with `error_code` in `kelly_call_events`.

## Authority rules

1. **Subrails** advance step and emit **intents** (`turn-planner.js`) — they must not write `current_booking_slot` or declare `toolsUsed`.
2. **L4 gates** are sole writers of slot meta, appointment IDs, and tool side effects.
3. **Handoff tri-state**: `script_only` | `kelly_required` | `kelly_optional`.
4. **Kelly rails** run mandatory deterministic tools before transactional speech.
5. **Executor telemetry** (`tool_invoked` / `tool_completed`) is the source of truth for tools.
6. **Sandbox TCR** is binary (0/1) per scenario; fluency score is secondary.
7. **Notification side effects** (SMS/email) must not corrupt session state on failure; log `notification_failed`.
8. **Identity admission** must reject unresolvable tenant before L2; event `identity_invalid`.

## Evaluation

Run: `npm run test:rails:conversation-sandbox`

Critical scenarios: `calling_about_appt`, `booking`, `booking_user_dialog`, `payment`, `outbound_reminder`, `spanish_booking`.

Fail CI when any critical scenario has `tcr !== 1`.

```bash
npm run verify:p0-telemetry
npm run test:rails:verify-telemetry
```

User-dialog repro:

```bash
node scripts/debug-booking-deadend.cjs --seeded
```

## Verifying tool execution (SQLite dev)

Dev DB stores Kelly events in `kelly_call_events` with JSON in `payload_json` (not `event_data`).

```bash
sqlite3 middleware-dev.db "
  SELECT event_type,
         json_extract(payload_json, '$.tool_name') AS tool,
         json_extract(payload_json, '$.success') AS success,
         session_id,
         created_at
  FROM kelly_call_events
  WHERE event_type IN ('tool_invoked', 'tool_completed', 'booking_outcome')
  ORDER BY created_at DESC
  LIMIT 30;"
```

**Three-query stack trace** after a sandbox run:

1. **Mode / rail** — `kelly_rails_session_projection.flags_json` or sandbox evidence JSON
2. **Tool execution** — query above; expect paired `tool_invoked` → `tool_completed` with `success=1`
3. **Side effect** — `appointments` row, `payment_complete` in session meta, or `status=cancelled`

If step 1 is correct but step 2 is empty, the failure is in lane gates or handoff. If step 2 succeeds but step 3 is empty, the failure is in the executor or DB write-back.
