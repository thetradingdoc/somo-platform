# Provider Today UI — HealthSpark redesign checklist

Canonical doc: [`docs/design/PROVIDER_TODAY_PAGE.md`](../../docs/design/PROVIDER_TODAY_PAGE.md).

## P0 (done)

- [x] Remove Urgent Tasks + HITL panels from today.html
- [x] 2-column grid: appointments main + calls/messages aside
- [x] Exceptions via alert strip only → claims.html
- [x] Payment alert deduplication
- [x] Mobile padding, hamburger SVG, sidebar backdrop z-index 1195
- [x] E2E + design doc updated

## P1 (done)

- [x] Greeting in topbar (no pp-hero block)
- [x] KPI sentence-case labels + trend row + auto height
- [x] Appointment tabs: Today / Upcoming / Recent
- [x] Chevron expand + clinical-prep brief
- [x] Avatar color cycling + neutral scheduled chip
- [x] Recent Messages panel + feed avatars/times/badges

## P2 / follow-up

- [ ] Revenue nav consolidation in PORTAL_NAV_BASE
- [ ] Real unread counts from patient inbox API
- [ ] Sidebar brand wordmark (skipped — icon-only per product choice)

## UI readiness punch list (2026-06-16)

### Must-fix before prod

- [ ] Remove remaining inline style-heavy modal markup from `business/calendar.html` into shared CSS classes for maintainability.
- [ ] Replace legacy inline `onclick` handlers in provider pages with delegated JS listeners for safer auditing and testability.
- [x] Validate keyboard focus order and ESC-close behavior across `calendar.html` modal stack (Escape + backdrop dismiss, `closeTopCalendarPanel()`).

### Should-fix soon

- [ ] Normalize topbar action labels and icon semantics across `today.html`, `calendar.html`, and `agent.html`.
- [ ] Add explicit empty-state actions for calls/messages panels in `today.html` (not only passive text).
- [ ] Convert repeated hardcoded button colors in `calendar.html` to Somo token-backed classes.

### Nice-to-have

- [ ] Add compact loading skeleton variants for mobile in provider dashboard panels.
- [ ] Add lightweight aria-live success status region for settings saves in `agent.html`.

## Verify

```bash
cd middleware-platform
npx playwright install
npx playwright test e2e/provider-today-portal.spec.cjs --config=playwright.config.cjs
npm run test:e2e:tenant-audit:safe   # full portal control inventory
```

Browser: `http://localhost:4000/business/today.html`
