# Step 1 Match — design reference

**Last updated:** 2026-05-21

Wireframe-level spec for `/start` after biological age confirm. Implementation (archived): `unified-dashboard/_archive/littlelab-landing/src/pages/funnel/`.

## Funnel steps

| Step | Headline | Primary UI |
| ---- | -------- | ---------- |
| Photo | Guess my age / Your skin age | Camera or library |
| **intent** | How can we help? | Two cards: Track a routine / Find a specialist |
| **specialistZip** | Find specialists | ZIP required; optional symptoms |
| **match** | What's going on? | Chips-first triage + optional detail; **no ZIP** on track |
| **clarify** | A few quick questions | `next_questions` (duration; rash: location, changing) |
| **preview** | Your week 1 plan | Week-one card, tracking CTA copy, save |
| **specialist** | Specialists near you | NPPES `nppes_v_physicians_specialists`; specialty on card; **Save** primary; **Track while I find a specialist** upsell |
| **dual** | Track & find care | After upsell only: program preview + specialist list |
| save | Save this plan | Email OTP; template only program/dual |
| done | You're set | Primary: **Log today's photo** → patient-dashboard |

## Chapter dots (Photo · Goal · Match · Plan · Save)

- **Photo:** capture → analyzing → confirm → correct
- **Goal:** intent
- **Match:** match, clarify, specialistZip (find specialist only)
- **Plan:** preview, specialist, or dual
- **Save:** save → done

## Track triage screen (`FunnelTrackTriage`)

- Section **What's going on**: concern chips (primary); optional detail textarea below
- No ZIP; `POST /api/public/funnel/match` sends `zip: null` for `track_program`
- Unmapped or low-confidence text → `clarify` (not specialist directory)
- Continue disabled until chip selected or inquiry ≥ 8 characters

## Specialist ZIP screen (`FunnelSpecialistZip`)

- ZIP required (5 digits); optional symptoms
- `user_goal: find_specialist` → specialist list via NPPES physician specialists view

## Specialist screen

- Banner if `urgency: high` from L0 safety
- Cards: name, city/state, phone (if present), NPI
- Footer: *Directory information only. Booking is not guaranteed on Skin & Care. Confirm availability with the practice.*
- CTA: Save this list / Continue → same save step as program path

## L0 safety copy (server)

Uses `triage-service.detectRedFlags` — same rules as Kelly. Client must not be the only safety gate.

## Face-read (L2)

- Stored in `sc_face_read`
- If apparent vs confirmed age delta ≥ 8 or `quality: low`, show confidence note on **preview** only; does not change route

## Returning user

- If `GET /api/patient/routine/template` returns active template (session present): show *Continue your [concern] program?* on match step
