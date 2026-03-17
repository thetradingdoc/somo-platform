### Still‑pending items (by section)

#### 12.1 Identity & session hardening

- **12.1.1**: Document the lifecycle of `patient_portal_sessions` vs `patient_sessions` (creation, renewal, expiry, logout) in architecture/docs.  
- **12.1.3**: Use the new `ip_address` / `user_agent` columns on `patient_portal_sessions` to:
  - Actually persist IP/UA on send/verify.
  - Add detection/alerts for suspicious patterns (multiple countries/IPs, spikes).  
- **12.1.4**: Implement a **soft lock** mechanism per email/IP after N failed verification attempts (beyond the existing rate limiter).

#### 12.2 Security & compliance posture

- **12.2.1**: Perform the actual **threat‑model exercise** and record concrete findings/TODOs.  
- **12.2.3**: Integrate **antivirus/content scanning** into patient uploads (both `/upload` and `/api/patient/documents`) and wire clear patient/staff error paths for blocked files.

#### 12.3 Resilience & UX guardrails

- **12.3.1**: Wire `showPatientAlert` (global alert helper) into all patient pages:
  - Replace ad‑hoc `alert`/generic messages with consistent, patient‑friendly banners for API/network/validation/payment/video errors.  
- **12.3.2**:
  - Implement explicit LiveKit‑down fallback logic and logging/alerting (banner + operational procedure).
  - Implement explicit payment‑processor‑down behavior (block new payments + patient messaging + alerts).

#### 12.4 Observability, metrics, alerts

- **12.4.1**:
  - Propagate `journey_id` (or `call_id`) from **voice intake → checkout → email links → portal session → case-report**; today it’s only partially handled (payments + video logs).  
- **12.4.2**:
  - Add metrics for:
    - Login attempts vs successes.
    - Onboarding step completion funnel.
    - Video token success/failure.
    - Case‑report generation success/failure.  
- **12.4.3**:
  - Implement dashboards (e.g., Grafana/Datadog) and alerts (outside the codebase) using those metrics and logs.

#### 12.5 Feature‑flags & rollout governance

- **12.5.1**:
  - Fully gate case‑report UI and provider navigation behind `FEATURE_PATIENT_CASE_REPORT`.
  - Optionally add backend checks that reject requests when flags are off (for safety).  
- **12.5.2**:
  - Extend the new `feature-flags.html` admin page to:
    - Manage **per‑clinic** overrides (using the existing `feature_flags` table shape).
    - Show more explicit **audit details** (who changed what, when), beyond the basic backend audit log.

#### 12.6 Data quality & reconciliation

- **12.6.2** Backfill scripts:
  - Write and run concrete migration scripts to:
    - Safely set `profile_verified` / `insurance_verified` for trusted, staff‑entered patients.
    - Link older `appointments` to `patient_id` where possible (e.g., via email/phone match), and record what was changed.

#### 12.7 Automated testing

- **12.7.1**: Add and run Jest (or equivalent) unit tests for:
  - `FHIRService.mergePatients`.
  - `PatientPortalService.verifyCode`.
  - `PaymentProcessorService.completePaymentSuccess`.  
- **12.7.2**: Add Playwright/Cypress E2E tests for:
  - Full happy path (voice checkout → portal login → onboarding → pay → video → case report).
  - Key negative flows (invalid codes, payment failure, unauthorized appointment/video access).  
- **12.7.3**: Wire these tests into CI and make them gate deploys.

#### 12.8 Performance & scale

- **12.8.1**: Run and analyze **load tests** (k6/Locust/etc.) for:
  - Login, onboarding, appointment viewing, payment, video token endpoints.  
- **12.8.2**: Run **Lighthouse/PageSpeed** on the main patient pages and:
  - Defer non‑critical scripts.
  - Add lazy‑loading or other optimizations for heavy sections (case reports, large document lists) as needed.