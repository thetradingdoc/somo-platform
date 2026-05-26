# Mobile and web parity

**Last updated:** 2026-05-21

One routine-tracker journey on **Expo** and **web patient portal**. Same APIs, same steps, same tab names.

## Happy path (both surfaces)

| Step | User action | Expo route | Web URL |
|------|-------------|------------|---------|
| 1 | Discover (optional age) | — | `/`, `/start` |
| 2 | Email + 6-digit code | `/(tabs)/index` (Account) or web handoff | `/patients/patient-login.html` |
| 3 | Pick one of five routines | `/routine/pick` | `/patients/patient-routine-pick.html` |
| 4 | Land on Today | `/(tabs)/today` | `/patients/patient-dashboard.html` |
| 5 | Log progress photo | Today CTA or FAB → `/routine/capture` (front camera + live ghost) | Today **Log today's photo** |
| 6 | Review history | `/(tabs)/timeline` — **Photos** filmstrip default | `/patients/schedule.html` |
| 7 | Bills (optional) | `/(tabs)/money` via Account → Bills & receipts | `/patients/wallet.html` (secondary; Profile submenu intent) |
| 8 | Account / settings | `/(tabs)/account` | `/patients/profile.html` |

**Signup:** prefer app handoff (`patientapp://auth?ticket=…`). **Login / web:** template check → pick if none, else Today.

## Route map (web = in-portal, not a separate product)

| Web file | Role | Mobile tab |
|----------|------|------------|
| `patient-dashboard.html` | **Today** — stats, choose routine CTA | Today |
| `patient-routine-pick.html` | **Pick** — 5 concern templates | `/routine/pick` |
| `schedule.html` | **Timeline** — calendar, photos, list | Timeline |
| `wallet.html` | **Money** — bills, receipts (secondary) | Money (hidden tab; linked from Account) |
| `profile.html` | **Account** — profile, Bills link | Account |

**Mobile tabs (v1.2):** Today · Timeline · Account. Center FAB **Log photo** → `/routine/capture`.

**Web bottom nav:** [patient-shell.js](../../unified-dashboard/assets/js/patient-shell.js) — Today, Timeline, Account first; Routine, Products, Wallet follow (skincare-first order).

## Data: template → calendar

1. `POST /api/patient/routine/template` with `{ concern_id }` → `patient_routine_templates` (+ items from `concern-routines.json`).
2. **Today:** `GET /api/patient/routine/phase?date=` → week, phase, AM/PM steps, photo prompt.
3. **Timeline:** `GET /api/patient/journal/calendar-range` → `is_routine_day`, entries, thumbnails, billing overlays.

No separate “calendar product” — one template drives both screens.

**API ownership:** routine and journal → [`middleware-platform/routes/patient-routine.js`](../../middleware-platform/routes/patient-routine.js) (see [`docs/architecture/SERVER_DECOMPOSITION.md`](../architecture/SERVER_DECOMPOSITION.md)).

## Brand colors (consumer)

| Role | Hex | Use |
|------|-----|-----|
| Primary CTA | `#000000` | Choose routine, Start tracking |
| Brand accent | `#c85103` | Active tab, links, selected card, sidebar active |
| Capture FAB | `#314DB6` (`--sc-fab-capture-bg`) | Center camera only |
| Tertiary blue | `#378ADD` | Billing due/paid on Money/Timeline only |

Tokens: [skin-care-tokens.css](../../unified-dashboard/assets/css/skin-care-tokens.css), [GUIDELINES.md](../Brand/GUIDELINES.md).

## Do not use on primary path

| Surface | Why |
|---------|-----|
| `appointments.html` shelf wizard | Advanced custom routine; not 5-template onboarding |
| `my-records.html` as “home” | Product shelf browser; not Today |
| Billing-first Timeline copy | Misleading; routine journal is primary |
| `patient-dashboard` as login-only default without template check | Skips pick step |

**Deferred:** `appointments.html` remains reachable from Profile/advanced; not in primary sidebar.

## Signup vs login

| Intent | Default after verify |
|--------|----------------------|
| `intent=signup` | App handoff screen; optional “Use web” → template check |
| Login (web) | `GET /api/patient/routine/template` → pick or Today |

See [02-journey-now.md](./02-journey-now.md) implementation table for status.

## Automated sandbox (local)

```bash
cd middleware-platform && node scripts/sandbox-routine-photo-loop.cjs
```

Verifies all five concerns: every program phase has `expect` or `focus`, photo sync writes `item_logs`, card progress is non-zero after one photo day, and two-day `buildCompareDay` bundles resolve media URLs.

## Timeline trust + Sprint 3 (parity)

| Feature | Mobile (Expo) | Web |
|---------|---------------|-----|
| Day modes (today / backfill / historical) | `today.tsx` banners | `patient-dashboard.html?date=` |
| Ghost overlay before capture | `PhotoGhostOverlay` modal | Dashboard pre-picker preview |
| Two-photo compare | `compare.tsx`; journal long-press | `schedule.html` dbl-click thumbs; `GET /routine/compare` |
| Phase bands + milestone hints | `_journal.tsx` legend + badges | `schedule.html` calendar bands + legend |
| Inline day sheet | Journal bottom sheet | Dashboard date deep link |
| Optional symptom tags | Today chips after photo | Same via `/photo` |
| Phase-aware progress cards | Today stats (via API) | `renderRoutineCards` from `progress-summary` |
| Layering conflicts | Today expand + Shelf | Shelf N/A; routine steps on dashboard |
| `journal_date` deep link | N/A | `appointments.html?journal_date=` |

## Manual verification (web + Expo)

1. **Web login** — `patient-login.html` → no template → `patient-routine-pick.html`; with template → `patient-dashboard.html`.
2. **Pick** — select template → lands on Today with `?started=1` toast; bottom nav shows Today / Timeline / Money / Profile.
3. **Today** — black primary CTA; center FAB is blue; brown active sidebar tab.
4. **Photo** — Today CTA uploads via `/routine/daily/:id/photo`; progress cards not 0%; stat “Logged today” = Yes; Timeline calendar shows logged/media.
5. **Timeline** — routine-first header; `!has_template` banner links to pick; calendar shows routine days.
6. **Expo** — same pick → Today → Timeline; `_journal` redirects to `/routine/pick` when `has_template === false`.
7. **Compare** — log two days → journal long-press (app) or double-click photo thumb (web) → side-by-side compare.
8. **Ghost** — second-day capture shows faint prior photo guide before camera/file picker.
9. **Symptoms** — optional chips after photo; timeline cell shows top symptom when tagged.
