# Step 1 Match — users and stories

**Last updated:** 2026-05-21

Step 1 on `/start` starts with **intent** (two routes: track routine or find dermatologist), then match → program, specialist, clarify, or **dual** (only after specialist upsell). Save activates a template only on program/dual paths.

## Personas

| Persona | Goal on `/start` | Match outcome |
| ------- | ---------------- | ------------- |
| **RoutineStarter** | Wants a guided 12-week plan | `user_goal: track_program` → `route: program` (any of five concerns, incl. Lines & texture / `anti_aging`) |
| **SpecialistSeeker** | Wants a specialist near them | `user_goal: find_specialist` → ZIP step → `route: specialist` (no default template) |
| **DualSeeker** | Chose “Track while I find a derm” on specialist screen | `user_goal: both` → `route: dual` |
| **SafetyEscalation** | Mole change, spreading rash, systemic symptoms | `route: specialist`, `urgency: high`, no program |
| **ReturningPatient** | Already has an active template | Continue card; skip full match when session has template |

## User stories

1. As **RoutineStarter**, after intent “Track a routine” I describe my concern **or** tap a chip (including Lines & texture), then see a week-1 preview.
2. As **SpecialistSeeker**, after intent “Find a dermatologist” I enter ZIP and see NPPES directory cards; save does not activate a template unless I opt into tracking afterward.
3. As **DualSeeker**, on the specialist list I tap **Track while I find a derm**, pick a program, then save with template + directory context.
4. As **SafetyEscalation**, red-flag language never assigns a routine; specialist path only.
5. As any user, **Not sure** prompts clarify—not silent default to barrier repair.
6. As **ReturningPatient** with a patient session, I can continue my existing program without re-picking chips (deferred UI).

## When the account (user) is created

Unchanged from [02-journey-now.md](./02-journey-now.md):

- **Anonymous** through photo, age, and match (`sessionStorage`: `sc_match_json`, `sc_concern_id`, `sc_face_read`, `sc_zip`).
- **Account** = email + 6-digit OTP on the save step (`POST /api/patient/verify/confirm`).
- After confirm: `POST /api/patient/routine/template` when `route` is `program` or `dual`; `POST /api/patient/funnel/bridge` stores `user_goal`, `route`, `companion_concern_id`, `clarify_answers`.

## Non-goals on `/start`

- Full Kelly `processTurn` / OPQRST interview
- `run_triage_rag` or booking on the funnel
- Guaranteed appointment booking on NPPES cards

## Related

- Design copy and wireframes: [09-step1-match-design.md](./09-step1-match-design.md)
- Agentic split (funnel vs Kelly): [10-agentic-funnel-scope.md](./10-agentic-funnel-scope.md)
- URLs: [04-surfaces-and-urls.md](./04-surfaces-and-urls.md)
