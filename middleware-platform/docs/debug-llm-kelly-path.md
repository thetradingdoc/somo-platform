# Debugging the Kelly LLM + tools path

Non-deterministic failures usually come from **(A) provider limits**, **(B) stale DB state**, or **(C) harness vs server mismatch** — not from “the model reasoning wrong” in isolation.

## 1. Confirm what actually ran

| Signal | Where |
|--------|--------|
| Provider | Server log line `[KellyAgent] Config: KELLY_PRIMARY_PROVIDER=...` at startup |
| Per turn | Set `KELLY_DEBUG_TURN=1` → logs `[KellyDebug] turn_start`, `turn_success`, `rate_limit_fallback_*`, `degraded_rate_limit_*`, `catch_fallback_return` |
| `toolsUsed` | API JSON `toolsUsed` on `POST /api/patient/triage/message` (harness logs it per turn) |
| DB file | `GET /health?show_db_path=1` → `database_path`; must match harness `DB_FILE` |

## 2. Failure modes (deep)

### A. “High demand / try again in 30 minutes”

- **Source:** `kelly-agent-service.js` catch path when `isRateLimit` is true **after** the rate-limit recovery `try { ... }` fails or does not apply (e.g. triage never completes, slot fetch fails, inner `catch (_) {}` swallows errors).
- **Recovery already in code:** On 429, Kelly tries server-side `store_triage_*` + `run_triage_rag`, then may call `get_available_slots` without the LLM. If that succeeds, **`toolsUsed` now includes `run_triage_rag` when a RAG row exists** (see `_toolsUsedEnsureRagBeforeSlots`).
- **Fix ops:** Ensure `ANTHROPIC_API_KEY` so primary is Claude; raise `KELLY_GROQ_MAX_RETRIES` / spacing in tests; reduce parallel load.

### B. Slots without triage (harness `tool_order_violation`)

- **Real bug:** `get_available_slots` succeeds while **no** `run_triage_rag` appears in `toolsUsed` even though RAG exists (e.g. rate-limit fallback returned only `get_available_slots`). Addressed by **`_toolsUsedEnsureRagBeforeSlots`** on those returns and on the main success path.
- **Stale state:** If the server DB still has `triage_rag_results` for the same `session_id` after a failed wipe, slots can succeed legitimately while the harness expects a fresh triage — use **new UUID** sessions (`run-kelly-tests.sh`) and **same SQLite file** as the server.

### C. Routine turn 1 fast but empty `toolsUsed`

- **Expected:** `toolsUsed: ['run_triage_rag']` after fast path runs `run_triage_rag` server-side.
- If empty, the running process is likely **old code** or a **different service** — redeploy/restart from this repo.

### D. Loops in the harness

- **Same assistant text 3×** → `loop_detected`. Often follows **(A)** because the harness sends “Please continue.”
- Not fixable by “more reasoning”; fix **provider availability** or **test pacing** (`SLEEP_BETWEEN_CALLS`).

## 3. Suggested debug sequence

1. Restart middleware from the repo you’re testing.
2. `curl -s 'http://localhost:4000/health?show_db_path=1' | jq .`
3. Export `KELLY_DEBUG_TURN=1`, reproduce one failing case, grep logs for `[KellyDebug]`.
4. Run a **single** case: `bash scripts/run-kelly-tests.sh back_pain_en` and read `test-results/.../logs/back_pain_en.log`.

## 4. Related code

- `processTurn` try/catch + rate-limit recovery: `services/kelly-agent-service.js`
- Slot gating: `services/kelly-tool-executor.js` (`_getAvailableSlots`)
- Session wipe: `server.js` `handlePatientTriageMessage` + `database.wipeChatSessionClinicalState`
- LLM routing / Groq retries: `services/llm-router.js`
