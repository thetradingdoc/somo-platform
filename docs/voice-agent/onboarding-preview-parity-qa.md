# Onboarding preview / live parity QA (FD-108)

Manual checklist for voice-setup step 3 (Greeting) before pilot sign-off.

## Preconditions

- Provider logged in with incomplete onboarding on `voice-setup.html?step=3`
- Practice name and transfer number saved on step 1
- Practice address filled (if testing address in opener)

## Steps

1. Enter a custom inbound greeting in `#setupGreeting` (e.g. "Thank you for calling Smile Dental.").
2. Wait for preview panel (`#setupPreview`) to refresh (debounced ~300ms).
3. Open browser devtools → Network → confirm `GET /api/voice-agent/preview` returns 200.
4. Compare **Live call opener** card text to `live_opener` in API response — they must match exactly.
5. Confirm preview includes:
   - AI disclosure appended
   - Practice address appended (when configured)
6. Click **Play live opener** — audio plays without error.
7. Save step and complete wizard; place test call on step 6.
8. Confirm spoken greeting matches preview (subjective listen test).

## Sign-off

| Check | Pass | Notes |
|-------|------|-------|
| Preview text = API `live_opener` | ☐ | |
| Address + disclosure present | ☐ | |
| Play button works | ☐ | |
| Test call matches preview | ☐ | |

**Signed:** _______________ **Date:** _______________
