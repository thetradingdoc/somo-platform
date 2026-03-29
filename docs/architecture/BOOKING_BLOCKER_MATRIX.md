# Booking blocker matrix (patient flow)

Reference for tests and ops. Maps phases to owners and status.

## Phases

| Phase | Owner | Status |
|------|--------|--------|
| Phase 1 - Get Slots | Platform / booking service | Active |
| Phase 2 - Schedule | Platform / FHIR bridge | Active |
| Phase 3 - Checkout | Payments / Stripe | Active |
| Phase 4 - Verify and Pay | Voice + email verification | Active |
| Infrastructure | DevOps / middleware | Active |

## Notes

- Patient calendar uses clinic-local civil dates (`schedule.html` + `isoDateInTz`).
- See also `docs/testing/AGENTIC_CHECKOUT_E2E_CHECKLIST.md` for commerce E2E.
