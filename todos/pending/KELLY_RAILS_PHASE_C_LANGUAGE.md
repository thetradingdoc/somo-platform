# Kelly Rails Phase C — Language detection (SSOT)

**Status:** Foundation landed — unified module + tests; downstream rails features build on this.

**Execution checklist (Phase C weeks 4–5):** [`KELLY_RAILS_PHASE_C_EXECUTION.md`](KELLY_RAILS_PHASE_C_EXECUTION.md)

**Code SSOT:** [`middleware-platform/services/kelly-rails/language.js`](../../middleware-platform/services/kelly-rails/language.js)

**Consumers:** `kelly-turn-resolver.js` (v2 first turn), `kelly-rails/orchestrator.js` (handoff), `patient-orchestrator-service.js` (thin re-exports), `kelly-triage-turn-service.js`, `retell-websocket.js` (voice).

---

## Supported languages (Phase C scope)

| Code | Language | Detection | Product handling |
|------|----------|-----------|------------------|
| `en` | English | Default / clinical English | Full rails (visit, book, pay) |
| `es` | Spanish | Hints + script heuristics | High-confidence → rails; low → handoff |
| `pt` | Portuguese | Hints | Same |
| `zh` | Mandarin | Han script + hints | Same |

**Extended detection (preference / handoff only):** `fr`, `de`, `ru`, `sw` via `detectLanguageFromText` / explicit preference phrases — handoff to human support unless product expands rails.

---

## Confidence threshold

- Env: `KELLY_LANG_MIN_CONFIDENCE` (default **0.6**)
- Below threshold and `language !== 'en'` → `forceLanguageHandoff` on first turn (`evaluateFirstTurnLanguage` in resolver)
- Explicit preference (“Can we speak Spanish?”) → `confidence: 0.95`, no forced handoff from low hint score

---

## Handoff behavior

When `opts.forceLanguageHandoff` or orchestrator `forceLanguageHandoff`:

1. **Lane:** `support` (`kelly_rails.active_lane`)
2. **Reply:** Human support / language specialist copy (orchestrator)
3. **Tools:** No schedule / pay / visit booking tools on that turn
4. **Event:** `language_confidence_handoff` (orchestrator telemetry)

English clinical intake (`"I have a rash on my arm"`) → stays on rail, no handoff.

---

## Events

| Event | When | Key fields |
|-------|------|------------|
| `turn_resolved` | Every Kelly v2 turn | `payload_json.runtime = kelly_rails_v2`, lane, tools |
| `language_confidence_handoff` | Low-confidence non-English first turn | `language`, `confidence` |

Query staging proof:

```sql
SELECT session_id, event_type, payload_json, created_at
FROM kelly_call_events
WHERE event_type IN ('turn_resolved', 'language_confidence_handoff')
ORDER BY created_at DESC LIMIT 10;
```

---

## Tests

- Unit: `npm run test:kelly:rails:language --prefix middleware-platform` → `__tests__/kelly-rails-language.test.js`
- Integration: Spanish first message → `support` lane, no schedule/pay tools (`kelly-rails-language-handoff.test.js`)

---

## Phase B boundary

Phase C language work does **not** block Phase B sign-off (F2, runtime row, V6-3). Track 2 runs in parallel; merge language unification after Phase B evidence is recorded in [`KELLY_CONVERSATION_RAILS_TODOS.md`](KELLY_CONVERSATION_RAILS_TODOS.md).
