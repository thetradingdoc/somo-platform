# Doctor portal visual QA checklist (screens 06–10)

> **Scope:** FD-234 — manual spot-check before pilot sign-off  
> **Breakpoints:** Desktop 1280px, mobile 375px  
> **Reference:** `somo-screen-designs.html` frames 06–10

## Screen 06 — Kelly control center (`agent.html`)

- [ ] Status grid shows LIVE / PAUSED / COVERAGE-OFF / SHADOW nameplate
- [ ] Coverage card reflects office-hours state
- [ ] Pause toggle updates nameplate without page reload
- [ ] PAUSED shows transfer number in `#vaTransferPromise` (BUG-3)
- [ ] Shadow week card visible only during shadow week
- [ ] Link to Settings → Kelly resolves correctly
- [ ] Mobile: hamburger opens sidebar; status cards stack single column

## Screen 07 — Today (`today.html`)

- [ ] Header nameplate matches Kelly status API
- [ ] KPI row: Calls today / Insurance checks / Copays collected
- [ ] Practice system sync card + MANUAL SYNC nameplate
- [ ] Recent calls table uses mono table headers
- [ ] Empty state when zero calls today
- [ ] Celebration callout only when LIVE + no blockers
- [ ] No RCM/telehealth jargon in visible copy

## Screen 08 — Calls (`calls.html`)

- [ ] Call list uses `sfd-card` with selected border state
- [ ] Detail panel renders timeline two-column table
- [ ] Chips: VERIFIED, LINK SENT, SYNC PENDING where applicable
- [ ] Transfer-only calls show minimal panel
- [ ] Skeleton uses `sfd-skeleton` while loading
- [ ] Mobile: master-detail stacks or scrolls cleanly

## Screen 09 — Settings (`settings.html`)

- [ ] Four primary pills: Profile, Connected Accounts, Kelly, Billing
- [ ] `#integrations` and `#voice` hashes redirect correctly
- [ ] Connected Accounts: Google, Dentrix, Stripe rows with nameplates
- [ ] Disconnect Google shows SFD modal (not browser confirm)
- [ ] Kelly tab: greeting, hours, languages, transfer, outbound, prompt
- [ ] Profile: practice name, transfer #, NPI, languages, address
- [ ] Mobile: pp-sidebar via hamburger

## Screen 10 — Patient pay (`patients/pay.html`)

- [ ] Header: `{Practice} · via Somo`
- [ ] Copay amount and visit context visible
- [ ] SMS consent checkbox before card pay
- [ ] Stripe footer / powered-by copy
- [ ] Expired link state renders correctly
- [ ] Already-paid state renders correctly
- [ ] Stripe Elements layout unchanged after SFD CSS import

## Shared shell

- [ ] Sidebar Kelly widget shows `sfd-nameplate` (not color-only dot)
- [ ] Kelly widget subcopy: "Voice · scheduling · copay"
- [ ] Nameplate variants match component gallery (`dev/sfd-component-gallery.html`)

## Sign-off

| Reviewer | Date | Notes |
|----------|------|-------|
| | | |
