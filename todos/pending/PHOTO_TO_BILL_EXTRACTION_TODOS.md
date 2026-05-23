# Photo to Bill Extraction Todos

Last reviewed: May 5, 2026
Status: pending

This plan is ordered by dependency. Do not skip order unless explicitly marked parallel-safe.

## Phase 1 - Security and Runtime Guardrails (Blocking)

- [ ] Rotate exposed `OPENAI_API_KEY` and revoke old key.
- [ ] Rotate exposed Google service account credentials and revoke old key material.
- [x] Remove `.env.bak2` from tracking and tighten ignore patterns for backup env files.
- [x] Decide and document one runtime GCP auth strategy for middleware:
   - `GOOGLE_APPLICATION_CREDENTIALS` (file path), or
   - `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON env secret).
   - Decision (current): use `GOOGLE_SERVICE_ACCOUNT_KEY` JSON secret in runtime env for middleware GCS access, then migrate to `GOOGLE_APPLICATION_CREDENTIALS` only when secret-manager/file-mounted flow is in place.

## Phase 2 - Backend Storage and Extraction Core

- [x] Define billing storage contract using existing `patient_billing_documents` shape:
   - canonical `storage_ref` format (for example `gcs://bucket/key`)
   - provider/bucket/key mirrored in `metadata_json` (or add migration if columns are preferred).
- [x] Add `middleware-platform/services/gcs-billing-storage.js`:
   - `uploadBuffer({ buffer, contentType, patientId, fileName })`
   - return `{ storageRef, bucket, key, provider }`
   - local fallback for development.
- [x] Update `POST /api/patient/billing/documents` to support both:
   - existing JSON metadata requests
   - new multipart upload requests with image/pdf bytes.
- [x] On multipart path, upload bytes to GCS and persist `storage_ref` + metadata (mime, size, filename).
- [x] Create billing OCR parser module:
   - input: raw OCR text
   - output: `provider_name`, `service_date`, `amount_cents`, `document_type`, `confidence_score`, `status`.
- [x] Update `POST /api/patient/billing/documents/:documentId/extract`:
    - load document bytes (or buffer) from `storage_ref`
    - call `patient-document-extraction.extractText(...)`
    - call billing parser
    - persist extraction artifacts in billing document metadata.
- [x] Persist raw extraction text/method to `patient_document_extracts` using existing migration/table.
- [x] Add server-side amount guardrails:
    - non-negative
    - explicit upper bound
    - stable error response contract.

## Phase 3 - Mobile Camera and Upload

- [x] Install camera dependencies in `patient-app`:
    - `expo-camera`
    - optionally `expo-image-picker` for fallback/import.
- [x] Implement real camera capture in `patient-app/app/capture-scan.tsx`:
    - permission flow
    - capture result URI + mime + size
    - remove hardcoded stub file values.
- [x] Resolve crop behavior for v1:
    - implement true crop pipeline, or
    - relabel UI to preview/confirm if crop is not shipping yet.
- [x] Update `patient-app/lib/billing-capture.ts` + scan flow to send multipart upload bytes for document creation.
- [x] Rework client quality checks to run against real capture data instead of synthetic placeholders.

## Phase 4 - Testing and Reliability

- [x] Fix Playwright auth bootstrap for Expo web + SecureStore session retrieval.
- [x] Re-run and stabilize capture route e2e:
    - `scan -> review -> complete`.
- [x] Add backend extraction tests:
    - happy path OCR parse
    - low confidence path (`needs_review`)
    - missing amount/date handling.
- [x] Add storage adapter tests for GCS behavior (and local fallback path).

Parallel-safe note: Task 18 can run in parallel with Phase 2 backend work.

## Phase 5 - Docs and Rollout

- [ ] Update env templates with required billing + GCS variables (template values only).
- [ ] Add/refresh runbook for photo-to-bill extraction operations:
    - upload failures
    - OCR fallback behavior
    - entitlement interactions
    - recovery steps.
- [ ] Execute staged rollout checks (internal -> beta -> public) with billing test suite gates.
- [ ] Perform physical device validation:
    - real photo
    - upload
    - OCR extraction
    - review edit
    - confirm
    - appears in Timeline and Money.

## Review Fixes (2026-05-05)

- [x] Return `amount_cents` as `null` when missing in billing OCR parser.
- [x] Return `service_date` as `null` when missing (no fabricated current date).
- [x] Update amount regex to support whole-dollar values.
- [x] Fix document type classification so PDF mime does not force `eob`.
- [x] Fix web multipart file upload path in `billing-capture.ts`.
- [x] Clear localStorage fallback keys in `clearPatientSession`.
- [x] Add local fallback file cleanup in GCS storage unit test.
- [x] Add typed API errors with HTTP status/code propagation.
- [x] Improve non-JSON API error handling signal.
- [x] Add request timeout support to patient API calls.
- [x] Add upload buffer size cap in `gcs-billing-storage`.
- [x] Add client-side amount cap in capture review submit path.
- [x] Configure camera plugin with `microphonePermission: false`.
- [x] Remove `expo-image-picker` plugin/dependency from current v1 scan scope.
- [x] Set Android cleartext traffic disabled in app config.

---

## Phase 6 — Timeline billing-first redesign

Source: `timeline_todo_review.html` (merged May 2026). Priority legend: **P0** ships broken / **P1** blocks real use / **P2** visible gap / **Gap** missing from earlier specs.

### Routing (P0 — fix first)

- [x] **R1** — Add `patient-app/app/(tabs)/timeline.tsx`: `export { default } from './journal'` so the Timeline tab resolves to the billing timeline (not Shelf).
- [x] **R2** — Add `money.tsx` and `profile.tsx`: `profile.tsx` → re-export `insights`; `money.tsx` → stub or real Money screen (same pattern as `calendar.tsx` / `products.tsx`).
- [x] **R3** — Verify `router.push('/(tabs)/timeline')` from `home.tsx` after R1; add to manual QA checklist. *(Home action cards use `/(tabs)/timeline`; see Q1 matrix.)*

### Backend — calendar API (P1 core; P2 tests / optional)

- [x] **B1** — Extend `GET /api/patient/journal/calendar-range` to join `patient_billing_events` on `service_date` (aggregated over range). Per day return e.g. `has_due`, `has_paid`, `event_count`, `due_cents`, `paid_cents`; preserve all existing routine fields. No N+1 per day. *(Implemented: single `GROUP BY service_date` query; per-day fields `billing_has_due`, `billing_has_paid`, `billing_all_paid`, `billing_event_count`, `billing_due_cents`, `billing_paid_cents`, `billing_visual`; `model_version` 2; billing-only users get full `days` when `has_template: false`.)*
- [x] **B2** — Define and implement behavior for **null `service_date`** on events (exclude from day keys or separate bucket); document for frontend. *(Excluded from calendar aggregates; described in response `billing_calendar_contract.null_service_date_behavior`.)*
- [x] **B3** — Define **priority rule** when multiple events share a day (e.g. any due → due styling; all paid → paid; mixed → document rule). *(Same as mobile `billingVisualForDay`; documented in `billing_calendar_contract.day_status_priority` and `lib/billing-calendar-agg.js`.)*
- [x] **B4** — Add index on `(session_id, service_date)` (and patient variant if used) if missing for calendar-range performance. *(Added `idx_billing_events_session_service_date`, `idx_billing_events_patient_service_date` in `ensureBillingTables`.)*
- [x] **B5** (P2) — Tests: range boundaries, empty billing, mixed statuses, null dates, timezone, billing-only vs routine-only vs both. *(Unit tests for aggregate → `billing_visual` mapping in `__tests__/billing-calendar-agg.test.js`; contract script `check:patient-journal-calendar-range` extended for `model_version` ≥ 2.)*
- [ ] **B6** (P2, optional v1.1) — Per-day `document_days` from `patient_billing_documents.created_at` (“captured on”) separate from `service_date`; defer until B1–B4 stable. **Deferred by design.**

### Frontend — stats row, banners, calendar chrome (P1; P2 polish)

- [x] **F1** — Replace routine stats with billing stats: **Bills due / Owed this month / Paid this month** (one round-trip preferred: extended calendar-range or billing APIs).
- [x] **F2** — Remove “No active routine template” from Timeline; billing-first empty state → “Capture your first bill” / `scan-entry`. Routine messaging stays on Routine only.
- [x] **F3** — Billing-colored day cells + dots + legend (due `#E6F1FB`/`#0C447C`, paid `#EAF3DE`/`#3B6D11`, today ring `#378ADD`; billing color priority when routine + billing overlap).
- [x] **F4** — Day tap opens **day detail** (billing events first; optional routine below). Stop sending every tap only to Routine when bills exist for that day.
- [x] **F5** (P2) — Unify segment labels web + mobile → recommended **Calendar | List | Documents** (Calendar default).
- [x] **F6** (P2) — Replace three pill chips with one **contiguous segmented control** (native `SegmentedControl` or single bordered row).
- [x] **F7** (P2) — Inline capture CTA on Timeline (`#E6F1FB` / `#85B7EB` / `#0C447C`) → `scan-entry`; clarify vs FAB.
- [x] **F8** (P2) — Typography: Timeline title sans vs display serif; align with billing theme tokens.

### Documents segment

- [x] **D1** — Split **billing documents** vs **routine photos** in Documents view (subsections or move routine media to Routine).
- [x] **D2** (P2) — Billing doc tiles: tap → preview/detail; surface OCR/parse status where available.

### List segment — persistence and styling

- [x] **L1** — Wire status pill changes to **server** (`PATCH` or existing billing update endpoint); remove toast-only local state. *(Requires `PATCH /api/patient/billing/events/:eventId` in middleware — added.)*
- [x] **L2** — Replace stub actions (Add/Edit, Link doc, Group episode) with real flows or hide until ready. *(Stubs removed; “Add another capture” → scan-entry.)*
- [x] **L3** (P2) — List row amount/badge colors: owed `#A32D2D`, paid `#3B6D11`, pending `#854F0B`; badge palette per redesign.

### Gaps (explicit follow-ups)

- [x] **G1** — **Web parity:** verify web Timeline uses the same enriched calendar API path as mobile; fix drift if not. *( `unified-dashboard/patients/schedule.html` consumes the same `calendar-range` payload; `classifyDay` + list filter honor `billing_visual` / `billing_event_count`.)*
- [x] **G2** — **Design tokens:** add named file (e.g. extend `billingTheme` or `TimelineColors`) for redesign hexes before shipping F1–F8. *(Added `constants/timelineTokens.ts`; extended `billingTheme.ts`.)*
- [x] **G3** — **Events ordering:** reconcile API `ORDER BY created_at` vs client sort by `service_date` (server sort option or stable merge) to avoid confusing order on refresh. *(Default `GET /api/patient/billing/events` sort: valid `service_date` descending, null/invalid dates last, then `created_at`; `?sort=created_at` preserves legacy ordering.)*
- [x] **G4** — **Accessibility:** concrete a11y spec — roles, legend `aria-label`, due/paid not color-only (icons/patterns). *(Journal: day cells include spoken billing status + counts; legend items labeled; decorative dots hidden from AT; segment `accessibilityHint`; inline list rows include amount + status.)*

### QA and documentation

- [x] **Q1** — Manual matrix: billing-only, routine-only, both, empty (calendar + empty states).
  - **Billing-only (no routine template):** `has_template: false`, full-range `days` with `billing_*` fields; calendar months from events + range; capture CTA works.
  - **Routine-only:** `has_template: true`, routine cells as before; billing fields zero/null when no events.
  - **Both:** routine + billing styling; billing visual wins over routine thumbnail (mobile + web).
  - **Empty:** no events, no template → neutral cells; empty list copy; Money/Profile unaffected.
- [x] **Q2** — Update architecture doc: Timeline = routine + billing; route map (`timeline.tsx`, `money.tsx`, `profile.tsx`); segment naming from F5.

#### Phase 6 architecture (snapshot)

- **Timeline tab** (`patient-app/app/(tabs)/timeline.tsx`) re-exports **Journal** (`journal.tsx`): segments **Calendar | List | Documents**; calendar loads `GET /api/patient/journal/calendar-range` plus `GET /api/patient/billing/events` and documents.
- **Money** (`money.tsx`): `GET /api/patient/billing/money-summary`.
- **Profile** (`profile.tsx`) → **Insights** (`insights.tsx`): account/subscription/privacy.
- **Calendar-range `model_version` 2:** each day includes routine fields plus `billing_*` aggregates and `billing_calendar_contract` documents null `service_date` and day priority rules.

### Phase 6 follow-ups — gaps / tech debt (review May 2026)

Parallel-safe unless noted.

- [x] **P6-T1** — **Integration tests** for `GET /api/patient/journal/calendar-range`: temp or fixture DB, assert aggregates vs seeded `patient_billing_events`, range boundaries, `has_template: false` full `days` length vs `range.days`. *(Implemented: `__tests__/patient-calendar-billing-query.integration.test.js` + shared `lib/patient-calendar-billing-query.js`.)*
- [x] **P6-T2** — **API compat:** document or gate **`has_template: false`** returning **full `days`** (was empty array historically); optionally support **`?include_empty_days=0`** or similar if any legacy consumer breaks. *(Query param `include_empty_days=0|false|no|off|legacy` → `days: []`; documented in `billing_calendar_contract` and `docs/architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md`.)*
- [x] **P6-T3** — **`GET /api/patient/billing/events` duplicates:** `LEFT JOIN patient_billing_event_documents` can return **multiple rows per event**; dedupe in SQL (`GROUP BY` / subquery) or aggregate document IDs — fixes list counts/order glitches. *(Subquery for latest `document_id` per event.)*
- [x] **P6-T4** — **Postgres / dual DB:** confirm patient billing + calendar routes are SQLite-only in prod; if Postgres mirror exists, **port calendar aggregation + indexes** or document single-source-of-truth. *(Documented in `docs/architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md`.)*
- [x] **P6-T5** — **Web UX (`schedule.html`):** replace raw **`billing_visual`** tokens in check-in list with human labels (**Bill due** / **Paid** / **Needs review**). *( `billingVisualHuman()`.)*
- [x] **P6-T6** — **A11y hardening:** add non-color cues on calendar cells (**icons / patterns**) beyond dots + VO labels for WCAG “not color-only.” *(Mobile: D / P / ! glyphs; web: same via `journal-day__bill-glyph`.)*
- [x] **P6-T7** — **Device QA:** calendar grid (**percentage cell widths + gap**) on small phones / RN Web — fix wrap/misalignment if observed. *(Journal grid: `width: 14.28%`, seven columns, removed horizontal `gap` to avoid wrap.)*
- [x] **P6-T8** — **Design decision:** Home tab header was resized to match billing tabs (**18 / 500**); revisit if Product wants **larger hero** title on Home only. *(Home title restored to **28 / 600** display font; other tabs unchanged.)*
- [x] **P6-T9** — **Canonical architecture:** promote Phase 6 snapshot from this file into a **repo-root or docs/`ARCHITECTURE.md`** (or link prominently from README) if that’s the team norm. *(Added [`docs/architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md`](../../docs/architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md); linked from root [`README.md`](../../README.md).)*
