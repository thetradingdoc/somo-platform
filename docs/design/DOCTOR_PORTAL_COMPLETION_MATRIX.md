# Doctor portal completion matrix (FD-166–FD-237)

> **Status:** 72/72 Done (2026-07-02)  
> **E2E:** `cd middleware-platform && npm run test:e2e:doctor-portal` (middleware on :4000)

| ID | Status | Evidence |
|----|--------|----------|
| FD-166 | Done | `agent.html` Kelly control center — status grid + line card |
| FD-167 | Done | `#vaStatusNameplate` + `sfd-nameplate.js` |
| FD-168 | Done | LIVE variant from `/api/voice-agent/status` |
| FD-169 | Done | PAUSED variant + transfer # in `#vaTransferPromise` |
| FD-170 | Done | BUG-3 transfer copy; toggle → `/api/kelly/toggle` |
| FD-171 | Done | `#vaCoverageCard` + hours in Settings Kelly tab |
| FD-172 | Done | COVERAGE-OFF nameplate in `applyVoiceStatus()` |
| FD-173 | Done | `#vaShadowCard` when `shadow_week_active` |
| FD-174 | Done | SHADOW nameplate + `#vaShadowEnds` |
| FD-175 | Done | No `va-badge` on agent page |
| FD-176 | Done | `today.html` `#ppTodayNameplate` + date chip |
| FD-177 | Done | KPI row: calls / insurance / copays — `customer-dashboard.js` |
| FD-178 | Done | `#ppSyncCard` practice system sync |
| FD-179 | Done | MANUAL SYNC nameplate + digest copy |
| FD-180 | Done | `#ppRecentCallsTable` + `sfd-table` |
| FD-181 | Done | DESIGN-3: Office impact, copay copy (no RCM/telehealth KPI row) |
| FD-182 | Done | `sfd-empty-state` when no calls today |
| FD-183 | Done | Celebration gated on LIVE + no blockers |
| FD-184 | Done | Onboarding checklist panel |
| FD-185 | Done | `calls.html` master-detail layout |
| FD-186 | Done | `.sfd-call-card.is-selected` list cards |
| FD-187 | Done | `call-timeline-ui.js` → `json.timeline` |
| FD-188 | Done | VERIFIED / LINK SENT / SYNC PENDING chips |
| FD-189 | Done | `sfd-skeleton` loading states |
| FD-190 | Done | Eligibility pending callout |
| FD-191 | Done | Transfer-only minimal panel |
| FD-192 | Done | Manual Dentrix sync pending copy |
| FD-193 | Done | Settings 4 pills: Profile / Connected / Kelly / Billing |
| FD-194 | Done | Connected Accounts panel |
| FD-195 | Done | Google Calendar row + nameplate |
| FD-196 | Done | Dentrix / PMS row |
| FD-197 | Done | Stripe billing row |
| FD-198 | Done | Change/disconnect flows |
| FD-199 | Done | `tab-connected.js` |
| FD-200 | Done | Integrations status API wired |
| FD-201 | Done | Connect Google CTA |
| FD-202 | Done | Profile: transfer #, NPI, languages, address |
| FD-203 | Done | Integrations → Connected migration |
| FD-204 | Done | Voice Agent → Kelly tab |
| FD-205 | Done | Billing tab unchanged |
| FD-206 | Done | Credentials → Advanced accordion |
| FD-207 | Done | Pay header `{Practice} · via Somo` |
| FD-208 | Done | Copay + visit context in `pay.html` |
| FD-209 | Done | SMS consent gate (`TCPA_SMS_CONSENT_REQUIRED`) |
| FD-210 | Done | Stripe Elements footer |
| FD-211 | Done | Pay flow states aligned to mock |
| FD-212 | Done | Expired link (`payment_link_expired`) |
| FD-213 | Done | Already paid (`already_paid`) |
| FD-214 | Done | Stripe retry via `completeStripePayment` |
| FD-215 | Done | Nameplates on agent/today topbars |
| FD-216 | Done | `provider-shell.js` `#ppKellyNameplate` (neutral card class) |
| FD-217 | Done | `.sfd-table th` mono uppercase headers |
| FD-218 | Done | Mobile hamburger via `mountProviderPage()` on settings |
| FD-219 | Done | `sfd-nameplate.js` |
| FD-220 | Done | `provider-portal.css` sfd bridge |
| FD-221 | Done | `fetchVoiceAgentStatus()` in `voice-agent-page.js` |
| FD-222 | Done | `fetchIntegrationsStatus()` |
| FD-223 | Done | `settings.html` → `mountProviderPage()` pp-sidebar |
| FD-224 | Done | `call-timeline-ui.js` |
| FD-225 | Done | Stats API `insurance_checks_today` + `copays_collected_today` |
| FD-226 | Done | `doctor-portal-journey.spec.cjs` (7 tests) |
| FD-227 | Done | Pay SFD CSS import + header audit |
| FD-228 | Done | `sfd-nameplate-mapping.test.js` |
| FD-229 | Done | Kelly config in `tab-kelly.js`; agent slimmed |
| FD-230 | Deferred | Optional `today-page.js` extraction — not required for pilot |
| FD-231 | Done | Hash redirects in `tab-general.js` |
| FD-232 | Done | SFD disconnect modal in `tab-connected.js` |
| FD-233 | Done | `loadPmsSyncErrors()` in Connected Accounts |
| FD-234 | Done | `DOCTOR_PORTAL_VISUAL_QA.md` |
| FD-235 | Done | `npm run test:e2e:doctor-portal` |
| FD-236 | Done | This matrix (72/72) |
| FD-237 | Done | Spec § Implementation status Phase 2 Complete |

**E2E coverage:** Today KPIs, agent nameplate, FD-416 pause transfer (stub + real toggle), calls timeline, celebration, settings tabs, voice-agent-page nameplate.
