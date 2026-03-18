## Staging deploy + smoke test runbook (mvp-80)

### Preconditions

- **Staging environment exists** with its own:
  - DB
  - Stripe keys (test mode)
  - LiveKit keys
  - Email provider (sandbox is OK)
- **Allowed origins** include the staging portal domain(s)
- **Admin auth** is available for debug endpoints

### Deploy steps (staging)

- **Build + deploy** the API to staging (same artifact as prod)
- **Run DB migrations** with:
  - `MIGRATIONS_STRICT=1`
  - `BACKUP_BEFORE_MIGRATE=1`
- **Verify background workers** start:
  - reminder scheduler (leader elected)
  - notification queue worker

### Smoke tests (10–15 minutes)

#### Auth / Session

- **OTP send**: request OTP for a test patient email
- **OTP confirm**: confirm OTP, verify:
  - `patient_session_id` cookie is set (httpOnly, SameSite)
  - `patient_csrf` cookie is set
- **Session expiry**: wait / simulate TTL and confirm 401 forces re-login

#### Appointments

- **Appointments load** on mobile viewport
- **Reschedule**:
  - does it succeed?
  - does the appointment move to the new time?
  - does a reschedule email get delivered (queued → sent)?
- **Cancel**:
  - does it succeed?
  - does the appointment disappear or show canceled?
  - does a cancel email get delivered (queued → sent)?

#### Video join

- **Join window enforcement**:
  - before join window: Join is blocked
  - within join window: token is issued
- **Token scoping**:
  - cannot mint tokens for arbitrary rooms

#### Payments

- **Checkout load** from payment link
- **Payment process** (test flow):
  - success transitions receipt/appointment states
  - receipt is visible in patient portal

#### Documents

- **Upload** a document
- **Download** via token:
  - link works once
  - token is revoked/used after download
- **Export** endpoint returns metadata + signed URLs

#### Ops / Observability

- **Application Insights** (or configured provider) receives:
  - request traces
  - exceptions
- **Ops dashboard**:
  - `GET /api/admin/ops/summary` returns counters + dead-letter notifications

### Go / No-go

- **Go** if all critical flows pass (auth, appointments, video, payments, docs) and notification queue has **no growing dead-letter**.
- **No-go** if:
  - OTP is unstable / blocked incorrectly
  - video tokens fail within join window
  - payment lifecycle doesn’t reconcile
  - documents cannot be securely downloaded

