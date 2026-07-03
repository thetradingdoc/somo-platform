# Onboarding completion matrix (FD-043–FD-165)

> **Status:** 123/123 Done (2026-06-30)  
> **E2E:** `cd middleware-platform && npm run test:e2e:onboarding` (middleware on :4000)

| ID | Status | Evidence |
|----|--------|----------|
| FD-043 | Done | `login.html` sfd-device-card shell |
| FD-044 | Done | `login-somo.js` + `onboarding-redirect.js` |
| FD-045 | Done | Redirect → `voice-setup.html?step=N` |
| FD-046 | Done | Redirect → `today.html#go-live-checklist` |
| FD-047 | Done | Terminal state → `today.html` |
| FD-048 | Done | Forgot panel uses signup-field auth shell |
| FD-049 | Done | `#loginToast` / `#forgotToast` signup-toast pattern |
| FD-050 | Done | `invite.html` device card |
| FD-051 | Done | Practice name pre-fill from API |
| FD-052 | Done | Confirm password field |
| FD-053 | Done | BAA gate on submit |
| FD-054 | Done | Expired invite copy |
| FD-055 | Done | Already-used → login redirect |
| FD-056 | Done | Success → voice-setup step 1 |
| FD-057 | Done | Name field hidden; practice name on accept |
| FD-058 | Done | Inline password validation |
| FD-059 | Done | `tenants.html` invite modal |
| FD-060 | Done | Dental specialty locked |
| FD-061 | Done | Optional PMS select |
| FD-062 | Done | Success toast + pending table refresh |
| FD-063 | Done | Field validation errors |
| FD-064 | Done | Per-field validation |
| FD-065 | Done | `AdminOnboarding.createInvite` |
| FD-066 | Done | Pending invites resend/revoke |
| FD-067 | Done | Pipeline convert CTA |
| FD-068 | Done | Lead detail convert CTA |
| FD-069 | Done | `admin-convert-modal.js` confirm |
| FD-070 | Done | Provisioning spinner state |
| FD-071 | Done | Success modal portal URL + password |
| FD-072 | Done | Failure + retry |
| FD-073 | Done | Already-converted view tenant |
| FD-074 | Done | Summary KV table in modal |
| FD-075 | Done | 7-step stepper |
| FD-076 | Done | Practice name field |
| FD-077 | Done | Address grid |
| FD-078 | Done | PMS dropdown |
| FD-079 | Done | Languages dropdown |
| FD-080 | Done | Transfer number |
| FD-081 | Done | NPI + hint |
| FD-082 | Done | Coverage mode |
| FD-083 | Done | wizard-started + save |
| FD-084 | Done | Continue → connect |
| FD-085 | Done | Connect step shell |
| FD-086 | Done | Google RECOMMENDED badge |
| FD-087 | Done | Somo calendar + skip |
| FD-088 | Done | Dentrix pending nameplate |
| FD-089 | Done | Dentrix interim callout |
| FD-090 | Done | Google OAuth CTA |
| FD-091 | Done | Continue after choice |
| FD-092 | Done | `POST /onboarding/connect` |
| FD-093 | Done | `google-oauth-onboarding.md` |
| FD-094 | Done | Redirect URLs documented |
| FD-095 | Done | Consent screen copy doc |
| FD-096 | Done | `calendarError` query handling |
| FD-097 | Done | Post-OAuth success card |
| FD-098 | Done | Picker + `POST /api/calendar/select` |
| FD-099 | Done | Settings disconnect hint in picker |
| FD-100 | Done | Auto-advance after OAuth |
| FD-101 | Done | Skip modal |
| FD-102 | Done | 3-item tradeoff list |
| FD-103 | Done | Go back / skip actions |
| FD-104 | Done | `skip_calendar_warning_ack` |
| FD-105 | Done | Greeting + hint |
| FD-106 | Done | `voice-preview.js` cards |
| FD-107 | Done | Play live opener button |
| FD-108 | Done | `onboarding-preview-parity-qa.md` |
| FD-109 | Done | No hardcoded tone in preview |
| FD-110 | Done | voice-hours-picker |
| FD-111 | Done | OFF nameplate closed days |
| FD-112 | Done | Coverage pre-fills hours |
| FD-113 | Done | After-hours message |
| FD-114 | Done | hours picker wired |
| FD-115 | Done | Outbound toggle |
| FD-116 | Done | Empty state when off |
| FD-117 | Done | Opener hidden when off |
| FD-118 | Done | VO-P1-1 note in spec |
| FD-119 | Done | Martian Mono number |
| FD-120 | Done | Lizard secondary CTA |
| FD-121 | Done | Forwarding table |
| FD-122 | Done | Forward ack checkbox |
| FD-123 | Done | Test call poll + snippet |
| FD-124 | Done | Test call failure message |
| FD-125 | Done | Finish → today checklist |
| FD-126 | Done | Forward ack on checklist |
| FD-127 | Done | Checklist panel |
| FD-128 | Done | API `destination.checklist` |
| FD-129 | Done | Blockers service items |
| FD-130 | Done | Greeting item |
| FD-131 | Done | Test call item |
| FD-132 | Done | Forward line item |
| FD-133 | Done | Shadow week item |
| FD-134 | Done | PMS manual FYI |
| FD-135 | Done | Celebration state |
| FD-136 | Done | Admin onboarding column link |
| FD-137 | Done | Dismiss + localStorage |
| FD-138 | Done | Step indices 1–6 wizard |
| FD-139 | Done | Step X of 7 eyebrow |
| FD-140 | Done | onboarding_state machine |
| FD-141 | Done | trial-activation alignment |
| FD-142 | Done | wizard_step on showStep |
| FD-143 | Done | Mobile CSS + doc note |
| FD-144 | Done | Connect API not sessionStorage |
| FD-145 | Done | Address in saveSettings |
| FD-146 | Done | applyCoverageModeToHours |
| FD-147 | Done | BAA gate |
| FD-148 | Done | assertInviteEmailAvailable + inline err |
| FD-149 | Done | Modal password ops-only |
| FD-150 | Done | onboarding-api.js |
| FD-151 | Done | Today API checklist |
| FD-152 | Done | forward_line_ack API |
| FD-153 | Done | test-call/latest poll |
| FD-154 | Done | Calendar picker post-OAuth |
| FD-155 | Done | Skip modal checklist |
| FD-156 | Done | Stepper invite done |
| FD-157 | Done | login device card |
| FD-158 | Done | invite already-used redirect |
| FD-159 | Done | invite inline validation |
| FD-160 | Done | stuck filter tenants |
| FD-161 | Done | tenant detail checklist |
| FD-162 | Done | convert-lead modal |
| FD-163 | Done | WON pill + convert |
| FD-164 | Done | `onboarding-journey.spec.cjs`, `onboarding-mobile.spec.cjs`, `npm run test:e2e:onboarding` — green 2026-07-02 (9/9) |
| FD-165 | Done | onboarding docs bundle |
