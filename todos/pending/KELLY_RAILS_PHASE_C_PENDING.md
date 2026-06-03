# Kelly Rails Phase C — Pending

**Status:** Engineering ~complete; sign-off ~open

**Done vs open (engineering):** [`KELLY_RAILS_PHASE_C_EXECUTION.md`](KELLY_RAILS_PHASE_C_EXECUTION.md)  
**Detection reference:** [`KELLY_RAILS_PHASE_C_LANGUAGE.md`](KELLY_RAILS_PHASE_C_LANGUAGE.md)  
**Demo target:** [`DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md`](../../docs/agent/kelly-rails/DEMO_SCENARIO_HEALTHCARE_SPECIALIST.md)  
**Staging proof:** [`KELLY_PHASE_C_STAGING.md`](../../docs/runbooks/KELLY_PHASE_C_STAGING.md)  
**Voice scorecards:** [`VOICE_QUALITY_SCORECARD.md`](../../docs/qa/VOICE_QUALITY_SCORECARD.md) → archive under [`docs/qa/voice-reviews/`](../../docs/qa/voice-reviews/README.md)

**Dependencies:** C-C-01 / C-C-02 blocked on C-P0-02. C-B-03 / C-P0-07 blocked on translator + external scorecards.

**Last automated run (2026-06-02):** All Phase C CI-parity commands **PASS** locally — language 10/10, rails golden 46/46, EN golden 10/10 rails, ES golden 3/3, voice SLO smoke OK, helper Jest 10/10. ES clinical logs LLM connection errors in sandbox but routing assertions pass. `npm run test:kelly:report` **skipped** (requires live server on `:4000`).

---

## Automated regression (green)

| Command | Result |
|---------|--------|
| `test:kelly:rails:language` | 10 passed |
| `test:kelly:rails:golden` | 46 passed |
| `test:e2e:kelly:golden-conversations` | 10 convs, 0 failures |
| `test:e2e:kelly:golden-conversations:es` | 3 convs, 0 failures |
| `test:voice:slo-smoke` | OK |
| Jest asr / opqrst / phi / formatter | 10 passed |

**Still requires human/staging:** P0, A–F open items below; perceptual voice (Retell audio); `test:kelly:report` with server up.

---

## P0 — Sign-off blockers

- [ ] **C-P0-01** (Medical translator) — Complete [`OPQRST_REVIEW_PACKET_v1.md`](../../docs/clinical/OPQRST_REVIEW_PACKET_v1.md). **Done when:** Spanish copy delivered for `config/clinical-opqrst/es.json`.
- [ ] **C-P0-02** (Translator + lead) — Add `docs/clinical/OPQRST_ES_SIGNOFF_<YYYY-MM-DD>.md`. **Done when:** File exists; matches `isOpqrstEsPackActive()` in `config.js`.
- [ ] **C-P0-03** (Engineer) — Populate `es.json` from approved text (no auto-translate in prod). **Done when:** ES registry snapshots pass; `KELLY_OPQRST_ES_PACK=v1` safe on staging.
- [ ] **C-P0-04** (External reviewer) — EN cohort per scorecard: 10 happy-path calls. **Done when:** Scorecard in `docs/qa/voice-reviews/`; pass bars met.
- [ ] **C-P0-05** (External reviewer) — ES cohort: 10 happy + 5 noisy + 5 low-confidence opener. **Done when:** Same archive + pass bars.
- [ ] **C-P0-06** (Product + engineer) — Demo dry-run EN + ES per demo scenario. **Done when:** End-to-end; provider sees appointment/prep on dashboard.
- [ ] **C-P0-07** (Tech lead) — Flip EXECUTION status to complete; sign-off boxes. **Done when:** All exit criteria; no auto-translated OPQRST in prod.

---

## A — Language detection (staging proof)

- [ ] **C-A-01** (Engineer / ops) — Staging chat first Spanish utterance. **Done when:** `language_detected` with `language=es`, `channel=chat`.
- [ ] **C-A-02** (Engineer / ops) — Staging voice first Spanish on Retell. **Done when:** Same event + `getKellySessionLanguage=es`.
- [ ] **C-A-03** (Engineer / ops) — Low-confidence non-English opener. **Done when:** `language_confidence_handoff` or `language_mismatch` as designed.
- [ ] **C-A-04** (Engineer) — `DB_PATH=<staging.db> npm run verify:kelly-rails-runtime-event.cjs --session-id <id>`. **Done when:** Script passes for proof sessions.

---

## B — Spanish prompts and Retell

- [ ] **C-B-01** (Engineer / ops) — `RETELL_VOICE_ID_ES`, `RETELL_CONFIGURE_LOCALE=es`, `configure-retell.js` on staging. **Done when:** Retell shows `es-US` + Spanish voice.
- [ ] **C-B-02** (Engineer / ops) — Staging Spanish happy path (rash → clinical in Spanish). **Done when:** No English drift first 3 turns.
- [ ] **C-B-03** (Engineer) — Prod policy: `KELLY_RAILS_ES_ENABLED=1` only with OPQRST sign-off. **Done when:** Env doc + deploy checklist aligned.

---

## C — OPQRST (post sign-off)

- [ ] **C-C-01** (Engineer) — After C-P0-02: `KELLY_OPQRST_ES_PACK=v1` on staging; voice clinical uses registry. **Done when:** Replies from `es.json`, not LLM paraphrase.
- [ ] **C-C-02** (Engineer) — ES Jest snapshots after sign-off. **Done when:** `clinical-opqrst-es.test.js` snapshots committed.

---

## D — ASR gate

- [ ] **C-D-01** (Engineer) — Retell spike; document payload fields in staging runbook (ASR table scaffold + `KELLY_ASR_DEBUG=1` wired). **Done when:** Field table filled from live spike.
- [ ] **C-D-02** (Engineer / ops) — `KELLY_ASR_MIN_CONFIDENCE` on staging; clarify + mid-call handoff. **Done when:** `asr_low_confidence` / `asr_low_confidence_mid_call` rows.
- [ ] **C-D-03** (Engineer) — If no confidence metadata: record gate no-op in runbook. **Done when:** Team knows prod behavior.

---

## E — Language mismatch (staging)

- [ ] **C-E-01** (Engineer / ops) — SQL proof for `language_mismatch` from resolver, orchestrator, ASR. **Done when:** One row per `mismatch_type` in test session.
- [ ] **C-E-02** (Engineer, optional P1) — `GET /api/admin/kelly/language-mismatches` **or** record SQL-only decision in this file. **Default:** SQL-only per staging runbook.

---

## F — Voice quality

- [ ] **C-F-01** (Engineer / ops) — Post-call voice-metrics curl for demo `callId`. **Done when:** SLO within `VOICE_SLO_*`.
- [ ] **C-F-02** (External reviewer) — Same as C-P0-04 / C-P0-05. **Done when:** Archived scorecards + median ≥ pass bars.

---

## Engineering hygiene (recommended)

- [x] **C-X-01** — ES golden `support_es_emergency_breathing` (`no puedo respirar` → `safety_blocked`).
- [x] **C-X-02** — CI: `test:e2e:kelly:golden-conversations:es` + `test:voice:slo-smoke`.
- [x] **C-X-03** — PT/ZH callback template in PT_ZH_HANDOFF + staging checklist (fill phone before demo).
- [x] **C-X-04** — Option A approver row in EXECUTION SSOT (_TBD name + date_).
- [x] **C-X-05** — Clinical prep PHI: `lib/clinical-phi-access.js` + admin route; Jest `clinical-phi-access.test.js`.

---

## Phase B carryover

- [ ] **B-OPS-01** (Operator) — `today.html` activity feed screenshot after v2 flow.

---

## Already done (do not re-todo)

- Code: first-utterance detection, ES prompts, ASR gate, mismatch telemetry, voice SLO + clamp, EN OPQRST registry, clinical-opqrst registry scaffold.
- Docs: demo scenario, OPQRST review packet, PT/ZH handoff, scorecard, staging runbook (base).
- Tests: `test:kelly:rails:language`, `test:e2e:kelly:golden-conversations:es`, `test:voice:slo-smoke`.
