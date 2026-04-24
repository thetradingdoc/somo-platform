# Patient portal UI screenshots

PNG captures for **Home**, **Routine**, **Calendar**, and **Products** static pages.

## Prerequisite

Install the browser once (repo root):

```bash
npx playwright install chromium
```

## Generate

From the repository root:

```bash
npm run capture:patient-portal-screenshots
```

Optional: set `PATIENT_SCREENSHOT_SESSION_ID` to a valid `patient_session_id` so pages stay on the portal shell instead of redirecting to login (API data may still show errors if the middleware is not reachable from the static server).

```bash
PATIENT_SCREENSHOT_SESSION_ID=your_session_id npm run capture:patient-portal-screenshots
```

## Outputs

Files are written next to this README:

- `portal-home-1280.png`
- `portal-routine-1280.png`
- `portal-calendar-1280.png`
- `portal-products-1280.png`

The script serves `unified-dashboard/` over a local ephemeral port and uses Playwright (1280×900 viewport, full-page capture).

## Git

PNG binaries are intentionally **not** required in git; regenerate locally or in CI when visuals change.
