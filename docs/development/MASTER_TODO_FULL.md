# DocLittle Platform – Full Backlog

**Last Generated:** April 6, 2026  
This document consolidates:

- The core platform roadmap from `MASTER_TODO.md`  
- The Agent / Prompt / Voice runtime backlog  
- The $1B‑scale financial and compliance hardening tasks
- The UX and safety backlogs for real-world clinical and financial use

---

## Phase 0b — Safety & Integrity (Pre‑requisites)

> Cross‑cutting guardrails that must be addressed early for clinical and financial safety, before deep scaling.

P0‑1. **Emergency warm transfer implementation**  
Implement end‑to‑end emergency egress mechanics: when red‑flag terms are detected, the Retell WebSocket handler must stop agent logic and trigger a Retell/Twilio/SIP warm or blind transfer to a pre‑configured crisis/triage line. Ensure no dead‑air (clear voice message, immediate transfer) and support for 11‑digit dial‑out / 911 hand‑off where legally appropriate.

P0‑2. **Medical STT configuration and NLU normalization**  
Select and configure a medical‑tuned STT backend (e.g., Deepgram Nova‑2 Medical, AWS Transcribe Medical, or equivalent) or a medical lexicon post‑processor on top of Retell transcripts. Normalize colloquialisms and drug/condition names into stable clinical concepts before urgency classification and ICD‑10 extraction.

P0‑3. **Dual‑layer urgency validation**  
Implement (a) a rule‑based keyword failsafe that forces high‑urgency/emergency flows when specific phrases are spoken, regardless of LLM output, and (b) a conservative secondary classifier that only flags high‑risk calls. Emergency egress should fire if either this layer or the primary LLM triage flags high risk.

P0‑4. **Provider ghosting / no‑show state machine**  
Design and implement explicit handling when a provider is assigned but never joins the LiveKit room within X minutes: mark the assignment as `provider_no_show`, re‑queue the patient with preserved or increased priority for the next batch, and increment a provider “ghosting” counter that feeds into reliability scoring and throttling.

P0‑5. **Visit charge timing decision (pre‑auth vs post‑capture)**  
Make and document a product/legal decision on when the main visit charge occurs (booking, session start, or post‑SOAP sign‑off) and reflect it in the ledger model: whether initial ledger entries are `pending` vs `settled`, how this interacts with no‑show deposit holds, and what refund patterns are supported.

---

## Part A — Core Platform Phases (from `MASTER_TODO.md`)

> Source of truth for core product, scheduling, matching, clinical features, and base payments.

```1:336:docs/MASTER_TODO.md
# Master TODO — Cash-Only Research-Backed Telehealth Platform

**Last Updated:** April 6, 2026

Consolidated task list for completing the platform. Built on current architecture: multi-tenant, Retell voice, LiveKit video, LangGraph, FHIR, `appointments`, `video_consult_sessions`, `voice_checkouts`, `clinics`, `fhir_patients`.

---

## Hybrid Architecture (Matching)

**LLM** = reasoning layer (triage, specialty inference, fit scoring, clinical cues).  
**Hungarian algorithm** = executor (mathematical optimization, fairness).

- LLMs for: subjective reasoning, synthesis, clinical nuance.
- Hungarian for: scalable assignment, determinism.
- **Phase 4c** hardens for clinical production: audit trail, feedback loops, emergency egress, cognitive load balancing, pre-match summary.

---

## Architecture Context (Current State)

| Component | Status | Notes |
|-----------|--------|-------|
| **Voice** | Retell WebSocket, `schedule_appointment`, `create_appointment_checkout`, `verify_checkout_code` | Flow: call → book → checkout → email code → payment link |
| **Video** | LiveKit rooms, Python agents → `POST /api/video-consult/agent-events` | LangGraph: accumulate → retrieve_context → human_review → store_fhir |
| **Data** | `appointments` (provider string), `video_consult_sessions`, `voice_checkouts`, `clinics`, `fhir_patients` | SQLite / optional Postgres |
| **Pricing** | Hardcoded $39.99 in `server.js` | No visit_pricing table |
| **Auth** | Admin: in-memory `admin_session`; Customer: `customer_sessions`; Provider: shared business login | No dedicated provider auth |
| **Matching** | None | No practitioners table, no match engine |

---

## Phase 0 — Critical Limitations (Fix First)

| # | Task | Details |
|---|------|---------|
| 1 | Remove $39.99 hardcode | Replace with `visit_pricing` table; add migration |
| 2 | Fix admin-auth in-memory sessions | Replace `admin_session` Map with DB-backed `admin_sessions` table (lost on Azure restart) |
| 3 | Create `visit_pricing` table | Keyed by `clinic_id` + `appointment_type`; base_price, surge_multiplier |
| 4 | Set base prices | $69 general consult, $109 therapy, $179 psychiatry initial, $99 psychiatry follow-up |
| 5 | Add `surge_enabled` to clinics | Boolean, default false (legal safety before dynamic pricing) |

---

## Phase 1 — Data Model Foundation

| # | Task | Details |
|---|------|---------|
| 6 | Create `practitioners` table | id, user_id, npi, name, specialty, clinic_id, circle_account_id, verification_status, availability_rules (JSON), star_rating, created_at |
| 7 | Create `practitioner_licenses` table | practitioner_id FK, state (indexed), license_number, verified — never JSON, state is core filter |
| 8 | Create `consult_sessions` table | id, appointment_id, practitioner_id, patient_id, status enum (triaging→matched→waiting_room→in_session→post_session→complete), livekit_room_name, retell_call_id, match_assignment_id |
| 9 | Link `video_consult_sessions` to `consult_sessions` | **Decided:** Keep separate. Add `consult_session_id` FK to video_consult_sessions; consult_sessions = lifecycle, video_consult_sessions = LiveKit metadata. Migration for existing rows. |
| 10 | Create `matching_cells` table | cell_id = `state_specialty_date_hourSlot`, demand_count, supply_count, surge_multiplier, updated_at |
| 11 | Create `match_requests` table | patient_id, appointment_type, state, preferred_date, preferred_time_start/end, clinical_urgency, status, batch_id, **reasoning_metadata** (JSON: clinical_cues, llm_triage_reasoning) — audit trail for human-in-the-loop |
| 12 | Create `match_assignments` table | batch_id, match_request_id, practitioner_id, slot_date, slot_time, cost_score, surge_multiplier, **cost_matrix_audit** (JSON: cost breakdown per factor), **pre_match_summary** (3-sentence clinical brief for provider Accept) |
| 13 | Create `provider_slots` table | practitioner_id, date, hour_slot, is_booked — pre-expanded from availability_rules |
| 14 | Create `matching_batch_queue` table | Track batch runs, prevent overlapping cycles |
| 15 | Create `provider_payouts` table | practitioner_id, amount, stripe_transfer_id, session_id, created_at |
| 16 | Add `practitioner_id` to appointments | Migration: backfill or default for existing rows |
| 17 | Add `preferred_practitioner_id` to fhir_patients | For continuity-of-care cost bonus |
| 18 | Add migration versioning | `migrations` table (version, applied_at) — current inline CREATE TABLE is untrackable |
| 19 | Create `specialty_mismatch_penalties` table | practitioner_id, specialty_or_icd_cluster, penalty, source (e.g. provider_feedback "not a fit"), created_at — feed cost-builder for outcome-based costs |

---

## Phase 2 — Provider Onboarding & Auth

| # | Task | Details |
|---|------|---------|
| 20 | Create `provider-auth.js` middleware | Mirror customer-auth; DB-backed `provider_sessions`; attach req.practitioner |
| 21 | Create `provider_sessions` table | session_id, practitioner_id, expires_at, created_at |
| 22 | Implement POST /api/provider/signup | name, email, NPI, specialty, state(s), email verify flow; creates practitioners row verification_status=pending |
| 23 | NPI verification via NPPES | Call `https://npiregistry.cms.hhs.gov/api/?number={npi}`; validate name, taxonomy, state; set verification_status=verified |
| 24 | Provider availability rules UI | Form in dashboard; weekly hours (Mon 9–17); store in practitioners.availability_rules |
| 25 | Scope business dashboard to practitioner_id | Today's schedule, earnings, patient queue; RBAC per practitioner |
| 26 | Clinic scoping for practitioners | Ensure clinic_id in all practitioner queries; multi-tenant isolation |

---

## Phase 3 — Scheduling Infrastructure

| # | Task | Details |
|---|------|---------|
| 27 | Extend getAvailableSlots to be practitioner-aware | Accept practitioner_id; query practitioners.availability_rules; check appointments WHERE practitioner_id=? |
| 28 | Provider slot indexer job | Background job (nightly or on availability change); expand availability_rules → provider_slots for next 14 days |
| 29 | Define Google Calendar vs provider_slots | Replace Calendar with provider_slots, or sync both (Calendar for external blockers) |
| 30 | No-show deposit-hold | Stripe authorize-only (capture_method: manual); capture on in_session; cancel if cancelled >24h; $25 no-show fee otherwise |

---

## Phase 4 — Matching Engine

| # | Task | Details |
|---|------|---------|
| 31 | Implement cost-builder.js | N×M cost matrix: wait_time (0.3), specialty_mismatch (0.4), provider_load (0.2), state_license (0.1); loyalty bonus -10 for preferred |
| 32 | ICD-10 → specialty mapping | Knowledge/ JSON: F-codes→psychiatry, M→physio, L→dermatology; feed specialty_mismatch; use provider_trust_metrics |
| 33 | Greedy matcher (Phase 4a) | Sort by urgency + created_at; assign to lowest-cost slot; fallback for Hungarian |
| 34 | Hungarian algorithm (Phase 4b) | munkres npm; full cost matrix; dummy columns for unmatched; globally optimal |
| 35 | Batch processor (setInterval 3 min) | 1) SELECT pending match_requests 2) batch_id 3) cost-builder 4) solver 5) match_assignments 6) consult_sessions→matched 7) notify patients 8) unmatched stay in queue |
| 36 | POST /api/matching/request | Enqueue match_request; return request_id, estimated_wait_min |
| 37 | GET /api/matching/status/:request_id | Return status, assigned_provider, slot, surge_multiplier, estimated_wait_min |
| 37b | POST /api/matching/cancel | Cancel match_request in pending/processing; set status=cancelled; used by UI-84 |

---

## Phase 4c — Matching Hardening (Clinical Safety)

| # | Task | Details |
|---|------|---------|
| 38 | **Reasoning Loop audit trail** | Store LLM clinical cues in match_requests.reasoning_metadata (e.g. "Patient mentioned 'crushing' chest pain, elevated to Urgent"); cost_matrix_audit in match_assignments. Human-in-the-loop audit UI. |
| 39 | **Emergency egress (dead-end logic)** | Before cost-builder: LLM triage detects high-acuity keywords (suicidal ideation, stroke symptoms) → bypass Hungarian entirely; trigger warm handover to human or 911. Never force-match emergencies. |
| 40 | **Feedback loop (re-matching penalty)** | When provider declines "not a fit": write to specialty_mismatch_penalties; cost-builder reads and increases specialty_mismatch for that (practitioner_id, specialty/icd_cluster) pair in future batches. |
| 41 | **Cognitive load balancing** | Track recent high-intensity encounters per practitioner (trauma/PTSD, etc.); reasoning layer temporarily increases cost for similar cases to prevent burnout even when technically available. |
| 42 | **Pre-match summary (mini-SOAP)** | Voice agent produces 3-sentence clinical brief; send to practitioner with match request; provider Accept/Decline flow before consult_sessions→matched. Store in match_assignments.pre_match_summary. |

---

## Phase 5 — Surge & Dynamic Pricing

| # | Task | Details |
|---|------|---------|
| 43 | surge-service.js | Per-cell: demand/supply ratio; multiplier = 1.0 + 0.1×max(0, ratio-1); cap 1.5× |
| 44 | Cell demand/supply counters | Increment on match_request insert; update on slot book/release |
| 45 | visit_pricing API | GET /api/pricing?clinic_id&appointment_type; POST /api/admin/pricing; wire into create_appointment_checkout |

---

## Phase 6 — Visit Infrastructure (Retell → LiveKit Handoff)

| # | Task | Details |
|---|------|---------|
| 46 | Implement consult_sessions state machine | triaging→matched→waiting_room→in_session→post_session→complete; emit events |
| 47 | Define Retell → LiveKit flow | **Decided:** Voice creates match_request. Agent says "We'll find a provider and text/email you a link." Patient polls status; LiveKit link after match. |
| 48 | Store retell_call_id on consult_sessions | Link Retell transcripts/flow to session |
| 49 | Auto LiveKit room creation on match | When match_assignment + status→matched: create room, tokens, send join link |
| 50 | Update Retell tools for matching | Retell schedule_appointment → create match_request (same as app). Update get_available_slots or remove; agent uses POST /api/matching/request. |
| 51 | Align LangGraph with consult_sessions | Trigger on post_session/complete; pass consult_session_id; store outputs linked to session |
| 52 | Wire symptom triage / risk events | video_consult_risk_events → consult_sessions; escalation rules |

---

## Phase 7 — Clinical (PRO & Outcomes)

| # | Task | Details |
|---|------|---------|
| 53 | PHQ-9 / GAD-7 pre-visit collection | Send form link after match; store via assessmentToFHIRObservation(); display in provider HUD |
| 54 | Post-visit SOAP note generation | LangGraph: Subjective, Objective, Assessment, Plan from transcript; FHIR Communication |
| 55 | Post-visit outcome collection | 24h after complete: PHQ-9/GAD-7 + satisfaction; FHIR Observations; time-series to pre-visit |
| 56 | Notification contracts | Match found, reminder, outcome survey, no-show; extend EmailService, ReminderScheduler |

---

## Phase 8 — Payments & Settlement

| # | Task | Details |
|---|------|---------|
| 57 | Wire create_appointment_checkout to visit_pricing | Replace hardcoded amount; use GET /api/pricing |
| 58 | Stripe Connect for provider payouts | Onboard practitioners to Stripe Connect Express; transfer on complete |
| 59 | Settlement trigger on session complete | consult_sessions→complete → Stripe Connect transfer; idempotency |
| 60 | Simplify cash-only | **Decided:** Deprecate Circle patient wallets. Stripe card only for launch. Hide/remove patient wallet UI. |

---

## Phase 9 — Patient App

| # | Task | Details |
|---|------|---------|
| 61 | Booking screen | appointment_type → date range → POST /api/matching/request → poll status → assigned provider + slot |
| 62 | Provider profile card | name, specialty, star_rating, NPI verified; accept or 1 re-match |
| 63 | Patient identity for matching | Ensure fhir_patients.resource_id stable; auth/session for matching |
| 64 | Extend intake | DOB, address; **consent for research required** before first PHQ-9/GAD-7 (see task 89). |

---

## Phase 10 — Operational & Compliance

| # | Task | Details |
|---|------|---------|
| 65 | HIPAA audit logging | Populate hipaa_access_log for patient access, FHIR reads/writes, payment events |
| 66 | Cost control | Rate limits for LangGraph, RAG; per-clinic caps (VIDEO_CONSULT_MAX_COST_PER_SESSION) |
| 67 | Feature flags | New matching vs legacy; new pricing vs hardcode; deposit-hold vs capture; rollback path |
| 68 | E2E test | Voice book → match → payment → LiveKit join → SOAP/outcome |
| 69 | Monitoring | Matching batch duration; unmatched rate; Stripe Connect failures; LangGraph failures |

---

## Phase 11 — Vision & P2 Items

| # | Task | Details |
|---|------|---------|
| 70 | Vision pipeline (P2) | Wire vc_yolo_probe / vision_frame to GPT-4o; FHIR Observation; max frames per session |
| 71 | In-app video join (P2) | Native LiveKit SDK in Expo instead of browser link |
| 72 | Outcome forms in app (P2) | Native PHQ-9/GAD-7; longitudinal score trends |
| 73 | Predictive demand model (P2) | Time-series per cell; pre-populate surge 48h; need 3mo data first |
| 74 | No-show prediction (P2) | Per-patient probability; feed cost-builder |

---

## Decisions (Resolved)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | **Retell voice booking: matching vs bypass?** | **Voice goes through matching.** Agent creates `match_request` (same as app); patient gets link to poll status. One path for consistency; triage feeds reasoning layer. For Urgent/Emergent, emergency egress bypasses matching. |
| 2 | **consult_sessions vs video_consult_sessions?** | **Keep separate, linked.** `consult_sessions` = lifecycle (triaging→matched→…→complete). `video_consult_sessions` = LiveKit/technical metadata. Add `consult_session_id` FK to video_consult_sessions; consult_sessions is source of truth. |
| 3 | **Circle patient wallet: deprecated or kept?** | **Deprecate for cash-only launch.** Stripe card only. Simplifies flow. Circle can return later if crypto payments needed. |
| 4 | **Patient research consent before PHQ-9/GAD-7?** | **Yes, required** before first PRO form. Consent screen/checkbox; store in fhir_patients or consent table. Block PRO until consent given. |

---

## Phase 12 — UI Tasks

### Provider UI

| # | Task | Details |
|---|------|---------|
| 75 | Provider NPI verification status screen | Show verification_status (pending/verified/rejected) with next steps after signup |
| 76 | Provider re-verification flow | If NPI check fails: correct NPI/specialty/states, resubmit; link to specialty_mismatch_penalties on decline |
| 77 | Provider decline reason UI | Accept/Decline modal: dropdown or text for decline reason (e.g. "not my sub-specialty", "schedule conflict"); feeds specialty_mismatch_penalties (task 40) |
| 78 | Pre-match summary display | Format for 3-sentence clinical brief in Accept/Decline screen; task 42 output |
| 79 | Stripe Connect onboarding UI | OAuth flow: identity verification, bank account; redirect from Stripe Connect Express |
| 80 | Stripe Connect status screen | Show Connect account status (pending, active, restricted); earnings, transfer history |
| 81 | Session complete screen (provider) | Post "End & Create Claim": show auto-generated SOAP note for review/sign-off; update flow since SOAP is now auto |
| 82 | Cognitive load indicator | Provider dashboard: "Light day / Moderate / Heavy" from recent high-intensity cases; self-management |
| 83 | Longitudinal score display (provider) | HUD + visit history: PHQ-9/GAD-7 trend over multiple visits, not just pre-visit |

### Patient UI

| # | Task | Details |
|---|------|---------|
| 84 | Patient match cancellation | In match_waiting: Cancel/Exit button; POST /api/matching/cancel (task 37b); return to booking or home |
| 85 | Re-match flow UI | After "Request re-match": return to waiting state; "Finding new provider…"; poll status; limit 1 re-match |
| 86 | Session complete screen (patient) | Post-visit: "Visit complete. You'll receive a follow-up survey in 24h." + optional summary |
| 87 | No-show fee receipt/notification | When $25 no-show charge fires: email + in-app notification; receipt UI with amount, date |
| 88 | Emergency egress UI | When triage triggers warm handover: "Connecting you with urgent support. Please stay on the line." No matching queue shown |
| 89 | Patient consent screen | Before first PHQ-9/GAD-7: consent checkbox + explanation; store consent; block PRO until given |
| 90 | PHQ-9/GAD-7 web form (public URL) | `/patients/pro/phq9` or similar; tokenized link from email; submit → FHIR Observation; landing page |
| 91 | Outcome survey landing page | `/patients/pro/outcome`; 24h email link; PHQ-9/GAD-7 + satisfaction; submit → FHIR |

### Appointments & Mixed State

| # | Task | Details |
|---|------|---------|
| 92 | Appointments list (mixed state) | Rows with practitioner_id show provider; rows without (legacy/Retell direct) show "Assigned provider TBD" or clinic name; consistent UX |

### Admin / Ops UI

| # | Task | Details |
|---|------|---------|
| 93 | Admin: specialty_mismatch_penalties | View/override penalties; task 19 backend |
| 94 | Admin: reasoning audit (wireframe) | View reasoning_metadata, cost_matrix_audit; task 38; define layout |
| 95 | Admin: per-clinic cost caps | Set VIDEO_CONSULT_MAX_COST_PER_SESSION per clinic; task 66 |
| 96 | Admin: feature flags UI | matching vs legacy, pricing vs hardcode, deposit-hold vs capture; task 67 |
| 97 | Ops: monitoring dashboard | Batch duration, unmatched rate, Stripe Connect failures, LangGraph failures; task 69 |
| 98 | Admin: HIPAA access log viewer | Query/filter hipaa_access_log; task 65 |

---

## Phase 13 — Transcript & Storage

### Data Model & Linkage

| # | Task | Details |
|---|------|---------|
| 99 | voice_call_log: patient_id, appointment_id, call_type | Add columns to voice_call_log; store call_id → patient_id → appointment_id. Upsert when patient_id resolved during call (schedule_appointment, collect_insurance). Migration. |
| 100 | voice_call_log: call_type enum | inbound_booking, inbound_triage, outbound_reminder, outbound_outcome_survey, outbound_no_show_followup. Different handling downstream. |
| 101 | Push voice transcripts to fhir_communications on call end | When call ends (Retell webhook or WebSocket disconnect) + patient_id known: write transcript to fhir_communications with patient_id, encounter_id=NULL if no encounter. Idempotency by call_id. Requires call-end trigger. |
| 102 | Voice transcript linkage when patient unidentified | Store in voice_conversation_memory with `unlinked` flag. Background job: periodically attempt to link unlinked transcripts to patients via phone lookup. |
| 103 | Create FHIR encounter at clinical interaction start (voice) | On first clinical turn/tool call with patient context, create encounter—not just on completion. Prevents transcript loss if call drops. |
| 104 | Link video_consult_sessions transcript to consult_sessions | After consult_session_id FK: ensure video transcript (metadata.audio_transcript) also written to fhir_communications linked to consult_sessions. |
| 105 | Durable transcript retention policy | Nightly job: find voice_conversation_memory rows with known patient_id (via call_id → voice_call_log) but no fhir_communications; backfill before 30-day purge. |
| 106 | Idempotency for transcript push | Dedupe by call_id before inserting fhir_communications. Prevent double-write if processVoiceCall and on-call-end handler both run. |

### Video Transcript Analysis

| # | Task | Details |
|---|------|---------|
| 107 | Real-time transcript analysis during video | Lightweight pass during in_session: flag high-acuity keywords (suicidal ideation, chest pain, stroke) as they appear; trigger emergency egress immediately, not post-session. |
| 108 | Unified transcript format | Canonical schema: { timestamp, speaker_role (patient/provider/agent), text, source (retell/livekit) }. Normalize both sources before fhir_communications. |
| 109 | Speaker diarization for video | Preserve speaker labels in LiveKit transcript so SOAP generation knows who said what. |
| 110 | Post-video LLM analysis pipeline | After in_session → post_session: full transcript → LLM for (1) SOAP note, (2) ICD-10/CPT, (3) risk flags, (4) PHQ-9/GAD-7 inference if verbal. Store all linked to consult_session_id. |
| 111 | Transcript search endpoint | GET /api/transcripts/search?patient_id&date_from&keyword. Backed by fhir_communications. For provider search and RAG at scale. |

### Analysis & Clinical Intelligence

| # | Task | Details |
|---|------|---------|
| 112 | Clinical cue extraction from all transcript sources | LLM pass on every completed transcript (voice or video): chief complaint, medications, symptom duration, risk flags. Store as fhir_observations linked to encounter. Feed matching fit scoring. |
| 113 | Sentiment and distress scoring | Sentiment analysis on patient speech turns. Store distress_score as FHIR Observation. Feed: (1) provider HUD real-time, (2) matching for high-distress → experienced providers. |
| 114 | Cross-session clinical continuity | When provider joins video: pull prior fhir_communications + fhir_observations for patient; summarize into pre-session brief. Display in provider HUD. |
| 114b | voice_conversation_memory: unlinked flag | Add `unlinked` column (boolean); set true when patient_id unknown at call end. Background job (task 102) uses for linkage attempts. Migration. |
| 114c | Transcript encryption at rest (P2) | HIPAA: encrypt transcript content before insert; decrypt on read. Use TRANSCRIPT_ENCRYPTION_KEY. Optional for launch. |

---

## Phase 14 — Retell Inbound & Outbound

### Inbound vs Outbound Pipeline

| # | Task | Details |
|---|------|---------|
| 115 | Inbound call transcript pipeline | Ensure inbound (patient calls in → booking/triage) captures transcript to voice_conversation_memory AND fhir_communications when patient_id resolved. Same path as outbound. |
| 116 | Outbound call transcript pipeline | Outbound: platform initiates (reminders, surveys, no-show). Transcript stored with originating context (appointment_id, survey_type) in voice_call_log; not just call_id. |
| 117 | Retell outbound API integration | Backend: call Retell Create Call API to initiate outbound. Pass context (appointment_id, call_type) for routing and transcript linkage. |
| 118 | Retell outbound for reminders | Replace or supplement EmailService.sendAppointmentReminder. 1h before: Retell calls patient, confirms attendance. Transcript stored. Cancel flow if patient cancels on call. |
| 119 | Retell outbound for outcome surveys | 24h post-visit: Retell calls patient, administers PHQ-9/GAD-7 verbally. LLM extracts responses → FHIR Observations. Fallback to email form if unanswered after 2 attempts. |
| 120 | Retell outbound for no-show followup | Patient no-shows: Retell calls within 30 min, offers reschedule. Transcript stored. If agreed, create new match_request. |
| 121 | Inbound during active video session | If patient calls Retell while consult_sessions status = in_session: detect via lookup; handle gracefully (e.g. "You're in a visit—please stay in the video room") instead of new booking flow. |

---

## Summary

| Phase | Tasks | Count |
|-------|-------|-------|
| 0 — Critical Limitations | 1–5 | 5 |
| 1 — Data Model Foundation | 6–19 | 14 |
| 2 — Provider Onboarding & Auth | 20–26 | 7 |
| 3 — Scheduling Infrastructure | 27–30 | 4 |
| 4 — Matching Engine | 31–37 | 7 |
| 4c — Matching Hardening | 38–42 | 5 |
| 5 — Surge & Dynamic Pricing | 43–45 | 3 |
| 6 — Visit Infrastructure | 46–52 | 7 |
| 7 — Clinical (PRO & Outcomes) | 53–56 | 4 |
| 8 — Payments & Settlement | 57–60 | 4 |
| 9 — Patient App | 61–64 | 4 |
| 10 — Operational & Compliance | 65–69 | 5 |
| 11 — Vision & P2 | 70–74 | 5 |
| 12 — UI Tasks | 75–98 | 24 |
| 13 — Transcript & Storage | 99–114c | 18 |
| 14 — Retell Inbound & Outbound | 115–121 | 7 |
| **Total** | | **123** |

**Critical path:** Phases 0–4 + 4c (foundations + matching + clinical hardening). Phases 5–12 build on a working practitioner model and matching engine.

**Decisions:** 4 resolved — Retell→matching; consult_sessions separate; Circle deprecated; consent required before PRO.
```

---

## Part B — Agent / Prompt / Voice Runtime Backlog

> Cross‑channel “brain” service, prompt control, tools, and reliability for voice + future chat.

### B1. AgentBrainService & session runtime

1. Design `AgentBrainService` interface and data structures (processTurn contract, history shape, action types).
2. Implement `AgentBrainService` in middleware with base system prompt, clinic‑aware prompt assembly, and LLM client.
3. Implement conversation memory + token‑budget management for voice sessions.
4. Wire `AgentBrainService` into `retell-websocket.js` to handle transcripts and send voice responses.
5. Implement agentic tool orchestration loop (`call_tool` actions, execute tools, re‑invoke brain).
6. Implement voice interrupt handling (user barge‑in detection from Retell, cancellation of in‑flight LLM/tool work, restart of turn).
7. Add streaming response support from LLM to Retell (token streaming, partial responses, fallback to non‑streaming).

### B2. Prompt profiles, safety, and admin UX

8. Design and migrate DB schema for `prompt_profiles` with versioning and status (draft/active/archived).
9. Implement prompt checksum/hash generation and store with each compiled prompt.
10. Implement prompt audit logging table `prompt_audit_logs` to track who edited which prompt, when, and what changed.
11. Expose REST APIs for listing, creating, updating prompt profiles and setting clinic defaults.
12. Implement prompt linting and guardrails to enforce base safety prompt and detect risky doctor instructions.
13. Implement prompt injection defenses in `AgentBrainService` to detect and mitigate malicious caller instructions.
14. Add admin UI in dashboard for editing prompt profiles using structured controls and optional free‑text.
15. Add prompt sandbox UI for doctors/admins to test prompts in a safe preview environment.

### B3. State, reliability, degraded mode

16. Design and implement lightweight conversation state manager (e.g., GREETING, INTAKE, INSURANCE, SCHEDULING, CONFIRMATION).
17. Implement tool reliability layer (`ToolReliabilityService`) with per‑tool timeouts, simple retry policy, and safe fallback messages.
18. Implement degraded mode controller triggered by repeated LLM/tool failures, with simplified behavior or escalation.
19. Introduce trace IDs across WebSocket, `AgentBrainService`, and tools for per‑call/turn tracing.
20. Add rate limiting and abuse protection for calls, turns, and token usage per tenant/session.
21. Create background jobs to clean up sessions, enforce data retention, and archive transcripts per policy.

### B4. Logging, tracing, and observability

22. Extend logging/audit (call logs + `agent_turns`) to capture `prompt_profile_id`, version, model, latency, and transcripts.
23. Build synthetic conversation testing framework to replay scripted dialogs against prompts and tools.
24. Add unit tests for `AgentBrainService` with mocked LLM and history truncation.
25. Write a runbook documenting how clinics configure prompts and how to debug a call end‑to‑end.

### B5. Human handoff, escalation, financial tools

26. Add human handoff / escalation actions (`handoff_to_human`, `transfer_call`, `schedule_callback`) to `processTurn`.
27. Wire Retell adapter to perform real call transfers or callback scheduling for handoff actions.

---

## Part C — $1B‑Scale Ledger, Payments, and Compliance Backlog

> Tasks focused on getting to $1B+ in annual patient / insurer / provider flows with verifiable correctness.

### Circle / USDC vs cash‑only launch

- **Launch decision (Phase 8 / task 60):** Cash‑only, Stripe‑card flows; Circle patient wallets deprecated for the initial GA.
- **Scale decision (this Part C):** Re‑introduce Circle/USDC and multi‑rail architecture **after** cash‑only flows are stable and regulatory requirements (C4) and DB migration (C5‑53) are complete.
- Treat Circle and multi‑rail work as **feature‑flagged**: all C1–C3 tasks should ship behind config so the platform can run Stripe‑only or Stripe+Circle per environment/tenant.

### Critical dependencies / ordering

- **DB migration first:** Task **C5‑53 (SQLite → Postgres/Cockroach)** is a **hard prerequisite** for:
  - All **C1 – Ledger & wallet foundation** tasks.
  - All **C2 – Payment rails** tasks.
  - Any financial reconciliation or high‑volume RCM work that depends on durable transactions.
- **Emergency egress depends on risk detection:**
  - Phase **4c‑39 (Emergency egress)** depends on transcript and risk‑signal plumbing from **Phase 13‑107 (real‑time transcript analysis)** and **Phase 13‑112 (clinical cue extraction)**.
  - Implementation order should be: basic transcript pipeline → risk keyword / cue detection → emergency egress decision + routing.

### C1. Ledger & wallet foundation

28. Design canonical account model: `ledger_accounts` (owner_type patient/provider/insurer/system, owner_id, currency, rail_type stripe/circle/internal, status) and invariants (no negative balances; debits == credits; immutability).
29. Implement double‑entry `ledger_entries` table with `id`, `account_id`, `debit`, `credit`, `currency`, `external_ref_type`, `external_ref_id`, `created_at`, `status`.
30. Wrap all money‑moving operations (Stripe charges, Circle transfers, wallet credits, invoice payments) in a “decision → ledger entries → rail call → status update” pattern.
31. Add idempotency keys at the ledger layer to prevent duplicate entry creation on retries.
32. Implement per‑patient / per‑provider / per‑insurer wallet summary APIs driven solely from ledger balances.
33. Backfill existing payment data into the ledger where feasible, or define a clear cutover height.

### C2. Payment rails (Stripe, Circle, hybrid)

34. Define and document three canonical rails: Rail A (cash / Stripe only), Rail B (hybrid copay via Stripe + insurer via Circle), Rail C (insurance‑only).
35. Define canonical payment rail state machines for each rail (intent_created → authorized → captured → settled → failed/refunded) and document invariants.
36. Implement a single `payment_orchestrator` contract that all callers (voice, app, RCM) use to drive these rail state machines.
37. Integrate ledger with Stripe flows so each payment intent and payout creates appropriate pending and settled ledger entries, including refunds/chargebacks.
38. Integrate ledger with Circle flows so each transfer and escrow movement has matching ledger entries; treat escrow as its own ledger account.
39. Formalize hybrid claim → payment choreography in one orchestrator (`rcm-service` or dedicated `claim-settlement-orchestrator`) with idempotent claim submissions and payments.

### C3. RCM, Stedi, and payer APIs

40. Harden Stedi production integration: strict config for sandbox vs production, and gated simulation modes for dev only.
41. Implement per‑payer routing: some payers via Stedi, others via direct FHIR, based on configuration.
42. Implement `payer-gateway-service` with `checkEligibility`, `submitClaim`, `getClaimStatus` that chooses Stedi vs FHIR per payer capabilities.
43. Add per‑payer, per‑tenant budgets and usage accounting for Stedi/FHIR calls with hard/soft limits and alerting.
44. Add metrics and alerts for Stedi and FHIR failure rate and latency per payer.

### C4. Regulatory, AML/KYC, and governance

45. Perform money transmitter licensing and regulatory assessment for Circle/USDC and payment flows.
46. Integrate AML/sanctions screening on wallet and payment transactions.
47. Implement KYC/KYB workflows for new providers and insurers onboarding to wallets.
48. Set up HIPAA BAA management and tracking for all PHI‑handling vendors and financial vendors.
49. Centralize secrets and keys (Stedi, UHC OAuth, Stripe, Circle, DB) in a secrets manager and implement key rotation.
50. Define roles/permissions for internal services and agent tool calls; enforce authorization checks on all financial and PHI operations.
51. Implement audit logging for all access to PHI and all financial actions (who did what, when, from where).
52. Implement data retention and deletion policies for financial records and PHI; document data flows and BAAs.

### C5. Database, migration, and infra

53. Migrate financial and other high‑write tables from SQLite to Postgres/Cockroach with proper transactions and replication.
54. Add appropriate indexes for all hot ledger, claim, and payer‑API queries.
55. Implement queues / job workers for long‑running or retryable operations (claim submission, reconciliation, payouts).
56. Ensure critical services are stateless (session/state in DB/Redis) so app instances can be scaled horizontally.

### C6. Failure patterns, DLQ, sagas

57. Add DLQ and retry strategy for financial tool calls with side effects, including compensating actions.
58. Model key payment and claim flows as sagas with compensating transactions for partial failures.
59. Add circuit breakers and backoff strategies for Circle/Stripe/Stedi outages beyond current fallbacks.
60. Design and run chaos scenarios for financial flows (external outages, partial successes, delayed webhooks) and verify no double‑charge/credit and clean recovery.

### C7. Unified financial timeline and user‑visible tracing

61. Build a unified financial event log that normalizes Circle, Stripe, and Stedi events per patient/provider/insurer on top of the ledger.
62. Build financial timelines for patient and provider portals that narrate visit → claim → EOB → payments, sourced only from ledger + reconciliation.
63. Guarantee visit/encounter linkage for all financial events: every claim, EOB, ledger entry, and transfer references a `consult_session_id` / Encounter ID; add DB constraints where possible.

### C8. Observability, metrics, and SLOs

64. Instrument metrics for every financial event (ledger entries, rail calls, status changes) and claim lifecycle stages.
65. Define and instrument SLOs for eligibility latency, claim adjudication latency, and payout latency; surface in internal dashboards.
66. Add jobs and alerts for claims stuck in `submitted/processing`, transfers stuck in `pending`, or any ledger imbalance / reconciliation delta beyond tolerance.

### C9. Testing, load, and security

67. Add unit and integration tests for ledger invariants (no negative balances; debits == credits) and for each payment rail (happy paths + errors).
68. Add property‑based tests and invariants for escrow split logic (e.g., 50/20/20/10) and related calculations.
69. Build synthetic datasets (thousands of claims) and run end‑to‑end RCM + payments + reconciliation tests; verify no money lost and balances reconcile.
70. Design and run load/stress tests simulating $1B+ payment volume across rails before go‑live.
71. Run static analysis and dependency scanning for financial and PHI services.
72. Schedule third‑party penetration testing and security audit for the voice agent and financial APIs.
73. Create a formal threat model for voice channel (spoofing, social engineering, payment abuse) and mitigation plan.
74. Add strict guardrails for payment‑related tools (limits, whitelists, confirmation flows) beyond prompt‑level safety.
75. Author on‑call incident runbooks for payment/escrow failures and major outages.
76. Define and implement backup and disaster recovery plan specifically for financial and ledger tables.

### C10. Disputes, exceptions, and provider payout issues

77. Design and implement flows for **provider payment disputes** (Stripe Connect transfers and Circle payouts), including:
    - Dispute intake and tracking (who raised it, which session/claim/transfer).
    - Temporary holds or adjustments on future payouts while disputed amounts are investigated.
    - Reconciliation between ledger entries and external dispute outcomes (Stripe/Circle).
78. Add admin/Ops tooling to view and resolve disputes, with full audit trail of adjustments and justifications.

### C11. Consent management and provider credentialing extensions

79. Implement a centralized **Consent Service** that:
    - Tracks consent artifacts (type, text/version, channel, timestamp, actor, revocation).
    - Links consents to patients and specific features (research PROs, data sharing, recording, financial authorizations).
    - Exposes APIs to check “is consent X valid?” at call‑time and to log revocations.
80. Refactor existing consent usage (tasks 64, 89, and related screens) to use the Consent Service instead of ad‑hoc flags on `fhir_patients`.
81. Extend provider credentialing beyond NPI:
    - DEA number capture and verification for prescribers.
    - Malpractice insurance capture (policy number, carrier, expiry) and periodic verification.
    - State medical board sanction checks where available.
    - Surface credential status in provider onboarding and admin views.

### C12. Financial tool rate limits, on/off‑ramps, and infra resilience

82. Implement **financial rate‑limiting layer** for payment tools:
    - Per‑session, per‑patient, and per‑day dollar limits.
    - Hard caps on number of payment intents / transfers that can be created via a single voice/chat session.
    - Alerting and blocking behavior when limits are exceeded.
83. Document and design **Circle on/off‑ramp and fiat conversion strategy**:
    - How USDC enters the system (who funds wallets; via which bank/rail).
    - How and when USDC is converted to fiat and paid out to providers/insurers.
    - Which entity is responsible for bank‑side compliance and reporting.
84. Implement alert routing and on‑call integration for critical financial and PHI alerts:
    - Define who gets paged for which classes of incidents.
    - Integrate with PagerDuty/OpsGenie (or equivalent) and link alerts to the runbooks from task 75.
85. Define an initial **failover and recovery strategy** for the primary database and key services:
    - RPO/RTO targets for financial data.
    - Whether multi‑region or hot‑standby replicas are used.
    - What happens to in‑flight payment flows during failover, and how to safely resume or reconcile them afterward.

### C13. Tax reporting and weight‑change auditability

86. Implement **provider earnings and tax reporting support** alongside Stripe Connect Express:
    - Track annual earnings per provider in the ledger so Stripe’s 1099‑K reporting can be reconciled.
    - Surface thresholds (e.g., \$600) and account status in provider dashboards and admin tools.
87. Add an **audit log for outcome‑based matching weight changes**:
    - Log who changed cost‑builder weights/penalties, when, old vs new values, and what outcome data was used to justify the change.
    - Make this history queryable for internal review and potential regulators/ethics boards.

---

## Part D — UX & Journeys Backlog

> Cross‑persona user journeys, high‑stakes screens, and UX quality bars (including accessibility and mobile‑first).

### D1. Cross‑persona journeys & empty states

UX‑1. Define end‑to‑end **provider onboarding journey**: invite/signup → credentialing → availability setup → Stripe Connect → first visit → payouts.  
UX‑2. Define end‑to‑end **patient journey**: first visit → consent → booking → matching → visit → payments → follow‑up surveys.  
UX‑3. Define end‑to‑end **admin journey**: clinic onboarding → configuring prompts/voice agent → monitoring → resolving incidents/disputes.  
UX‑4. Design **empty states** for provider, patient, and admin dashboards with guidance and primary CTAs.

### D2. Provider UX improvements

UX‑5. Redesign **match Accept/Decline** as a mobile‑first notification flow with single‑tap Accept and a secondary Decline path (with optional structured reason), instead of a dashboard‑only modal.  
UX‑6. Make the **cognitive load indicator** actionable: when “Heavy”, offer options to temporarily reduce incoming matches, block new bookings for the day, or contact support.  
UX‑7. Define **SOAP note sign‑off UX**:
  - Show LLM‑generated note vs provider‑edited version.
  - Add explicit “I have reviewed and approve this note” confirmation separate from Save.
  - Provide diff view of edits and store version history for liability/audit.  
UX‑8. Implement **Stripe Connect state‑aware UI** with state‑specific CTAs and help for “not started”, “pending identity”, “pending bank”, “restricted”, “active”, and “deactivated”.

### D3. Patient UX improvements

UX‑9. Specify **booking + waiting experience**:
  - ETA and progress messaging during “Finding a provider…”.
  - Clear explanation of what happens next and maximum expected wait.
  - Fallback behavior and messaging if no match is found within X minutes.  
UX‑10. Design **emergency egress safety screen**:
  - Prominent crisis hotline numbers and “Call 911” option.
  - Ability to continue or safely exit; no trapping states.
  - Copy/layout aligned with mental‑health safety best practices.  
UX‑11. Design **research consent UX**:
  - Plain‑language summary plus expandable full legal text.
  - Per‑data‑use acknowledgments (research, product improvement, etc.).
  - Confirmation receipt sent to patient and stored via Consent Service (C11).  
UX‑12. Define **patient financial timeline language**: use patient‑friendly labels like “What your insurance covered”, “What you owe”, “What you’ve paid”, “What’s in review” instead of claims jargon.

### D4. Admin / Ops UX improvements

UX‑13. Design **prompt sandbox UX**:
  - Simulate different patient personas and scripted scenarios (e.g., suicidal ideation, no‑show, complex billing).
  - Side‑by‑side comparison of two prompt versions.
  - Logging of test runs (who tested what, when, with which prompt version).  
UX‑14. Add **semantics to monitoring dashboard**:
  - Thresholds and color‑coding (normal / warning / critical) per metric.
  - Short explanations and recommended actions for each critical state.  
UX‑15. Extend **HIPAA access log viewer** with CSV/PDF export of filtered results for audits.  
UX‑16. Design **reasoning audit view** as a compliance surface:
  - Show what the LLM concluded, what data it used, what alternatives it considered, and final choice.
  - Show who reviewed or overrode the decision and when.  
UX‑17. Build **notification preferences center** where patients and providers control channels (email/SMS/push/voice) and topics, respecting HIPAA constraints on message content.

### D5. Error, loading, accessibility, mobile

UX‑18. Create a catalog and designs for critical **error states**:
  - Insurance verification failure, payment failure, payout dispute, claim submission error, matching timeout, etc.
  - For each, define patient/provider messaging, next steps, and escalation options.  
UX‑19. Define **async loading and progress patterns**:
  - Standard progress/feedback for long‑running operations (matching, eligibility, claims, payments).
  - “You can leave this screen, we’ll notify you” pattern where safe.  
UX‑20. Establish **accessibility baseline (WCAG 2.1 AA)** across all major flows:
  - Typography, contrast, focus states, keyboard navigation, screen‑reader behavior.
  - Add accessibility checks to UI reviews and automated tests where feasible.  
UX‑21. Create **mobile‑first layout specs** for key flows:
  - Booking, waiting, visit join, payments, consent, emergency egress, provider Accept/Decline.
  - Define breakpoints, bottom‑sheet patterns, and tap targets.

### D6. Prioritized high‑stakes flows

UX‑22. Produce detailed UX specs (copy, states, mobile/desktop) for the five highest‑impact flows:
  1) Patient booking + waiting  
  2) Provider accept/decline  
  3) Emergency egress  
  4) SOAP note sign‑off  
  5) Patient financial timeline  
UX‑23. Align the **design system** (components, patterns) with these high‑stakes flows so the same buttons, alerts, banners, timelines, and modals can be reused across personas.

---

## Part E — Cash‑Only Telehealth at $1B Scale

> Focused tasks to ensure cash‑only telemedicine (patient → provider via Stripe), matching, and voice transcription can realistically support \$1B+/year (~10M visits).

### E1. Core cash rail (patient → provider via Stripe)

CF‑1. Finalize **cash‑only payment rail spec** (Stripe‑only): document end‑to‑end flow (checkout → payment intent → confirmation → Connect payout) with states, errors, and retry behavior.  
CF‑2. Implement double‑entry **ledger integration for Stripe payments**: ensure every charge/refund maps to patient/provider ledger entries with idempotency keys.  
CF‑3. Implement **Stripe Connect payouts driven by ledger**: use provider ledger balances to trigger Connect transfers when `consult_sessions` move to `complete`, with idempotent triggers and safe rollback rules.  
CF‑4. Build **patient and provider cash “wallet” views** backed solely by ledger balances and entries (no direct Stripe/Circle table reads).  
CF‑5. Implement **financial reconciliation jobs for Stripe**: periodic jobs that reconcile Stripe charges/payouts vs ledger entries and flag discrepancies.

### E2. Matching & optimization for telemedicine scale

MATCH‑1. Complete **practitioner and slot data model**: finish and validate `practitioners`, `practitioner_licenses`, `provider_slots`, and `consult_sessions` schemas and indexes for high‑volume matching.  
MATCH‑2. Implement **availability rules → slots indexer**: background job that expands availability rules into `provider_slots` for N days ahead, and supports incremental updates.  
MATCH‑3. Implement **cost‑based matching engine** (cost‑builder + greedy/Hungarian solver) using wait time, specialty fit, license, provider load, and penalties.  
MATCH‑4. Implement **match request/status APIs** (`POST /api/matching/request`, `GET /api/matching/status`, `POST /api/matching/cancel`) shared by voice and app.  
MATCH‑5. Wire **Retell voice and patient app to matching**: update Retell tools and patient app flows so they create `match_requests` and consume `match_assignments` / `consult_sessions` instead of direct, ad‑hoc bookings.  
MATCH‑6. Implement **surge pricing and monitoring** for matching cells, wired into visit pricing and exposed in monitoring dashboards.

### E3. Clinical safety & robustness at high volume

SAFE‑1. Implement **emergency egress** from matching: use transcript‑derived risk signals to bypass matching and trigger warm handoff / emergency flows, logging all decisions.  
SAFE‑2. Implement **cognitive load balancing**: track high‑intensity encounters per provider and dynamically adjust cost‑builder weights to prevent burnout under load.  
SAFE‑3. Implement **reasoning audit trail for matches**: persist clinical cues, cost breakdowns, alternatives considered, and final assignment, tied to users and review actions.

### E4. Algorithm performance, batching, and slot freshness

SCALE‑ALG‑1. Add **batch size limits and Hungarian performance profiling**:
  - Cap batch sizes to safe thresholds (e.g., max N match_requests per batch).  
  - Measure and optimize Hungarian runtime under realistic loads (thousands of requests).  
  - Introduce dynamic batch interval or split‑batch strategies under load.  
SCALE‑ALG‑2. Replace nightly‑only slot indexing with **near‑real‑time slot updates**:
  - Trigger slot updates on booking/cancellation and availability changes.  
  - Ensure `provider_slots` reflects up‑to‑date capacity throughout the day to avoid overbooking.  

### E5. Infra, DB, and capacity planning

SCALE‑1. Migrate **matching + payments** to Postgres/Cockroach: move high‑write tables (consult_sessions, providers, ledger, claims) off SQLite with proper transactions and replication.  
SCALE‑2. Index and tune **hot queries** for matching and payments (match queue, slot lookup, ledger by account/date, session lookups).  
SCALE‑3. Implement **background workers and queues** for matching batches, reconciliation, payouts, and high‑latency external calls (Stedi/FHIR/Stripe).  
SCALE‑4. Run **load tests** for matching + payments at target scale (tens of thousands of daily bookings; thousands of concurrent visits) and tune configuration.  
SCALE‑5. Perform **LiveKit capacity planning and alerting**:
  - Verify plan and limits for ~2k+ concurrent rooms.  
  - Add dashboards and alerts for LiveKit room count, bandwidth, and error rates.  

### E6. LLM pipeline cost and throughput control

LLM‑1. Design **LLM workload queuing** for SOAP notes and clinical cue extraction so post‑session processing is fully async and back‑pressure aware.  
LLM‑2. Implement **aggregate LLM cost controls**:
  - Project daily/monthly token and cost budgets based on 10M annual visits.  
  - Add system‑level caps and alerts when approaching LLM budget limits.  
LLM‑3. Monitor and optimize **LLM throughput** for post‑session tasks (e.g., target sustained N LLM calls/sec with graceful degradation if exceeded).

### E7. Transcript storage and archival

TRANS‑1. Perform **transcript storage capacity planning** for voice + video transcripts at projected visit volume; estimate data growth and required storage classes.  
TRANS‑2. Implement **tiered storage / archival strategy**:
  - Keep recent transcripts in fast storage for operational use.  
  - Move older transcripts to cheaper archival storage while preserving compliance and discoverability.  

### E8. Outcome‑based matching optimization

MATCH‑OPT‑1. Implement **outcome‑based matching weight optimization**:
  - Use longitudinal outcomes (e.g., PHQ‑9/GAD‑7 improvement, satisfaction scores) to evaluate matching quality.  
  - Periodically adjust cost‑builder weights and penalties based on empirical outcomes, with audit logs of changes.  
MATCH‑OPT‑2. Implement a **provider reliability / ghosting penalty**:
  - Maintain a reliability score per provider based on no‑shows, late joins, early drops, and cancellations.
  - Feed this score into the cost‑builder so frequently ghosting providers are only selected as a last resort or are temporarily excluded.

### E9. UX for cash + matching flows (high‑stakes)

UX‑CASH‑1. Design **patient booking + waiting journey** (mobile‑first) with clear expectations, ETA, and fallback behavior.  
UX‑CASH‑2. Design **provider accept/decline flow** optimized for mobile notification use, integrated with the matching engine.  
UX‑CASH‑3. Design **patient financial timeline** specifically for cash‑only flows, using plain‑language labels and surfacing payments, refunds, and outstanding balances.  
UX‑CASH‑4. Design **provider earnings and payout view** tied to ledger and Stripe Connect states, showing per‑visit and aggregate earnings and payout status.

### E10. Matching performance, sharding, and supply‑side incentives

SCALE‑ALG‑3. Implement **concrete batch capping and sharding for Hungarian**:
  - Define a maximum safe batch size (e.g., up to a few hundred pairs) based on profiling.  
  - Shard oversized batches by specialty, geography, or time window before building matrices.  
  - If a shard still exceeds the cap, split it into sub‑batches within the same 3‑minute cycle.  
MATCH‑INCENT‑1. Implement **provider supply‑side surge incentives**:
  - When wait times or unmatched demand in a matching cell exceed thresholds, increase per‑visit provider payouts (within legal/contractual bounds) via the ledger.  
  - Surface active multipliers and incentives clearly in provider dashboards to attract more log‑ins when needed.



