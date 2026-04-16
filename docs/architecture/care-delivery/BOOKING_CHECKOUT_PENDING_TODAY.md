# Booking + Checkout Pending Tasks (Today)

This file contains only the pending work discussed today.

## P0 - User-facing booking failure clarity

- [x] Return specific duplicate-identity errors from Kelly instead of generic fallback text.
- [x] In `kelly-agent-service` server-side scheduling intercept, map duplicate/phone-confirmation cases to explicit patient guidance.
- [x] Ensure UI/chat response explains what to do next (confirm phone/email) when duplicate identity is detected.

## P0 - Checkout completion blockers

- [x] Audit and patch all paths where booking succeeds but checkout does not complete (voice and chat entry points).
- [x] Verify auto-checkout + manual checkout do not conflict and cannot create ambiguous user state.
- [x] Ensure verification flow returns actionable error codes/messages (expired code, invalid code, missing token).

## P1 - Inbound booking path consistency

- [x] Re-verify inbound call flow for all four journeys:
  - symptoms + immediate
  - symptoms + routine
  - no symptoms + immediate
  - no symptoms + routine
- [x] Confirm triage/urgency gates are consistent across UI and backend for each journey.

## P1 - Observability and debugging

- [x] Add/verify structured logs for schedule failure causes (duplicate, triage gate, insurance gate, checkout gate).
- [x] Add/verify correlation across triage -> slot lookup -> schedule -> checkout -> verify steps.
- [x] Confirm there is no silent fallback that hides root cause in patient-facing copy.

## P2 - Validation and rollout checks

- [x] Execute end-to-end test runs for booking + checkout in chat and inbound call modes.
- [x] Add/refresh regression tests for duplicate identity, checkout token loss, and verify-code failure paths.
- [x] Produce a final go-live checklist for "someone can always book and pay, or receives a precise actionable error."

## P0 - Calendar reliability (provider sync vs manual availability)

- [x] Define and enforce booking policy tiers for sync visits:
  - Tier A: Google connected + availability blocks (highest confidence)
  - Tier B: Availability blocks only, no Google (allow booking with warnings)
  - Tier C: No Google and no blocks (do not offer sync slots)
- [x] Add explicit feature flags:
  - `CALENDAR_REQUIRED_FOR_SYNC`
  - `PREFER_SYNCED_PROVIDERS`
  - `BLOCKS_ONLY_ALLOWED`
- [x] Remove calendar ambiguity by documenting source of truth for each lane:
  - sync lane: Google + blocks (or blocks-only fallback by policy)
  - async lane: quota + provider availability rules

## P0 - Backend behavior fixes (calendar selection + matching)

- [x] Implement deterministic provider calendar resolution order:
  - provider user selected calendar
  - provider primary calendar
  - clinic calendar fallback (if allowed)
  - env shared calendar fallback (if allowed)
- [x] Add a single `calendar_confidence` field to slot responses (`high`, `medium`, `low`) based on source.
- [x] Prioritize synced providers first when multiple providers match the same slot window.
- [x] Return structured error codes for calendar gating:
  - `PROVIDER_CALENDAR_NOT_CONNECTED`
  - `PROVIDER_AVAILABILITY_NOT_SET`
  - `NO_BOOKABLE_SYNC_PROVIDER`
- [x] Ensure provider without Google but with blocks is still schedulable when policy permits.
- [x] Ensure provider without Google and without blocks is excluded from sync slot generation.

## P1 - Provider UX and settings fixes

- [x] Add provider status badges in UI:
  - `Live calendar connected`
  - `Availability blocks only`
  - `Unavailable`
- [x] Add actionable CTAs in settings:
  - Connect Google calendar
  - Set weekly availability blocks
  - Test booking readiness
- [x] Show non-blocking warning for blocks-only mode:
  - "External calendar conflicts may not be detected."
- [x] Add per-specialist "Booking readiness" card with pass/fail checks:
  - online status
  - active provider profile
  - calendar connected (optional by policy)
  - availability blocks set

## P1 - Patient/agent experience improvements

- [x] Keep patient-facing copy simple and non-technical for calendar fallback cases.
- [x] Auto-suggest next available business day when selected day has no slots.
- [x] If no sync-capable provider is available, offer:
  - next date search
  - async review lane
  - callback/manual scheduling fallback
- [x] Ensure Kelly never says "booked" before schedule success and calendar checks pass.

## P1 - Data model and migration tasks

- [x] Add canonical link between specialist and calendar credentials (`provider_profiles.user_id -> users.id`).
- [x] Add `provider_booking_readiness` materialized/derived state for quick checks.
- [x] Add `calendar_confidence` and `calendar_source` to appointment metadata.
- [x] Backfill existing providers:
  - map user email -> provider profile
  - detect missing calendar connection
  - detect missing availability blocks

## P2 - Observability, alerts, and guardrails

- [x] Add metrics:
  - `% slots from high/medium/low confidence sources`
  - `% bookings created with blocks-only providers`
  - `% no-bookable-provider failures by clinic`
- [x] Add warning logs with stable codes for every fallback step.
- [x] Add alert when blocks-only booking volume exceeds threshold (signals integration drift).
- [x] Add audit trail event when booking proceeded without Google sync.

## P2 - Test plan and rollout

- [x] Unit tests for calendar resolution priority and policy flag combinations.
- [x] Integration tests for all provider states:
  - connected + blocks
  - connected + no blocks
  - not connected + blocks
  - not connected + no blocks
- [x] E2E tests:
  - patient sees valid slots when provider is blocks-only
  - patient gets clean fallback when no provider is bookable
- [x] Staged rollout:
  - enable `PREFER_SYNCED_PROVIDERS`
  - validate metrics
  - decide whether to enforce `CALENDAR_REQUIRED_FOR_SYNC`

