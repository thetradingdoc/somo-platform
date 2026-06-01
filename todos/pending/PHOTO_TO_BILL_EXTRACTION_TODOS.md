# Photo to Bill Extraction Todos

**Last reviewed:** May 31, 2026  
**Status:** Phases 2–4 and Phase 6 (timeline) **complete** — **open:** Phase 1 key rotation, Phase 5 rollout

Backend capture, GCS storage, OCR parser, mobile camera, and timeline billing-first redesign are shipped. See completed sections in git history or prior archive notes.

---

## Open — Phase 1 (blocking before prod)

- [ ] Rotate exposed `OPENAI_API_KEY` and revoke old key — runbook: [`docs/runbooks/PHOTO_TO_BILL_KEY_ROTATION.md`](../../docs/runbooks/PHOTO_TO_BILL_KEY_ROTATION.md)
- [ ] Rotate exposed Google service account credentials and revoke old key material — same runbook

---

## Open — Phase 5 (rollout)

- [ ] Update env templates with required billing + GCS variables (template values only).
- [ ] Add/refresh runbook for photo-to-bill extraction operations (upload failures, OCR fallback, entitlement, recovery).
- [ ] Execute staged rollout checks (internal → beta → public) with billing test suite gates.
- [ ] Perform physical device validation: real photo → upload → OCR → review → confirm → Timeline + Money.

---

## Completed (reference)

<details>
<summary>Phases 1–4, 6 — implemented (expand)</summary>

### Phase 1 (partial)

- [x] Remove `.env.bak2` from tracking; tighten ignore patterns
- [x] Document GCP auth strategy (`GOOGLE_SERVICE_ACCOUNT_KEY` for middleware GCS)

### Phase 2 — Backend storage and extraction

- [x] Billing storage contract (`storage_ref`, metadata)
- [x] `gcs-billing-storage.js` upload + local fallback
- [x] Multipart upload on `POST /api/patient/billing/documents`
- [x] OCR parser + extract endpoint + amount guardrails
- [x] `patient_document_extracts` persistence

### Phase 3 — Mobile camera and upload

- [x] `expo-camera` capture in `capture-scan.tsx`
- [x] Multipart upload from `billing-capture.ts`
- [x] Real capture quality checks

### Phase 4 — Testing

- [x] Playwright auth bootstrap; capture e2e
- [x] Backend extraction + storage adapter tests

### Phase 6 — Timeline billing-first redesign

- [x] Routing (`timeline.tsx`, `money.tsx`, `profile.tsx`)
- [x] Calendar-range billing aggregates (B1–B5)
- [x] Frontend stats, calendar chrome, list/documents segments (F1–F8, D1–D2, L1–L3)
- [x] Web parity, tokens, events ordering, a11y (G1–G4, Q1–Q2)
- [x] Follow-ups P6-T1 through P6-T9

**Deferred:** B6 per-day `document_days` (v1.1)

</details>
