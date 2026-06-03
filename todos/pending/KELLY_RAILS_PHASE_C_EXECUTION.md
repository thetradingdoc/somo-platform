# Kelly Rails Phase C — Execution SSOT (Language + Voice)

**Status:** In progress (weeks 4–5)

**Open items (checklist):** [`KELLY_RAILS_PHASE_C_PENDING.md`](KELLY_RAILS_PHASE_C_PENDING.md)

**Companion:** Detection/handoff reference — [`KELLY_RAILS_PHASE_C_LANGUAGE.md`](KELLY_RAILS_PHASE_C_LANGUAGE.md)  
**Code:** [`middleware-platform/services/kelly-rails/language.js`](../../middleware-platform/services/kelly-rails/language.js)

---

## Product decisions (approved)

| Topic | Decision |
|-------|----------|
| High-confidence Spanish | **Option A:** full v2 rails when `KELLY_RAILS_ES_ENABLED=1` |
| Option A approval | _TBD — product owner name + date (see C-X-04 in PENDING)_ |
| Spanish clinical OPQRST | **Blocked** until `docs/clinical/OPQRST_ES_SIGNOFF_*.md` exists and `KELLY_OPQRST_ES_PACK=v1` |
| OPQRST v1 specialty scope | All specialty blocks in [`kelly-voice-agent-prompt.md`](../../docs/voice-agent/prompts/kelly-voice-agent-prompt.md) |
| PT / ZH | Detection + handoff only — see [`PT_ZH_HANDOFF.md`](../../docs/clinical/PT_ZH_HANDOFF.md) |
| Mid-call ASR | After **2** consecutive low-confidence turns → clarify then `support` handoff; event `asr_low_confidence_mid_call` |
| ES emergency | Golden tests: Spanish emergency phrases → `safety_blocked` (mirror EN `support_2_emergency_handoff`) |

**Demo target:** [`DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md`](../../docs/agent/kelly-rails/DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md)

---

## Workstreams A–F (checklist)

### A — Language detection (first utterance)

- [x] `language.js` + resolver first-turn gate
- [x] `language_detected` event on first turn
- [x] Retell first-transcript parity with `evaluateFirstTurnLanguage`
- [x] Voice integration test `kelly-rails-language-voice-first-turn.test.js`
- [x] `isKellyRailsEsEnabled()` / `isOpqrstEsPackActive()` in `kelly-rails/config.js`
- [ ] Staging proof: chat + voice first Spanish utterance

### B — Spanish prompts per rail

- [x] `prompts/en.js`, `prompts/es.js`, locale in `state.locale`
- [x] P0–P2 lanes in Spanish tables
- [x] `configure-retell.js` — `RETELL_VOICE_ID_ES`, `RETELL_AGENT_ID_ES`
- [x] Golden ES fixture + `test:e2e:kelly:golden-conversations:es`
- [ ] Manual 10-call ES scorecard (see QA doc)

### C — OPQRST (human review gate)

- [x] [`OPQRST_REVIEW_PACKET_v1.md`](../../docs/clinical/OPQRST_REVIEW_PACKET_v1.md)
- [x] `config/clinical-opqrst/en.json` + `es.json` scaffold
- [x] `clinical-opqrst-registry.js` + `voice-reply-formatter.js`
- [ ] Translator sign-off file `OPQRST_ES_SIGNOFF_<date>.md`
- [x] Snapshot tests `clinical-opqrst-es.test.js`

### D — ASR gate

- [x] `kelly-asr-gate.js` + `KELLY_ASR_MIN_CONFIDENCE`
- [x] Wired in `retell-websocket.js` before `runKellyTurn`
- [x] `kelly-asr-gate.test.js`
- [ ] Retell payload fields documented from live spike (staging runbook)

### E — Language mismatch logging

- [x] `kelly-language-telemetry.js` → `language_mismatch` events
- [x] Emits from resolver, orchestrator, ASR gate
- [x] SQL in [`KELLY_PHASE_C_STAGING.md`](../../docs/runbooks/KELLY_PHASE_C_STAGING.md)

### F — Voice quality

- [x] `voice-slo-metrics.js` on Retell path
- [x] `clampVoiceReply` before `sendRetellResponse`
- [x] `turn_resolved.latency_ms` + language/locale
- [x] `npm run test:voice:slo-smoke`
- [ ] EN/ES perceptual scorecards (external reviewer)

---

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `KELLY_LANG_MIN_CONFIDENCE` | Text handoff threshold | `0.6` |
| `KELLY_ASR_MIN_CONFIDENCE` | ASR gate (unset = off) | — |
| `KELLY_RAILS_ES_ENABLED` | Spanish lane prompts | `0` |
| `KELLY_OPQRST_ES_PACK` | ES registry version | — |
| `RETELL_VOICE_ID` | EN TTS | `retell-Cimo` |
| `RETELL_VOICE_ID_ES` | ES TTS | — |
| `RETELL_AGENT_ID_ES` | ES Retell agent | — |
| `KELLY_VOICE_MAX_TOKENS` | LLM cap (voice) | `200` |
| `VOICE_SLO_MAX_AVG_WORDS` | SLO | `32` |
| `VOICE_SLO_MAX_MULTI_QUESTION_RATE` | SLO | `0.2` |
| `VOICE_SLO_MAX_REPHRASE_RATE` | SLO | `0.25` |
| `VOICE_SLO_MAX_INTERRUPTION_RATE` | SLO | `0.45` |
| `VOICE_SLO_MAX_TTFHR_MS` | SLO | `12000` |

---

## Test matrix

```bash
cd middleware-platform
npm run test:kelly:rails:language
npm run test:kelly:rails:golden-conversations
npm run test:e2e:kelly:golden-conversations:es
npm run test:voice:slo-smoke
```

Manual: [`VOICE_QUALITY_SCORECARD.md`](../../docs/qa/VOICE_QUALITY_SCORECARD.md)

---

## Sign-off (Phase C complete)

- [ ] All workstream exit criteria met
- [ ] `KELLY_RAILS_ES_ENABLED=1` only with OPQRST sign-off for clinical registry
- [ ] No auto-translated OPQRST in production
