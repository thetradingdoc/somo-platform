# Telehealth Patient Portal — MVP TODOs

This is the consolidated backlog for making the patient portal production-ready as a **telehealth portal**:

- login
- appointments (join/reschedule/cancel)
- payments (simple invoices/links + receipts)
- records/documents

---

## Legend

- **P0**: must-have to avoid trust/security failures
- **P1**: must-have to reduce support burden / improve reliability
- **P2**: important polish / scale readiness

---

## P0 — Trust, Security, and Core Flows

- **mvp-2** ✅ Done: Remove Wallet from patient MVP (no fintech UI until server-truth)
- **mvp-3** ✅ Done: Remove localStorage-seeded `$3000` and any placeholder money/insurance numbers
- **mvp-4** ✅ Done: Eliminate `session_id` in URLs; use `x-session-id` everywhere; centralized 401→logout+redirect
- **mvp-5** ✅ Done: After login always land on **Appointments (Today view)**; core actions: join/reschedule/cancel/pay
- **mvp-6** ✅ Done: Video join security: use `/api/livekit/patient/video/token` only; prevent arbitrary room joins
- **mvp-15** ✅ Done: Appointment context + state-aware UI (upcoming/live/completed/canceled; join-window; missed state)
- **mvp-18** ✅ Done: Payment UX: why paying, paid/unpaid/refunded, receipt visibility, failure handling + retry
- **mvp-22** ✅ Done: Backend appointment lifecycle state machine (scheduled→confirmed→paid→completed→documented/canceled)
- **mvp-23** ✅ Done: Backend payment lifecycle (pending→success/failed→refunded) with enforced transitions
- **mvp-24** ✅ Done: Receipt model + storage + patient endpoint `GET /api/patient/receipts`
- **mvp-25** ✅ Done: Reconciliation guarantees (payment success updates appointment payment_status) + idempotency hardening
- **mvp-26** ✅ Done: Time-based join window enforcement + expired appointment handling + timezone normalization
- **mvp-27** ✅ Done: Fine-grained authorization per resource (session→patient→appointment/docs) across all routes
- **mvp-32** ✅ Done: Backend schema/data validation at API boundaries (emails, IDs, appointment times, payload shapes)
- **mvp-33** ✅ Done: Backend idempotent write operations beyond payments (cancel/reschedule/upload)
- **mvp-34** ✅ Done: Backend soft delete + audit trail (deleted_at + exclude deleted by default + immutable audit log) for appointments/payments/receipts/documents
- **mvp-35** ✅ Done: Session expiration + expiry UX (TTL/inactivity timeout + “session expired” messaging)
- **mvp-36** ✅ Done: OTP abuse protection (rate limit verify/send + verify/confirm; IP+email throttling)
- **mvp-37** ✅ Done: PHI protection audit (enforced): no request-body logging, redaction hooks for telemetry, no PHI stored in client storage beyond session token, and all sensitive access is audited
- **mvp-38** ✅ Done: Tighten CORS/origin restrictions to known domains/environments
- **mvp-58** ✅ Done: Security: content security policy + security headers hardening (CSP, HSTS, clickjacking, referrer policy)
- **mvp-59** ✅ Done: Security: session storage strategy upgrade (prefer httpOnly SameSite cookies; CSRF plan if cookies)

---

## P1 — Reliability, Document Safety, and Patient Confidence

- **mvp-1** ✅ Done: Unify navigation into one mobile-first model (bottom tabs); remove sidebar/bottom-nav duplication
- **mvp-7** ✅ Done: Payments MVP: receipts/success UX + appointment status refresh after payment
- **mvp-8** ✅ Done: Records/documents MVP: unify records + documents page; empty/error states; patient-scoped responses
- **mvp-10** ✅ Done: Mobile-first UI standards (44px targets, no horizontal scroll at 320px, one-thumb primary actions)
- **mvp-11** ✅ Done: Shared patient client layer (`patientApi`, `patientSession`, `patientShell`) to stop page drift
- **mvp-14** ✅ Done: Global system feedback layer (banners/toasts, retry states, skeletons, offline detection)
- **mvp-16** ✅ Done: Video UX: pre-join (preview/mic/device), in-call fallback, exit state → summary/records
- **mvp-17** ✅ Done: Records UX: clinical grouping + visit metadata + next-steps guidance
- **mvp-19** ✅ Done: Home-state decision enforced (Appointments Today) + strong “no appointments” CTA
- **mvp-20** ✅ Done: Persistent support/escape hatch (Help + clinic contact + payment/video/missed-visit flows)
- **mvp-60** ✅ Done: Support config: clinic contact info sourced from backend/tenant config (phone/email/hours)
- **mvp-21** ✅ Done: Patient guidance layer (microcopy/tooltips + educational empty states)
- **mvp-28** ✅ Done: Refresh strategy (polling/auto-refresh) for appointment/payment updates; realtime optional later
- **mvp-39** ✅ Done: Secure document delivery via signed URLs (no raw paths)
- **mvp-61** ✅ Done: Documents: download endpoint + authorization + audit (e.g. `/api/patient/documents/:id/download` → signed URL)
- **mvp-40** ✅ Done: Upload constraints (size/type/magic bytes; malware scanning MVP)
- **mvp-41** ✅ Done: Document lifecycle states (uploaded/processing/available/failed) surfaced to patient UI
- **mvp-42** ✅ Done: Timezone normalization rule explicitly documented and enforced end-to-end (store UTC, render local)
- **mvp-43** ✅ Done: Grace periods policy (early/late join windows, missed rules)
- **mvp-44** ✅ Done: Retry strategy (GET safe retries; POST only when idempotent)
- **mvp-45** ✅ Done: Circuit breaker / fail-safe UI states (video token failure fallback; payment isolation)
- **mvp-46** ✅ Done: Graceful degradation so one subsystem failing doesn’t break the portal
- **mvp-47** ✅ Done: Patient notifications (email MVP): scheduled/rescheduled/canceled + reminders
- **mvp-48** ✅ Done: Post-visit notification: “your summary is ready” → records
- **mvp-49** ✅ Done: Ownership edge cases (multiple emails/phone mismatch) + canonical identity mapping rules
- **mvp-50** ✅ Done: Multi-appointment handling (same-day multiple, overlaps, multiple providers)
- **mvp-51** ✅ Done: Enforce payment↔appointment linking (no orphan payments; appointment_id required)
- **mvp-57** ✅ Done: Accessibility: WCAG basics (contrast, focus, keyboard nav, screen reader labels, reduced motion)

---

## P2 — Observability, Testing, Scale, and Ops

- **mvp-9** ✅ Done: Remove/defer non-MVP pages/features (Schedule/Benefits/Claims/Connect if referenced)
- **mvp-12** ✅ Done: E2E QA across iOS/Android breakpoints for critical flow (login→appts→video→pay→records)
- **mvp-13** ✅ Done: Metrics/journey logging (login, video token, payment success, records generation)
- **mvp-29** ✅ Done: Observability: structured logs per session/journey; payment/video audit logs; error tracking hooks
- **mvp-30** ✅ Done: Standardize API envelope + error codes across patient/payment/video endpoints
- **mvp-31** ✅ Done: API versioning strategy (`/api/v1`) plan for mobile app + integrations
- **mvp-52** ✅ Done: Internal/admin visibility layer for sessions/appointment states/payment logs (admin-only)
- **mvp-53** ✅ Done: E2E test coverage for critical flows (incl payment failure + session expiry)
- **mvp-54** ✅ Done: Mobile viewport QA automation (320/375/430)
- **mvp-55** ✅ Done: Env separation (dev/staging/prod) with separate DB + keys
- **mvp-56** ✅ Done: Secrets management (env/vault), no secrets in code or client bundle
- **mvp-62** ✅ Done: Data retention & deletion policy (sessions/logs/documents/records; account deletion request handling)
- **mvp-63** ✅ Done: Performance budgets + monitoring (mobile load targets, Lighthouse baseline + regression checks)

---

## Production Readiness — Remaining Tasks (Blockers)

These are the remaining items to call this **production-ready** (beyond the MVP checklist above).

### Compliance / Auditability

- **mvp-64**: Implement **soft delete** across patient-facing entities (appointments, payments/checkouts, receipts, documents, records) with `deleted_at` + “exclude deleted by default”
- **mvp-65**: Add **immutable audit trail** table for patient-sensitive events (login, appointment changes, payment lifecycle changes, document upload/download) with `{actor_type, actor_id, patient_id, resource_type, resource_id, action, metadata, created_at}`
- **mvp-66**: Complete **PHI protection audit** (mvp-37) as an enforceable checklist:
  - scrub PHI from logs (request bodies, errors)
  - ensure no PHI in URLs
  - ensure client storage contains no PHI beyond session token
  - confirm backups/encryption at rest policy

### Documents (Real production storage)

- **mvp-67** ✅ Done: Replace in-memory document download tokens with a **durable** store (DB table) + one-time use + revocation
- **mvp-68** ✅ Done: Move patient document storage to **cloud blob** (S3/Azure Blob) + signed URLs from the storage provider
- **mvp-69** ✅ Done: Add **malware scanning pipeline** (quarantine → scan → available/failed) and surface lifecycle status to UI
- **mvp-70** ✅ Done: Add per-tenant **document retention policy** (auto-expire documents after N years where appropriate) + export on request

### Security hardening (prod only)

- **mvp-71** ✅ Done: Finalize cookie-first session auth: CSRF strategy + enforce SameSite/secure + rotation plan
- **mvp-72** ✅ Done: Add environment-controlled **log level** + disable debug logging in production
- **mvp-73** ✅ Done: Add WAF / bot protections for public endpoints (rate limit tuning, IP reputation optional)

### Reliability / Scaling

- **mvp-74** ✅ Done: Make notification sending reliable: retry queue + dead-letter + admin visibility for failures
- **mvp-75** ✅ Done: Make reminder scheduler safe for multi-instance deployment (leader election / single-run job)
- **mvp-76** ✅ Done: Add DB migrations/versioning safety (fail fast if schema mismatch; backup before migrate in prod)

### Monitoring / Alerting

- **mvp-77** ✅ Done: Add real error tracking in production (Sentry/AppInsights) with PII/PHI scrubbing rules
- **mvp-78** ✅ Done: Add operational dashboards + alerts for: login failures, OTP abuse, payment failures, video token failures, doc download failures

### QA / Release gates

- **mvp-79** ✅ Done: Add CI gates: run unit tests + Cypress + perf budgets + retention script dry-run
- **mvp-80** ✅ Done: Add staging deploy + smoke test runbook (manual checklist for video join/payment/docs)

---

## FHIR-first Interop (Required for interoperability)

This section tracks the work to make the patient portal **FHIR-first** for interoperability (share/fetch clinical data via standard FHIR resources and APIs). Video calls remain **LiveKit-first** (FHIR is for clinical data, not token minting).

### Foundation (source of truth + mapping)

- **mvp-fhir-1**: Choose the FHIR **source of truth** strategy:
  - **A**: Real FHIR R4 server (Azure FHIR / HAPI) is canonical, or
  - **B**: Implement a fully compliant FHIR R4 REST facade over our DB (less preferred).
- **mvp-fhir-2**: Define canonical FHIR resource set for the portal:
  - `Patient`, `Appointment`, `Encounter`, `DocumentReference`, `DiagnosticReport`, `Binary` (or `Attachment.url` pattern).
- **mvp-fhir-3**: Write the field mapping spec (internal → FHIR) + required extensions:
  - appointment lifecycle → `Appointment.status` / `Encounter.status`
  - documents → `DocumentReference.content.attachment`
  - visit summary → `DocumentReference` and/or `DiagnosticReport`
  - payments → `Invoice` / `ChargeItem` / `PaymentNotice` (or keep non-FHIR but link via extensions).

### Patient API endpoints become FHIR-backed (no internal tables as primary)

- **mvp-fhir-4**: Make `GET /api/patient/profile` read from FHIR `Patient` (session → patient reference).
- **mvp-fhir-5**: Make `PUT /api/patient/profile` update FHIR `Patient` using proper patch/update semantics and validation.
- **mvp-fhir-6**: Make `GET /api/patient/appointments` read from FHIR `Appointment` and/or `Encounter` (summaries derived from FHIR).
- **mvp-fhir-7**: Make appointment “complete” create/update the FHIR `Encounter` + link to resulting documentation resources.
- **mvp-fhir-8**: Make `GET /api/patient/my-records` read from FHIR `DocumentReference` and/or `DiagnosticReport` (not DB tables).
- **mvp-fhir-9**: Make documents metadata FHIR-backed:
  - `GET /api/patient/documents` returns `DocumentReference`-derived data.
- **mvp-fhir-10**: Make patient document upload create FHIR resources:
  - create `Binary` (or external `Attachment.url`)
  - create `DocumentReference` referencing the attachment
  - link to `Encounter`/`Appointment` where applicable.
- **mvp-fhir-11**: Make patient document download resolve via FHIR:
  - `DocumentReference/{id}` is canonical metadata
  - content resolves to `Binary/{id}` or `Attachment.url` via signed URL/token.

### Frontend becomes API-first (no direct `/fhir/*` browser calls)

- **mvp-fhir-12**: Remove all direct browser calls to `/fhir/Patient?...` from patient UI pages.
- **mvp-fhir-13**: Add `GET /api/patient/me` bootstrap endpoint (minimal safe fields: patient id + display name) and use it across pages.
- **mvp-fhir-14**: Ensure patient UI stores **no PHI** (email/phone) and never relies on PHI in client storage for lookups.

### FHIR R4 REST surface (required for interoperability)

- **mvp-fhir-15**: Implement `/fhir/metadata` CapabilityStatement for supported resources/interactions.
- **mvp-fhir-16**: Implement/complete FHIR R4 endpoints with correct status codes + `OperationOutcome` errors:
  - `Patient`, `Appointment`, `Encounter`, `DocumentReference`, `DiagnosticReport` (and `Binary` if used).
- **mvp-fhir-17**: Implement core FHIR search params we rely on:
  - `Patient?name=`, `Patient?telecom=`, `Patient?email=` (FHIR-consistent telecom/email strategy)
  - `Appointment?patient=`
  - `Encounter?patient=`
  - `DocumentReference?patient=`
  - `DiagnosticReport?patient=`
- **mvp-fhir-18**: Support FHIR paging and common modifiers where required (`_count`, basic sorting, `_since`/`_lastUpdated` as needed).
- **mvp-fhir-19**: Implement `Binary` strategy (choose one):
  - `Binary` resources stored in FHIR server, or
  - use external storage + signed `Attachment.url` with short TTL (still FHIR-compliant).

### Authorization & scopes (SMART-style)

- **mvp-fhir-20**: Define and enforce SMART-style scopes for patient access (at minimum internally):
  - `patient/Patient.read`
  - `patient/Appointment.read`
  - `patient/Encounter.read`
  - `patient/DocumentReference.read`
  - `patient/DiagnosticReport.read`
- **mvp-fhir-21**: Enforce resource-level authorization at the FHIR layer:
  - patient can only access resources referencing them (`subject`/`patient` references).
- **mvp-fhir-22**: Decide external OAuth2 strategy for 3rd-party interoperability (SMART-on-FHIR):
  - token issuance, audience, scopes, rotation, revocation.

### Migration plan (internal tables → FHIR, with safety)

- **mvp-fhir-23**: Create migration/backfill plan for `appointments` → FHIR `Appointment` (+ `Encounter` on completion).
- **mvp-fhir-24**: Create migration/backfill plan for `patient_documents` → FHIR `DocumentReference` (+ `Binary`/`Attachment.url`).
- **mvp-fhir-25**: Create migration/backfill plan for visit summaries (`diagnostic_reports`/notes) → `DiagnosticReport` and/or `DocumentReference`.
- **mvp-fhir-26**: Implement dual-write period (temporary):
  - write both internal + FHIR until cutover.
- **mvp-fhir-27**: Implement cutover + verification:
  - counts match, sampling, referential integrity (patient/encounter references), rollback plan.

### Records normalization (Encounter-linked)

- **mvp-fhir-28**: Decide the canonical “visit summary” representation:
  - `DocumentReference` (PDF/HTML) and/or `DiagnosticReport` (structured), and document the rule.
- **mvp-fhir-29**: Ensure every record links to a visit:
  - `DocumentReference.context.encounter` and/or `DiagnosticReport.encounter`.

### Interop-safe file delivery

- **mvp-fhir-30**: Replace “download by internal doc id” patterns with FHIR references:
  - the canonical id is `DocumentReference.id`
  - download resolves to `Binary` or `Attachment.url` with short TTL.
- **mvp-fhir-31**: Ensure attachments never leak PHI via URLs:
  - signed URLs + one-time tokens + short TTL
  - no raw storage paths.

### Auditability & monitoring for FHIR access

- **mvp-fhir-32**: Emit immutable audit events for FHIR operations:
  - `fhir.read`, `fhir.search`, `fhir.create`, `fhir.update`, `fhir.download`
  - include `{actor_type, actor_id, patient_id, resource_type, resource_id, action}`.
- **mvp-fhir-33**: Add admin-only visibility endpoint for FHIR audit trails (patient-scoped query + recent events).

### Testing & conformance gates

- **mvp-fhir-34**: Add contract tests validating FHIR JSON shapes and `OperationOutcome` error responses.
- **mvp-fhir-35**: Add an “interop smoke test” script:
  - search Patient by telecom/email
  - fetch Appointment/Encounter/DocumentReference/DiagnosticReport for patient
  - download attachment via Binary/URL
- **mvp-fhir-36**: Add a release gate that fails if:
  - `/fhir/metadata` is missing/invalid
  - required searches return invalid shapes
  - unauthorized FHIR access is not blocked.

### Missing interop essentials (profiles, terminology, consent, provenance, export)

- **mvp-fhir-37**: Publish supported **profiles** in `CapabilityStatement` and enforce them where required (at minimum document which profiles you conform to).
- **mvp-fhir-38**: Add `/fhir/$validate` (or equivalent validation hook) for key resources (`Patient`, `Appointment`, `Encounter`, `DocumentReference`, `DiagnosticReport`) and fail writes that are not valid FHIR.
- **mvp-fhir-39**: Add `StructureDefinition`/`CodeSystem`/`ValueSet` hosting strategy (even if minimal) for any required custom extensions and coded fields.
- **mvp-fhir-40**: Implement/standardize **terminology** handling:
  - consistent coding systems (LOINC/SNOMED/ICD-10/CPT where applicable)
  - avoid “free-text only” in clinical resources where codes are expected.
- **mvp-fhir-41**: Implement `Provenance` (or equivalent) for writes that create/modify patient-facing clinical data (who/when/source).
- **mvp-fhir-42**: Implement `Consent` (or equivalent policy) and enforce it for data sharing/export to 3rd parties.
- **mvp-fhir-43**: Implement patient-compartment scoping rules explicitly:
  - enforce `patient=Patient/{id}` reference scoping for searches
  - forbid cross-patient reads even if IDs are guessed.
- **mvp-fhir-44**: Attachment/Binary safety:
  - if using `Binary`: protect access with auth + scopes and never expose raw IDs without authorization checks
  - if using `Attachment.url`: ensure URLs are short-lived signed links and don’t embed PHI.
- **mvp-fhir-45**: Add `GET /fhir/Patient/{id}/$everything` (optional but common interop expectation) or document why it’s not supported.
- **mvp-fhir-46**: SMART-on-FHIR launch readiness checklist:
  - `.well-known/smart-configuration`
  - OAuth2 endpoints, token introspection/rotation policy
  - scope → resource access mapping tests.
- **mvp-fhir-47**: Bulk export strategy (if required by customers):
  - FHIR Bulk Data `$export` (or a documented alternative) with job tracking + audit + consent gating.
