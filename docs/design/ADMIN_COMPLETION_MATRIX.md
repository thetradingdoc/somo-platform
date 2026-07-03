# Admin completion matrix (FD-238–FD-285)

> **Status:** 48/48 Done (2026-07-02)  
> **E2E:** `cd middleware-platform && npm run test:e2e:admin` (middleware on :4000)

| ID | Status | Evidence |
|----|--------|----------|
| FD-238 | Done | `tenants.html` — PMS + Actions columns in offices table |
| FD-239 | Done | `AdminOnboarding.tenantNameplateHtml()` — PENDING INVITE label |
| FD-240 | Done | `#btnInviteOffice` + `#inviteOfficeModal` |
| FD-241 | Done | Empty state + invite CTA |
| FD-242 | Done | `#stuckFilter` + `/api/admin/voice-onboarding/stuck` |
| FD-243 | Done | Onboarding column → `showDetail(id, { scrollChecklist: true })` + `#onboarding-checklist` |
| FD-244 | Done | Pending invites Resend/Revoke via `/api/admin/invites/:id/resend` |
| FD-245 | Done | `showDetail()` → tenant detail panel |
| FD-246 | Done | Kanban columns in `pipeline.html` |
| FD-247 | Done | `.admin-crm-kanban-card` component |
| FD-248 | Done | Won column Convert + `admin-convert-modal.js` |
| FD-249 | Done | Kanban/list `leadMetaLine()` — location · PMS · languages |
| FD-250 | Done | `.admin-crm-badge-count` column headers |
| FD-251 | Done | `lead.html` header + source chip |
| FD-252 | Done | Job posting / posted / title KV rows + `job_posting_url` in facade |
| FD-253 | Done | WON nameplate on won leads |
| FD-254 | Done | Convert to customer CTA + modal |
| FD-255 | Done | Onboarding checklist in tenant detail |
| FD-256 | Done | Reset onboarding quick action |
| FD-257 | Done | Compare opener quick action |
| FD-258 | Done | Usage table (24h/7d/30d) in tenant detail |
| FD-259 | Done | Billing table — plan, minutes, invoice date (`due_date`) |
| FD-260 | Done | Open provider portal link in detail |
| FD-261 | Done | `admin/leads.html` → redirect to pipeline |
| FD-262 | Done | `admin/feature-flags.html` + admin shell |
| FD-263 | Done | Nav: Tenants, Pipeline, Leads, Feature flags in `admin-shell.js` |
| FD-264 | Done | `index.html` Office status card grid |
| FD-265 | Done | `sales-agent.html` CONFIGURED nameplates |
| FD-266 | Done | `coding-reviews.html` `admin-crm-data-table` + nav link |
| FD-267 | Done | `admin-shell.js` shared sidebar + capability gating |
| FD-268 | Done | `admin-portal.css` + SFD CSS on all admin pages |
| FD-269 | Done | `admin-onboarding.js` invite/onboarding helpers |
| FD-270 | Done | `admin-convert-modal.js` convert flow |
| FD-271 | Done | Invite office `sfd-modal-backdrop` on tenants |
| FD-272 | Done | `admin-crm-data-table` on tenants, billing, flags, coding |
| FD-273 | Done | `tenantNameplate()` mapping in tenants table |
| FD-274 | Done | List API: `pms_type`, `pending_invite`, `last_invoice` |
| FD-275 | Done | Detail API: `billing.invoices[]` + usage by_period |
| FD-276 | Done | Feature flags GET merge + POST `{ flag, enabled }` compat |
| FD-277 | Done | `admin/leads.html` redirect stub |
| FD-278 | Done | `admin/feature-flags.html` |
| FD-279 | Done | Coding reviews nav + table styling |
| FD-280 | Done | `admin-portal-journey.spec.cjs` (5 tests) |
| FD-281 | Done | `npm run test:e2e:admin` + Playwright `admin` project |
| FD-282 | Done | This matrix (48/48) |
| FD-283 | Done | `ADMIN_VISUAL_QA.md` |
| FD-284 | Done | Spec § Implementation status Phase 3 Complete |
| FD-285 | Done | `admin-tenants-enrichment.test.js` |

**E2E coverage:** tenants PMS/nameplate, stuck filter, pending invite resend, pipeline kanban metadata, feature flags table.
