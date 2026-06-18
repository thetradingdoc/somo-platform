# Kelly Conversation Loop (As-Built)

**Last updated:** 2026-06-18

One patient utterance: **L2 half** (playbook) + **L4 half** (gates/LLM) + **merge back**.

---

## Flow

```
Retell → runKellyTurn → identity admission
  → runConversationDispatch (L2)
  → if SCRIPT_ONLY: return
  → handleTurn → executeTurn → executeLaneStep
      → gates (registry) OR node-runner LLM
  → persistRailsSessionState → mergeKellyRailsIntoSession → reply
```

**Entry:** `kelly-turn-resolver.js`  
**L2:** `conversation-mode-session.js` → `conversation-dispatcher.js` → subrails  
**L4:** `execute-turn.js` → `gate-registry.js` → `lanes.js`

---

## L2 subrail (booking example)

`booking-subrail.js` maintains steps: `intent_confirm → slot_lookup → … → confirm`.

- Emits `booking_intents` via `detectBookingIntents` — does **not** write `current_booking_slot`.
- **Gate-owned steps hold position** until L4 signals success (`schedule_appointment_success`) or intent-driven micro-advance.

---

## L4 execute-turn (second planner)

`execute-turn.js` maps L2 hints to lane/step, runs `planTurnOwner`, calls `executeLaneStep`.

Under `enforce`, legacy `shouldReroute` / `routeOrchestratorLane` are skipped when `conversation_mode` is set.

**meta_kv:** writes consolidated via `persistRailsSessionState` → `mirrorMetaFromPayload` (not scattered pre-persist meta calls).

---

## Gate registry

Priority-sorted; `gateAllowedByTurnPlan` honors `_turn_plan` from `turn-planner.js` before running non-matching gates.

Returns `gate_matched` and `gate_outcome` on every `executeLaneStep` result → `orchestration_trace`.

---

## Architectural friction (known)

1. **Three planners** — L2 step advance, L4 lane map, gate predicates. Mitigation: turn planner authority + gate-owned subrail steps.
2. **Dual vocabulary** — `active_subrail_step` vs `lane`/`step`. Target: single phase enum (`state-schema.js`).
3. **`execute-turn` routing** — drain imperative chains into handoff contract.
4. **LangGraph** — thin wrapper; projection is SSOT.

---

## Debugging

| Question | Start here |
|----------|------------|
| Turn entry | `retell-websocket.js` → `runKellyTurn` |
| Mode | `seedModeAtCallStart`, `pivot-engine` |
| Tools | `lanes.js` gates or `node-runner.js` |
| State save | `persistRailsSessionState` |
| Test loop | `rails-conversation-sandbox.cjs` |

See [`OPERATIONS.md`](../deployment/OPERATIONS.md) for prod forensics SQL.
