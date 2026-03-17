## Local LittleLab Landing + Portal Test Flow

This flow verifies the end-to-end journey for the 3D landing page, patient portal, and provider dashboard using local seed data.

### 1. Start middleware with a dev database

```bash
cd middleware-platform
DB_PATH=./middleware-dev.db npm run dev
```

Leave this server running.

### 2. Seed demo data

In a second terminal:

```bash
cd middleware-platform
npm run seed:demo
npm run seed:patient-demo
```

- `seed:demo` creates provider/insurer demo accounts (`provider@doclittle.com`, `insurer@doclittle.com`, `patient@doclittle.com`, password `demo123`) and base FHIR/insurance data.
- `seed:patient-demo` focuses on the LittleLab patient journey:
  - Ensures a FHIR patient for **Bala Jones / patient@doclittle.com**.
  - Creates at least one upcoming **Video Consultation** appointment.
  - Seeds a stub `voice_checkouts` row linked to that appointment (for payment flows).
  - Optionally seeds a `patient_documents` row so records are not empty.

### 3. Open the LittleLab landing page

In your browser:

- Navigate to `http://localhost:4000/`.
- Type a symptom or condition into the search box and confirm the 3D cards respond.
- Click **“I’m a Patient”** to go to the patient login page.

### 4. Complete patient login + onboarding

On `patient-login.html`:

1. Enter `patient@doclittle.com`.
2. Retrieve the 6‑digit code from the middleware logs or configured email sink.
3. Enter the code to sign in.
4. If prompted, complete onboarding on `onboarding.html`:
   - Personal details (name, DOB, phone, email).
   - Insurance details.
   - Optional document upload.
5. After step 3, follow the **“Go to my dashboard”** redirect to `patient-dashboard.html`.

### 5. Verify appointment + payment view

From the patient dashboard:

- Open the **Appointments** section and confirm the seeded Video Consultation is visible.
- If payment flows are enabled, confirm any demo charges or balances related to the seeded `voice_checkouts` record.

### 6. Log in as provider and see the same appointment

In a new tab:

1. Go to `http://localhost:4000/unified-dashboard/login.html`.
2. Log in with:
   - Email: `provider@doclittle.com`
   - Password: `demo123`
3. Open the clinic/appointments view and confirm you can see **Bala Jones** and the same upcoming appointment.

### 7. Optional: repeat with a fresh database

If you need a clean run:

```bash
cd middleware-platform
rm ./middleware-dev.db
DB_PATH=./middleware-dev.db npm run dev
npm run seed:demo
npm run seed:patient-demo
```

Then repeat steps 3–6.

