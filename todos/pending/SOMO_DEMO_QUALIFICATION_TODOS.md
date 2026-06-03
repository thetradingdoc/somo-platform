# Somo demo qualification — engineering checklist



**Last updated:** 2026-06-03  

**SSOT script:** [docs/agent/somo-demo/QUALIFICATION_CALL_SCRIPT_V1.md](../../docs/agent/somo-demo/QUALIFICATION_CALL_SCRIPT_V1.md)  

**Verification report:** [QUALIFICATION_VERIFICATION_REPORT_2026-06-03.md](../../docs/agent/somo-demo/QUALIFICATION_VERIFICATION_REPORT_2026-06-03.md)



| ID | Task | Owner | Status |

|----|------|-------|--------|

| Q-01 | Add `QUALIFICATION_CALL_SCRIPT_V1.md` + `QUALIFICATION_PLAYBOOK.md` | Eng | done |

| Q-02 | Kelly persona in templates + orchestrator (not Sam) | Eng | done |

| Q-03 | `max_duration_sec` = 180 in `somo-demo-templates.json` | Eng | done |

| Q-04 | Extend Groq `record_interest` tool schema | Eng | done |

| Q-05 | First-turn `evaluateFirstTurnLanguage` → DB + orchestrator context | Eng | done |

| Q-06 | `isEmergencyUtterance` block before orchestrator (EN/ES) | Eng | done |

| Q-07 | `record_interest` → DB fields + Sheets `qualification_captured` | Eng | done |

| Q-08 | `send_signup_link` → Sheets `cta_sent` | Eng | done |

| Q-09 | `end_call` / hangup → Sheets `call_ended` | Eng | done |

| Q-10 | Landing form: optional practice type (3 options only) | Eng | done |

| Q-11 | Form: optional specialty + `questions_asked` textarea | Eng | done |

| Q-12 | `somoDemo.js` payload + default `medical_clinic` when empty | Eng | done |

| Q-13 | Update `demo-voice-prompt.md` + Retell configure script | Eng | done |

| Q-14 | Unit tests: handler + orchestrator | Eng | done |

| Q-15 | E2E: submit without practice type | Eng | done |

| Q-16 | Staging smoke `npm run smoke:somo-demo` | Ops | **done** (2026-06-03, api.callsomo.com) |

| Q-17 | Manual EN call — 5 Sheets event types | Ops | **pending operator** |

| Q-18 | Manual ES call — Spanish throughout | Ops | **pending operator** |

| Q-19 | README/RUNBOOK qualification section | Eng | done |



## Landing form UX (2026-06-03)

Conversion-focused rebuild: minimal form (name, phone, note, consent), practice pills on left only, Somo brand voice in form chrome.

## UI parity gate (required before deploy / Q-17)

**SSOT:** [SOMO_LANDING_UI_PARITY_TODOS.md](./SOMO_LANDING_UI_PARITY_TODOS.md) — logo, header/footer mobile, hero assets, localhost :4000 = callsomo.com. Complete UI-01–UI-09 before treating hosting as production-ready.

## Remaining before full prod GO

1. **Landing UI parity** — complete [SOMO_LANDING_UI_PARITY_TODOS.md](./SOMO_LANDING_UI_PARITY_TODOS.md) (UI-08 deploy + UI-07 visual sign-off).

2. **Q-17:** One EN live call from landing or API with your cell.

3. **Q-18:** One ES live call (first response in Spanish).

4. **Sheets:** Confirm 5 event types if `SOMO_SHEETS_*` configured on Cloud Run.



## Smoke (verified 2026-06-03)



```bash

cd middleware-platform

API_BASE_URL=https://api.callsomo.com npm run smoke:somo-demo

npm run verify:prod:routing-smoke

npm run test:prod:smoke

```



Optional live dial:



```bash

SOMO_DEMO_SMOKE_PLACE_CALL=1 SOMO_DEMO_SMOKE_PHONE=+1YOUR_CELL \

  API_BASE_URL=https://api.callsomo.com npm run smoke:somo-demo

```


