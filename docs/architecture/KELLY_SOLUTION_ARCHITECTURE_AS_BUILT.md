# Kelly Solution Architecture (As-Built)

**Last updated:** 2026-06-18  
**Production:** `api.callsomo.com` (Cloud Run `somo-middleware`) with `KELLY_RAILS_V2=1`, `CONVERSATION_MODE_ROUTING=enforce`

**SSOT:** [`KELLY_ORCHESTRATION_ARCHITECTURE.md`](./KELLY_ORCHESTRATION_ARCHITECTURE.md), [`ORCHESTRATION_GAP_MATRIX.md`](./ORCHESTRATION_GAP_MATRIX.md), [`TURN_COMPLETION_CONTRACT.md`](./TURN_COMPLETION_CONTRACT.md)

---

## System context

| Layer | Host | Code |
|-------|------|------|
| Marketing + portals | `callsomo.com` | Firebase `somo-4ddf6` |
| Voice API + Kelly | `api.callsomo.com` | `middleware-platform/` — `webhooks/retell-websocket.js` |
| Session DB | SQLite on GCS | `kelly_rails_session_projection`, clinical tables |

Patient calls flow: **Twilio → Retell WSS → `runKellyTurn` → tools/DB → reply/TTS**.

---

## Design principles

1. **Gates before LLM** — Book, cancel, pay owned by deterministic L4 gates.
2. **L2 picks the playbook** — Mode + subrail + step before Kelly; enforce mode is binding.
3. **Prove outcomes** — Success = tools + DB (`TURN_COMPLETION_CONTRACT`).
4. **LLM is fallback** — `node-runner.js` when no gate owns the turn.
5. **Single session truth** — `kelly_rails_session_projection` wins; `meta_kv` mirrors on persist.

---

## Four planes

| Plane | Role | Key modules |
|-------|------|-------------|
| **0 Entry** | Retell WSS, identity admission | `retell-websocket.js`, `voice-identity-admission.js` |
| **2 L2** | Mode, subrail, pivot, dispatch | `conversation-mode/*`, subrails |
| **G Guardrails** | Firewall, script-only, scope, safety | `mode-tool-firewall.js`, `node-runner` scope guard |
| **4 L4** | Gates, planner, LLM, SSOT | `execute-turn.js`, `gate-registry.js`, `lanes.js`, `session-ssot.js` |

**Gate priority:** safety → payment → records → lookup → reschedule → cancel → clinical → opqrst → **schedule (90)** → **conflict (80)** → LLM.

---

## Booking path (reference)

L2 `booking-subrail` emits `booking_intents` only; L4 `turn-planner` + schedule/conflict gates own slots and `schedule_appointment`.

Three ways to book: stated time, slot+confirm, post-conflict alt confirm.

Failure taxonomy keys: `schedule_conflict`, `schedule_failed`, `no_slots_available`, `cancel_failed`, `reschedule_failed`, `records_failed`.

---

## State and memory

| Store | Authority |
|-------|-----------|
| `kelly_rails_session_projection` | **Primary SSOT** |
| `kelly_session_meta_kv` | Mirror (via `mirrorMetaFromPayload` on persist) |
| `triage_sessions` | OPQRST, RAG |
| `kelly_conversation_history` | ~20 turns for LLM only |

L2 must not write `current_booking_slot`; L4 gates own slots.

---

## Modes and subrails

| Mode | Handler |
|------|---------|
| `tenant_inbound_admin` | booking / cancel subrails → L4 |
| `tenant_inbound_clinical` | OPQRST → clinical gates |
| `tenant_billing` | copay subrail |
| `tenant_records` | records_qa subrail |
| `operator_outbound` / `outbound_sales` | Scripted rails |
| `emergency_safety` | Emergency rail |

---

## Observability

- `kelly_call_events`: `mode_resolved`, `tool_invoked`, `tool_completed`, `booking_outcome`, `orchestration_trace` (lane, step, `gate_matched`, `gate_outcome`)
- Sandbox: `rails-conversation-sandbox.cjs` — 14 scenarios, TCR 0/1
- CI: `npm run test:rails:orchestration`
- Prod env: `npm run verify:kelly-rails-cloudrun`

---

## Completeness snapshot

| Area | ~Complete | Notes |
|------|-----------|-------|
| Entry + identity | 90% | Admission gate shipped |
| L2 mode/subrail | 65% | Enforce on prod; planner booking-only |
| L4 gates | 85% | Cancel/reschedule/records shipped; `lanes.js` monolithic |
| LLM fallback | 75% | Bounded; not outcome-planned |
| SSOT | 65% | Transactional persist; meta consolidation in progress |
| Telemetry | 55% | P0 events + enriched trace; full audit open |
| Prod front-desk flows | ~75% | Sandbox + live acceptance |

---

## Module map

```
middleware-platform/
  webhooks/retell-websocket.js
  services/
    kelly-turn-resolver.js
    kelly-tool-executor.js
    conversation-mode/
    kelly-rails/
      execute-turn.js, lanes.js, gate-registry.js
      turn-planner.js, session-ssot.js
      prompts/deterministic.js
```
