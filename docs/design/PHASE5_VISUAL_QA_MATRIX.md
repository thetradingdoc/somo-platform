# Phase 5 visual QA matrix (scoped)

> **Last updated:** 2026-07-02  
> **Scope:** Dental pilot — in-scope provider, auth, and platform pages (FD-366–408 scoped)  
> **Deferred:** Patient consumer (FD-332–347), P3 misc (FD-352–359) — 24 pages, no implementation  
> **Automation:** `middleware-platform/e2e/tenant-front-desk-audit.spec.cjs` + onboarding/admin/doctor E2E

## Summary

| Status | Count | Notes |
|--------|-------|-------|
| **Done** | 28 | In-scope pages with shell + SFD anchors |
| **N/A (redirect)** | 13 | FD-319–331 legacy stubs — URL redirect only |
| **Deferred** | 24 | FD-332–347, FD-352–359 — out of dental pilot |
| **Docs/E2E (FD-409–418)** | 10 | Separate deliverables — see inventory matrix |

---

## In-scope pages — Done

| FD ID | Page | Shell | SFD components | E2E coverage | Status |
|-------|------|-------|----------------|--------------|--------|
| FD-366 | `business/today.html` | `pp-sidebar` | KPI cards, nameplate | tenant-audit, doctor-portal | **Done** |
| FD-367 | `business/calendar.html` | `pp-sidebar` | `sfd-table`, voice nameplate | tenant-audit | **Done** |
| FD-368 | `business/patients.html` | `pp-sidebar` | `sfd-card` | tenant-audit | **Done** |
| FD-369 | `business/patient-case.html` | `pp-sidebar` | `sfd-card`, timeline table | tenant-audit | **Done** |
| FD-370 | `business/calls.html` | `pp-sidebar` | call table / timeline | tenant-audit, doctor-portal | **Done** |
| FD-371 | `business/revenue.html` | `pp-sidebar` | pill tabs, KPI, `sfd-table` | tenant-audit (4 tabs) | **Done** |
| FD-372 | `business/rcm-journey.html` | `pp-sidebar` | `sfd-card`, `sfd-table` | tenant-audit | **Done** |
| FD-373 | `business/trial-activation.html` | auth/wizard | `sfd-device-card` | tenant-audit | **Done** |
| FD-374 | `business/invoice-detail.html` | `pp-sidebar` | `sfd-card`, `sfd-table` | tenant-audit | **Done** |
| FD-375 | `business/video-call.html` | minimal | tokens + SFD CSS | tenant-audit | **Done** |
| FD-376 | `business/tenants.html` | `pp-sidebar` | `sfd-table`, nameplates | tenant-audit | **Done** |
| FD-377 | `business/leads.html` | `pp-sidebar` | `sfd-card` iframe chrome | tenant-audit | **Done** |
| FD-378 | `business/payor-review.html` | `pp-sidebar` | `sfd-card`, `sfd-table` | tenant-audit | **Done** |
| FD-379 | `business/merge-review.html` | `pp-sidebar` | `sfd-card`, `sfd-table` | tenant-audit | **Done** |
| FD-380 | `business/agent.html` | `pp-sidebar` | Kelly widget, nameplate | tenant-audit, doctor-portal | **Done** |
| FD-381 | `business/settings.html` | `pp-sidebar` | tabs, voice settings | tenant-audit | **Done** |
| FD-382 | `business/voice-setup.html` (incomplete) | wizard | stepper, fields | tenant-audit, onboarding | **Done** |
| FD-383 | `business/voice-setup.html` (complete) | `pp-sidebar` redirect | post-setup state | tenant-audit | **Done** |
| FD-384 | `login.html` | auth card | `login-shell`, tokens | tenant-audit (auth) | **Done** |
| FD-385 | `signup.html` | auth card | `sfd-device-card` | tenant-audit (auth) | **Done** |
| FD-386 | `signup-complete.html` | auth card | `login-shell` | tenant-audit (auth) | **Done** |
| FD-387 | `reset-password.html` | auth card | auth field pattern | tenant-audit (auth) | **Done** |
| FD-388 | `portal.html` | router card | nameplates | tenant-audit (auth) | **Done** |
| FD-389 | `business/invite.html` | signup wizard | `sfd-device-card` | tenant-audit, onboarding | **Done** |
| FD-390 | `dev/sfd-component-gallery.html` | dev | all SFD primitives | manual / FD-411 | **Done** |
| FD-391 | `admin/sales-agent.html` | admin sidebar | `sfd-nameplate`, `sfd-card` | admin-portal-journey | **Done** |
| FD-392 | `admin/coding-reviews.html` | admin sidebar | `sfd-table` | admin-portal-journey | **Done** |
| FD-393 | Mobile MSU sidebar (390px) | `pp-mobile-toggle` | responsive rules | tenant-audit viewport | **Done** |

### Cross-cutting QA (FD-360–365) — verified via in-scope pages

| FD ID | Check | Status |
|-------|-------|--------|
| FD-360 | Revenue KPIs match Today | **Done** |
| FD-361 | Calendar schedule `sfd-table` | **Done** |
| FD-362 | patient-case timeline parity | **Done** |
| FD-363 | `sfd-table` on provider tables | **Done** |
| FD-364 | `sfd-card` on panels | **Done** |
| FD-365 | No legacy `aside.sidebar` | **Done** |

---

## Redirect stubs — N/A (no UI)

| FD ID | Page | Redirect target | Status |
|-------|------|-----------------|--------|
| FD-319–331 | `billing.html`, `rcm.html`, `claims.html`, etc. (13 stubs) | `revenue.html` tabs | **N/A** |

Verified by tenant-audit `expectRedirect` rows.

---

## Deferred — out of dental pilot (24 pages)

| FD range | Pages | Rationale | Status |
|----------|-------|-----------|--------|
| FD-332–347 | `patients/*.html` (16) | Patient consumer Skin & Care — not dental pilot | **Deferred** |
| FD-352–357 | `about.html`, `waitlist.html`, health/legal (6) | Not provider/auth scope | **Deferred** |
| FD-358–359 | `insurer/`, `orders/` (2) | Spec P3 defer | **Deferred** |

---

## E2E gates (FD-409–418)

| FD ID | Task | Status |
|-------|------|--------|
| FD-411 | Component gallery | **Done** |
| FD-412–415 | Onboarding journey E2E | **Done** (`npm run test:e2e:onboarding`) |
| FD-416 | Kelly pause → transfer | **Done** (`npm run test:e2e:doctor-portal`) |
| FD-417 | Copy review | **Done** |
| FD-418 | Guidelines update | **Done** |

---

## Verification commands

```bash
cd middleware-platform
npm run test:e2e:tenant-audit:safe
npm run test:e2e:onboarding
npm run test:e2e:doctor-portal
npm run test:e2e:admin
```
