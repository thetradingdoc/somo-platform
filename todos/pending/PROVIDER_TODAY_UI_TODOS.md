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

## Verify

```bash
cd middleware-platform
npx playwright install
npx playwright test e2e/provider-today-portal.spec.cjs --config=playwright.config.cjs
```

Browser: `http://localhost:4000/business/today.html`
