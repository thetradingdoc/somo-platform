# Retell `kelly_flow` and routine intake (A3)

Retell voice and HTTP chat share the same **session meta** key `routine_intake_active` when the flow should use **`ROUTINE_INTAKE`** (narrow tools + orchestrator copy): skincare / routine intake, not default triage.

## Canonical values (single source of truth)

Allowed `kelly_flow` strings (case-insensitive after trim) are defined in code:

- `routine_intake`
- `skincare`
- `skincare_intake`

See `ROUTINE_INTAKE_KELLY_FLOW_VALUES` in `services/kelly-orchestrator-phase.js` (`kellyFlowActivatesRoutineIntake`).

## Retell: where to set them

Configure **dynamic variables** on the agent / call so the websocket can read:

| Source (checked in order) | Field |
|----------------------------|--------|
| `call.dynamic_variables` | `kelly_flow` or `KellyFlow` |
| `call.metadata` | `kelly_flow` |
| `call.dynamic_variables` or `call.metadata` | `routine_intake_active` = `1` or `true` → treated as `routine_intake` |

Implementation: `extractKellyFlowFromRetellCall` in `kelly-orchestrator-phase.js`; applied in `webhooks/retell-websocket.js` when the call connects (sets `routine_intake_active` on the voice `sessionId` / `callId`).

## HTTP landing assistant (Little Lab)

`POST /api/public/landing-assistant/turn` accepts:

- Body: `kelly_flow` (string), or `routine_intake_active` (`1` / `true`)
- Or `meta.kelly_flow` / `meta.routine_intake_active` inside the JSON body

The littlelab client sends **`kelly_flow: 'skincare'`** by default from `sendLandingAssistantTurn` (`unified-dashboard/littlelab-landing/src/landingAssistantApi.js`).

## Narrow system prompt (ROUTINE_INTAKE)

When **`KELLY_PHASE_PROMPTS=1`** and the orchestrator phase is **`ROUTINE_INTAKE`**, Kelly uses `services/kelly-prompt-builder.js` (shared safety + intake slice + orchestrator section) instead of the full legacy monolith. Unset or `0` keeps legacy prompts for all phases.

## Intake fields, summary injection, `intake_complete` (D1–D3)

**Minimum fields (D1)** — stored via **`store_triage_opqrst`** with consumer semantics:

| Column | Meaning in Skin & Care intake |
|--------|-------------------------------|
| `quality` | Main skin concern (e.g. acne, dryness) |
| `onset` | Duration or when it started |
| `associated_sx` | Current routine, product names, or **systemic** symptoms |
| `medications` | Optional: topicals / OTC if you use this field instead of `associated_sx` |

**Prompt injection (D2)** — When phase is `ROUTINE_INTAKE`, the server adds **`## INTAKE / TRIAGE SO FAR`** to the system prompt from `triage_sessions` (see `formatRoutineIntakeSummaryFromTriageRow` in `kelly-prompt-builder.js`).

**`intake_complete` (D3)** — After `store_triage_opqrst`, if `routine_intake_active` is on and the row has **concern + onset + (associated_sx or medications)**, the executor sets session meta **`intake_complete=1`** and **`intake_complete_at`** on the triage row. Then **`routineIntakeHold`** releases: phase is no longer `ROUTINE_INTAKE` unless `routine_intake_active` is still set and other rules apply — typically the next turn moves into normal triage discovery if there is no completed clinical triage yet. Product can refine that transition later.

**Tool descriptions** in this phase are overridden by **`mapToolDescriptionsForRoutineIntake`** (`kelly-orchestrator-phase.js`) so schema text does not steer toward `run_triage_rag` / booking.

## Smoke test (two-turn + optional DB assert)

With middleware running and `DEFAULT_CLINIC_ID` set if required:

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db   # optional: assert meta in SQLite
node scripts/smoke-landing-assistant-two-turn.cjs
```

See also: [kelly-god-object-fix-todos.md](./kelly-god-object-fix-todos.md) (Phase A).
