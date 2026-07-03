# Admin portal visual QA

> Smoke checklist for FD-238–266 screens. Run after deploy or before pilot.

## Prerequisites

- Middleware on `:4000` with admin session (or dev open mode)
- Operator capabilities: `platform.tenants`, `platform.leads`, `platform.feature_flags`

## Tenants (`/admin/tenants.html`)

- [ ] Offices table shows Practice, PMS, Status, Onboarding, Minutes, Actions
- [ ] LIVE / SHADOW / PENDING INVITE nameplates render correctly
- [ ] Onboarding link opens detail checklist (scrolls to `#onboarding-checklist`)
- [ ] Stuck filter narrows table
- [ ] Pending invites show Resend + Revoke
- [ ] Detail panel: Usage table, Billing table (invoice date), PMS, checklist actions

## Pipeline (`/admin/pipeline.html`)

- [ ] Kanban columns with counts
- [ ] Cards show location · PMS · languages
- [ ] Won column Convert button opens modal

## Lead detail (`/admin/lead.html?id=`)

- [ ] Header chips: source, location, WON pill when applicable
- [ ] Job posting link when `job_posting_url` present
- [ ] Convert to customer CTA

## Control board (`/admin/`)

- [ ] Metrics row loads
- [ ] Office status grid (top 6 tenants) with nameplates
- [ ] Tenant alerts + funnel cards

## Feature flags (`/admin/feature-flags.html`)

- [ ] Table lists env flags
- [ ] Toggle persists (DB override)

## Coding reviews (`/admin/coding-reviews.html`)

- [ ] Shared table styling
- [ ] Approve/Reject actions

## Nav

- [ ] Sidebar: Control board, Tenants, Pipeline, Leads, Feature flags, Sales agent, Coding reviews
- [ ] `business/feature-flags.html` redirects to admin

## E2E

```bash
cd middleware-platform && npm run test:e2e:admin
```

Expected: 5/5 green with middleware running.
