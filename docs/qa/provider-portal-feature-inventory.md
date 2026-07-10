# Provider portal — feature inventory (portal E2E scope)

**Generated:** 2026-07-04 for dentist-journey parity / P1 manifest alignment.

## P0 surfaces (every run)

| Page | Path | Key controls |
|------|------|--------------|
| Landing | `/` | Sign up CTA, login link |
| Signup | `/signup` | Persona grid, wizard steps S1–S7 |
| Login | `/login` | Email, password, submit |
| Voice setup | `/business/voice-setup.html` | 7-step wizard (create mode only) |
| Today | `/business/today.html` | Kelly activity, KPI row, go-live checklist |
| Agent (Kelly) | `/business/agent.html` | Nameplate, pause toggle, transfer promise |
| Session | `/api/kelly/status` | No 401 when logged in |

## P1 sidebar tour (sampled rotation)

| Page | Path | P1 manifest ID |
|------|------|----------------|
| Calls | `/business/calls.html` | `nav.calls`, `calls.list_visible` |
| Calendar | `/business/calendar.html` | `nav.schedule`, `schedule.board_visible`, `calendar.open_modal` |
| Patients | `/business/patients.html` | `nav.patients` |
| Kelly | `/business/agent.html` | `nav.agent`, `agent.nameplate` |
| Settings | `/business/settings.html` | `nav.settings`, `settings.profile_tab` |
| Revenue | `/business/revenue.html` | `nav.revenue`, `revenue.payments_tab` |
| Today | `/business/today.html` | `today.kpi_row`, `today.onboarding_checklist` |

## P2 (weekly / pre-release)

From `tenant-ui-audit.cjs` — admin and legacy:

- Admin: leads, tenants, payor-review
- Legacy redirects: `billing.html` → revenue
- Full `TENANT_PAGES` exhaustive button audit (`test:e2e:tenant-audit`)

## Notification surfaces (manual checklist)

| Surface | Location | Tier |
|---------|----------|------|
| Login error toast | `/login` | P0 |
| Signup validation | `/signup` | P0 |
| `pp-toast` | Portal shell | P1 |
| `pp-alert` strip | Today / Revenue | P1 |
| Kelly nameplate states | Agent page | P0 |
| Revenue billing alerts | Revenue tabs | P2 |

## Source

- P1 manifest: `middleware-platform/e2e/helpers/portal-p1-manifest.json`
- Full page list: `middleware-platform/e2e/helpers/tenant-ui-audit.cjs` (`TENANT_PAGES`)
