# Local Test Runbook — Patient Journey & Landing

**Last Updated:** April 6, 2026

Merged from: LOCAL_E2E_RUNBOOK, LOCAL_LANDING_TEST_FLOW.

---

## 1. Start Middleware

```bash
cd middleware-platform
DB_PATH=./middleware-dev.db npm start
# or: npm run dev
```

API at `http://localhost:4000`.

---

## 2. Option A: Voice → Payment → Video (E2E)

1. **Create voice appointment** — Retell/Twilio flow or script → `voice_checkouts` + `appointments` rows
2. **Capture links** — Login + payment links from email/console
3. **Patient login** — `patient-login.html` → email + 6-digit code
4. **Onboarding** — `onboarding.html` (profile, insurance, documents)
5. **Appointments + payment** — `appointments.html` → Pay now → complete
6. **Video visit** — Join video → complete → `createDiagnosticReportForAppointment`

---

## 3. Option B: Landing + Portal (LittleLab)

1. **Seed data:**
   ```bash
   npm run seed:demo
   npm run seed:patient-demo
   ```
2. **Landing** — `http://localhost:4000/` → search → "I'm a Patient"
3. **Login** — `patient@doclittle.com` + code from logs
4. **Onboarding** — Complete 3 steps
5. **Dashboard** — Verify seeded appointment, wallet
6. **Provider** — Log in as `provider@doclittle.com` / `demo123` → see same appointment

---

## 4. Fresh Run

```bash
rm ./middleware-dev.db
DB_PATH=./middleware-dev.db npm run dev
npm run seed:demo
npm run seed:patient-demo
```
