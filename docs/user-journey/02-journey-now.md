# Journey — MVP (now)

**Last updated:** 2026-05-21

Frictionless path: **optional age hook → intent (why you’re here) → match (goal-aware inquiry + program, specialist, dual, or clarify) → week-1 preview, dual offer, or derm directory on `/start` → inline email + code → app with session + activated routine (program/dual only) → first progress photo on Today.**

## Principles

- **One auth moment** — email and 6-digit code only (no password, no duplicate login on web then app).
- **No profile gate** — do not block routine pick on demographics, insurance, or `onboarding.html`.
- **Web discovers and verifies** — landing and biological age on littlelab; account can start on `/start` (inline OTP) or `patient-login.html`.
- **App and web share the routine** — picker, Today, Timeline, Money; see [06-mobile-and-web-parity.md](./06-mobile-and-web-parity.md).
- **Age never blocks signup** — `/start` is optional; Signup from `/` skips the photo step.

## Happy path (7 steps)

1. **Discover** — User opens `/` (landing: `RoutineLanding.jsx`). CTAs: **Guess my age** or **Signup**.
2. **Optional hook + value** — **Guess my age** → `/start` (`BiologicalAgePage.jsx`): selfie → face-read estimate → confirm or correct age → **intent** (two routes: track routine or find dermatologist) → **match** (`POST /api/public/funnel/match` with `user_goal`, optional `clarify_answers`) → **program**, **specialist**, **clarify**, or **dual** (dual only after specialist upsell). Session stores `sc_user_goal`, `sc_match_json`, `sc_concern_id`, `sc_preview_json`, `sc_zip`, `sc_clarify_answers`.
3. **Account on funnel** — **Save** on `/start`: email → verify → `POST /api/patient/routine/template` only when `route` is `program` or `dual`. Specialist-only saves email + bridge meta without template. **Done** primary CTA: log today’s photo → `patient-dashboard.html`.
4. **Handoff** — **Get the app** (`POST /api/patient/auth/handoff/create` → `patientapp://auth?ticket=…`) or **Continue on web** (`patient-routine-pick.html` or dashboard if template exists).
5. **Alternate account** — **Signup** from `/` still goes to `/patients/patient-login.html?intent=signup` (same verify APIs).
6. **Land on Today** — `/(tabs)/today` as the first meaningful screen (default tab).
7. **Daily loop** — progress photo on Today; history on Timeline; bills via Money tab (optional).

## Alternate paths

| Entry | Path |
|-------|------|
| **Signup from landing** | `/` → `patient-login?intent=signup` → (steps 4–7) |
| **After age + preview** | `/start` save step → inline OTP → done handoff (app or web) |
| **Skip save on funnel** | `/start` → **Continue without saving** → done → web login |
| **Returning user (web)** | `patient-login.html` Login → template check → `patient-routine-pick.html` or `patient-dashboard.html` (Today) |
| **Returning user (app)** | App session in SecureStore → Home / routine tab; Login tab only if session expired |
| **Legacy URLs** | `/app`, `/join` → **302** → `patient-login.html` (preserves query e.g. `intent=signup`) |

## What we ask — now vs later

| Moment | Ask now | Defer (see [03-journey-later.md](./03-journey-later.md)) |
|--------|---------|----------------------------------------------------------|
| Account | Email + 6-digit code | Password, social login |
| After verify | App handoff or web pick → Today | Long intake, insurance |
| Activation | Concern on `/start` + template POST after verify (or pick on web/app) | Long intake, insurance, address |
| Age hook | Optional selfie + local confirm | Server-side confirmed age |
| Program preview | Week-1 `expect` + all `red_flags` from `concern-routines.json` | Full Kelly chat on funnel |
| Step 1 match | Goal-aware fusion pipeline (`funnel-sales-match-pipeline.js`); see [10-agentic-funnel-scope.md](./10-agentic-funnel-scope.md) | Kelly `processTurn` on `/start`; Pinecone L3 |
| Specialist path | NPPES derm directory (`/api/public/funnel/specialists`) | Booking on funnel |
| Daily | **One progress photo** = day logged; phase copy on Today | Step checklists as hero; AI chat |

## Flow diagram

```
/ ── Guess my age ──► /start: photo → age → intent → match → preview OR specialist OR dual → save (OTP)
 │                         │                              │
 │                         └── Continue without saving ───┼──► done (handoff)
 └── Signup ──► patient-login?intent=signup               │
                        email → code → confirm ──────────┤
                                                        ▼
                                              patient app (session) or web Today
                                                        │
                                                        ▼
                                              /(tabs)/today  (daily)
```

## Implementation status

Docs describe **target** behavior. Gaps below are intentional follow-up work (not blockers for writing the journey).

| Step | Target | Status |
|------|--------|--------|
| Post-verify redirect (signup) | App handoff → app `/routine/pick` | Done: `patient-login.html` handoff step |
| Post-verify redirect (login web) | Template check → pick or Today | Done: `finishAuthRedirect` + `redirectWebAfterAuth` |
| Session web → app | `patientapp://auth?ticket=…` | Done: handoff create/exchange; Expo `useAppDeepLinks` |
| Web parity nav | Today / Timeline / Money / Profile + FAB | Done: `patient-shell.js` + sidebar IA |
| Web Today / pick / Timeline copy | Routine-first, brand tokens | Done: see [06-mobile-and-web-parity.md](./06-mobile-and-web-parity.md) |
| App post-confirm | `/routine/pick` when `!has_template`, else Today | Done: `(tabs)/index.tsx` |
| Default tab | `/(tabs)/today` | Done: `(tabs)/_layout.tsx` |
| Progress photos | Photo → `completion_score` 100 + all `item_logs` complete; `today_logged` on summary | Done: see [07-v1-product-decisions.md](./07-v1-product-decisions.md) |
| Today phase card | `/phase` `expect` + collapsed steps | Done: web `patient-dashboard.html`, app `today.tsx` |
| Confirmed age | Optional enrichment | `sc_confirmed_age` in sessionStorage only |
| Funnel program | Match router + preview + optional inline verify | `sc_match_json`, `sc_concern_id`, `sc_preview_json`, `sc_patient_session_id` |
| Kelly bridge | After verify + template | `POST /api/patient/funnel/bridge` → `funnel_match_json` meta |
| Timeline trust | 48h backfill, read-only history, `frozen_steps` on past days | Done: `routine-day-mode.js`, Today/Journal banners |
| Sprint 3 compare | Ghost overlay before capture; long-press/dbl-click compare two days | Done: app `compare.tsx`, web dashboard ghost + schedule compare modal |
| v1.1 symptoms | Optional flare chips on photo day → timeline badges | Done: `symptom_tags` on upload + `calendar-range` |
| Phase-aware home cards | Progress cards use current phase names, not week-1 template | Done: `progress-summary` + web `renderRoutineCards` |
| Layering (V2-lite) | Conflict copy only (not Yuka scores) | Done: `layering-check` API; Today + Shelf surfaces |

When behavior changes, update this table and [06-mobile-and-web-parity.md](./06-mobile-and-web-parity.md) in the same PR.
