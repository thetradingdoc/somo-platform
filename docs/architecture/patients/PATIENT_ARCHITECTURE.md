# Patient Architecture — Voice, Chat, UI & Session

**Last Updated:** March 2026

Merged from: PATIENT_VOICE_BOOKING_ARCHITECTURE, TRIAGE_SESSION_SCOPE, PATIENT_UI_SOURCE_OF_TRUTH.

---

## 1. 9-Step Patient Booking Flow

```
1. Multi-Modal Front Door (Voice + Chat) → Kelly/Orchestrator
2. Case Report (OPQRST) → Triage
3. Triage & Lane (Emergency | Sync Video | Async)
4. Availability Matching → Slots
5. Payment Gate
6. Reminders (24h, 1h, tech check)
7. Telemedicine Encounter (LiveKit)
8. Case Report & Handoff
9. Feedback Loop
```

**Entry Points:** `POST /api/patient/triage/message`, Retell WebSocket → `handlePatientTriageMessage`. Kelly (LLM) primary; PatientOrchestrator fallback.

---

## 2. Triage Session Scope (orch-13)

| Storage | Key | Purpose |
|--------|-----|---------|
| sessionStorage | `patient_triage_state_v1` | triageState (session_id, flow_state) — **tab-scoped** |
| localStorage | `patient_session_id` | Portal auth |
| Server (DB) | `patient_orchestrate_sessions` | Canonical session |

**Resumability:** Same tab ✅; New tab/refresh ❌ (sessionStorage cleared). Recommendation: store `session_id` in localStorage for cross-tab resume.

---

## 3. Patient Portal UI — Source of Truth

**Reference:** `unified-dashboard/patients/patient-dashboard.html`

**Layout:** Fixed sidebar (260px), main content. Theme: `--primary: #1e40af`.

**Sidebar nav (6 items):** Dashboard, My Benefits, My Wallet, Bills & Claims, Appointments, My Records.

**Pages to align:** patient-dashboard, appointments, wallet, my-records, onboarding, triage — all use same shell, theme, footer ("Patient Account").
