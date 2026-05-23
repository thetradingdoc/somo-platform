# Surfaces and URLs

**Last updated:** 2026-05-21

## Local development

```bash
# 1. Inference (optional for /start photo step)
./scripts/start-face-scan-stack.sh   # teamkelly :8765

# 2. Build marketing + funnel SPA
cd unified-dashboard/littlelab-landing && npm install && npm run build

# 3. Middleware (serves landing build + patient static + APIs)
cd middleware-platform && npm start   # :4000

# 4. Patient app
cd patient-app && npx expo start
```

Open `http://127.0.0.1:4000/`

## URL map (MVP)

| URL | Surface | Purpose |
|-----|---------|---------|
| `/` | littlelab-landing | Landing: **Guess my age** + **Signup** |
| `/start` | littlelab-landing | Face-age → match → week-1 preview or specialist list → inline save (OTP) → done handoff |
| `/patients/patient-login.html` | unified-dashboard (static on middleware) | **Consumer signup/login** — email + 6-digit code (`?intent=signup` opens Sign Up tab) |
| `/app` | middleware redirect | **302** → `patient-login.html` (legacy; not a bridge page) |
| `/join` | middleware redirect | **302** → `patient-login.html` (legacy alias) |
| `/api/public/face-read` | middleware | Photo estimate (proxies teamkelly) |
| `/api/public/routines/concerns` | middleware | List concern programs for funnel chips |
| `/api/public/routines/:concernId/preview` | middleware | Week-1 preview (`week_one`, red flags) for funnel |
| `/api/public/funnel/match` | middleware | Step 1 router: `program` \| `specialist` \| `clarify` |
| `/api/public/funnel/specialists` | middleware | NPPES dermatology directory by ZIP (read-only) |
| `/api/patient/funnel/bridge` | middleware | After verify: write match context to Kelly session meta |
| `/api/patient/auth/handoff/create` | middleware | Web → app session ticket after funnel verify |
| `/api/patient/verify/send` | middleware | Email code (**web + app**) |
| `/api/patient/verify/confirm` | middleware | Create session (**web + app**) |
| `/api/patient/routine/template` | middleware | Activate routine (free) |
| `/api/patient/routine/phase` | middleware | Week/phase copy for Today |
| `/api/patient/routine/daily/:id/photo` | middleware | Progress photo → day logged |
| `/api/patient/home/progress-summary` | middleware | Portfolio cards + `today_logged` |
| `/patients/patient-dashboard.html` | unified-dashboard | **Web Today** (phase card + photo CTA) |
| `/patients/patient-routine-pick.html` | unified-dashboard | Web routine pick |
| `/patients/schedule.html` | unified-dashboard | Web Timeline |

**Legacy redirects:** `/consumer/*join*` → patient login; other `/consumer/*` → `/start` where applicable.

**Not primary path:** `onboarding.html`, `appointments.html` journal-only photo (`media-link`); use Today `/photo` for logging.

## Repos / folders

| Path | Role |
|------|------|
| `unified-dashboard/littlelab-landing/` | Consumer web funnel (landing, `/start`) |
| `unified-dashboard/patients/` | Web patient login + legacy dashboard |
| `middleware-platform/` | API + serves littlelab `build/` + patient static |
| `patient-app/` | Routine picker, daily loop, prescriptions, bills |
| `teamkelly/` | Inference (gitignored in parent repo) |

## Patient app routes

| Route | Purpose |
|-------|---------|
| `/(tabs)/index` | Login tab — email + code (returning users or dev without web signup) |
| `/routine/pick` | Choose routine from bundled JSON (shown when `!has_template` after confirm) |
| `/(tabs)/today` | **Today** — phase card + photo (default tab) |
| `/(tabs)/timeline` | Calendar / journal |
| `/(tabs)/money` | Bills |
| `/(tabs)/profile` | Settings (profile depth deferred) |

After `verify/confirm` in the app, if the patient has no template, navigation goes to `/routine/pick` (`patient-app/app/(tabs)/index.tsx`).

## Deep links

| URL | Use |
|-----|-----|
| `patientapp://login` | **Returning users** — open Login tab when session expired |
| `patientapp://auth?ticket=…` | One-time web → app session handoff after signup |
| `patientapp://` + routine paths | Existing routine deep links |

Primary **new-user** path: web OTP on `patient-login.html` → handoff into app (not `patientapp://login` as a second signup).

## Env

- `FACE_READ_INFERENCE_BASE_URL=http://localhost:8765` (middleware `.env`)
- `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000` (patient app)
