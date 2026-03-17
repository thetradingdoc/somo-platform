## LittleLab – Landing, Search & Signup TODOs

**Scope**: Public landing, patient signup/access, provider login entry.  
**Brand**: LittleLab (replacing DocLittle on patient-facing flows).

---

## 1. Landing Page & 3D Search Shell

### 1.1 Backend – RAG search API (1 task)

1. **Create RAG search endpoint**
   - New route `middleware-platform/routes/rag-search.js`:
     - `GET /api/rag/search?q=<query>&limit=20`.
     - Wraps `knowledgeService.getCodeCandidatesDualSource(q, options)`.
     - Normalises response to `{ query, icd10: [], cpt: [], hcpcs: [] }`.
   - Wire in `server.js`:
     - `const ragSearchRoutes = require('./routes/rag-search');`
     - `app.use('/api/rag', ragSearchRoutes);`

### 1.2 React 3D App – structure & logic (7 tasks)

2. **Refactor `App.jsx` into data-driven 3D cards**
   - Replace static image cards with medical code cards.
   - Card fields: `code`, `label`, `category`, `confidence`, `color`.
   - Idle state uses a curated list of common diagnoses/procedures.

3. **Add `useRAGSearch.js` hook**
   - Debounced (≈350 ms) client-side search.
   - Calls `/api/rag/search` and shapes codes into card objects.
   - Exposes `{ query, setQuery, cards, loading }`.

4. **Create `Search.jsx` overlay**
   - Glassmorphic search box overlaid on 3D canvas.
   - Shows spinner while `loading`.
   - Shows hint text when query length ≥ 2.

5. **Create `RoleSelect.jsx`**
   - Two CTAs:
     - “I’m a Patient” → `/unified-dashboard/patients/patient-login.html`.
     - “I’m a Provider” → `/unified-dashboard/login.html`.
   - Secondary subtitle adapts slightly when a query is present.

6. **Update `index.js` (React root)**
   - Compose:
     - `<App cards={cards} />` for the 3D scene.
     - `<Search />` and `<RoleSelect />` inside a `.ui-layer` overlay.
   - Use `useRAGSearch()` hook at the top level.

7. **Update `styles.css` for LittleLab**
   - Dark “clinical” background, Playfair Display for `LittleLab` wordmark.
   - Glassmorphism for search + CTAs.
   - Custom cursor (small golden circle) with smooth animation.
   - Responsive layout (full screen, mobile-friendly).

8. **Wire LittleLab landing into Express**
   - Build the React landing app (CRA or Vite).
   - Serve static build under `middleware-platform/public/landing/`.
   - In `server.js`, route the root:
     - `app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/landing/index.html')));`

### 1.3 Branding & naming (2 tasks)

9. **Rename patient-facing brand DocLittle → LittleLab**
   - Update titles and logo text in:
     - Landing React app.
     - `unified-dashboard/patients/*` HTML heads and visible headings.

10. **Add `LittleLab` copy guidelines**
    - Brief section in `docs/architecture/branding/` (or similar):
      - Tone, tagline (“Your virtual care companion”), and usage rules.

---

## 2. Patient Signup / Access Flow

### 2.1 Patient entry & navigation (4 tasks)

11. **Make landing the primary entry for patients**
    - Ensure `/` or marketing entry points land on the new LittleLab 3D search.
    - Role CTA “I’m a Patient” takes the user directly to patient login.

12. **Clarify patient vs provider routes**
    - Patient portal entry:
      - `/unified-dashboard/patients/patient-login.html`.
    - Provider/clinic entry:
      - `/unified-dashboard/login.html` (business login).

13. **Clean up provider login (`login.html`)**
    - Remove “Bala Jones (Patient)” demo button.
    - Keep “Quick test accounts” only when `?test=true` (if desired).
    - Change “Create Account” link to correct path:
      - `/unified-dashboard/signup.html` (or Express route serving that file).

14. **Update patient portal branding**
    - `patient-login.html`:
      - Title: “LittleLab Patient Portal”.
      - Copy: “Access your LittleLab portal” (email + 6-digit code).

### 2.2 Patient login → onboarding → dashboard (4 tasks)

15. **Confirm email-code login UX**
    - Keep existing endpoints:
      - `POST /api/patient/verify/send`
      - `POST /api/patient/verify/confirm`
    - Ensure patient login copy never mentions passwords or Google sign-in.

16. **Post-verify redirect logic**
    - After successful `/verify/confirm`:
      - Call `GET /api/patient/profile` with `x-session-id`.
      - If `profile_verified && insurance_verified`:
        - Redirect → `patients/patient-dashboard.html`.
      - Else:
        - Redirect → `patients/onboarding.html`.

17. **Finalize `patients/onboarding.html` UX**
    - Three clear sections:
      1. Personal details (name, DOB, contact).
      2. Insurance details.
      3. Documents upload.
    - Backed by existing endpoints:
      - `GET/PUT /api/patient/profile`
      - `GET/PUT /api/patient/insurance`
      - `GET/POST /api/patient/documents`

18. **Onboarding completion flag**
    - Ensure backend sets:
      - `profile_verified`, `profile_verified_at`
      - `insurance_verified`, `insurance_verified_at`
    - After successful step 3, show CTA:
      - “Go to my dashboard” → `patients/patient-dashboard.html`.

---

## 3. Provider / Clinic Signup Flow

### 3.1 Provider login page cleanup (3 tasks)

19. **Clarify provider login copy**
    - `login.html`:
      - Header: “LittleLab Clinic Dashboard”.
      - Subtext: “For providers and clinic staff”.

20. **Provider forgot password flow**
    - Ensure `forgot password` form posts to working backend route or:
      - Temporarily hide the link if not implemented.

21. **Provider signup path**
    - `signup.html`:
      - Verify fields align with backend tenant creation (clinic name, email, domain, etc.).
      - Ensure it does not overlap with patient onboarding language.

---

## 4. Local Test Data & Developer Experience

### 4.1 Seed scripts & test scenarios (3 tasks)

22. **Local patient test data script**
    - Seed one or more patients (e.g. “Bala Jones”) with:
      - `fhir_patients`, `appointments`, `voice_checkouts`, `patient_documents` (optional).
    - Script: `npm run seed:patient-demo`.

23. **Local provider test data**
    - Ensure `seed:demo` sets up:
      - One clinic + provider user.
      - Matching login credentials for `login.html` (no embedded demo buttons).

24. **Document local test flows**
    - Short doc under `docs/architecture/patients/LOCAL_LANDING_TEST_FLOW.md`:
      - Steps:
        1. Start middleware with `DB_PATH=./middleware-dev.db`.
        2. Run seed scripts.
        3. Open `/` → use 3D search → click “I’m a Patient”.
        4. Complete login + onboarding + appointment/payment check.
        5. Optionally, log in as provider and see matching appointment.

---

## 5. Configuration & Env

### 5.1 Config wiring (3 tasks)

25. **API base configuration for React landing**
    - Respect `REACT_APP_API_BASE` / `API_BASE_URL` in:
      - `useRAGSearch` calls.
    - Ensure dev builds target `http://localhost:4000` by default.

26. **Route consistency in `config.js`**
    - Update `unified-dashboard/assets/js/config.js` as needed so:
      - Patient paths and provider paths are generated consistently.
      - Tenant config doesn’t conflict with the new landing.

27. **Rename references from DocLittle → LittleLab**
    - Especially in:
      - `config.js` console logs / comments.
      - Visible text on landing, patient, and provider UIs.

---

## 6. User Journeys (for validation)

### 6.1 Patient journeys

28. **Journey A – New patient via landing**
    1. User visits `/` → sees LittleLab 3D search.
    2. Types “cough and fever” → sees relevant cards.
    3. Clicks “I’m a Patient”.
    4. Enters email → receives code (local: see logs).
    5. Enters code → onboarding (profile/insurance/docs).
    6. Lands on `patient-dashboard.html` with upcoming appointment and payment link (if any).

29. **Journey B – Returning patient**
    1. Visits `/` → clicks “I’m a Patient”.
    2. Enters email, code.
    3. If already verified profile/insurance:
       - Redirect straight to dashboard.
    4. Else:
       - Redirect to onboarding to finish missing steps.

30. **Journey C – Patient + appointment payment**
    1. Matches Journey A or B.
    2. Goes to `appointments.html`.
    3. Uses “Pay now” link; on success:
       - Appointment becomes `confirmed`/`paid`.

### 6.2 Provider journeys

31. **Journey D – Provider login from landing**
    1. Visits `/` → clicks “I’m a Provider”.
    2. Arrives at `login.html`, logs in with seeded credentials.
    3. Lands on `business-dashboard.html`.

32. **Journey E – Provider signup**
    1. From `login.html`, clicks “Create account”.
    2. Arrives at `signup.html`, submits clinic info.
    3. Receives onboarding instructions (email + dashboard link).

---

## Summary

- **Total high-level tasks**: 32  
- Grouped into:
  - Landing & 3D search (10)
  - Patient signup/access (8)
  - Provider signup/login (3)
  - Local test data & DX (3)
  - Config & env (3)
  - Journey validation (5)

