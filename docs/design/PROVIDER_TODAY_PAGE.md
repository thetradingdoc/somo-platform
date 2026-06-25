# Provider Today page

> **Last reviewed:** 2026-06-03

## Job of the screen

**Front desk command center:** today's schedule first, lightweight comms on the side. Deep RCM work (exceptions, journeys, EOB) lives on **Claims** and related pages—not duplicated here.

## Layout order

1. **Topbar** — `pp-topbar--page`: greeting (`Good morning, …` via `pp-page-title` / `#ppHeroGreeting`), `pp-page-sub`, date chip, Search, New Appointment ([shell doc](./PROVIDER_PORTAL_SHELL.md))
2. **Alert strip** — Kelly provisioning, payment links (deduped), exception count → Claims (max 3 rows)
3. **KPI row** — Upcoming appointments, Appointments, Calls, Messages (with week-over-week trend)
4. **Dashboard grid (desktop)**
   - **Row 1 (full width):** Appointments panel with tabs (Today / Upcoming / Recent)
   - **Row 2 (50/50):** Recent Calls | Recent Messages (equal-width panels)
   - Footer: Revenue pipeline (spans both columns)
5. **Tablet/mobile:** stack — appointments, then calls, then messages (full width)

## What is not on Today

- Urgent Tasks / RCM journey feed (removed; use Claims + nav badge)
- Needs Your Attention / HITL panel (exceptions → alert strip + `claims.html`)
- Revenue snapshot panel

## Colors (provider Somo)

| Role | Token |
|------|--------|
| Primary CTA | `--somo-green` `#16a637` |
| Pending chip | neutral grey (`#f1f5f9` / `#64748b`) |
| Risk alerts | `--red-soft` |
| Provisioning | `--violet-soft` |

## Brand

- Sidebar: gecko icon only — [`somo-icon.png`](../../unified-dashboard/assets/brand/somo-icon.png)
- Kelly live card remains in sidebar (all provider pages)

## Button system (provider shell)

Shared classes in [`provider-portal.css`](../../unified-dashboard/assets/css/provider-portal.css) (Tailwind/shadcn-aligned):

| Class | Use on Today |
|-------|----------------|
| `pp-btn-primary` | New Appointment (one strong CTA per view) |
| `pp-btn-outline` | Search (bordered; `pp-btn-secondary` is an alias) |
| `pp-btn-ghost` | Low-emphasis actions in tables/toolbars (no border) |
| `pp-btn-link` | Panel “View all”, rail links (`pp-link-cta` is deprecated alias) |
| `pp-btn-sm` | Topbar control size (`height: 32px`) |

Focus: `focus-visible` ring uses `--somo-green`. Touch targets: `min-height: 44px` on mobile for boxed buttons only.

## Files

| File | Purpose |
|------|---------|
| `unified-dashboard/business/today.html` | Page structure and render |
| `unified-dashboard/assets/css/provider-portal.css` | Today layout, KPI, feed, grid |
| `unified-dashboard/assets/js/provider-shell.js` | Appointments fetch helpers, rail normalize, alerts |
| `middleware-platform/routes/rcm.js` | Recent calls/messages feed shape |

## Alert strip API

- `ppPushAlert({ id, type, icon, message, href, ctaLabel })`
- `ppFlushAlertStrip()` / `ppClearAlerts()`
- `ppRenderProvisioningAlert(kellyStatus)`

## QA

- Manual: [`docs/Brand/README.md`](../Brand/README.md#qa-matrix) — `/business/today.html`
- E2E: `middleware-platform/e2e/provider-today-portal.spec.cjs`
