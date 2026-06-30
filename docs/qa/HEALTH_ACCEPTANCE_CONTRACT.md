# Health video — acceptance contract

**Last updated:** 2026-06-26  
**Architecture:** [`HEALTH_SESSION_ARCHITECTURE.md`](../architecture/HEALTH_SESSION_ARCHITECTURE.md)

Write this at the top of every health coding session:

```
SESSION GOAL: [one layer or one fix]
ACCEPTANCE TEST: [paste the relevant layer section below]
DONE WHEN: npm run health:acceptance -- --offline green [+ --live if RAG/Groq touched]
DO NOT CLOSE until:
  - [health-turn] patient_text … turn=N appears for each turn
  - [derm-rag] retrieved N passages (if skin/RAG touched)
  - diagnosis guard grep returns empty on all assistant replies
  - report has chief_complaint + opqrst + (citations if derm)
```

## Automated runners

| Runner | Command | When |
|--------|---------|------|
| Offline gate (CI) | `cd middleware-platform && npm run health:acceptance -- --offline` | Every PR / session close |
| Live gate | `npm run health:acceptance -- --live` | After RAG or Groq changes |
| Unit tests | `npm test -- --testPathPattern='health-(session\|turn\|video\|token\|rag\|safety\|diagnosis\|opqrst\|vision\|derm\|care-pathway)'` | CI `ci:gate` |
| Playwright | `npm run test:e2e:health-video` | `ci:local full` |

**Live env:** `GROQ_API_KEY`, `DERM_EDUCATION_PIPELINE_ENABLED=true`, `RAG_EDUCATION_URL`

---

## Safety floor (every session close)

Non-negotiable. Refactors to turn pipeline, history, or orchestrator can bypass `SafetyPreScreen`.

| Check | Pass | Log / assertion |
|-------|------|-----------------|
| Emergency short-circuit | Chest pain / self-harm → crisis copy, no LLM | `[health-turn] emergency_short_circuit`; orchestrator not called |
| Emergency latency | p95 &lt; 2000ms (10× chest pain, no Groq) | `health-acceptance-layer0.cjs` |
| No diagnosis language | Grep empty on all assistant replies | `health-diagnosis-guard.js` |
| RAG or abstain | Skin answer without `[derm-rag]` = hallucination risk | `[derm-rag] retrieved N passages` OR abstain mode |

Diagnosis grep (must return nothing):

```bash
echo "$REPLY" | grep -iE "you have|it is|this is|diagnosis|you are suffering from|it looks like [a-z]+ (disease|condition|syndrome)"
```

---

## Layer 0 — STT / Video Orchestration (“the ears work”)

**Done when:** Text arrives in DB with correct speaker; nothing dropped; no duplicates.

| Test | Pass criteria | Automation |
|------|---------------|------------|
| Turn logging | `[health-turn] patient_text room=… turn=N` on every final | Manual / log grep |
| DB persist | Patient + assistant rows in `health_session_transcripts` | `health-turn-service.test.js` |
| 3-turn order | 3 sequential patient turns → strict `ts` order, alternating speakers | `health-turn-service.test.js` |
| Vision frame | `vision_frame` on `health-*` → `metadata.vision_artifacts` | `health-vision-frame.test.js` |
| Vision SLA | First frame immediate; interval ≤10s (UI) | `useFrameCapture.js` design + vision test |

**Failure:** Dropped turns, duplicate replies, STT firing twice, turns missing from DB.

---

## Layer 1 — Data Orchestration (“the memory works”)

**Done when:** Somo remembers turn 1 when answering turn 3; report has both sides of the conversation.

| Test | Pass criteria | Automation |
|------|---------------|------------|
| Session row | `health_sessions` created on start | `health-session.test.js` |
| Memory | Turn 3 orchestrator `history` includes turn 1 symptom | `health-turn-service.test.js` |
| Report fields | `chief_complaint`, `opqrst`, `safety_flags`, transcript excerpt | `health-session-report-service.test.js` |
| OPQRST gate | Scripted utterances → metadata + report section verbatim | `health-opqrst-gate.test.js` |
| Not monologue | Report summary ≠ patient-only transcript | `health-session-report-service.test.js` |

**Failure:** Patient monologue report, memory loss between turns, missing assistant rows.

---

## Layer 2 — Agent Orchestration (“Somo is accurate and grounded”)

**Done when:** Skin questions hit education RAG; citations shown; no diagnosis language.

| Test | Pass criteria | Automation |
|------|---------------|------------|
| RAG log | `[derm-rag] retrieved N passages` for skin queries | `patient-education-client.js` + `health-acceptance-layer2.cjs` |
| Skin router | 100% keyword list → `isSkinConcern` | `health-video-skin-router.test.js` |
| Diagnosis guard | No match on grep patterns | `health-diagnosis-guard.test.js` |
| Weak RAG abstain | 0 passages → abstain, not confident skin advice | `health-derm-grounding.test.js` |
| Citations | `analyze_skin_concern` → `toolEvents` with citations | `health-rag-integration.test.js` |

**Pinecone note:** Consumer health uses HTTP education RAG (`RAG_EDUCATION_URL`), not Pinecone coding index.

**Failure:** Confident skin answer without `[derm-rag]` log; diagnosis language; missing citations.

---

## Layer 3 — Rail Orchestration (“the care pathway works”)

**Done when:** Urgency correctly classified; copay route works (mock in dev).

| Test | Pass criteria | Automation |
|------|---------------|------------|
| Pathway matrix | Chest pain → emergency; rash/no fever → routine; stroke → emergency | `health-care-pathway.test.js` |
| Copay route | `POST …/route` → mock payment; mock pay → `paid` | `health-session-routing.test.js` + Playwright API |
| Stripe webhook | `health_session_id` metadata → paid | `health-session-routing.test.js` |

**Out of scope:** Real Stripe Elements UI (mock pay is dev SSOT).

---

## Layer 4 — Loop (“session closes cleanly; report is usable”)

**Done when:** Real person can go from “I have a rash” to a report they can bring to a doctor, without Somo pretending to be a doctor.

| Test | Pass criteria | Automation |
|------|---------------|------------|
| Golden journey | start → 3 turns → end → report with required fields | `health-acceptance-golden.cjs` |
| UI journey | Landing → live session → report heading | `health-video-demo.spec.cjs` |
| Live LLM | ToolCard citations + report sections | `health-video-demo.spec.cjs` (needs `GROQ_API_KEY` + derm) |

**Report must include:** chief complaint, OPQRST, when to seek care, citations (if derm ran).  
**Report must not include:** diagnoses, drug names.

---

## One-line “done” per layer

| Layer | Done |
|-------|------|
| 0 | Text in DB, ordered, no drops |
| 1 | Memory across turns; report has both sides |
| 2 | Skin → RAG; citations; no diagnosis |
| 3 | Urgency classified; copay route works |
| 4 | Rash → education → doctor-ready report |
