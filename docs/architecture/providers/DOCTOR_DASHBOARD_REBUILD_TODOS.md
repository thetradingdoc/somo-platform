# Doctor Dashboard Rebuild TODOs

This checklist covers the rebuild of the doctor portal dashboard around triage priority, provider tasks, schedule, and specialist consult workflows.

## P0 - Product and UX foundation

- [ ] Lock dashboard information architecture for doctor workflow:
  - Clinical Control strip (priority queue, matching, pending tasks, consults, readiness)
  - Today Tasks panel
  - Schedule panel
  - Consult Network panel (scaffold)
- [ ] Confirm no ecommerce-first metrics remain in doctor view (orders/AOV/conversion as primary KPIs).
- [ ] Define final doctor personas for dashboard behavior:
  - Solo specialist
  - Multi-specialist clinic doctor
  - Triage-assigned covering doctor
- [ ] Define card and list empty-states (no tasks, no consults, no schedule, unavailable readiness).

## P0 - Design system and icon migration (Tailwind/Heroicons only)

- [ ] Replace all non-Heroicon icons/emojis in doctor dashboard.
- [ ] Standardize icon mapping:
  - Queue: `ExclamationTriangleIcon`
  - Tasks: `ClipboardDocumentListIcon`
  - Schedule: `CalendarDaysIcon`
  - Consults: `UserGroupIcon`
  - Calls: `PhoneIcon`
  - Readiness: `CheckBadgeIcon`/`ExclamationCircleIcon`
- [ ] Add consistent icon size/stroke utility classes for desktop/mobile.
- [ ] Verify contrast and accessibility for icon + urgency chips.

## P0 - Data contract cleanup for doctor dashboard

- [ ] Define and document doctor dashboard API contract (single source for tiles + panels).
- [ ] Remove mismatch between shop metrics and clinic/provider metrics in doctor UI bindings.
- [ ] Ensure all dashboard metrics are tenant-scoped and provider-safe.
- [ ] Add versioned response shape for dashboard contract to prevent UI drift.

## P0 - Clinical Control strip (top KPIs)

- [ ] Add tile: high-priority triage queue counts (`red`, `yellow`, `green`).
- [ ] Add tile: unassigned matched cases count.
- [ ] Add tile: doctor pending tasks count.
- [ ] Add tile: today consults (`scheduled`, `in_progress`).
- [ ] Add tile: booking readiness (`live calendar`, `blocks-only`, `unavailable`).
- [ ] Add quick actions:
  - Open triage queue
  - Open today schedule
  - Open consult requests

## P0 - Today Tasks panel

- [ ] Build tabs:
  - Important
  - Pending
  - Waiting
  - Completed
- [ ] Support task item types:
  - Review triage summary
  - Accept/decline match
  - Complete SOAP note
  - Follow-up callback/message
  - Coding/billing completion
- [ ] Add task row metadata:
  - urgency tag
  - patient/case reference
  - due time
  - owner/source
- [ ] Add row actions:
  - Open case
  - Mark done
  - Reassign

## P0 - Schedule panel

- [ ] Build schedule cards grouped by time windows for today.
- [ ] Show lane tags (`sync`, `async review`, `consult requested`).
- [ ] Add quick actions:
  - Start consult
  - View chart
  - Request specialist consult
- [ ] Show no-show / in-progress / completed status colors.

## P1 - Consult Network scaffold

- [ ] Add section: outbound consult requests.
- [ ] Add section: inbound consult requests.
- [ ] Add section: cases needing second opinion.
- [ ] Add minimal actions:
  - Open case
  - Send consult request
  - Accept/decline consult request

## P1 - Backend data wiring (existing data first, no static mocks)

- [ ] Wire schedule data from provider schedule APIs/services.
- [ ] Wire booking readiness from `/api/provider/booking-readiness`.
- [ ] Wire observability summary from `/api/provider/booking-observability`.
- [ ] Wire upcoming appointments from tenant/provider scoped endpoints.
- [ ] Add triage queue query from `triage_sessions` (`urgency`, `safety_level`, `triage_complete`).
- [ ] Add pending task derivation from existing appointment + triage + consult/coding states.

## P1 - Interaction and workflow reliability

- [ ] Ensure clicking a task deep-links to the correct case/appointment context.
- [ ] Ensure provider identity/canonical profile is used consistently in all dashboard queries.
- [ ] Add optimistic UI updates for task status changes with rollback on failure.
- [ ] Ensure stale data handling with polling or refresh controls.

## P1 - Mobile and responsive behavior

- [ ] Build responsive two-column -> one-column collapse for mobile.
- [ ] Keep quick actions reachable above the fold on small screens.
- [ ] Preserve readability and tappable targets for task/schedule cards.
- [ ] Verify side menu + bottom interactions do not hide critical dashboard actions.

## P0 - Video consult UX redesign (telemedicine-first)

- [ ] Make provider video stage the primary canvas on `business/video-call.html` (full-width desktop, fullscreen-first mobile).
- [ ] Collapse non-critical side surfaces by default (Transcript, Case Report, Clinical panel) and reveal on explicit toggle.
- [ ] Add a single "Clinical panel" toggle with clear open/close state and keyboard-safe behavior.
- [ ] Convert right panel to an overlay drawer on desktop and bottom sheet on mobile (no horizontal clipping).
- [ ] Keep risk/safety alert visible even when drawers are closed, with quick jump to transcript.
- [ ] Keep primary call controls sticky and always reachable on mobile (mic/camera/leave/end-claim).
- [ ] Merge patient context into progressive disclosure flow so doctors can focus on live video first.
- [ ] Ensure no panel blocks local/remote video on initial room connect and auto-join flows.
- [ ] Validate responsive behavior on narrow widths (`<=768px`) and landscape phones.

## P2 - Observability and auditability

- [ ] Add dashboard load telemetry by panel (latency/error).
- [ ] Add task action audit events (opened, completed, reassigned).
- [ ] Add consult request audit trail events.
- [ ] Add alert on sustained readiness degradation (e.g., unavailable providers > threshold).

## P2 - Testing and rollout

- [ ] Add unit tests for dashboard data mappers and status-to-chip transforms.
- [ ] Add integration tests for provider states and task derivation.
- [ ] Add E2E test:
  - doctor sees urgent triage item
  - opens case
  - marks task done
  - schedule panel updates
- [ ] Add E2E test for blocks-only readiness messaging.
- [ ] Stage rollout:
  - feature flag new doctor dashboard
  - internal clinic validation
  - controlled tenant rollout
  - remove legacy dashboard bindings

## Definition of done

- [ ] Dashboard primary view is clinically oriented (triage/tasks/schedule/consult), not ecommerce-oriented.
- [ ] All doctor dashboard icons are Heroicons/Tailwind-compatible.
- [ ] No static/mock data in production path; all cards are DB/API-backed.
- [ ] Doctor can complete core daily loop from dashboard:
  - identify priority case
  - act on pending task
  - start or manage consult
  - track readiness/state quickly.
