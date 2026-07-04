# Onboarding stepper — mock vs implementation (FD-034)

> **Canon:** Invite → Profile → Connect → Voice → Hours → Outbound → Live (Billing in Settings only).

The mock (`somo-screen-designs.html`) shows a single 7-step wizard. Production splits **Invite** onto its own page; `voice-setup.html` runs steps 2–7 with the stepper marking Invite as complete.

## Delta table

| Mock frame | Mock label | Production page | Step index | Notes |
|------------|------------|-----------------|------------|-------|
| 01 | Invite | `business/invite.html` | 1 (stepper: done) | Separate auth shell; not inside voice-setup |
| 04 | Practice profile | `voice-setup.html` `#step1` | 2 | Eyebrow: "Step 2 of 7" |
| 04a | Connect systems | `voice-setup.html` `#step2` | 3 | Google + Somo cards; skip modal |
| 04b | Voice greeting | `voice-setup.html` `#step3` | 4 | Preview component |
| 04c | Hours | `voice-setup.html` `#step4` | 5 | CLOSED → OFF nameplate |
| 04d | Outbound | `voice-setup.html` `#step5` | 6 | Toggle default off |
| 05 | Test call + forward | `voice-setup.html` `#step6` | 7 | Finish → Today `#go-live-checklist` |
| — | Billing | `business/settings.html#billing` | — | Not in wizard per canon |

## Stepper keys (`sfd-stepper.js`)

`invite` → `profile` → `connect` → `voice` → `hours` → `outbound` → `live`

When entering from a accepted invite, `voice-setup.js` passes `completedThrough: 'invite'` so the stepper shows Invite as done.

## Mobile QA (FD-143)

Auth and wizard pages use `activation-wrap` / `sfd-device-card` with responsive padding at 480px (`somo-front-desk-components.css`). Connect step `.sfd-grid-2` stacks to single column at 768px. Manual spot-check at 390px viewport recommended before pilot.

Self-serve trial uses `trial-activation.html` (activation number reveal) before `voice-setup.html?step=1`. Stepper still starts at Profile (step 2 of 7). See FD-141 / FD-311.
