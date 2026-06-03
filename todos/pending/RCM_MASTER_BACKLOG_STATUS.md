# RCM master backlog status

Source: `somo_rcm_todo_master.html` (40 items). Reconciled against provider portal pass (UI-P0–P3) and this implementation pass.

## Already shipped (prior portal pass — verified in repo)

| Item | Status |
|------|--------|
| Claims vs Exceptions label ambiguity | Done — `Claims & EOB`, `Denials & CDI` in `provider-shell.js` |
| Today journey CTAs | Partial — `ppJourneyStageHref` on case/rcm; **Today feed + journey strip shipped 2026-06-01** |
| Today journey labels | Done — `j.stage_label` from API |
| patient-payments request form + QR | Done — `patient-payments.html` |
| Payment-link-sent on Today | Done — payment alerts block |
| pdf-coding shell | Done — redirect to `billing.html?section=scan`, nav `coding` |
| invoice-detail RCM block | Done — `loadRcmPaymentsForInvoice` |
| settings Voice tab dedupe (summary only) | Done — link to agent.html |
| A/R on Today + RCM | Done — metrics in snapshot rows |

## Completed in this pass

| Item | Notes |
|------|--------|
| calendar.html activeId | `resolveActiveIdFromUrl` |
| patient-case journey strip + CTAs | Mini strip + `ppJourneyStageHref` |
| CI Jest stability | `testTimeout`, `forceExit`, `--runInBand` in CI |
| Real-time payment refresh | `ppStartPaymentPoll` / `ppOnPaymentRefresh` |
| Remittance workspace | ERA table + `GET /api/rcm/remittances` |
| billing `#paymentsSection` removed | DOM + dead `loadPayments` |
| Prior auth overview card | billing nav cards |
| claims status filter tabs | open/denied/paid client filter |
| agent stage 9→10 queue | collection queue panel on agent.html |
| patient-payments polish | empty state, toast, semantic table |
| Provider notified badge | payments nav badge from poll |
| wallet somo-tokens | wallet.html |
| Design system batch | somo-tokens import, nav green, fonts, video green |
| Admin 403 guard | `initProviderShell` |
| Calendar drawer a11y | tab roles |
| Playwright CI + specs | ci.yml provider-portal/rcm jobs |
| Infra runbooks | `GITHUB_SECRETS_SOMO_PLATFORM.md`, `DOCLITTLE_ARCHIVE.md` |

## Manual / out-of-repo

| Item | Owner action |
|------|----------------|
| GitHub secrets on somo-platform | `gh secret set` per runbook |
| Archive doclittle-platform | After green CI + sign-off |
| Railway disconnect | Confirm in Railway dashboard |
| Master HTML in Downloads | Refresh `done: true` flags locally |

## Verification (2026-06-01)

- Jest: `npm test -- --runInBand --forceExit` — 400 tests passed locally
- Playwright: requires `npm run dev` on `:4000` then:
  ```bash
  PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npx playwright install chromium
  PW_API_BASE_URL=http://127.0.0.1:4000 npm run test:e2e:provider-portal
  npm run test:e2e -- --project provider-rcm
  ```
- Kelly golden conversations (incl. `request_patient_payment`) run on CI Node 20 via `test:e2e:kelly:golden-conversations`
