# Front desk inventory completion matrix (Phase 4 + 5 — provider + auth scope)

> **Last updated:** 2026-07-02  
> **Scope:** Dental pilot — provider business pages + auth shell (FD-306–318, FD-348–351, FD-360–365, Phase 5 QA for in-scope pages)  
> **Out of scope (deferred):** Patient consumer Skin & Care stack (FD-332–347), P3 misc (FD-352–359)

## Summary

| Category | Done | Deferred | Notes |
|----------|------|----------|-------|
| Provider core (FD-306–309) | 4 | 0 | calendar, patients, patient-case, revenue |
| RCM + platform (FD-310–317) | 8 | 0 | includes payor/merge/invoice/video/tenants/leads |
| Auth redirect (FD-318) | 1 | 0 | pre-shipped |
| Auth shell (FD-348–351) | 4 | 0 | signup family + portal |
| Cross-cutting (FD-360–365) | 6 | 0 | KPI/table/card/sidebar inheritance |
| Phase 5 QA (in-scope) | 28 | — | gallery, tenant audit, E2E targets — see [PHASE5_VISUAL_QA_MATRIX.md](./PHASE5_VISUAL_QA_MATRIX.md) |
| Patient consumer (FD-332–347) | 0 | 16 | Not dental pilot |
| P3 misc (FD-352–359) | 0 | 8 | Spec P3 defer |

**In-scope shipped:** 28 task IDs + Phase 5 deliverables for listed pages  
**Explicit deferrals:** 24 task IDs (documented below, not implemented)

---

## Phase 4 — Provider + platform pages

| ID | Page | Status | Notes |
|----|------|--------|-------|
| FD-306 | `business/calendar.html` | **Done** | Voice nameplate in topbar; schedule board `sfd-table` |
| FD-307 | `business/patients.html` | **Done** | `mountProviderPage()`; `sfd-card` panel; skeleton loaders |
| FD-308 | `business/patient-case.html` | **Done** | `CallTimelineUi.renderTimelineTable`; `sfd-card` |
| FD-309 | `business/revenue.html` | **Done** | `mountProviderPage()`; KPI row matches Today (`pp-kpi-card`) |
| FD-310 | `business/rcm-journey.html` | **Done** | `sfd-card` panels; events via `RevenueUI.renderTable` → `sfd-table` |
| FD-311 | `business/trial-activation.html` | **Done** | Pre-shipped |
| FD-312 | `business/invoice-detail.html` | **Done** | Legacy sidebar removed; `sfd-card` + `sfd-table` line items/payments |
| FD-313 | `business/video-call.html` | **Done** | Legacy sidebar removed; tokens + SFD CSS linked |
| FD-314 | `business/tenants.html` | **Done** | `mountProviderPage()`; `sfd-table` + nameplates |
| FD-315 | `business/leads.html` | **Done** | `mountProviderPage()`; iframe in `sfd-card` chrome |
| FD-316 | `business/payor-review.html` | **Done** | `mountProviderPage()`; `sfd-card` / `sfd-table` |
| FD-317 | `business/merge-review.html` | **Done** | Same as payor-review |
| FD-318 | `business/feature-flags.html` | **Done** | Pre-shipped redirect to admin |

---

## Phase 4 — Auth shell

| ID | Page | Status | Notes |
|----|------|--------|-------|
| FD-348 | `signup.html` | **Done** | Auth shell parity: tokens + `auth-somo.css` + `sfd-device-card` |
| FD-349 | `signup-complete.html` | **Done** | `login-shell` + `sfd-device-card` |
| FD-350 | `reset-password.html` | **Done** | Auth card + signup field pattern |
| FD-351 | `portal.html` | **Done** | Router card with Somo tokens + nameplates |

---

## Phase 4 — Cross-cutting inheritance (FD-360–365)

| ID | Task | Status | Implementation |
|----|------|--------|----------------|
| FD-360 | Revenue KPIs ← Today | **Done** | `RevenueUI.renderKpiRow` uses `pp-kpi-card` / `pp-kpi-value` |
| FD-361 | Calendar ← Calls table | **Done** | Schedule board table adds `sfd-table` |
| FD-362 | patient-case timeline ← Calls | **Done** | `call-timeline-ui.js` wired |
| FD-363 | `sfd-table` on provider tables | **Done** | revenue, calendar board, invoice, payor, merge, tenants |
| FD-364 | `sfd-card` on panels | **Done** | payor, merge, invoice, rcm-journey, patient-case, patients |
| FD-365 | No legacy sidebar in source | **Done** | payor, merge, invoice, video-call |

---

## Deferred — out of dental pilot scope

| Range | Count | Reason |
|-------|-------|--------|
| FD-332–347 | 16 | Patient consumer Skin & Care pages — not dental pilot |
| FD-352–357 | 6 | Misc/legal/health — not provider/auth |
| FD-358–359 | 2 | Spec P3 defer (insurer, orders) |

---

## Phase 5 — QA (in-scope pages)

| ID | Task | Status | Deliverable |
|----|------|--------|-------------|
| FD-411 | Component gallery | **Done** | `dev/sfd-component-gallery.html` — fields, pill-tabs, modal, empty-state, skeleton, table |
| FD-416 | Kelly pause E2E | **Done** | `doctor-portal-journey.spec.cjs` FD-416 tests present |
| — | Admin E2E (FD-280 verify) | **Done** | `admin-portal-journey.spec.cjs` (7/7 — run `npm run test:e2e:admin`) |
| FD-366–408 | Per-page QA (in-scope) | **Done (scoped)** | [PHASE5_VISUAL_QA_MATRIX.md](./PHASE5_VISUAL_QA_MATRIX.md) — 28 pages Done, 24 Deferred |
| FD-409–410, 417–418 | Docs QA | **Done** | Pre-shipped |

### In-scope pages in tenant audit

`today`, `calendar`, `patients`, `patient-case`, `calls`, `invoice-detail`, `revenue-*`, `rcm-journey`, `payor-review`, `merge-review`, `tenants`, `leads`, `invite`, `agent`, `settings`, `video-call`, `voice-setup` (complete + incomplete), auth shell (`login`, `signup`, `signup-complete`, `reset-password`, `portal`), redirects, mobile viewport (390px)

---

## Exit criteria (scoped)

- [x] All in-scope FD-306–365, FD-348–351 marked **Done**
- [x] Deferred FD-332–347, FD-352–359 marked **Deferred** with rationale
- [x] No legacy `<aside class="sidebar">` in in-scope business HTML source
- [x] `npm run test:e2e:doctor-portal` green (FD-416 verified 2026-07-02)
- [x] `npm run test:e2e:admin` green (7/7 verified 2026-07-02)
- [x] Phase 5 QA matrix published — [PHASE5_VISUAL_QA_MATRIX.md](./PHASE5_VISUAL_QA_MATRIX.md)
- [x] `npm run verify:prod-gates` skip-safe in dev — [PROD_VENDOR_GATES.md](../voice-agent/PROD_VENDOR_GATES.md)
