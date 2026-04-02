// server.js - FIXED WITH PAYMENT ORCHESTRATOR AND PROPER DATABASE
// Load environment variables from .env if dotenv is available.
// In Azure, env vars are provided by App Settings, so dotenv may not be installed.
try {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isProduction = nodeEnv === 'production' || nodeEnv === 'prod';
  // In local/dev test runs, prefer .env values over inherited shell exports.
  require('dotenv').config({ override: !isProduction });
} catch (e) {
  console.warn('⚠️  dotenv not found - skipping .env loading (Azure App Settings will be used instead)');
}

// SECURITY: Validate environment variables on startup
const { validateAndExitIfInvalid } = require('./utils/env-validator');
validateAndExitIfInvalid();

// Enforce JWT for FHIR/DiagnosticReport in production to avoid accidental open PHI endpoints.
const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
if (isProd) {
  const requireJwtForFhir = process.env.REQUIRE_JWT_FOR_FHIR === '1' || process.env.REQUIRE_JWT_FOR_FHIR === 'true';
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!requireJwtForFhir) {
    console.error('❌ REQUIRE_JWT_FOR_FHIR must be set to \"1\" in production. Refusing to start.');
    process.exit(1);
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('❌ JWT_SECRET must be set (min 32 chars) in production. Refusing to start.');
    process.exit(1);
  }
  const rtfv =
    process.env.REQUIRE_TRIAGE_FOR_VOICE === '1' || process.env.REQUIRE_TRIAGE_FOR_VOICE === 'true';
  if (!rtfv) {
    console.warn(
      '⚠️  PRODUCTION: REQUIRE_TRIAGE_FOR_VOICE is not enabled. Voice /voice/... routes may skip DB triage when session_id/call_id is omitted. Set REQUIRE_TRIAGE_FOR_VOICE=1 (see middleware-platform/docs/VOICE_TRIAGE_PARITY.md).'
    );
  }
}

// LangSmith: route traces to Doctor Little project
try {
  require('./utils/langsmith-config');
} catch (e) { /* ignore */ }

// Application Insights (optional - before other requires)
try {
  require('./middleware/application-insights').init();
} catch (e) {
  console.warn('⚠️  Application Insights init skipped:', e.message);
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// Node 18+ has global fetch; fallback to axios where needed
// Initialize Stripe with proper configuration and validation
const stripeConfig = require('./utils/stripe-config');
let stripe = null;
try {
  stripe = stripeConfig.initializeStripe();
} catch (error) {
  // If it's a validation error, it's a security issue - log it but continue
  if (error.message.includes('SECURITY ERROR')) {
    console.error('❌', error.message);
    // Don't exit in server.js - let the specific route handlers deal with it
  } else {
    console.warn('⚠️  Stripe not configured - Payment features will be limited');
  }
}
const axios = require('axios');
// Google APIs (optional - for Calendar integration)
let google;
try {
  google = require('googleapis').google;
} catch (error) {
  console.warn('⚠️  googleapis not available - Calendar features will be disabled');
  google = null;
}
const { v4: uuidv4 } = require('uuid');
const {
  requireAdminAuth,
  handleAdminLogin,
  handleAdminLogout,
  adminSessionStatus,
  hasValidSession
} = require('./middleware/admin-auth');
const { generateApiKey, hashApiKey } = require('./utils/api-keys');

// Try to load bcryptjs, but make it optional for now
let bcrypt;
try {
  bcrypt = require('bcryptjs');
  console.log('✅ bcryptjs loaded - password hashing enabled');
} catch (e) {
  console.log('⚠️  bcryptjs not installed - run "npm install bcryptjs" to enable password hashing');
  console.log('⚠️  Using basic auth for now (demo mode only)');
  bcrypt = null;
}

// Import database and services
const db = require('./database');
const constants = require('./utils/constants');
const PaymentOrchestrator = require('./services/payment-orchestrator');
const PaymentFlowService = require('./services/payment-flow-service');
const { sanitizeForLog, safeLogRequestBody } = require('./services/payment-security');
const SMSService = require('./services/sms-service');
const FHIRService = require('./services/fhir-service');
const FHIRAdapter = require('./adapters/fhir-adapter');
const BookingService = require('./services/booking-service');
const ReminderScheduler = require('./services/reminder-scheduler');
const KellyToolExecutor = require('./services/kelly-tool-executor');
const { normalizeToE164 } = require('./utils/phone-e164');
const {
  resolveVoiceSessionIdForGuard,
  requireVoiceSessionIdForTriageParity,
  enforceVoiceTriageGuardrailsForSession
} = require('./services/voice-triage-guards');
const PostgresSyncWorker = require('./services/postgres-sync-worker');
const ToolCallDlqWorker = require('./services/tool-call-dlq-worker');
const EhrSyncJobWorker = require('./services/ehr-sync-job-worker');
const InsuranceService = require('./services/insurance-service');
const PayerCacheService = require('./services/payer-cache-service');
const Metrics = require('./services/metrics');
const ProviderService = require('./services/provider-service');
const PatientPortalService = require('./services/patient-portal-service');
const PatientIntakeService = require('./services/patient-intake-service');
const EHRAggregatorService = require('./services/ehr-aggregator-service');
const EHRSyncService = require('./services/ehr-sync-service');
const EpicAdapter = require('./services/epic-adapter');
const RetellService = require('./services/retell-service');
const livekitTokenRoutes = require('./routes/livekit');
const authTokenRoutes = require('./routes/auth-tokens');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/jwt-fhir-auth');

// Import Stripe Issuing Service (optional)
let StripeIssuingService;
try {
  StripeIssuingService = require('./services/stripe-issuing-service');
} catch (e) {
  console.warn('⚠️  Stripe Issuing Service not available:', e.message);
  StripeIssuingService = null;
}

// CircleService - make it optional (don't crash if CIRCLE_API_KEY is not set)
// CircleService exports a singleton instance, so we can use it directly
let CircleService;
try {
  CircleService = require('./services/circle-service');
  // Check if the service is available (has API key and is configured)
  if (!CircleService.isAvailable()) {
    console.warn('⚠️  Circle service is not fully configured. Wallet features will be limited.');
    console.warn('   Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET to enable Circle wallets.');
  } else {
    console.log('✅ Circle service initialized and available');
  }
} catch (error) {
  console.warn('⚠️  Circle service not available:', error.message);
  console.warn('   Server will continue without Circle wallet features.');
  CircleService = null;
}

// Make Twilio optional - only initialize if configured
let twilio = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  console.log('✅ Twilio configured');
} else {
  console.log('⚠️  Twilio not configured - SMS will be skipped');
}

function getGoogleOAuthClient() {
  if (!google || !google.auth) {
    return null;
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return null;
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000'}/auth/google/calendar/callback`;

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeState(state) {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
  } catch (error) {
    console.warn('⚠️  Failed to decode Google OAuth state:', error.message);
    return {};
  }
}

const app = express();
const PORT = process.env.PORT || 4000;

// ============================================
// SMART-on-FHIR discovery + OAuth2 (minimal)
// ============================================

function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.API_BASE_URL || process.env.BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/.well-known/smart-configuration', (req, res) => {
  const base = publicBaseUrl(req);
  return res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    jwks_uri: `${base}/oauth/jwks`,
    response_types_supported: ['code', 'token'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    scopes_supported: [
      'openid',
      'fhirUser',
      'patient/Patient.read',
      'patient/Appointment.read',
      'patient/Encounter.read',
      'patient/DocumentReference.read',
      'patient/DiagnosticReport.read',
      'patient/Binary.read',
      'patient/Provenance.read',
      'patient/Consent.read',
      'user/*.*',
      'system/*.*'
    ],
    capabilities: [
      'launch-standalone',
      'permission-v1',
      'client-confidential-symmetric'
    ]
  });
});

// Minimal JWKS endpoint (symmetric JWTs can't publish a real JWK).
app.get('/oauth/jwks', (req, res) => {
  return res.status(501).json({ error: 'jwks_not_supported', error_description: 'Server uses symmetric JWT signing' });
});

// Minimal authorize endpoint stub (interactive SMART launch not implemented yet)
app.get('/oauth/authorize', (req, res) => {
  return res.status(501).send('SMART authorization_code flow not implemented. Use client_credentials or internal /api/auth/* token issuers.');
});

// Client credentials token (confidential clients only)
app.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
  try {
    if (!JWT_SECRET) return res.status(500).json({ error: 'server_error', error_description: 'JWT not configured' });

    const auth = (req.headers.authorization || '').toString();
    let clientId = req.body.client_id;
    let clientSecret = req.body.client_secret;
    if (auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        clientId = decoded.slice(0, idx);
        clientSecret = decoded.slice(idx + 1);
      }
    }

    const grantType = req.body.grant_type;
    if (grantType !== 'client_credentials') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    const expectedId = process.env.SMART_CLIENT_ID || '';
    const expectedSecret = process.env.SMART_CLIENT_SECRET || '';
    if (!expectedId || !expectedSecret) {
      return res.status(501).json({ error: 'oauth_not_configured', error_description: 'Set SMART_CLIENT_ID/SMART_CLIENT_SECRET' });
    }
    if (clientId !== expectedId || clientSecret !== expectedSecret) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    const requestedScopes = (req.body.scope || '').toString().split(/\s+/).filter(Boolean);
    const allowed = new Set([
      'openid',
      'fhirUser',
      'user/*.*',
      'system/*.*',
      'patient/Patient.read',
      'patient/Appointment.read',
      'patient/Encounter.read',
      'patient/DocumentReference.read',
      'patient/DiagnosticReport.read',
      'patient/Binary.read',
      'patient/Provenance.read',
      'patient/Consent.read'
    ]);
    const scopes = (requestedScopes.length ? requestedScopes : ['system/*.*']).filter(s => allowed.has(s));

    const token = jwt.sign(
      { sub: clientId, scope: 'system', scopes },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    return res.json({
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      scope: scopes.join(' ')
    });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', error_description: e.message });
  }
});

// ============================================
// Patient portal authz helpers (mvp-27)
// ============================================
function requirePatientSession(req, res, next) {
  const headerSession = req.headers['x-session-id'];
  const cookieSession = req.cookies?.patient_session_id;
  const sessionId = headerSession || cookieSession;
  if (!sessionId) {
    return res.status(401).json({ success: false, error: 'x-session-id required' });
  }
  req.usedCookieAuth = !headerSession && !!cookieSession;
  const sessionValidation = PatientPortalService.validateSession(sessionId);
  if (!sessionValidation.valid) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
  req.patientSessionId = sessionId;
  req.patientSession = sessionValidation;
  return next();
}

/** Provider portal auth: X-Provider-Id header or customer_session for provider customers. */
function requireProviderAuth(req, res, next) {
  const providerId = req.headers['x-provider-id'];
  if (providerId) {
    req.providerId = providerId;
    return next();
  }
  const sessionId = req.cookies?.customer_session;
  if (sessionId) {
    const session = db.getCustomerSession && db.getCustomerSession(sessionId);
    const customer = session && db.getCustomer && db.getCustomer(session.customer_id);
    if (customer?.email) {
      req.providerId = customer.email;
      return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized. Provide X-Provider-Id header or customer session.' });
}

function issueCsrfCookie(res) {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  const token = crypto.randomBytes(20).toString('hex');
  res.cookie('patient_csrf', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 24 * 60 * 60 * 1000
  });
  return token;
}

function requireCsrfForCookieAuth(req, res, next) {
  const method = (req.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (!unsafe) return next();
  if (!req.usedCookieAuth) return next(); // header-based x-session-id is not cookie-auth

  const cookieToken = (req.cookies?.patient_csrf || '').toString();
  const headerToken = (req.headers['x-csrf-token'] || '').toString();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ success: false, error: 'CSRF validation failed' });
  }
  return next();
}

async function rotatePatientSessionIfNeeded(req, res) {
  if (!req.usedCookieAuth) return;
  const hours = parseInt(process.env.PATIENT_SESSION_ROTATE_HOURS || '6', 10);
  const rotateMs = Math.max(1, hours) * 60 * 60 * 1000;
  try {
    const row = db.db.prepare(`
      SELECT id, email, phone, patient_id, verified, verified_at
      FROM patient_portal_sessions
      WHERE id = ? LIMIT 1
    `).get(req.patientSessionId);
    if (!row || !row.verified) return;
    const verifiedAtMs = row.verified_at ? new Date(row.verified_at).getTime() : NaN;
    if (Number.isNaN(verifiedAtMs)) return;
    if (Date.now() - verifiedAtMs < rotateMs) return;

    const { v4: uuidv4 } = require('uuid');
    const newId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.db.prepare(`
      INSERT INTO patient_portal_sessions
        (id, patient_id, phone, email, verification_code, verified, verified_at, expires_at, created_at, last_seen_at)
      VALUES
        (?, ?, ?, ?, NULL, 1, datetime('now'), ?, datetime('now'), datetime('now'))
    `).run(newId, row.patient_id || null, row.phone || null, row.email || null, expiresAt);

    // P-2: Invalidate old session row so validateSession rejects revoked sessions
    db.db.prepare(`
      UPDATE patient_portal_sessions
      SET revoked_at = datetime('now'), rotated_to = ?
      WHERE id = ?
    `).run(newId, row.id);

    const isSecure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
    res.cookie('patient_session_id', newId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 24 * 60 * 60 * 1000
    });
    issueCsrfCookie(res);
  } catch (e) {
    console.warn('⚠️  rotatePatientSessionIfNeeded failed:', e?.message || e);
  }
}

function assertPatientOwnsAppointmentOrThrow(sessionValidation, appointment) {
  const sessionEmail = (sessionValidation.email || '').toLowerCase().trim();
  const sessionPhone = sessionValidation.phone || null;
  if (
    appointment.patient_id &&
    sessionValidation.patient_id &&
    appointment.patient_id !== sessionValidation.patient_id
  ) {
    throw Object.assign(new Error('Not allowed to access this appointment'), { status: 403 });
  }
  if (!appointment.patient_id) {
    const emailMatches =
      appointment.patient_email &&
      sessionEmail &&
      appointment.patient_email.toLowerCase().trim() === sessionEmail;
    const phoneMatches =
      appointment.patient_phone && sessionPhone && appointment.patient_phone === sessionPhone;
    if (!emailMatches && !phoneMatches) {
      throw Object.assign(new Error('Not allowed to access this appointment'), { status: 403 });
    }
  }
}

function validateYyyyMmDd(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function validateHhMm(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [hh, mm] = s.split(':').map(n => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false;
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function withIdempotency(operationType) {
  return (req, res, next) => {
    const key = (req.headers['idempotency-key'] || '').toString().trim();
    if (!key) return next();

    // If completed, return cached response
    const cached = db.getIdempotentResult ? db.getIdempotentResult(key, operationType) : null;
    if (cached && cached.result) {
      return res.json({ ...cached.result, idempotent: true });
    }

    // Reserve key to prevent double-write
    const reservation = db.reserveIdempotencyKey ? db.reserveIdempotencyKey(key, operationType) : 'reserved';
    if (reservation === 'completed') {
      const c2 = db.getIdempotentResult ? db.getIdempotentResult(key, operationType) : null;
      if (c2 && c2.result) return res.json({ ...c2.result, idempotent: true });
    }
    if (reservation === 'in_progress') {
      return res.status(409).json({ success: false, error: 'Request already in progress for this Idempotency-Key' });
    }

    req.idempotencyKey = key;
    req.idempotencyOperation = operationType;

    // Hook response json to store success results
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        if (key && body && body.success && db.completeIdempotentResult) {
          db.completeIdempotentResult(key, operationType, body);
        }
      } catch (_) { /* ignore */ }
      return originalJson(body);
    };

    res.on('finish', () => {
      // If request failed, release pending reservation so client can retry.
      if (key && res.statusCode >= 400 && db.releaseIdempotencyKey) {
        try { db.releaseIdempotencyKey(key, operationType); } catch (_) {}
      }
    });
    // Bug 6: Release key on close (socket closed without res.end, e.g. crash before response)
    res.on('close', () => {
      if (key && !res.writableEnded && db.releaseIdempotencyKey) {
        try { db.releaseIdempotencyKey(key, operationType); } catch (_) {}
      }
    });
    return next();
  };
}

/** C2 / impl-11: When LEGACY_APPOINTMENTS_API_DISABLED=1, legacy booking APIs return 410 Gone with replacement routes. */
function legacyAppointmentsApiDisabled(res) {
  const off =
    process.env.LEGACY_APPOINTMENTS_API_DISABLED === '1' ||
    process.env.LEGACY_APPOINTMENTS_API_DISABLED === 'true';
  if (!off) return false;
  res.status(410).json({
    success: false,
    error: 'GONE',
    error_code: 'LEGACY_APPOINTMENTS_API_DEPRECATED',
    message:
      'This legacy /api/appointments/* endpoint is disabled. Integrations must migrate to authenticated patient routes or voice routes.',
    replacement_routes: {
      schedule: 'POST /api/patient/booking/schedule (requires patient session)',
      available_slots: 'GET /api/patient/booking/available-slots or POST /voice/appointments/available-slots',
      reschedule: 'PUT /api/patient/appointments/:id/reschedule (patient session) or POST /voice/appointments/reschedule'
    },
    documentation: 'docs/architecture/BOOKING_CHECKOUT_ARCHITECTURE_ANALYSIS.md §6.5',
    runbook: 'middleware-platform/docs/VOICE_TRIAGE_PARITY.md',
    hint: 'Set LEGACY_APPOINTMENTS_API_DISABLED=0 only for a short migration window.'
  });
  return true;
}

// Patient: Support config (mvp-60)
app.get('/api/patient/support-config', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    // Resolve patient -> clinic_id (best effort)
    let clinicId = null;
    try {
      if (sessionValidation.patient_id && db.getPatientClinicIds) {
        const ids = db.getPatientClinicIds(sessionValidation.patient_id);
        clinicId = (ids && ids[0]) || null;
      }
    } catch (_) {}

    const fromDb = (k) => {
      try {
        if (!clinicId) return null;
        const row = db.db.prepare(`SELECT value FROM clinic_settings WHERE clinic_id = ? AND key = ? LIMIT 1`).get(clinicId, k);
        return row ? row.value : null;
      } catch (_) { return null; }
    };

    const phone = fromDb('support_phone') || process.env.CLINIC_SUPPORT_PHONE || '';
    const email = fromDb('support_email') || process.env.CLINIC_SUPPORT_EMAIL || '';
    const hours = fromDb('support_hours') || process.env.CLINIC_SUPPORT_HOURS || '';

    const { getClinicBusinessHours } = require('./config/clinic-business-hours');
    const clinicHours = clinicId ? getClinicBusinessHours(clinicId) : null;
    const timezone = clinicHours?.timezone || process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York';

    const slotHoldTtl = parseInt(process.env.APPOINTMENT_PAYMENT_TTL_MINUTES || '30', 10);

    return res.json({
      success: true,
      clinic_id: clinicId,
      support: { phone, email, hours },
      timezone,
      slot_hold_ttl_minutes: Math.max(10, Math.min(60, slotHoldTtl))
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Patient: "me" bootstrap (mvp-fhir-13)
// Minimal safe identity for the patient UI; FHIR-first pages should use this instead of calling /fhir/* directly.
app.get('/api/patient/me', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const patientId = sessionValidation.patient_id || null;

    // Resolve FHIR Patient (best effort)
    let patientRow = null;
    try {
      if (patientId && db.getFHIRPatient) patientRow = db.getFHIRPatient(patientId);
      if (!patientRow && sessionValidation.email && db.getFHIRPatientByEmail) patientRow = db.getFHIRPatientByEmail(sessionValidation.email);
      if (!patientRow && sessionValidation.phone && db.getFHIRPatientByPhone) patientRow = db.getFHIRPatientByPhone(sessionValidation.phone);
    } catch (_) {}

    let displayName = 'Patient';
    let resolvedId = patientRow?.resource_id || patientId || null;
    let canonicalIntake = null;
    let onboarding = { onboarding_complete: false, missing_fields: ['first_name', 'last_name', 'dob', 'phone', 'country', 'city'] };
    try {
      const r = patientRow?.resource_data
        ? (typeof patientRow.resource_data === 'string' ? JSON.parse(patientRow.resource_data) : patientRow.resource_data)
        : null;
      if (r && r.name && r.name[0]) {
        const given = Array.isArray(r.name[0].given) ? r.name[0].given.join(' ') : (r.name[0].given || '');
        const family = r.name[0].family || '';
        const nm = `${given} ${family}`.trim();
        if (nm) displayName = nm;
      } else if (patientRow?.name) {
        displayName = patientRow.name;
      }
      if (r && PatientIntakeService && PatientIntakeService.canonicalFromPatientResource) {
        canonicalIntake = PatientIntakeService.canonicalFromPatientResource(r);
        onboarding = PatientIntakeService.onboardingStatusFromCanonical(canonicalIntake);
      }
    } catch (_) {}

    return res.json({
      success: true,
      patient: {
        id: resolvedId,
        name: displayName
      },
      onboarding: onboarding,
      intake: canonicalIntake
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================
// Patient intake (web + voice canonical schema)
// ============================================

app.get('/api/patient/intake', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId, patientRow } = resolvePatientIdFromSession(sessionValidation);
    const resource = patientRow?.resource_data
      ? (typeof patientRow.resource_data === 'string' ? JSON.parse(patientRow.resource_data) : patientRow.resource_data)
      : null;
    const canonical = resource && PatientIntakeService.canonicalFromPatientResource
      ? PatientIntakeService.canonicalFromPatientResource(resource)
      : {
        first_name: '',
        last_name: '',
        dob: '',
        phone: '',
        email: (sessionValidation?.email || '').toString(),
        country: '',
        city: '',
        address_line1: '',
        postal_code: '',
        city_place_id: ''
      };
    const status = PatientIntakeService.onboardingStatusFromCanonical(canonical);
    return res.json({
      success: true,
      patient_id: patientId || null,
      intake: canonical,
      ...status
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/patient/intake', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const payload = req.body && typeof req.body === 'object' ? req.body : {};

    const patientId = await PatientIntakeService.resolveOrCreatePatientIdFromSession(sessionValidation, payload);
    if (!patientId) {
      return res.status(500).json({ success: false, error: 'Unable to resolve or create patient record' });
    }

    const result = await PatientIntakeService.upsertIntakeByPatientId(patientId, payload);
    if (!result.success) return res.status(400).json(result);

    // Persist patient_id onto the portal session row for faster resolution later
    try {
      db.db.prepare(`
        UPDATE patient_portal_sessions
        SET patient_id = COALESCE(patient_id, ?)
        WHERE id = ?
      `).run(patientId, req.patientSessionId);
    } catch (_) {}

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Patient identity bundle for record-matching (no PHI beyond demographics)
app.get('/api/patient/identity', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId, patientRow } = resolvePatientIdFromSession(sessionValidation);
    const resource = patientRow?.resource_data
      ? (typeof patientRow.resource_data === 'string' ? JSON.parse(patientRow.resource_data) : patientRow.resource_data)
      : null;
    const canonical = resource && PatientIntakeService.canonicalFromPatientResource
      ? PatientIntakeService.canonicalFromPatientResource(resource)
      : {
        first_name: '',
        last_name: '',
        dob: '',
        phone: (sessionValidation?.phone || '').toString(),
        email: (sessionValidation?.email || '').toString(),
        country: '',
        city: '',
        address_line1: '',
        postal_code: '',
        city_place_id: ''
      };
    const canConnect = PatientIntakeService.canConnectRecordsFromIntake
      ? PatientIntakeService.canConnectRecordsFromIntake(canonical)
      : false;
    return res.json({
      success: true,
      patient_id: patientId || null,
      identity: canonical,
      can_connect_records: !!canConnect
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Geo helper for city autocomplete (web onboarding)
// Uses Google Places if configured, otherwise falls back to a minimal in-process list.
app.get('/api/geo/city-autocomplete', (req, res, next) => apiLimiter(req, res, next), async (req, res) => {
  try {
    const q = (req.query?.q || '').toString().trim();
    if (q.length < 2) return res.json({ success: true, items: [] });

    const key = (process.env.GOOGLE_MAPS_API_KEY || '').toString().trim();
    if (key) {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=(cities)&key=${encodeURIComponent(key)}`;
        const r = await fetch(url);
        const data = await r.json();
        const preds = Array.isArray(data?.predictions) ? data.predictions : [];
        const items = preds.map(p => ({
          label: p.description,
          city: p.structured_formatting?.main_text || p.description,
          country: (p.terms && p.terms.length ? p.terms[p.terms.length - 1].value : ''),
          place_id: p.place_id || ''
        }));
        return res.json({ success: true, items });
      } catch (_) {
        // fall through to local fallback
      }
    }

    // Fallback: small list-based suggestions (no external dependency)
    const haystack = [
      { label: 'Austin, United States', city: 'Austin', country: 'United States', place_id: '' },
      { label: 'New York, United States', city: 'New York', country: 'United States', place_id: '' },
      { label: 'San Francisco, United States', city: 'San Francisco', country: 'United States', place_id: '' },
      { label: 'London, United Kingdom', city: 'London', country: 'United Kingdom', place_id: '' },
      { label: 'Toronto, Canada', city: 'Toronto', country: 'Canada', place_id: '' }
    ];
    const lc = q.toLowerCase();
    const items = haystack.filter(x => x.label.toLowerCase().includes(lc));
    return res.json({ success: true, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

function resolvePatientIdFromSession(sessionValidation) {
  try {
    if (!sessionValidation) return { patientId: null, patientRow: null };
    if (sessionValidation.patient_id && db.getFHIRPatient) {
      const r = db.getFHIRPatient(sessionValidation.patient_id);
      return { patientId: sessionValidation.patient_id, patientRow: r || null };
    }
    if (sessionValidation.email && db.getFHIRPatientByEmail) {
      const r = db.getFHIRPatientByEmail(sessionValidation.email);
      return { patientId: r ? r.resource_id : null, patientRow: r || null };
    }
    if (sessionValidation.phone && db.getFHIRPatientByPhone) {
      const r = db.getFHIRPatientByPhone(sessionValidation.phone);
      return { patientId: r ? r.resource_id : null, patientRow: r || null };
    }
    return { patientId: sessionValidation.patient_id || null, patientRow: null };
  } catch (_) {
    return { patientId: sessionValidation?.patient_id || null, patientRow: null };
  }
}

function buildDocumentReferenceFromPatientDocRow(row, req) {
  const patientId = row.patient_id;
  const id = row.id;
  const contentType = row.file_type || 'application/octet-stream';
  const title = row.file_name || 'Document';
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
  const encounterRef = row.encounter_id ? { reference: `Encounter/${row.encounter_id}` } : null;

  return {
    resourceType: 'DocumentReference',
    id,
    status: 'current',
    subject: patientId ? { reference: `Patient/${patientId}` } : undefined,
    date: createdAt,
    description: title,
    context: encounterRef ? { encounter: [encounterRef] } : undefined,
    content: [{
      attachment: {
        contentType,
        title,
        url: `${req.protocol}://${req.get('host')}/fhir/Binary/${id}`
      }
    }]
  };
}

async function syncFhirEncounterFromAppointment(appointmentId) {
  try {
    if (!appointmentId) return;
    const appt = db.getAppointment ? db.getAppointment(appointmentId) : null;
    if (!appt || !appt.patient_id) return;
    const FHIRResources = require('./models/fhir-resources');
    const encId = appt.id;
    const existing = db.getFHIREncounter ? db.getFHIREncounter(encId) : null;

    const encStatus =
      appt.status === 'completed' ? 'finished' :
      appt.status === 'canceled' ? 'cancelled' :
      appt.status === 'live' ? 'in-progress' :
      'planned';

    const startIso = appt.start_time || null;
    const resource = FHIRResources.createEncounter({
      id: encId,
      patientId: appt.patient_id,
      patientName: appt.patient_name || '',
      callId: encId,
      status: encStatus,
      type: appt.appointment_type || 'Telehealth visit',
      startTime: startIso || new Date().toISOString(),
      ...(appt.end_time ? { endTime: appt.end_time } : {})
    });
    resource.extension = Array.isArray(resource.extension) ? resource.extension : [];
    resource.extension.push({ url: 'https://doclittle.health/extension/appointment-status', valueString: appt.status || 'unknown' });
    if (appt.payment_status) resource.extension.push({ url: 'https://doclittle.health/extension/payment-status', valueString: appt.payment_status });

    if (!existing && db.createFHIREncounter) db.createFHIREncounter(resource);
    if (existing && db.updateFHIREncounter) db.updateFHIREncounter(encId, resource);
  } catch (_) {}
}

// Patient: Export documents metadata + signed download URLs (mvp-70)
app.get('/api/patient/documents/export', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) patient = db.getFHIRPatient(sessionValidation.patient_id);
    if (!patient && sessionValidation.email) patient = db.getFHIRPatientByEmail(sessionValidation.email);
    if (!patient && sessionValidation.phone) patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    const patientId = patient ? patient.resource_id : sessionValidation.patient_id;
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found' });

    const docs = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];
    const base = `${req.protocol}://${req.get('host')}`;
    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);

    const exported = [];
    for (const d of docs) {
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
      db.createPatientDocumentDownloadToken && db.createPatientDocumentDownloadToken({
        token,
        doc_id: d.id,
        patient_id: patientId,
        expires_at: expiresAtIso
      });
      exported.push({
        id: d.id,
        file_name: d.file_name,
        file_type: d.file_type,
        status: d.status,
        created_at: d.created_at,
        download_url: `${base}/api/patient/documents/download/${token}`
      });
    }

    return res.json({ success: true, documents: exported });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Trust proxy - required for Azure App Service and express-rate-limit
// This allows Express to correctly identify client IPs behind proxies
app.set('trust proxy', true);

// Import WebSocket for Retell LLM
const WebSocket = require('ws');
const RetellWebSocketHandler = require('./webhooks/retell-websocket');

// Import middleware
const { securityHeaders, sanitizeInput, requestLogger } = require('./middleware/security');
const {
  apiLimiter,
  publicCatalogReadLimiter,
  publicCommerceLimiter,
  authLimiter,
  paymentLimiter,
  voiceLimiter,
  scheduleCheckoutLimiter
} = require('./middleware/rate-limiter');
const { check: clinicRateLimitCheck } = require('./utils/clinic-rate-limiter');
const { usageLogger, logVoiceCall, logFunctionCall, logError } = require('./middleware/usage-logger');
let errorHandler, asyncHandler, withTimeout, withRetry, logErrorHandler;
let healthCheckHandler, readinessCheck, livenessCheck;

// Load reliability middleware (graceful fallback if missing)
try {
  const errorHandlerModule = require('./middleware/error-handler');
  errorHandler = errorHandlerModule.errorHandler;
  asyncHandler = errorHandlerModule.asyncHandler;
  withTimeout = errorHandlerModule.withTimeout;
  withRetry = errorHandlerModule.withRetry;
  logErrorHandler = errorHandlerModule.logError;
} catch (err) {
  console.warn('⚠️  Error handler module not found, using fallback');
  errorHandler = (err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  };
  asyncHandler = (fn) => fn;
  withTimeout = (fn) => fn;
  withRetry = async (fn) => fn();
  logErrorHandler = () => { };
}

try {
  const healthCheckModule = require('./middleware/health-check');
  healthCheckHandler = healthCheckModule.healthCheckHandler;
  readinessCheck = healthCheckModule.readinessCheck;
  livenessCheck = healthCheckModule.livenessCheck;
} catch (err) {
  console.warn('⚠️  Health check module not found, using fallback');
  healthCheckHandler = (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() });
  readinessCheck = (req, res) => res.json({ ready: true });
  livenessCheck = (req, res) => res.json({ alive: true });
}

const logger = require('./services/logger');

// mvp-72: Environment-controlled log level; suppress noisy logs in production
if (isProd && !process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'warn';
  logger.logLevel = 'warn';
}
try {
  const original = {
    log: console.log.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  console.log = (...args) => { if (logger.shouldLog('info')) original.log(...args); };
  console.info = (...args) => { if (logger.shouldLog('info')) original.info(...args); };
  console.debug = (...args) => { if (logger.shouldLog('debug')) original.debug(...args); };
} catch (_) {}

// mvp-73: Lightweight bot/WAF guard for public endpoints (kept intentionally simple)
function botGuard(req, res, next) {
  if (!isProd && !(process.env.BOT_GUARD_ENABLED === '1' || process.env.BOT_GUARD_ENABLED === 'true')) return next();
  const ua = (req.get('user-agent') || '').toLowerCase();
  const p = (req.path || '').toLowerCase();
  const suspicious =
    !ua ||
    /curl|wget|python|httpclient|scrapy|spider|scanner|nikto|nmap|sqlmap|go-http-client|java\/|okhttp|bot\b/.test(ua);
  const sensitive =
    p.includes('/api/patient/verify/') ||
    p.includes('/api/payment/process') ||
    p.includes('/api/payment/verify-code') ||
    p.includes('/api/payment/create-intent');
  if (suspicious && sensitive) {
    return res.status(403).json({ success: false, error: 'Request blocked' });
  }
  return next();
}

// Security middleware (must be first)
app.use(securityHeaders);

// Remove CSP for patient video page (Safari iOS blocks HTTP requests with strict CSP)
app.use('/patients/video-call.html', (req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  next();
});

// Remove CSP for calendar (FullCalendar CDN + data: fonts need style-src/font-src)
app.use(['/business/calendar.html', '/unified-dashboard/business/calendar.html'], (req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  next();
});

// CORS
// IMPORTANT: We must explicitly allow credentials and trusted origins,
// otherwise browser requests with `credentials: 'include'` will fail
// with a generic "Failed to fetch" error (as seen on tenant login).
const allowedOrigins = [
  'https://doclittle.site',
  'https://www.doclittle.site',
  'https://api.doclittle.site',
  'http://localhost:4000',
  'http://localhost:3000'
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser / same-origin requests with no Origin header (e.g. curl, internal calls)
    if (!origin) {
      return callback(null, true);
    }

    // Allow explicit origins in the safelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow any subdomain of doclittle.site (e.g. akin-dunbar.doclittle.site)
    if (/^https?:\/\/([a-z0-9-]+\.)*doclittle\.site$/i.test(origin)) {
      return callback(null, true);
    }

    // Allow ngrok domains (for HTTPS testing: https://xxxx.ngrok-free.app)
    if (/^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/.test(origin) || /^https:\/\/[a-z0-9-]+\.ngrok\.io$/.test(origin)) {
      return callback(null, true);
    }

    // Allow local network IPs (for mobile testing: http://10.x.x.x:4000, http://192.168.x.x:4000)
    // This is safe in development - restrict in production
    if (process.env.NODE_ENV === 'development' || process.env.ALLOW_LIVE_KEYS_IN_DEV === 'true') {
      if (/^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9.]+:\d+$/.test(origin)) {
        return callback(null, true);
      }
    }

    // Block everything else
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-session-id', 'x-journey-id', 'idempotency-key'],
  exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));
// Handle preflight for all routes
app.options('*', cors(corsOptions));

const { correlationIdMiddleware } = require('./middleware/request-context');
app.use(correlationIdMiddleware);

// Cookie parser
app.use(cookieParser());

// Stripe webhook — MUST be before express.json() (raw body required for signature verification)
const { stripeWebhookRouter } = require('./routes/stripe-webhook-handler');
app.use('/webhooks/stripe', stripeWebhookRouter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (console)
app.use(requestLogger);

// Enhanced usage logging (database) - for API endpoints and /public/* catalog aliases (normalized to /api/public/* in logs)
app.use('/api/', usageLogger);
app.use('/public/', usageLogger);

// Input sanitization
app.use(sanitizeInput);

// Global rate limiting
app.use('/api/', apiLimiter);

// Provider Availability (must be early so no other middleware intercepts)
const ProviderServiceAvail = require('./services/provider-service');
app.get('/api/customers/me/availability-status', authLimiter, (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = db.getCustomerSession(sessionId);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) return res.status(404).json({ success: false, error: 'Customer not found' });
    const status = ProviderServiceAvail.getProviderStatus(customer.email);
    res.json({ success: true, status: status || { is_online: false, availability_rules: null, updated_at: null } });
  } catch (e) {
    console.error('Get availability status error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.patch('/api/customers/me/availability-status', authLimiter, express.json(), (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = db.getCustomerSession(sessionId);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) return res.status(404).json({ success: false, error: 'Customer not found' });
    const { is_online } = req.body || {};
    if (typeof is_online === 'boolean') ProviderServiceAvail.setProviderOnline(customer.email, is_online);
    const status = ProviderServiceAvail.getProviderStatus(customer.email);
    res.json({ success: true, status });
  } catch (e) {
    console.error('Patch availability status error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get('/api/customers/me/availability-blocks', authLimiter, (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = db.getCustomerSession(sessionId);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) return res.status(404).json({ success: false, error: 'Customer not found' });
    const blocks = ProviderServiceAvail.getAvailabilityBlocks(customer.email, req.query.start, req.query.end);
    res.json({ success: true, blocks });
  } catch (e) {
    console.error('Get availability blocks error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/api/customers/me/availability-blocks', authLimiter, express.json(), (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = db.getCustomerSession(sessionId);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) return res.status(404).json({ success: false, error: 'Customer not found' });
    const { block_type, start_datetime, end_datetime, title } = req.body || {};
    if (!block_type || !['available', 'out_of_office'].includes(block_type))
      return res.status(400).json({ success: false, error: 'block_type must be "available" or "out_of_office"' });
    if (!start_datetime || !end_datetime)
      return res.status(400).json({ success: false, error: 'start_datetime and end_datetime required' });
    const block = ProviderServiceAvail.createAvailabilityBlock({ provider_email: customer.email, block_type, start_datetime, end_datetime, title: title || null });
    res.json({ success: true, block });
  } catch (e) {
    console.error('Create availability block error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.delete('/api/customers/me/availability-blocks/:id', authLimiter, (req, res) => {
  try {
    const sessionId = req.cookies?.customer_session;
    if (!sessionId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const session = db.getCustomerSession(sessionId);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid session' });
    const customer = db.getCustomer(session.customer_id);
    if (!customer || !customer.email) return res.status(404).json({ success: false, error: 'Customer not found' });
    const deleted = ProviderServiceAvail.deleteAvailabilityBlock(customer.email, req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Block not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Delete availability block error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// API Documentation routes (protected - requires signup + terms acceptance)
app.get('/docs', (req, res, next) => {
  // Check for customer session cookie
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) {
    // Redirect to signup
    return res.redirect('/?redirect=/docs');
  }

  // Verify session exists in database
  const session = db.getCustomerSession(sessionId);
  if (!session) {
    return res.redirect('/?redirect=/docs');
  }

  // Update last accessed
  db.updateCustomerSessionAccess(sessionId);

  // Check customer exists and has accepted terms
  const customer = db.getCustomer(session.customer_id);
  if (!customer || !customer.email_verified) {
    return res.redirect('/?redirect=/docs');
  }

  const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
  if (!termsAccepted) {
    return res.redirect('/terms?redirect=/docs');
  }

  // REQUIRED: Check if payment method is verified (MANDATORY)
  const hasVerifiedPayment = customer.stripe_payment_method_id && customer.card_verified === 1;
  if (!hasVerifiedPayment) {
    // Payment verification is MANDATORY - redirect to verify-card
    // Check customer_type to determine proper redirect
    const customer = db.getCustomer(session.customer_id);
    const customerType = customer?.customer_type || 'saas';
    const cardVerifyRedirect = customerType === 'saas'
      ? '/business/business-dashboard.html'
      : '/docs';
    return res.redirect(`/verify-card?redirect=${encodeURIComponent(cardVerifyRedirect)}&customer_type=${customerType}`);
  }

  // Customer is authenticated, has accepted terms, and has verified payment method - serve docs
  res.sendFile(path.join(__dirname, 'public', 'docs', 'index.html'));
});

app.get('/docs/*', (req, res, next) => {
  const relativePath = req.path.replace('/docs/', '');
  const filePath = path.join(__dirname, 'public', 'docs', relativePath);
  const fs = require('fs');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    next();
  }
});

// Admin Portal - REMOVED: Admin portal should be on doclittle.site/admin, not api.doclittle.site/admin

// ============================================
// Domain-based Routing
// Serve frontend for doclittle.site, API for api.doclittle.site
// ============================================

// Helper function to get hostname (strip port; support [IPv6]:port)
function getHostname(req) {
  const host = req.headers.host;
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(1, end);
  }
  const idx = host.lastIndexOf(':');
  if (idx > 0 && !host.includes(']')) return host.slice(0, idx);
  return host;
}

// Helper function to extract subdomain from hostname
function getSubdomain(hostname) {
  if (!hostname) return null;

  // Remove port if present
  const host = hostname.split(':')[0];

  // Split by dots
  const parts = host.split('.');

  // For localhost, no subdomain
  if (host === 'localhost' || host === '127.0.0.1') {
    return null;
  }

  // For known domains, extract subdomain
  // e.g., "tenant.doclittle.site" -> "tenant"
  // e.g., "tenant.doclittle.azurewebsites.net" -> "tenant"
  if (parts.length >= 3) {
    // Check if it's a known domain
    const knownDomains = ['doclittle.site', 'doclittle.azurewebsites.net'];
    const domain = parts.slice(-2).join('.'); // Get last 2 parts (e.g., "doclittle.site")
    const azureDomain = parts.slice(-3).join('.'); // Get last 3 parts for Azure (e.g., "doclittle.azurewebsites.net")

    if (knownDomains.includes(domain) || knownDomains.includes(azureDomain)) {
      // Return first part as subdomain
      return parts[0];
    }
  }

  return null;
}

// Helper function to get unified-dashboard path (works both locally and in Azure)
function getUnifiedDashboardPath(...subPaths) {
  const fs = require('fs');
  // Try Azure/production path first (unified-dashboard in same directory)
  let azurePath = path.join(__dirname, 'unified-dashboard', ...subPaths);
  if (fs.existsSync(azurePath)) {
    return azurePath;
  }
  // Fallback to local dev path (unified-dashboard in parent directory)
  return path.join(__dirname, '..', 'unified-dashboard', ...subPaths);
}

// Helper function to get littlelab landing build path (works both locally and in Azure)
function getLittleLabBuildPath(...subPaths) {
  const fs = require('fs');
  let azurePath = path.join(__dirname, 'unified-dashboard', 'littlelab-landing', 'build', ...subPaths);
  if (fs.existsSync(azurePath)) {
    return azurePath;
  }
  return path.join(__dirname, '..', 'unified-dashboard', 'littlelab-landing', 'build', ...subPaths);
}

/** Prefer CRA LittleLab landing build, then middleware public marketing page. */
function trySendLittleLabOrPublicLanding(res) {
  const fs = require('fs');
  const landingBuild = getLittleLabBuildPath('index.html');
  if (fs.existsSync(landingBuild)) {
    res.sendFile(landingBuild);
    return true;
  }
  const legacyLandingPath = path.join(__dirname, 'public', 'landing.html');
  if (fs.existsSync(legacyLandingPath)) {
    res.sendFile(legacyLandingPath);
    return true;
  }
  return false;
}

const ROOT_API_RUNNING_STUB_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>DocLittle API</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.5;max-width:40rem">' +
  '<p>Middleware API is running.</p>' +
  '<p>To serve the Skin &amp; Care landing at <code>/</code>, build the LittleLab app:</p>' +
  '<pre style="background:#f4f4f5;padding:1rem;border-radius:8px;overflow:auto">cd unified-dashboard/littlelab-landing && npm install && npm run build</pre>' +
  '</body></html>';

function sendLittleLabOrApiRunningStub(res) {
  if (trySendLittleLabOrPublicLanding(res)) return;
  res.type('text/html').send(ROOT_API_RUNNING_STUB_HTML);
}

/** Loopback and, in non-production, RFC1918 LAN hosts (phone-on-WiFi dev). */
function isLocalDevRootHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  if (isProd) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h);
}

// Root endpoint - route based on domain
app.get('/', (req, res) => {
  const hostname = getHostname(req);
  const subdomain = getSubdomain(hostname);

  // Tenant subdomain routing (e.g., tenant.doclittle.site)
  if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
    // Look up merchant by subdomain
    const merchant = db.getMerchantBySubdomain(subdomain);

    if (merchant) {
      // Check if user has valid session
      const sessionId = req.cookies?.customer_session;
      if (sessionId) {
        const session = db.getCustomerSession(sessionId);
        if (session) {
          const customer = db.getCustomer(session.customer_id);
          // Verify customer belongs to this merchant
          if (customer && customer.merchant_id === merchant.id) {
            // User is authenticated and belongs to this tenant - serve dashboard
            const dashboardPath = getUnifiedDashboardPath('business', 'business-dashboard.html');
            if (require('fs').existsSync(dashboardPath)) {
              return res.sendFile(dashboardPath);
            }
          }
        }
      }
      // No valid session or wrong tenant - redirect to login
      return res.redirect(`/login?subdomain=${subdomain}`);
    }
    // Subdomain not found - fall through to default routing
  }

  // Local / dev hosts — same marketing priority as production (LittleLab build, then public/landing.html)
  if (isLocalDevRootHost(hostname)) {
    sendLittleLabOrApiRunningStub(res);
    return;
  }

  // API subdomain - check if user is already logged in
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    // Check if user has valid session
    const sessionId = req.cookies?.customer_session;
    if (sessionId) {
      const session = db.getCustomerSession(sessionId);
      if (session) {
        // Check customer exists and has accepted terms BEFORE redirecting to docs
        const customer = db.getCustomer(session.customer_id);
        if (customer && customer.email_verified) {
          const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
          if (termsAccepted) {
            // Check payment method verification (required before accessing docs)
            const hasVerifiedPayment = customer.stripe_payment_method_id && customer.card_verified === 1;
            if (hasVerifiedPayment) {
              // User is fully authenticated - redirect to docs
              return res.redirect('/docs');
            } else {
              // Payment verification required - redirect to verify-card
              return res.redirect('/verify-card?redirect=/docs');
            }
          } else {
            // Terms not accepted - redirect to terms page (MANDATORY)
            return res.redirect('/terms?redirect=/docs');
          }
        }
      }
    }
    // No valid session or not fully authenticated - show signup page
    return res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
  }

  // Root domain - prefer LittleLab React landing build, otherwise legacy marketing page
  if (hostname === 'doclittle.site' || hostname === 'www.doclittle.site' || hostname === 'doclittle.azurewebsites.net') {
    const landingBuild = getLittleLabBuildPath('index.html');
    if (require('fs').existsSync(landingBuild)) {
      console.log('[ROOT ROUTE] Serving LittleLab landing build (doclittle.site)');
      return res.sendFile(landingBuild);
    }
    const legacyLandingPath = path.join(__dirname, 'public', 'landing.html');
    if (require('fs').existsSync(legacyLandingPath)) {
      return res.sendFile(legacyLandingPath);
    }
  }

  // Default fallback - ONLY for API subdomain or unknown domains
  // CRITICAL: If we got here with a tenant subdomain, redirect to login instead
  if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
    console.log(`[ROOT ROUTE] Tenant subdomain "${subdomain}" but merchant not found - redirecting to login`);
    return res.redirect('/login');
  }

  // Default fallback to signup (ONLY for API subdomain or unknown domains)
  // Check for session first
  const sessionId = req.cookies?.customer_session;
  if (sessionId) {
    const session = db.getCustomerSession(sessionId);
    if (session) {
      // Check customer exists and has accepted terms BEFORE redirecting to docs
      const customer = db.getCustomer(session.customer_id);
      if (customer && customer.email_verified) {
        const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
        if (termsAccepted) {
          // Check payment method verification (required before accessing docs)
          const hasVerifiedPayment = customer.stripe_payment_method_id && customer.card_verified === 1;
          if (hasVerifiedPayment) {
            // User is fully authenticated - redirect to docs
            return res.redirect('/docs');
          } else {
            // Payment verification required - redirect to verify-card
            return res.redirect('/verify-card?redirect=/docs');
          }
        } else {
          // Terms not accepted - redirect to terms page (MANDATORY)
          return res.redirect('/terms?redirect=/docs');
        }
      }
    }
  }

  // Never leave GET / unanswered (avoids hung sockets and accidental catch-all 404 for edge Host values)
  sendLittleLabOrApiRunningStub(res);
});

// ============================================
// Unified Dashboard Routes (doclittle.site frontend)
// ============================================

// Serve unified-dashboard root pages under /unified-dashboard/*
// This is the canonical front-door for Patient Portal vs Provider Portal selection.
app.use('/unified-dashboard', express.static(getUnifiedDashboardPath(), {
  index: false,
  extensions: ['html'],
  maxAge: '5m'
}));

// Short path for Skin & Care landing (same tree as unified-dashboard/littlelab-landing — bookmarks use /littlelab-landing/public/index.html)
app.use('/littlelab-landing', express.static(getUnifiedDashboardPath('littlelab-landing'), {
  index: false,
  extensions: ['html'],
  maxAge: '5m'
}));

// Serve manifest.webmanifest at root (patient/portal pages use href="../manifest.webmanifest")
app.get('/manifest.webmanifest', (req, res) => {
  const manifestPath = getUnifiedDashboardPath('manifest.webmanifest');
  if (require('fs').existsSync(manifestPath)) {
    res.type('application/manifest+json');
    res.sendFile(manifestPath);
  } else {
    res.status(404).json({ error: 'Manifest not found' });
  }
});

// Serve unified-dashboard static assets
app.use('/assets', express.static(getUnifiedDashboardPath('assets'), {
  maxAge: '1d' // Cache static assets for 1 day
}));

// Serve LittleLab React landing static assets
app.use('/static', express.static(getLittleLabBuildPath('static'), {
  maxAge: '1y',
  immutable: true
}));

// Serve extra LittleLab landing assets emitted by CRA build
app.use('/images', express.static(getLittleLabBuildPath('images'), {
  maxAge: '1d'
}));
app.use('/videos', express.static(getLittleLabBuildPath('videos'), {
  maxAge: '1d'
}));

// Serve unified-dashboard HTML pages
app.get('/landing', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.redirect('/');
  }
  res.sendFile(getUnifiedDashboardPath('landing.html'));
});

app.get('/login', (req, res) => {
  const hostname = getHostname(req);
  const subdomain = getSubdomain(hostname);

  console.log(`\n[LOGIN ROUTE] ==========================================`);
  console.log(`[LOGIN ROUTE] REQUEST RECEIVED`);
  console.log(`[LOGIN ROUTE] Hostname: ${hostname}`);
  console.log(`[LOGIN ROUTE] Subdomain: ${subdomain}`);
  console.log(`[LOGIN ROUTE] Path: ${req.path}`);
  console.log(`[LOGIN ROUTE] ==========================================\n`);

  // CRITICAL: Explicitly check for API subdomain first
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    console.log('[LOGIN ROUTE] ✅ API subdomain detected - serving API signup page (code-based)');
    return res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
  }

  // Check for localhost - serve business dashboard login (password-based) for SaaS customers
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    console.log('[LOGIN ROUTE] ✅ Localhost detected - serving business dashboard login');
    const loginPath = getUnifiedDashboardPath('login.html');
    const fs = require('fs');
    if (fs.existsSync(loginPath)) {
      return res.sendFile(loginPath);
    }
  }

  // CRITICAL: Tenant subdomain detection - MUST serve password login page
  if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
    console.log(`[LOGIN ROUTE] 🔍 Tenant subdomain detected: "${subdomain}"`);
    const merchant = db.getMerchantBySubdomain(subdomain);
    if (merchant) {
      console.log(`[LOGIN ROUTE] ✅ Valid tenant found - serving PASSWORD login page for ${subdomain}`);
      const loginPath = getUnifiedDashboardPath('login.html');
      const fs = require('fs');
      if (fs.existsSync(loginPath)) {
        console.log(`[LOGIN ROUTE] ✅ File exists: ${loginPath}`);
        return res.sendFile(loginPath);
      } else {
        console.error(`[LOGIN ROUTE] ❌ File NOT found: ${loginPath}`);
        return res.status(500).send('Login page not found');
      }
    } else {
      console.log(`[LOGIN ROUTE] ⚠️  Subdomain "${subdomain}" not found in database - but still serving tenant login page`);
      // Even if merchant not found, serve tenant login page (not API signup)
      const loginPath = getUnifiedDashboardPath('login.html');
      const fs = require('fs');
      if (fs.existsSync(loginPath)) {
        return res.sendFile(loginPath);
      }
    }
  }

  // Default: serve business dashboard login (password-based) for root domain or other cases
  // THIS SHOULD NEVER SERVE API SIGNUP PAGE
  console.log('[LOGIN ROUTE] ✅ Serving default business dashboard login (password-based)');
  const loginPath = getUnifiedDashboardPath('login.html');
  const fs = require('fs');
  if (fs.existsSync(loginPath)) {
    console.log(`[LOGIN ROUTE] ✅ File exists: ${loginPath}`);
    return res.sendFile(loginPath);
  } else {
    console.error(`[LOGIN ROUTE] ❌ File NOT found: ${loginPath}`);
    return res.status(500).send('Login page not found');
  }
});

// Handle /login.html requests (redirect to /login or serve same file)
app.get('/login.html', (req, res) => {
  // Just redirect to /login to use the same logic
  return res.redirect('/login');
});

app.get(['/about', '/about.html'], (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  res.sendFile(getUnifiedDashboardPath('about.html'));
});

// Reset password page
app.get('/reset-password', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  res.sendFile(getUnifiedDashboardPath('reset-password.html'));
});

// Signup complete page
app.get('/signup-complete', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  res.sendFile(getUnifiedDashboardPath('signup-complete.html'));
});

// Signup page (use case selection) - only on root domain
app.get('/signup', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    // API subdomain has its own signup flow
    return res.redirect('/');
  }

  // Check if user is already verified and has session - redirect to appropriate dashboard
  const sessionId = req.cookies?.customer_session;
  if (sessionId) {
    const session = db.getCustomerSession(sessionId);
    if (session) {
      const customer = db.getCustomer(session.customer_id);
      if (customer && customer.email_verified) {
        // User is verified - redirect based on customer_type
        const customerType = customer.customer_type || 'saas';
        const redirectUrl = customerType === 'saas'
          ? '/business/business-dashboard.html'
          : '/docs';
        return res.redirect(redirectUrl);
      }
    }
  }

  // Serve use case selection page for root domain
  res.sendFile(getUnifiedDashboardPath('signup.html'));
});

app.get('/signup/saas', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  // SaaS Platform - serve login.html
  res.sendFile(getUnifiedDashboardPath('login.html'));
});

app.get('/signup/form', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.redirect('/');
  }

  // Check if this is for SaaS platform
  const plan = req.query.plan;
  if (plan === 'saas') {
    // SaaS Platform signup/login - serve login.html
    res.sendFile(getUnifiedDashboardPath('login.html'));
  } else {
    // API Integration signup - should redirect to api.doclittle.site
    res.redirect('https://api.doclittle.site');
  }
});

app.get('/index.html', (req, res) => {
  const hostname = getHostname(req);
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  if (trySendLittleLabOrPublicLanding(res)) return;
  return res.status(404).type('text/plain').send('Not found');
});

// Serve unified-dashboard subdirectories
app.use('/business', express.static(getUnifiedDashboardPath('business'), {
  index: false,
  extensions: ['html']
}));

// Redirect business HTML files to /business/ prefix
// This handles cases where links use relative paths that resolve to root
const businessPages = [
  'products.html',
  'orders.html',
  'patients.html',
  'agent.html',
  'billing.html',
  'settings.html',
  'invoices.html',
  'wallets.html',
  'claims.html',
  'treatments.html',
  'records.html',
  'merchant-orders.html',
  'calendar.html',
  'pdf-coding.html',
  'business-dashboard.html'
];

businessPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.redirect(`/business/${page}`);
  });
});

app.use('/patients', express.static(getUnifiedDashboardPath('patients'), {
  index: false,
  extensions: ['html']
}));

app.use('/insurer', express.static(getUnifiedDashboardPath('insurer'), {
  index: false,
  extensions: ['html']
}));

app.use('/admin', (req, res, next) => {
  const hostname = getHostname(req);
  // Admin portal should be on root domain, not API subdomain
  if (hostname === 'api.doclittle.site' || hostname === 'api.doclittle.azurewebsites.net') {
    return res.status(404).json({
      error: 'Admin portal not available on API subdomain',
      message: 'Please access admin portal at https://doclittle.site/admin'
    });
  }

  // Serve admin portal from unified-dashboard/admin
  // When using app.use('/admin', ...), req.path is already stripped of '/admin' prefix
  const adminFile = req.path === '/' || req.path === '' ? 'index.html' : req.path.replace(/^\//, '');
  const adminPath = getUnifiedDashboardPath('admin', adminFile);

  if (require('fs').existsSync(adminPath) && adminPath.includes('unified-dashboard')) {
    return res.sendFile(adminPath);
  }

  // Fallback to middleware-platform admin if exists
  next();
});

// ============================================
// Signup Routes (Customer Registration)
// API routes for signup (POST /api/signup, etc.)
// ============================================
const signupRoutes = require('./routes/signup');
// Only register API routes, not root (root is handled above)
app.use('/api', signupRoutes);

// ============================================
// Credits Routes (Credits Purchase & Balance)
// ============================================
const creditsRoutes = require('./routes/credits');
app.use('/api/credits', creditsRoutes);

// ============================================
// Invoice Routes (Admin & Customer)
// ============================================
const invoiceRoutes = require('./routes/invoices');
app.use('/api', invoiceRoutes);

// Merchant settings/profile routes
const merchantRoutes = require('./routes/merchant');
app.use('/api/merchant', merchantRoutes);
const providerRoutes = require('./routes/providers');
app.use('/api/providers', providerRoutes);

// Clinic Invoice Routes (Patient Billing)
// ============================================
const clinicInvoiceRoutes = require('./routes/invoices-clinic');
app.use('/api/invoices', clinicInvoiceRoutes);

// Products and Orders routes (merged from merchant-shop)
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
app.use('/api/products', productRoutes);
const prescriptionRoutes = require('./routes/prescriptions');
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/prescription-orders', orderRoutes);

// Onboarding routes
const onboardingRoutes = require('./routes/onboarding');
app.use('/api/onboarding', onboardingRoutes);

// Admin job search (scraped jobs for agent outreach)
const adminLeadsRoutes = require('./routes/admin-leads');
app.use('/api/admin/leads', adminLeadsRoutes);

// Sequences (Phase 2)
const sequencesRoutes = require('./routes/sequences');
app.use('/api/sequences', sequencesRoutes);

// Workflows (Enhanced workflow builder with AI actions)
const workflowsRoutes = require('./routes/workflows');
app.use('/api/admin/workflows', workflowsRoutes);

// AI Template Generator (Phase 2)
const aiTemplatesRoutes = require('./routes/ai-templates');
app.use('/api/ai/templates', aiTemplatesRoutes);

// Qualification Rules (Phase 2)
const qualificationRulesRoutes = require('./routes/qualification-rules');
app.use('/api/qualification-rules', qualificationRulesRoutes);

// Admin AI Assistant
const adminAIAssistantRoutes = require('./routes/admin-ai-assistant');
app.use('/api/admin/ai', adminAIAssistantRoutes);

// Admin tenant monitoring routes
const adminTenantsRoutes = require('./routes/admin-tenants');
app.use('/api/admin/tenants', adminTenantsRoutes);

// Tenant config routes
const tenantConfigRoutes = require('./routes/tenant-config');
app.use('/api/tenant', tenantConfigRoutes);

// LiveKit video conferencing (token endpoint)
// (mounted above) app.use('/api/livekit', livekitTokenRoutes);

// RAG proxy (Colab RAG via main tunnel)
const ragProxyRoutes = require('./routes/rag-proxy');
// RAG search (LittleLab landing search -> code candidates)
const ragSearchRoutes = require('./routes/rag-search');
app.use('/api/rag', ragProxyRoutes);
app.use('/api/rag', ragSearchRoutes);

const videoConsultRoutes = require('./routes/video-consult');
app.use('/api/video-consult', videoConsultRoutes);

// Retell custom function endpoints
const retellFunctionsRoutes = require('./routes/retell-functions');
app.use('/api/retell', retellFunctionsRoutes);

// Voice routes (product search, checkout, etc.)
// Apply tenant context middleware to resolve merchant from subdomain
const { tenantContext } = require('./middleware/tenant-context');
const voiceRoutes = require('./routes/voice');
app.use('/voice', tenantContext({ requireTenant: false }), voiceRoutes);

// Voice agent settings (UI-configurable settings)
const voiceAgentSettingsRoutes = require('./routes/voice-agent-settings');
app.use('/api/voice-agent', tenantContext({ requireTenant: false }), voiceAgentSettingsRoutes);

// Payment routes (payment page and processing)
const paymentRoutes = require('./routes/payment');
app.use('/api/payment', botGuard, paymentRoutes);

// Provider case summary API (appointments, SOAP notes, post-visit notes)
const { providerCaseSummaryRouter } = require('./routes/provider-case-summary-route');
app.use('/api/provider', requireProviderAuth, providerCaseSummaryRouter);

// Visit pricing API (Task 16)
const pricingRoutes = require('./routes/pricing');
app.use('/api/pricing', pricingRoutes);

// Customer wallet routes
const customerWalletRoutes = require('./routes/customer-wallet');
app.use('/api/customer/wallet', customerWalletRoutes);

// Public products (read-only) — dedicated rate bucket + legacy /public/* aliases (same handler, one catalog limiter)
const publicProductsRoutes = require('./routes/public-products');
app.use('/api/public/products', publicCatalogReadLimiter, publicProductsRoutes);
app.use('/api/public/prescriptions', publicCatalogReadLimiter, publicProductsRoutes);
app.use('/public/products', publicCatalogReadLimiter, publicProductsRoutes);
app.use('/public/prescriptions', publicCatalogReadLimiter, publicProductsRoutes);

// Public checkout (unauthenticated ensure customer)
const publicCheckoutRoutes = require('./routes/public-checkout');
app.use('/api/public/checkout', publicCheckoutRoutes);

// Commerce quote + cart — separate rate bucket from global /api limiter so bursts do not starve catalog reads
const publicCommerceQuoteRoutes = require('./routes/public-commerce-quote');
const publicCommerceCartRoutes = require('./routes/public-commerce-cart');
app.use('/api/public/commerce', publicCommerceLimiter);
app.use('/api/public/commerce', publicCommerceQuoteRoutes);
app.use('/api/public/commerce', publicCommerceCartRoutes);
app.use('/public/commerce', publicCommerceLimiter);
app.use('/public/commerce', publicCommerceQuoteRoutes);
app.use('/public/commerce', publicCommerceCartRoutes);

const publicCheckoutChatRoutes = require('./routes/public-checkout-chat');
app.use('/api/public/checkout-chat', publicCheckoutChatRoutes);

// ============================================
// Customer Agent Routes (Prompt Management)
// ============================================
const customerAgentRoutes = require('./routes/customer-agent');
app.use('/api/customer/agent', customerAgentRoutes);

// ============================================
// Customer Billing Routes (Pay-as-you-go)
// ============================================
const customerBillingRoutes = require('./routes/customer-billing');
app.use('/api/customer/billing', customerBillingRoutes);

// Customer Dashboard (Tenant-scoped data)
const customerDashboardRoutes = require('./routes/customer-dashboard');
app.use('/api/customer/dashboard', customerDashboardRoutes);

// Chat Commands (Quick Actions)
const chatCommandsRoutes = require('./routes/chat-commands');
app.use('/api/chat', chatCommandsRoutes);

// Automation (Rules, Templates, Message History)
const automationRoutes = require('./routes/automation');
app.use('/api/automation', automationRoutes);

// Outbound Calls
const outboundCallRoutes = require('./routes/outbound-call');
app.use('/api/voice/outbound', outboundCallRoutes);

// Voice Web Call (in-browser voice via Retell Web SDK)
const voiceWebCallRoutes = require('./routes/voice-web-call');
app.use('/api/voice', voiceWebCallRoutes);

// RCM / Financial Intelligence APIs (EMPI-based)
const rcmRoutes = require('./routes/rcm');
app.use('/api/rcm', rcmRoutes);

// Research Bounties (Pharma Data Requests - Impact-Weighted Escrow)
const researchBountiesRoutes = require('./routes/research-bounties');
app.use('/api/research-bounties', researchBountiesRoutes);
// Register /terms route (MANDATORY - requires session and email verification)
app.get('/terms', (req, res) => {
  const sessionId = req.cookies?.customer_session;

  // Check for session (user must be signed up first)
  if (!sessionId) {
    return res.redirect('/?redirect=/terms');
  }

  const session = db.getCustomerSession(sessionId);
  if (!session) {
    return res.redirect('/?redirect=/terms');
  }

  // Check customer exists and email is verified (must complete signup first)
  const customer = db.getCustomer(session.customer_id);
  if (!customer || !customer.email_verified) {
    return res.redirect('/?redirect=/terms');
  }

  // Serve unified terms of service (includes both SaaS and API pricing)
  res.sendFile(path.join(__dirname, 'public', 'signup', 'terms.html'));
});

// Register /profile route (Customer Profile)
app.get('/profile', (req, res) => {
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) {
    return res.redirect('/?redirect=/profile');
  }

  const session = db.getCustomerSession(sessionId);
  if (!session) {
    return res.redirect('/?redirect=/profile');
  }

  const customer = db.getCustomer(session.customer_id);
  if (!customer || !customer.email_verified) {
    return res.redirect('/?redirect=/profile');
  }

  // Check if terms accepted
  const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
  if (!termsAccepted) {
    return res.redirect('/terms?redirect=/profile');
  }

  res.sendFile(path.join(__dirname, 'public', 'profile', 'index.html'));
});

// Register /verify-card route
app.get('/verify-card', (req, res) => {
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) {
    return res.redirect('/?redirect=/verify-card');
  }

  const session = db.getCustomerSession(sessionId);
  if (!session) {
    return res.redirect('/?redirect=/verify-card');
  }

  const customer = db.getCustomer(session.customer_id);
  if (!customer || !customer.email_verified) {
    return res.redirect('/?redirect=/verify-card');
  }

  // Check if terms accepted
  const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
  if (!termsAccepted) {
    return res.redirect('/terms?redirect=/verify-card');
  }

  res.sendFile(path.join(__dirname, 'public', 'signup', 'verify-card.html'));
});

// Register /wallet route (Customer Wallet UI)
app.get('/wallet', (req, res) => {
  const sessionId = req.cookies?.customer_session;
  if (!sessionId) {
    return res.redirect('/?redirect=/wallet');
  }

  const session = db.getCustomerSession(sessionId);
  if (!session) {
    return res.redirect('/?redirect=/wallet');
  }

  const customer = db.getCustomer(session.customer_id);
  if (!customer || !customer.email_verified) {
    return res.redirect('/?redirect=/wallet');
  }

  // Check if terms accepted
  const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
  if (!termsAccepted) {
    return res.redirect('/terms?redirect=/wallet');
  }

  res.sendFile(path.join(__dirname, 'public', 'customer', 'wallet.html'));
});

// Favicon route (prevent 404 errors)
app.get('/favicon.ico', (req, res) => {
  // Return a simple SVG favicon as data URI
  const svgFavicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚕️</text></svg>';
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.send(svgFavicon);
});

// CRITICAL: Block static file serving of API signup page on tenant subdomains
// This MUST come before static file middleware
app.use((req, res, next) => {
  const hostname = req.headers.host?.split(':')[0] || req.headers.host;
  const subdomain = getSubdomain(hostname);

  // Block ANY access to API signup page from tenant subdomains
  if (req.path.includes('/signup') &&
    hostname &&
    !hostname.includes('api.doclittle.site') &&
    !hostname.includes('localhost') &&
    !hostname.includes('127.0.0.1')) {
    if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
      console.log(`[STATIC BLOCK] ⛔ Blocked API signup page access from tenant subdomain: ${subdomain}`);
      console.log(`[STATIC BLOCK] Request path: ${req.path}`);
      return res.redirect('/login');
    }
  }
  next();
});

// Serve static files from public directory (after security middleware and routes)
// CRITICAL: This comes AFTER all routes, so routes take precedence
app.use(express.static(path.join(__dirname, 'public'), {
  // Don't serve index files automatically - let routes handle it
  index: false
}));

console.log('✅ Database initialized');
console.log('✅ FHIR integration enabled');

// ============================================
// RETELL LLM WEBSOCKET SERVER
// ============================================
// Get API base URL - use production domain or localhost for development
const API_BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://doclittle.site' : `http://localhost:${PORT}`);

const retellHandler = new RetellWebSocketHandler(db, {
  apiBaseUrl: API_BASE_URL
});

// Create WebSocket server for Retell LLM (will be attached to HTTP server)
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  console.log('📞 New Retell LLM WebSocket connection');
  retellHandler.handleConnection(ws, req);
});

console.log('✅ Retell LLM WebSocket handler ready');

// ============================================
// FHIR API Routes (Telemedicine Phase 1 — Task 6 JWT, Task 7–8 resource access)
// ============================================
const { jwtFhirAuth } = require('./middleware/jwt-fhir-auth');
const { fhirResourceAccess } = require('./middleware/fhir-resource-access');
const fhirRoutes = require('./routes/fhir');
app.use('/fhir', jwtFhirAuth, fhirResourceAccess, fhirRoutes);

// ============================================
// PDF Medical Coding Routes
// ============================================
const pdfCodingRoutes = require('./routes/pdf-coding');
app.use('/api/pdf-coding', pdfCodingRoutes);

// ============================================
// Usage Tracking Routes
// ============================================
const usageRoutes = require('./routes/usage');
app.use('/api/usage', usageRoutes);

// Usage Monitor Routes (monthly billing & usage tracking)
const usageMonitorRoutes = require('./routes/usage-monitor');
app.use('/api/usage-monitor', usageMonitorRoutes);

// ============================================
// Utility & Helpers
// ============================================

function generateId(prefix = 'tx') {
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function normalizePhoneNumber(phone) {
  if (!phone) return phone;
  const e164 = normalizeToE164(phone);
  return e164 || phone;
}

function calculateFraudScore(data) {
  let score = 0;
  const reasons = [];

  // Phone validation
  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(data.customer_phone)) {
    score += 30;
    reasons.push('Invalid phone format');
  }

  // Check for repeated calls from same number (velocity check)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCalls = db.getTransactionsByPhone(data.customer_phone, oneHourAgo);

  if (recentCalls && recentCalls.length > 3) {
    score += 25;
    reasons.push('Multiple calls in short time');
  }

  // Time-based risk (late night orders)
  const hour = new Date().getHours();
  if (hour < 6 || hour > 23) {
    score += 15;
    reasons.push('Unusual hour');
  }

  // High-value transaction
  if (data.amount > 100) {
    score += 10;
    reasons.push('High-value transaction');
  }

  // New customer risk
  const customerHistory = db.getTransactionsByCustomer(data.customer_phone, null);

  if (customerHistory && customerHistory.length === 0) {
    score += 10;
    reasons.push('New customer');
  }

  // Voice protocol (slightly higher risk)
  if (data.protocol === 'voice') {
    score += 5;
    reasons.push('Voice transaction');
  }

  // Determine risk level
  let riskLevel = 'LOW';
  if (score >= 70) riskLevel = 'HIGH';
  else if (score >= 40) riskLevel = 'MEDIUM';

  return {
    score: Math.min(score, 100),
    level: riskLevel,
    reasons: reasons,
    timestamp: new Date().toISOString()
  };
}

// ============================================
// TWILIO VOICE INCOMING HANDLER
// ============================================
// Twilio sends `application/x-www-form-urlencoded` by default, so we must parse it here.
app.post('/voice/incoming', voiceLimiter, express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('\n📞 INCOMING CALL from Twilio');
    console.log('From:', req.body.From);
    console.log('To:', req.body.To);
    console.log('CallSid:', req.body.CallSid);

    // Check if this is an outbound sales call (from query params)
    const isOutboundSales = req.query.call_type === 'sales_outbound' || req.query.lead_id;
    const leadId = req.query.lead_id;
    const clinicName = req.query.clinic_name ? decodeURIComponent(req.query.clinic_name) : null;

    // Look up SaaS customer by dedicated Twilio phone number first
    const toNumberRaw = req.body.To;
    const normalizedToNumber = normalizePhoneNumber(toNumberRaw);
    let clinicId = null;
    let customerId = null;
    let matchedCustomer = null;

    // For outbound sales calls, use sales agent; otherwise use default
    let retellAgentId = isOutboundSales
      ? (process.env.RETELL_SALES_AGENT_ID || process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a')
      : (process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a');

    if (isOutboundSales) {
      console.log('📞 OUTBOUND SALES CALL DETECTED');
      console.log(`   Lead ID: ${leadId}`);
      console.log(`   Clinic: ${clinicName}`);
      console.log(`   Using Sales Agent: ${retellAgentId}`);

      // For outbound calls, the "To" number is the target (clinic), not our number
      // We don't need to look up customer by number - we have lead_id
      if (leadId) {
        const lead = db.getLead(leadId);
        if (lead) {
          console.log(`✅ Found lead: ${lead.clinic_name}`);
          // Use lead data for context
          clinicId = leadId; // Use lead ID as identifier
        }
      }
    } else {
      const customerByNumber = db.getCustomerByTwilioNumber(normalizedToNumber);
      if (customerByNumber) {
        matchedCustomer = customerByNumber;
        customerId = customerByNumber.id;
        if (customerByNumber.retell_agent_id) {
          retellAgentId = customerByNumber.retell_agent_id;
        }
        console.log(`✅ Matched customer ${customerByNumber.name || customerByNumber.company_name || customerByNumber.id} via Twilio number ${normalizedToNumber}`);

        // CRITICAL: Get merchant_id from customer for voice functions
        if (customerByNumber.merchant_id) {
          console.log(`✅ Customer has merchant_id: ${customerByNumber.merchant_id}`);
        } else {
          console.warn(`⚠️  Customer ${customerId} has no merchant_id. Voice product/order functions may not work.`);
        }

        // Check credit balance before allowing call
        const credits = db.getCustomerCredits(customerId);
        if (!credits || credits.credits_balance_minutes <= 0) {
          // Check if customer has payment method (allows overage)
          const customer = db.getCustomer(customerId);
          const hasPaymentMethod = customer && customer.stripe_payment_method_id && customer.card_verified === 1;

          if (!hasPaymentMethod) {
            console.warn(`⚠️  Customer ${customerId} has no credits and no payment method. Call may be blocked.`);
            // Note: We still allow the call to proceed, but will track overage
            // In production, you might want to block calls here
          } else {
            console.log(`ℹ️  Customer ${customerId} has no credits but has payment method - allowing call with overage billing`);
          }
        } else {
          console.log(`✅ Customer ${customerId} has ${credits.credits_balance_minutes} credits available`);
        }
      } else {
        // Look up legacy clinic mapping
        const clinicPhone = db.getClinicPhoneNumber(normalizedToNumber);
        if (clinicPhone && clinicPhone.clinic_id) {
          clinicId = clinicPhone.clinic_id;
          customerId = clinicId; // Legacy: clinic_id used as customer_id
          const clinic = await db.getClinicById(clinicId);
          if (clinic && clinic.retell_agent_id) {
            retellAgentId = clinic.retell_agent_id;
            console.log(`✅ Found clinic: ${clinic.name} (${clinicId})`);
            console.log(`   Using Retell agent: ${retellAgentId}`);
          }
        } else {
          // Try to find customer by agent_id if provided in query params or headers
          const agentIdFromRequest = req.query.agent_id || req.headers['x-retell-agent-id'];
          if (agentIdFromRequest) {
            const customer = db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(agentIdFromRequest);
            if (customer) {
              matchedCustomer = customer;
              customerId = customer.id;
              retellAgentId = agentIdFromRequest;
              console.log(`✅ Found customer by agent_id: ${customer.name} (${customerId})`);
              console.log(`   Using Retell agent: ${retellAgentId}`);

              // CRITICAL: Get merchant_id from customer for voice functions
              if (customer.merchant_id) {
                console.log(`✅ Customer has merchant_id: ${customer.merchant_id}`);
              } else {
                console.warn(`⚠️  Customer ${customerId} has no merchant_id. Voice product/order functions may not work.`);
              }

              // Check credit balance before allowing call
              const credits = db.getCustomerCredits(customerId);
              if (!credits || credits.credits_balance_minutes <= 0) {
                // Check if customer has payment method (allows overage)
                const customer = db.getCustomer(customerId);
                const hasPaymentMethod = customer && customer.stripe_payment_method_id && customer.card_verified === 1;

                if (!hasPaymentMethod) {
                  console.warn(`⚠️  Customer ${customerId} has no credits and no payment method. Call may be blocked.`);
                  // Note: We still allow the call to proceed, but will track overage
                  // In production, you might want to block calls here
                } else {
                  console.log(`ℹ️  Customer ${customerId} has no credits but has payment method - allowing call with overage billing`);
                }
              } else {
                console.log(`✅ Customer ${customerId} has ${credits.credits_balance_minutes} credits available`);
              }
            } else {
              console.warn(`⚠️  No customer found for agent_id: ${agentIdFromRequest}`);
              console.warn(`   Using default Retell agent: ${retellAgentId}`);
            }
          } else {
            console.warn(`⚠️  No clinic or customer found for phone number: ${normalizedToNumber}`);
            console.warn(`   Using default Retell agent: ${retellAgentId}`);
          }
        }
      }
    }

    // Per-clinic rate limit (Section 17)
    const tenantKey = clinicId || customerId || retellAgentId || (isOutboundSales && leadId) || 'unknown';
    const rateLimit = clinicRateLimitCheck(tenantKey);
    if (!rateLimit.allowed) {
      console.warn(`⚠️  Clinic rate limit exceeded for ${tenantKey} (${rateLimit.limit}/min)`);
      const rateLimitTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We're experiencing high call volume. Please try again in a moment.</Say>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(rateLimitTwiml);
    }

    // CRITICAL: Register call with Retell FIRST (before responding)
    // But use a shorter timeout and handle errors gracefully
    const metadata = {};
    if (req.body.CallSid) {
      metadata.twilio_call_sid = req.body.CallSid;
    }
    // Add lead metadata for outbound sales calls
    if (isOutboundSales && leadId) {
      metadata.lead_id = leadId;
      metadata.call_type = 'sales_outbound';
      metadata.clinic_name = clinicName;
    }
    if (clinicId) {
      metadata.clinic_id = clinicId;
    }
    if (customerId) {
      metadata.customer_id = customerId;
    }
    if (matchedCustomer?.customer_type) {
      metadata.customer_type = matchedCustomer.customer_type;
    }
    // CRITICAL: Add merchant_id to metadata for voice functions (product search, order creation, tracking)
    if (matchedCustomer && matchedCustomer.merchant_id) {
      metadata.merchant_id = matchedCustomer.merchant_id;
      console.log(`✅ Added merchant_id ${matchedCustomer.merchant_id} to voice call metadata`);
    } else if (customerId) {
      // Try to get merchant_id from customer record if not already in matchedCustomer
      const customer = db.getCustomer(customerId);
      if (customer && customer.merchant_id) {
        metadata.merchant_id = customer.merchant_id;
        console.log(`✅ Added merchant_id ${customer.merchant_id} to voice call metadata`);
      } else {
        console.warn(`⚠️  No merchant_id found for customer ${customerId}. Voice product/order functions will not work.`);
      }
    }

    // Use merchant_id from metadata if available, otherwise try to resolve from clinic
    let merchantResolutionReason = 'none';
    let merchantId = metadata.merchant_id;
    if (merchantId) merchantResolutionReason = 'metadata';
    if (!merchantId && customerId) {
      // Try to get merchant from customer's clinic
      const customer = db.getCustomer(customerId);
      if (customer && customer.merchant_id) {
        merchantId = customer.merchant_id;
        merchantResolutionReason = 'customer_record';
      }
    }
    if (!merchantId && clinicId) {
      // Try to get merchant from clinic
      const clinic = await db.getClinicById(clinicId);
      if (clinic && clinic.merchant_id) {
        merchantId = clinic.merchant_id;
        merchantResolutionReason = 'clinic_record';
      }
    }

    // If still no merchant_id, resolve from Retell agent_id (PRIMARY METHOD - agent should be associated with tenant)
    if (!merchantId && retellAgentId) {
      // CRITICAL: Explicit mapping for known agents to ensure correct tenant resolution
      // This ensures the agent ALWAYS connects to the correct tenant
      const agentToSubdomainMap = {
        'agent_9151f738c705a56f4a0d8df63a': 'akin-dunbar' // Explicit mapping for akin-dunbar agent
      };
      
      // Check explicit mapping first (highest priority)
      if (agentToSubdomainMap[retellAgentId]) {
        const mappedSubdomain = agentToSubdomainMap[retellAgentId];
        const mappedMerchant = db.getMerchantBySubdomain(mappedSubdomain);
        if (mappedMerchant) {
          merchantId = mappedMerchant.id;
          merchantResolutionReason = 'agent_subdomain_map';
          console.log(`✅ Resolved merchant_id from explicit agent mapping: ${merchantId} (${mappedMerchant.name || 'unknown'}) for subdomain ${mappedSubdomain}`);
        }
      }
      
      // Method 1: Find merchant directly by agent_id (if merchants table has retell_agent_id column)
      if (!merchantId) {
        try {
          const merchantByAgent = db.db.prepare('SELECT id FROM merchants WHERE retell_agent_id = ? LIMIT 1').get(retellAgentId);
          if (merchantByAgent && merchantByAgent.id) {
            merchantId = merchantByAgent.id;
            merchantResolutionReason = 'merchant_retell_agent_id';
            const merchant = db.getMerchant(merchantId);
            console.log(`✅ Resolved merchant_id directly from merchant agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
          }
        } catch (e) {
          // Column might not exist, continue to other methods
        }
      }
      
      // Method 2: Find customer by agent_id (SaaS customers have agent_id)
      if (!merchantId) {
        const customerByAgent = db.db.prepare('SELECT * FROM customers WHERE retell_agent_id = ?').get(retellAgentId);
        if (customerByAgent && customerByAgent.merchant_id) {
          merchantId = customerByAgent.merchant_id;
          merchantResolutionReason = 'customer_retell_agent_id';
          const merchant = db.getMerchant(merchantId);
          console.log(`✅ Resolved merchant_id from customer agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
        }
      }
      
      // Method 3: Find clinic by agent_id (legacy clinics have agent_id)
      if (!merchantId) {
        const clinicWithAgent = db.db.prepare('SELECT merchant_id FROM clinics WHERE retell_agent_id = ? AND merchant_id IS NOT NULL LIMIT 1').get(retellAgentId);
        if (clinicWithAgent && clinicWithAgent.merchant_id) {
          merchantId = clinicWithAgent.merchant_id;
          merchantResolutionReason = 'clinic_retell_agent_id';
          const merchant = db.getMerchant(merchantId);
          console.log(`✅ Resolved merchant_id from clinic agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
        }
      }
      
      // Last resort: Use default tenant (akin-dunbar) - this ensures the agent always has a merchant
      if (!merchantId) {
        const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN || 'akin-dunbar';
        const defaultMerchant = db.getMerchantBySubdomain(defaultSubdomain);
        if (defaultMerchant) {
          merchantId = defaultMerchant.id;
          merchantResolutionReason = 'default_tenant_subdomain';
          console.log(`✅ Resolved merchant_id from default tenant (${defaultSubdomain}): ${merchantId} (${defaultMerchant.name || 'unknown'})`);
        } else {
          console.error(`❌ CRITICAL: Default tenant (${defaultSubdomain}) not found in database!`);
          // Final fallback: use first available merchant to keep voice flow alive in dev/misconfigured envs.
          try {
            const anyMerchant = (db.getAllMerchants && db.getAllMerchants()[0]) || null;
            if (anyMerchant?.id) {
              merchantId = anyMerchant.id;
              merchantResolutionReason = 'first_available_merchant_fallback';
              console.warn(`⚠️  Falling back to first available merchant: ${merchantId} (${anyMerchant.name || 'unknown'})`);
            }
          } catch (_) {}
        }
      }
    }

    if (!merchantId) {
      console.warn(`⚠️  No merchant_id found for customer ${customerId || 'unknown'} / clinic ${clinicId || 'unknown'}. Voice product/order functions may not work.`);
      merchantResolutionReason = 'unresolved';
    }

    // Optional hard guard: enforce merchant resolution before calling Retell.
    if (!merchantId && (process.env.REQUIRE_MERCHANT_ON_INBOUND === '1' || process.env.REQUIRE_MERCHANT_ON_INBOUND === 'true')) {
      const missingMerchantTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We are unable to route your call right now due to account configuration. Please try again shortly.</Say>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(missingMerchantTwiml);
    }

    const dynamicVariables = {
      merchant_id: merchantId || null
    };

    // For outbound sales calls, add lead-specific variables
    if (isOutboundSales && leadId) {
      const lead = db.getLead(leadId);
      if (lead) {
        dynamicVariables.clinic_name = lead.clinic_name || clinicName || 'the clinic';
        dynamicVariables.clinic_location = lead.location || 'Unknown';
        dynamicVariables.job_title = lead.title || 'Medical Receptionist';
        dynamicVariables.lead_id = leadId;
        dynamicVariables.lead_source = lead.source || 'job_search';
        console.log(`📋 Added lead context to dynamic variables`);
      }
    }

    if (clinicId) {
      dynamicVariables.clinic_id = String(clinicId);
    }
    if (customerId) {
      dynamicVariables.customer_id = String(customerId);
    }
    if (matchedCustomer?.customer_type) {
      dynamicVariables.customer_type = matchedCustomer.customer_type;
    }

    // Pre-populate patient context for cost optimization (P1 - reduce data entry during call)
    if (!isOutboundSales && req.body.From) {
      try {
        const callerPhone = SMSService.formatPhoneNumber(req.body.From);
        let patient = db.getFHIRPatientByPhone(callerPhone);
        if (!patient) {
          const altPhone = normalizePhoneNumber(req.body.From);
          if (altPhone !== callerPhone) patient = db.getFHIRPatientByPhone(altPhone);
        }
        if (patient) {
          const data = patient.resource_data && typeof patient.resource_data === 'object' ? patient.resource_data : {};
          const name = data?.name?.[0];
          const patientName = name ? [name.given?.join(' '), name.family].filter(Boolean).join(' ').trim() : (patient.name || null);
          const hasInsurance = !!(data?.insurance?.length || patient.insurance_verified);
          dynamicVariables.patient_id = String(patient.resource_id);
          if (patientName) dynamicVariables.patient_name = patientName;
          dynamicVariables.has_insurance = hasInsurance ? 'yes' : 'no';
          console.log(`✅ Pre-populated patient context: ${patientName || patient.resource_id} (insurance: ${dynamicVariables.has_insurance})`);
        }
      } catch (e) {
        console.warn('⚠️  Patient pre-population failed:', e.message);
      }
    }

    const registerPayload = {
      agent_id: retellAgentId,
      audio_websocket_protocol: 'twilio',
      audio_encoding: 'mulaw',
      sample_rate: 8000,
      from_number: req.body.From,
      to_number: req.body.To,
      metadata,
      retell_llm_dynamic_variables: dynamicVariables
    };

    try {
      console.log('[VoiceInbound] merchant_resolution', JSON.stringify({
        merchant_id: merchantId || null,
        reason: merchantResolutionReason,
        clinic_id: clinicId || null,
        customer_id: customerId || null,
        retell_agent_id: retellAgentId || null
      }));
    } catch (_) {}

    console.log('📡 Registering call with Retell...');

    let callId = null;
    let sipUri = null;

    try {
      const retellRegisterResp = await axios.post(
        'https://api.retellai.com/v2/register-phone-call',
        registerPayload,
        {
          headers: {
            'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 8000 // allow up to 8 seconds for Retell to respond
        }
      );

      console.log('📊 Retell Register Response:', JSON.stringify(retellRegisterResp.data, null, 2));

      callId = retellRegisterResp.data.call_id;
      console.log('✅ Call registered! Call ID:', callId);

      // Log call to database (async, don't block response)
      // For outbound sales calls, also log to lead_calls
      if (isOutboundSales && leadId) {
        setImmediate(async () => {
          try {
            // Update lead call record with Retell call ID
            const leadCalls = db.db.prepare('SELECT * FROM lead_calls WHERE call_id = ? OR call_id LIKE ?').all(
              req.query.call_id || '',
              `%${req.body.CallSid}%`
            );
            if (leadCalls.length > 0) {
              const leadCall = leadCalls[0];
              db.db.prepare(`
                UPDATE lead_calls 
                SET call_id = ?,
                    call_status = 'ringing',
                    updated_at = datetime('now')
                WHERE id = ?
              `).run(callId, leadCall.id);
              console.log(`📝 Updated lead call record with Retell call ID: ${callId}`);
            }
          } catch (logError) {
            console.error('⚠️  Failed to update lead call:', logError.message);
          }
        });
      }

      if (customerId || clinicId) {
        setImmediate(async () => {
          try {
            // Resolve a valid customers.id for FK-safe voice_call_log inserts.
            // Legacy flows may only have clinic_id; map or create tenant customer as needed.
            let resolvedCustomerId = customerId || null;
            // Guard legacy values (e.g. clinic-default) that are not real customers.id rows.
            if (resolvedCustomerId) {
              const existingCustomer = db.getCustomer?.(resolvedCustomerId) ||
                db.db.prepare('SELECT id FROM customers WHERE id = ? LIMIT 1').get(resolvedCustomerId);
              if (!existingCustomer) {
                resolvedCustomerId = null;
              }
            }
            if (!resolvedCustomerId && clinicId) {
              resolvedCustomerId =
                db.getCustomerIdForClinic?.(clinicId) ||
                db.ensureCustomerIdForClinic?.(clinicId) ||
                null;
              if (!resolvedCustomerId) {
                console.warn(`⚠️  Could not resolve customer_id for clinic ${clinicId}; logging voice call without customer_id`);
              }
            }

            await db.logVoiceCall({
              id: `call-${callId}`,
              customer_id: resolvedCustomerId,
              call_id: callId,
              twilio_call_sid: req.body.CallSid, // Store Twilio CallSid for cost tracking
              call_duration_seconds: null, // Will update when call ends
              function_calls_count: 0,
              status: 'active'
            });
            console.log(`📝 Logged call to database for ${resolvedCustomerId ? 'customer' : 'clinic'}: ${resolvedCustomerId || clinicId}`);
            console.log(`   Twilio CallSid: ${req.body.CallSid}`);
          } catch (logError) {
            console.error('⚠️  Failed to log call:', logError.message);
          }
        });
      }

      // Get SIP URI from Retell response if available, otherwise use default format
      // Retell may return sip_uri, sip_endpoint, or we construct it from call_id
      sipUri = retellRegisterResp.data.sip_uri ||
        retellRegisterResp.data.sip_endpoint ||
        `sip:${callId}@5t4n6j0wnrl.sip.livekit.cloud`;

      console.log('📞 Dialing to Retell SIP endpoint:', sipUri);
      if (isOutboundSales) {
        console.log('   📋 Outbound sales call - using sales agent prompt');
      }
    } catch (retellError) {
      console.error('❌ Retell registration failed:', retellError.message);
      console.error('   RETELL_API_KEY present:', !!process.env.RETELL_API_KEY);
      if (retellError.response) {
        console.error('   Status:', retellError.response.status);
        try {
          console.error('   Data:', JSON.stringify(retellError.response.data));
        } catch (e) {
          console.error('   Data: <unserializable>');
        }
      } else if (retellError.request) {
        console.error('   No response received from Retell (request sent).');
      }
      // If Retell fails, return fallback TwiML (configurable strict/soft behavior).
      const strictRetellFailure =
        process.env.INBOUND_RETELL_STRICT_FAILURE === '1' ||
        process.env.INBOUND_RETELL_STRICT_FAILURE === 'true';
      const errorTwiml = strictRetellFailure ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, we're experiencing technical difficulties. Please try again in a moment.</Say>
  <Hangup/>
</Response>` : `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We are temporarily unable to connect you to the live agent. Please try again in about one minute, or leave your number after the tone and we will call you back.</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">Please leave your callback number now.</Say>
  <Record maxLength="30" playBeep="true"/>
  <Hangup/>
</Response>`;
      return res.type('text/xml').send(errorTwiml);
    }

    // Return TwiML IMMEDIATELY after Retell registration
    // Twilio requires response within 10-15 seconds
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>${sipUri}</Sip>
  </Dial>
</Response>`;

    res.type('text/xml').send(twiml);

    // ========== FHIR INTEGRATION ==========
    // Process FHIR resources asynchronously AFTER responding to Twilio
    // This prevents timeout issues - FAILURES DO NOT BLOCK CALLS
    if (process.env.ENABLE_FHIR !== 'false') {
      setImmediate(async () => {
        try {
          // Only process FHIR if we have customer_id (for proper patient linking)
          if (!customerId) {
            console.log('[FHIR] Skipping FHIR processing - no customer_id found');
            return;
          }

          // Resolve merchant_id from phone number or clinic_id
          let merchantId = null;
          if (clinicId) {
            const clinic = await db.getClinicById(clinicId);
            if (clinic && clinic.merchant_id) {
              merchantId = clinic.merchant_id;
            }
          }
          if (!merchantId && req.body.To) {
            // Try to resolve from phone number
            const clinicPhone = db.getClinicPhoneNumber(req.body.To);
            if (clinicPhone) {
              const clinic = await db.getClinicById(clinicPhone.clinic_id);
              if (clinic && clinic.merchant_id) {
                merchantId = clinic.merchant_id;
              }
            }
          }
          if (!merchantId && customerId) {
            // Try to get from customer
            const customer = db.getCustomer(customerId);
            if (customer && customer.merchant_id) {
              merchantId = customer.merchant_id;
            }
          }

          const callData = FHIRAdapter.retellCallToFHIR({
            call_id: callId,
            from_number: req.body.From,
            to_number: req.body.To,
            metadata: {
              twilio_call_sid: req.body.CallSid,
              merchant_id: merchantId // Use resolved merchant_id, null if not found
            }
          });

          const fhirResources = await FHIRService.processVoiceCall(callData);
          console.log(`[FHIR] ✅ Created Patient: ${fhirResources.patient.id}, Encounter: ${fhirResources.encounter.id}`);

          // Store FHIR IDs for later use
          global.activeCalls = global.activeCalls || {};
          global.activeCalls[callId] = {
            patientId: fhirResources.patient.id,
            encounterId: fhirResources.encounter.id,
            callSid: req.body.CallSid
          };
        } catch (fhirError) {
          // FHIR failures are non-blocking - log but don't crash
          console.error('[FHIR] ⚠️  FHIR processing failed (non-blocking):', fhirError.message);
          if (fhirError.stack) {
            console.error('[FHIR] Stack:', fhirError.stack.split('\n').slice(0, 3).join('\n'));
          }
          // Continue with call - FHIR is optional for voice agent functionality
        }
      });
    }
    // ======================================
    // Main try block ends here - response already sent
  } catch (error) {
    console.error('❌ Error handling incoming call:');

    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   Error:', error.message);
    }

    // Log error to database
    try {
      const toNumber = req.body.To;
      const clinicPhone = db.getClinicPhoneNumber(toNumber);
      const clinicId = clinicPhone ? clinicPhone.clinic_id : null;

      db.logError({
        id: `error-${require('crypto').randomBytes(16).toString('hex')}`,
        customer_id: clinicId,
        error_type: 'VoiceCallError',
        error_message: error.message,
        stack_trace: error.stack,
        request_id: req.body.CallSid,
        endpoint: '/voice/incoming',
        context: JSON.stringify({ from: req.body.From, to: req.body.To }),
        severity: 'high'
      });
    } catch (logError) {
      console.error('⚠️  Failed to log error:', logError.message);
    }

    // Return error TwiML
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, there was an error connecting your call. Please try again later.</Say>
  <Hangup/>
</Response>`;

    res.type('text/xml');
    res.send(errorTwiml);
  }
});

// ============================================
// TWILIO SMS INCOMING (Call deflection P2)
// ============================================
// Configure Twilio Phone Number SMS webhook: https://yoursite.com/sms/incoming
app.post('/sms/incoming', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const from = req.body.From;
    const to = req.body.To;
    const body = req.body.Body || '';
    const smsBooking = require('./services/sms-booking-service');
    const responseText = await smsBooking.processIncoming(from, to, body);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(responseText)}</Message></Response>`;
    res.type('text/xml').send(twiml);
  } catch (error) {
    console.error('❌ SMS incoming error:', error);
    const fallback = 'Sorry, something went wrong. Please call us.';
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(fallback)}</Message></Response>`;
    res.type('text/xml').send(twiml);
  }
});
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Twilio Status Callback - receives call status updates
app.post('/voice/status-callback', voiceLimiter, express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    const direction = req.body.Direction;
    const from = req.body.From;
    const to = req.body.To;
    const sequenceNumber = req.body.SequenceNumber || '0';
    const callDuration = req.body.CallDuration; // Duration in seconds (only on completed calls)
    const callDurationMinutes = callDuration ? parseFloat(callDuration) / 60 : null;

    console.log(`\n📊 CALL STATUS UPDATE`);
    console.log(`   Call SID: ${callSid}`);
    console.log(`   Status: ${callStatus}`);
    console.log(`   Direction: ${direction}`);
    console.log(`   From: ${from} → To: ${to}`);
    console.log(`   Duration: ${callDuration ? `${callDuration}s (${callDurationMinutes?.toFixed(2)} min)` : 'N/A'}`);
    console.log(`   Sequence: ${sequenceNumber}`);

    // Log status update to database if we have a matching call record
    if (callSid) {
      setImmediate(async () => {
        try {
          // Update voice_call_log with duration and calculate costs if call completed
          const voiceCall = db.db.prepare('SELECT * FROM voice_call_log WHERE twilio_call_sid = ? ORDER BY created_at DESC LIMIT 1').get(callSid);

          if (voiceCall) {
            // Update call status and duration
            if (callDuration) {
              db.db.prepare(`
                UPDATE voice_call_log 
                SET call_duration_seconds = ?,
                    call_duration_minutes = ?,
                    status = ?,
                    cost_updated_at = datetime('now')
                WHERE id = ?
              `).run(
                parseInt(callDuration),
                callDurationMinutes,
                callStatus,
                voiceCall.id
              );

              // Calculate and update costs using UsageMonitor
              const UsageMonitor = require('./services/usage-monitor');
              await UsageMonitor.logVoiceCallUsage({
                call_id: voiceCall.call_id,
                customer_id: voiceCall.customer_id,
                twilio_call_sid: callSid,
                call_duration_seconds: parseInt(callDuration),
                call_duration_minutes: callDurationMinutes,
                status: callStatus
              });

              // Deduct credits for completed calls
              if (voiceCall.customer_id && callStatus === 'completed' && callDurationMinutes > 0) {
                try {
                  const creditsToDeduct = Math.ceil(callDurationMinutes); // Round up to nearest minute
                  db.deductCredits(voiceCall.customer_id, creditsToDeduct);

                  // Update voice_call_log with credits deducted
                  db.db.prepare(`
                    UPDATE voice_call_log 
                    SET credits_deducted = ?
                    WHERE id = ?
                  `).run(creditsToDeduct, voiceCall.id);

                  console.log(`   ✅ Deducted ${creditsToDeduct} credits from customer ${voiceCall.customer_id}`);
                } catch (creditError) {
                  console.error(`   ❌ Failed to deduct credits: ${creditError.message}`);
                  // Continue - don't fail the call status update
                }
              }

              console.log(`   ✅ Updated voice call with duration and costs`);
            } else {
              // Just update status
              db.db.prepare(`
                UPDATE voice_call_log 
                SET status = ?
                WHERE id = ?
              `).run(callStatus, voiceCall.id);
            }
          }

          // Try to find lead call by Twilio Call SID
          const leadCalls = db.db.prepare(`
            SELECT * FROM lead_calls 
            WHERE call_id LIKE ? OR call_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `).all(`%${callSid}%`, callSid);

          if (leadCalls.length > 0) {
            const leadCall = leadCalls[0];
            db.db.prepare(`
              UPDATE lead_calls 
              SET call_status = ?,
                  updated_at = datetime('now')
              WHERE id = ?
            `).run(callStatus, leadCall.id);

            // Create activity if status changed significantly
            if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
              db.createLeadActivity({
                lead_id: leadCall.lead_id,
                activity_type: 'call',
                activity_subject: `Call Status: ${callStatus}`,
                activity_description: `Twilio call status update: ${callStatus} (Call SID: ${callSid})`,
                created_by: 'system',
                metadata: JSON.stringify({
                  call_sid: callSid,
                  call_status: callStatus,
                  direction: direction,
                  from: from,
                  to: to,
                  duration: callDuration
                })
              });
            }

            console.log(`   ✅ Updated lead call record with status: ${callStatus}`);
          }
        } catch (logError) {
          console.error('⚠️  Failed to log status update:', logError.message);
        }
      });
    }

    // Return 200 OK to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error in status callback:', error.message);
    // Still return 200 to prevent Twilio from retrying
    res.status(200).send('OK');
  }
});

// Create appointment checkout (appointment payment, not products)
app.post('/voice/appointments/checkout', scheduleCheckoutLimiter, voiceLimiter, withIdempotency('voice_checkout'), async (req, res) => {
  try {
    console.log('\n💳 VOICE: Create Appointment Checkout');
    safeLogRequestBody('Request body:', req);

    // TEST_MODE: bypass outbound email delivery and return verification_code directly
    const TEST_MODE = process.env.TEST_MODE === '1' || process.env.TEST_MODE === 'true';
    const includeTestVerificationCode = TEST_MODE && process.env.NODE_ENV !== 'production';

    const args = req.body.args || req.body;
    const triageSessionIdForAudit = resolveVoiceSessionIdForGuard(args, req);
    let clinicId = resolveClinicIdFromRequest(req, args);

    // Calculate amount based on insurance coverage if available
    // Default: fixed price per appointment if no insurance info
    let amount = args.amount; // If provided, caller overrides pricing

    // Build a minimal checkout record tied to the appointment
    const checkoutId = require('uuid').v4();

    // Ensure customer_phone is provided (required field)
    const customerPhone = args.customer_phone || args.patient_phone || '0000000000';

    // Try to find appointment by ID, phone, or email (S-2: tenant-scoped)
    let appointmentId = args.appointment_id || null;
    let appointmentRecord = null;
    const customerId = args.metadata?.customer_id || args.customer_id || req.body?.metadata?.customer_id || null;
    if (appointmentId) {
      appointmentRecord = await db.getAppointment(appointmentId, clinicId || null, customerId || null);
      if (!appointmentRecord) {
        return res.status(400).json({
          success: false,
          error: 'Invalid appointment_id. Appointment not found for this clinic/tenant context.',
          error_code: 'INVALID_APPOINTMENT_ID',
          appointment_id: appointmentId
        });
      }
      if (!clinicId) {
        clinicId = appointmentRecord.clinic_id || clinicId;
      }
    }
    if (!appointmentId) {
      // Search for most recent appointment for this customer
      const BookingService = require('./services/booking-service');
      const searchTerm = customerPhone || args.customer_email || args.patient_email;
      if (searchTerm) {
        try {
          let scopedClinic = clinicId;
          if (!scopedClinic && appointmentId) {
            const appointment = await db.getAppointment(appointmentId);
            scopedClinic = appointment?.clinic_id || null;
          }
          if (!scopedClinic && !customerId) {
            throw new Error('Missing clinic or customer context for appointment lookup');
          }

          const searchResult = await BookingService.searchAppointments(searchTerm, scopedClinic || null, customerId);
          if (searchResult.success && searchResult.appointments && searchResult.appointments.length > 0) {
            // Get the most recent scheduled/confirmed appointment
            const recentAppt = searchResult.appointments
              .filter(a => ['scheduled', 'confirmed'].includes(a.status))
              .sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time))[0];
            if (recentAppt) {
              appointmentId = recentAppt.id;
              appointmentRecord = await db.getAppointment(appointmentId, scopedClinic || null, customerId || null);
              console.log(`📋 Linked checkout to appointment: ${appointmentId}`);
            }
          }
        } catch (searchError) {
          console.warn('⚠️  Could not find appointment for checkout:', searchError.message);
        }
      }
    }

    // If appointment_id is available, calculate patient responsibility based on insurance
    if (appointmentId && amount == null) {
      try {
        const appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
        if (appointment && !clinicId) {
          clinicId = appointment.clinic_id || clinicId;
        }
        if (appointment && appointment.patient_id) {
          // Try to get latest eligibility for this patient
          const eligibility_checks = db.db.prepare(`
            SELECT * FROM eligibility_checks 
            WHERE patient_id = ? 
            ORDER BY created_at DESC LIMIT 1
          `).all(appointment.patient_id);
          const eligibilityChecks = eligibility_checks;

          if (eligibility_checks && eligibility_checks.length > 0) {
            const latestEligibility = eligibility_checks[0];
            // Calculate patient responsibility based on EOB
            if (latestEligibility.allowed_amount !== null && latestEligibility.insurance_pays !== null) {
              const patientOwe = latestEligibility.allowed_amount - latestEligibility.insurance_pays;
              amount = Math.max(0, patientOwe);
              console.log(`💰 Calculated patient responsibility: $${amount.toFixed(2)} (Insurance covers $${latestEligibility.insurance_pays.toFixed(2)} of $${latestEligibility.allowed_amount.toFixed(2)})`);
            } else if (latestEligibility.copay_amount) {
              // Fallback to copay if available
              amount = latestEligibility.copay_amount;
              console.log(`💰 Using copay amount: $${amount.toFixed(2)}`);
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Could not calculate insurance-adjusted amount:', error.message);
      }
    }

    // If still no amount, use visit_pricing (Task 17: same source as GET /api/pricing)
    if (amount == null) {
      try {
        let appointmentType = args.appointment_type || null;
        if (!appointmentType && appointmentId) {
          const appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
          appointmentType = appointment?.appointment_type || appointmentType;
          if (appointment && !clinicId) {
            clinicId = appointment.clinic_id || clinicId;
          }
        }
        const pricing = db.getEffectiveVisitPrice(clinicId, appointmentType || 'General Consult');
        amount = pricing.effective_price;
        console.log(`💰 Visit pricing: clinic=${clinicId} type="${pricing.canonicalType}" base=$${pricing.base_price} surge_enabled=${pricing.surge_enabled} mult=${pricing.surge_multiplier} => $${amount.toFixed(2)}`);
      } catch (e) {
        const { DEFAULT_FALLBACK } = require('./config/pricing-fallbacks');
        amount = DEFAULT_FALLBACK;
      }
    }

    // Resolve merchant_id from clinic_id or args
    let merchantId = args.merchant_id;
    if (!merchantId && clinicId) {
      const clinic = await db.getClinicById(clinicId);
      if (clinic && !clinic.merchant_id) {
        // Chk-C4: single-tenant fallback to managed merchant creation
        clinic.merchant_id = ensureMerchantForClinic(clinic);
      }
      if (clinic && clinic.merchant_id) {
        merchantId = clinic.merchant_id;
      }
    }
    if (!merchantId && appointmentId) {
      // Try to get from appointment
      const appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
      if (appointment && appointment.clinic_id) {
        const clinic = await db.getClinicById(appointment.clinic_id);
        if (clinic && !clinic.merchant_id) {
          clinic.merchant_id = ensureMerchantForClinic(clinic);
        }
        if (clinic && clinic.merchant_id) {
          merchantId = clinic.merchant_id;
        }
      }
    }

    // If still no merchant_id, return error instead of creating default
    if (!merchantId) {
      console.error('[CHECKOUT] merchantId not found for clinic:', clinicId);
      return res.status(500).json({
        success: false,
        error: 'MERCHANT_NOT_CONFIGURED',
        message: 'Payment is not configured for this clinic. Please contact support.'
      });
    }

    // Verify merchant exists
    const existingMerchant = db.getMerchant(merchantId);
    if (!existingMerchant) {
      console.error(`[CHECKOUT] merchantId ${merchantId} not found in database for clinic:`, clinicId);
      return res.status(500).json({
        success: false,
        error: 'MERCHANT_NOT_CONFIGURED',
        message: 'Payment is not configured for this clinic. Please contact support.'
      });
    }

    if (!clinicId && appointmentId) {
      appointmentRecord = appointmentRecord || await db.getAppointment(appointmentId, clinicId || null, customerId || null);
      clinicId = appointmentRecord?.clinic_id || clinicId;
    }

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to create a voice checkout'
      });
    }

    // Idempotency / dedupe: if a checkout already exists for this appointment_id,
    // reuse it (prevents multi-path/concurrent "triple checkout" creation).
    if (appointmentId) {
      try {
        const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(appointmentId);
        const existingCheckout = pending?.checkout || null;
        if (existingCheckout?.id && existingCheckout.deleted_at == null) {
          const tokenRow = db.db.prepare(`
            SELECT * FROM payment_tokens
            WHERE checkout_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `).get(existingCheckout.id);

          // Populate triage linkage for audit (C9) even when an older row exists.
          if (triageSessionIdForAudit && !existingCheckout.triage_session_id) {
            try { await db.updateVoiceCheckout(existingCheckout.id, { triage_session_id: triageSessionIdForAudit }); } catch (_) {}
          }
          if (triageSessionIdForAudit && appointmentId) {
            try {
              db.db?.prepare(
                'UPDATE voice_checkouts SET triage_session_id = COALESCE(triage_session_id, ?) WHERE appointment_id = ?'
              ).run(triageSessionIdForAudit, appointmentId);
            } catch (_) {}
          }

          if (tokenRow?.token) {
            const checkoutResponse = PaymentFlowService.buildLifecycleResponse({
              stage: 'checkout_created',
              nextAction: 'verify_identity_code',
                message: includeTestVerificationCode
                  ? 'Verification code returned (checkout reused in TEST_MODE)'
                  : 'Verification code already generated (checkout reused)',
              checkoutId: existingCheckout.id,
              paymentToken: tokenRow.token,
              requiresVerification: true,
              extra: {
                amount: existingCheckout.amount,
                currency: 'USD',
                  email_sent: includeTestVerificationCode ? false : !!existingCheckout.customer_email,
                  verification_code: includeTestVerificationCode ? tokenRow.verification_code : undefined,
                  verification_code_expires: includeTestVerificationCode ? tokenRow.verification_code_expires : undefined,
                  verification_code_returned: includeTestVerificationCode ? true : undefined
              }
            });

            PaymentFlowService.logTransition('checkout_created_reused', {
              checkout_id: existingCheckout.id,
              appointment_id: appointmentId,
              clinic_id: clinicId,
              merchant_id: merchantId,
              triage_session_id: triageSessionIdForAudit || existingCheckout.triage_session_id || null
            });

            return res.json(checkoutResponse);
          }

          // Token missing (common when the first request timed out before reaching token generation):
          // reuse the existing voice_checkouts row and generate the token/code on it.
          let appointment = null;
          try {
            appointment = appointmentRecord || await db.getAppointment(appointmentId, clinicId);
          } catch (_) {}

          // Mirror the "card creation" block but target the existing checkout row.
          if (amount > 0 && appointmentId) {
            try {
              if (appointment && appointment.patient_id) {
                const FHIRService = require('./services/fhir-service');
                const eligibility_checks = db.getEligibilityChecksByPatient?.(appointment.patient_id) || [];
                const isCopay =
                  eligibility_checks.length > 0 && eligibility_checks[0].copay_amount === amount;

                if (isCopay) {
                  await FHIRService.createCardForCopay(appointment.patient_id, amount, {
                    appointment_id: appointmentId,
                    checkout_id: existingCheckout.id
                  });
                } else {
                  await FHIRService.createCardForBill(appointment.patient_id, amount, {
                    appointment_id: appointmentId,
                    checkout_id: existingCheckout.id
                  });
                }
              }
            } catch (_) {}
          }

          const crypto = require('crypto');
          const paymentToken = crypto.randomBytes(32).toString('hex');
          const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
          const codeExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

          await db.createPaymentToken({
            token: paymentToken,
            checkout_id: existingCheckout.id,
            verification_code: verificationCode,
            verification_code_expires: codeExpires,
            status: 'pending'
          });

          const emailDeliveryQueued = !TEST_MODE && !!existingCheckout.customer_email;
          if (emailDeliveryQueued) {
            setImmediate(async () => {
              try {
                const EmailService = require('./services/email-service');
                await EmailService.sendCheckoutVerificationCode(existingCheckout.customer_email, verificationCode);
                console.log('[CHECKOUT] Verification email sent to:', String(existingCheckout.customer_email || '').slice(0, 4) + '…');
              } catch (emailError) {
                console.error('⚠️  Email delivery failed (token-missing reuse path):', emailError.message);
              }
              try {
                if (appointmentId && appointment) {
                  const EmailService = require('./services/email-service');
                  const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
                  const paymentLink = `${baseUrl}/payment/${paymentToken}`;
                  await EmailService.sendPatientBillingEmail(existingCheckout.customer_email, {
                    patientName: existingCheckout.customer_name || appointment.patient_name,
                    appointmentDate: appointment.date,
                    serviceName: appointment.appointment_type || 'Therapy Session',
                    totalAmount: amount + amount * 0.1,
                    insuranceAmount: amount * 0.1,
                    copayAmount: amount,
                    amountDue: amount,
                    paymentLink
                  });
                }
              } catch (emailError) {
                console.error('⚠️  Billing email delivery failed (token-missing reuse path):', emailError.message);
              }
            });
          }

          const checkoutResponse = PaymentFlowService.buildLifecycleResponse({
            stage: 'checkout_created',
            nextAction: 'verify_identity_code',
            message: includeTestVerificationCode
              ? 'Verification code returned (TEST_MODE: email skipped)'
              : (emailDeliveryQueued ? 'Verification code generated (email queued)' : 'Verification code generated (email not sent)'),
            checkoutId: existingCheckout.id,
            paymentToken,
            requiresVerification: true,
            extra: {
              amount: existingCheckout.amount,
              currency: 'USD',
              email_sent: false,
              email_queued: emailDeliveryQueued,
              billing_email_sent: false,
              billing_email_queued: emailDeliveryQueued,
              verification_code: includeTestVerificationCode ? verificationCode : undefined,
              verification_code_expires: includeTestVerificationCode ? codeExpires : undefined,
              verification_code_returned: includeTestVerificationCode ? true : undefined
            }
          });

          PaymentFlowService.logTransition('checkout_created_reused_token_missing', {
            checkout_id: existingCheckout.id,
            appointment_id: appointmentId,
            clinic_id: clinicId,
            merchant_id: merchantId,
            triage_session_id: triageSessionIdForAudit || existingCheckout.triage_session_id || null
          });

          return res.json(checkoutResponse);
        }
      } catch (dedupeErr) {
        console.warn('⚠️ voice checkout dedupe failed:', dedupeErr.message);
      }
    }

    const checkout = {
      id: checkoutId,
      merchant_id: merchantId,
      product_id: 'APPOINTMENT',
      product_name: args.appointment_type ? `Appointment - ${args.appointment_type}` : 'Appointment',
      quantity: 1,
      amount: amount,
      customer_phone: customerPhone, // Required field - cannot be null
      customer_name: args.customer_name || args.patient_name || 'Patient',
      customer_email: args.customer_email || args.patient_email || null,
      appointment_id: appointmentId, // Link to appointment
      status: 'pending',
      clinic_id: clinicId,
      triage_session_id: triageSessionIdForAudit || null
    };

    // Store checkout
    await db.createVoiceCheckout(checkout);

    // Create Stripe card on-demand if patient has insurance and copay is due
    if (amount > 0 && appointmentId) {
      try {
        const appointment = await db.getAppointment(appointmentId, clinicId);
        if (appointment && appointment.patient_id) {
          const FHIRService = require('./services/fhir-service');
          // Guard: fetch eligibility in this scope (was undefined when amount came from pricing)
          const eligibility_checks = db.getEligibilityChecksByPatient?.(appointment.patient_id) || [];
          const eligibilityChecks = eligibility_checks;
          const isCopay = eligibility_checks.length > 0 &&
            eligibility_checks[0].copay_amount === amount;

          if (isCopay) {
            console.log(`💳 Creating payment card for appointment copay: $${amount.toFixed(2)}`);
            await FHIRService.createCardForCopay(appointment.patient_id, amount, {
              appointment_id: appointmentId,
              checkout_id: checkoutId
            });
          } else {
            // Patient responsibility (bill)
            console.log(`💳 Creating payment card for appointment payment: $${amount.toFixed(2)}`);
            await FHIRService.createCardForBill(appointment.patient_id, amount, {
              appointment_id: appointmentId,
              checkout_id: checkoutId
            });
          }
        }
      } catch (cardError) {
        // Don't fail checkout if card creation fails
        console.warn('⚠️  Failed to create payment card for appointment checkout:', cardError.message);
      }
    }

    // Generate token + code
    const crypto = require('crypto');
    const paymentToken = crypto.randomBytes(32).toString('hex');
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.createPaymentToken({
      token: paymentToken,
      checkout_id: checkoutId,
      verification_code: verificationCode,
      verification_code_expires: codeExpires,
      status: 'pending'
    });

    // Email the code (TEST_MODE bypass + fire-and-forget to avoid checkout latency tails)
    const emailDeliveryQueued = !TEST_MODE && !!checkout.customer_email;
    if (emailDeliveryQueued) {
      setImmediate(async () => {
        try {
          const EmailService = require('./services/email-service');
          await EmailService.sendCheckoutVerificationCode(checkout.customer_email, verificationCode);
          console.log('[CHECKOUT] Verification email sent to:', String(checkout.customer_email || '').slice(0, 4) + '…');
        } catch (emailError) {
          console.error('⚠️  Email delivery failed:', emailError.message);
        }
        try {
          if (appointmentId) {
            const appointment = await db.getAppointment(appointmentId, clinicId);
            if (appointment) {
              const EmailService = require('./services/email-service');
              const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
              const paymentLink = `${baseUrl}/payment/${paymentToken}`;
              await EmailService.sendPatientBillingEmail(checkout.customer_email, {
                patientName: checkout.customer_name || appointment.patient_name,
                appointmentDate: appointment.date,
                serviceName: appointment.appointment_type || 'Therapy Session',
                totalAmount: amount + (amount * 0.1),
                insuranceAmount: amount * 0.1,
                copayAmount: amount,
                amountDue: amount,
                paymentLink: paymentLink
              });
            }
          }
        } catch (billingEmailError) {
          console.error('⚠️  Billing email delivery failed:', billingEmailError.message);
        }
      });
    }

    const checkoutResponse = PaymentFlowService.buildLifecycleResponse({
      stage: 'checkout_created',
      nextAction: 'verify_identity_code',
      message: includeTestVerificationCode
        ? 'Verification code returned (TEST_MODE: email skipped)'
        : (emailDeliveryQueued ? 'Verification code generated (email queued)' : 'Verification code generated (email not sent)'),
      checkoutId,
      paymentToken,
      requiresVerification: true,
      extra: {
        amount,
        currency: 'USD',
        email_sent: false,
        email_queued: emailDeliveryQueued,
        billing_email_sent: false,
        billing_email_queued: emailDeliveryQueued,
        verification_code: includeTestVerificationCode ? verificationCode : undefined,
        verification_code_expires: includeTestVerificationCode ? codeExpires : undefined,
        verification_code_returned: includeTestVerificationCode ? true : undefined
      }
    });
    PaymentFlowService.logTransition('checkout_created', {
      checkout_id: checkoutId,
      appointment_id: appointmentId,
      clinic_id: clinicId,
      merchant_id: merchantId,
      triage_session_id: triageSessionIdForAudit || null
    });
    return res.json(checkoutResponse);
  } catch (error) {
    console.error('❌ Error creating appointment checkout:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Development-only helper: create a test PaymentMethod for e2e tests (do NOT enable in production)
if (process.env.NODE_ENV !== 'production' && stripe) {
  app.get('/dev/create-test-payment-method', async (req, res) => {
    try {
      const pm = await stripe.paymentMethods.create({
        type: 'card',
        card: { token: 'tok_visa' }
      });
      return res.json({ success: true, payment_method_id: pm.id });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  });
}

// Development-only helper: fetch verification code by token (do NOT enable in production)
if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/payment-token/:token', (req, res) => {
    try {
      const record = db.getPaymentToken(req.params.token);
      if (!record) return res.status(404).json({ success: false, error: 'Not found' });
      return res.json({
        success: true,
        token: record.token,
        checkout_id: record.checkout_id,
        verification_code: record.verification_code,
        verification_code_expires: record.verification_code_expires,
        status: record.status
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

}

// Verify email code and send payment link
app.post('/voice/checkout/verify', async (req, res) => {
  try {
    console.log('\n🔐 VOICE: Verify Email Code');
    safeLogRequestBody('Request body:', req);

    // TEST_MODE: bypass outbound email and keep verification fast/deterministic.
    const TEST_MODE = process.env.TEST_MODE === '1' || process.env.TEST_MODE === 'true';

    const args = req.body.args || req.body;
    const token = args.payment_token || args.token;
    const code = args.code || args.verification_code;
    const triageSessionVerify = resolveVoiceSessionIdForGuard(args, req);

    if (!token || !code) {
      return res.status(400).json({
        success: false,
        error: 'payment_token and code are required',
        error_code: 'MISSING_VERIFY_FIELDS',
        next_step: 'Provide payment_token and the 6-digit verification_code, then retry.'
      });
    }

    if (triageSessionVerify) {
      try {
        console.log(
          JSON.stringify({
            event: 'voice_checkout_verify',
            triage_session_id: triageSessionVerify
          })
        );
      } catch (_) {}
    }

    const tokenRecord = db.getPaymentToken(token);
    if (!tokenRecord) {
      return res.status(404).json({
        success: false,
        error: 'Invalid token',
        error_code: 'INVALID_PAYMENT_TOKEN',
        next_step: 'Create a new checkout and request a fresh verification code.'
      });
    }

    // Check expiration
    if (tokenRecord.verification_code_expires) {
      const now = new Date();
      const exp = new Date(tokenRecord.verification_code_expires);
      if (now > exp) {
        return res.status(400).json({
          success: false,
          error: 'Verification code expired',
          error_code: 'VERIFICATION_CODE_EXPIRED',
          next_step: 'Re-run create_appointment_checkout to resend a new verification code.'
        });
      }
    }

    // Check code match
    if ((tokenRecord.verification_code || '').trim() !== String(code).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification code',
        error_code: 'INVALID_VERIFICATION_CODE',
        next_step: 'Ask the patient to re-check the 6-digit code and retry.'
      });
    }

    // Fetch checkout to email link
    const checkout = await db.getVoiceCheckout(tokenRecord.checkout_id);
    if (!checkout) {
      return res.status(404).json({ success: false, error: 'Checkout not found' });
    }

    // Check if patient has wallet with sufficient balance
    let walletInfo = null;
    try {
      // Try to find FHIR patient by email or phone
      let fhirPatient = null;
      if (checkout.customer_email) {
        fhirPatient = db.getFHIRPatientByEmail(checkout.customer_email);
      }
      if (!fhirPatient && checkout.customer_phone) {
        fhirPatient = db.getFHIRPatientByPhone(checkout.customer_phone);
      }

      if (fhirPatient && CircleService && CircleService.isAvailable()) {
        // Get patient wallet
        const walletResult = await CircleService.getOrCreatePatientWallet(fhirPatient.resource_id, {
          createIfNotExists: false // Don't create wallet if it doesn't exist
        });

        if (walletResult.success && walletResult.account) {
          // Get wallet balance
          const balanceResult = await CircleService.getWalletBalance(walletResult.account.circle_wallet_id);

          if (balanceResult.success) {
            // Extract USDC balance from balances array
            const balances = balanceResult.balances || [];
            let usdcBalance = 0;
            let usdcCurrency = 'USDC';

            // Find USDC balance (token balances are usually in format { token: { symbol: 'USDC', ... }, amount: '1000000' })
            // Amount is typically in smallest unit (e.g., 6 decimals for USDC)
            for (const balance of balances) {
              if (balance.token && (balance.token.symbol === 'USDC' || balance.token.symbol === 'USDC.e')) {
                // Convert from smallest unit (6 decimals) to dollars
                const amount = parseFloat(balance.amount || '0');
                usdcBalance = amount / 1000000; // USDC has 6 decimals
                usdcCurrency = balance.token.symbol || 'USDC';
                break;
              }
            }

            walletInfo = {
              has_wallet: true,
              wallet_id: walletResult.account.circle_wallet_id,
              balance: usdcBalance,
              currency: usdcCurrency,
              sufficient_balance: usdcBalance >= checkout.amount
            };
            console.log(`💰 Patient wallet found: Balance $${walletInfo.balance.toFixed(2)} ${walletInfo.currency}`);
          }
        }
      }
    } catch (walletError) {
      console.warn('⚠️  Could not check wallet balance:', walletError.message);
      // Continue without wallet info
    }

    // Build payment link with better fallback logic
    // Priority: API_BASE_URL > BASE_URL > Railway URL (if detected) > production domain > localhost
    let baseUrl = process.env.API_BASE_URL || process.env.BASE_URL;
    if (!baseUrl) {
      // Check if running on Railway (common production environment)
      const railwayUrl = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
      if (railwayUrl) {
        baseUrl = `https://${railwayUrl}`;
      } else if (process.env.NODE_ENV === 'production') {
        // Production: use doclittle.site domain
        baseUrl = 'https://doclittle.site';
      } else {
        // Fallback to localhost for development
        baseUrl = 'http://localhost:4000';
      }
    }
    const paymentLink = `${baseUrl}/payment/${token}`;
    console.log(`🔗 Payment link: ${paymentLink}`);

    const emailDeliveryQueued = !TEST_MODE && !!checkout.customer_email;
    let emailResult = { success: false, error: null, queued: emailDeliveryQueued };
    try {
      if (emailDeliveryQueued) {
        const EmailService = require('./services/email-service');
        let appt = null;
        if (checkout.appointment_id) {
          appt = await db.getAppointment(checkout.appointment_id);
        }

        // Fire-and-forget: don't block identity verification on email delivery.
        EmailService.sendPaymentLinkEmail(checkout.customer_email, paymentLink, {
          product_name: checkout.product_name,
          amount: checkout.amount,
          wallet_balance: walletInfo?.balance,
          can_pay_from_wallet: walletInfo?.sufficient_balance,
          appointment_date: appt?.date,
          appointment_time: appt?.time,
          appointment_type: appt?.appointment_type || checkout.product_name
        }).catch((emailError) => {
          console.error('⚠️  Payment link email delivery failed:', emailError.message);
        });
      }
    } catch (emailSetupError) {
      emailResult = { success: false, error: emailSetupError.message, queued: false };
    }

    // Task 53: Mark token as identity-verified (required before payment redemption)
    db.updatePaymentToken(token, { status: 'verified', identity_verified_at: new Date().toISOString() });

    const verifyResponse = PaymentFlowService.buildLifecycleResponse({
      stage: 'identity_verified',
      nextAction: 'process_payment',
      message: TEST_MODE
        ? 'Identity verified (TEST_MODE: payment link email skipped)'
        : (emailResult.queued
            ? 'Identity verified (payment link email queued)'
            : (emailResult.error || 'Identity verified')),
      paymentToken: token,
      checkoutId: checkout.id,
      requiresVerification: false,
      wallet: walletInfo
    });
    PaymentFlowService.logTransition('identity_verified', {
      checkout_id: checkout.id,
      appointment_id: checkout.appointment_id,
      clinic_id: checkout.clinic_id,
      merchant_id: checkout.merchant_id
    });
    return res.json(verifyResponse);
  } catch (error) {
    console.error('❌ Error verifying email code:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// VOICE COMMERCE ENDPOINTS
// ============================================
// NOTE: Voice routes are now handled by routes/voice.js (mounted above)
// This section kept for reference but duplicate route removed

// Get order tracking for voice agent
app.post('/voice/orders/tracking', async (req, res) => {
  try {
    console.log('\n📦 VOICE: Order Tracking Request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const TrackingService = require('./services/tracking-service');

    // Handle both Retell format and direct format
    let order_id, customer_email, customer_phone;

    if (req.body.args) {
      // Retell format
      order_id = req.body.args.order_id;
      customer_email = req.body.args.customer_email;
      customer_phone = req.body.args.customer_phone;
    } else {
      // Direct format
      order_id = req.body.order_id;
      customer_email = req.body.customer_email;
      customer_phone = req.body.customer_phone;
    }

    console.log('Order ID:', order_id || 'not provided');
    console.log('Customer Email:', customer_email || 'not provided');
    console.log('Customer Phone:', customer_phone || 'not provided');

    let order = null;

    // Try to find order by ID first
    if (order_id) {
      order = db.getOrder(order_id);
    }

    // CRITICAL: Get merchant_id from metadata to scope order search
    const merchant_id = req.body.metadata?.merchant_id ||
      req.body.merchant_id ||
      req.body.args?.merchant_id;

    // If not found by ID, search by customer email or phone (scoped to merchant)
    if (!order && (customer_email || customer_phone)) {
      // Scope search to merchant_id if available
      const ordersToSearch = merchant_id
        ? db.getOrdersByMerchant(merchant_id)
        : db.getAllOrders();

      order = ordersToSearch.find(o => {
        const emailMatch = customer_email && o.customer_email &&
          o.customer_email.toLowerCase() === customer_email.toLowerCase();
        const phoneMatch = customer_phone && o.customer_phone &&
          o.customer_phone.replace(/\D/g, '') === customer_phone.replace(/\D/g, '');
        return emailMatch || phoneMatch;
      });

      // If multiple orders found, get the most recent one
      if (!order && ordersToSearch.length > 0) {
        const matchingOrders = ordersToSearch.filter(o => {
          const emailMatch = customer_email && o.customer_email &&
            o.customer_email.toLowerCase() === customer_email.toLowerCase();
          const phoneMatch = customer_phone && o.customer_phone &&
            o.customer_phone.replace(/\D/g, '') === customer_phone.replace(/\D/g, '');
          return emailMatch || phoneMatch;
        });

        if (matchingOrders.length > 0) {
          // Sort by created_at descending and get most recent
          order = matchingOrders.sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
          )[0];
        }
      }
    }

    // Verify order belongs to merchant if merchant_id is available
    if (order && merchant_id && order.merchant_id !== merchant_id) {
      console.warn(`⚠️  Order ${order.id} does not belong to merchant ${merchant_id}`);
      order = null; // Don't return order from different merchant
    }

    if (!order) {
      console.log('❌ Order not found');
      return res.json({
        success: true,
        found: false,
        message: 'I couldn\'t find an order matching that information. Could you please provide your order number or email address?'
      });
    }

    console.log('✅ Order found:', order.id);
    console.log('   Status:', order.delivery_status || order.status);
    console.log('   Driver:', order.driver_name || 'not assigned');

    // Get tracking summary formatted for voice
    const trackingSummary = TrackingService.getTrackingSummary(order);

    // Parse tracking events if available
    let trackingEvents = [];
    if (order.tracking_events) {
      try {
        trackingEvents = typeof order.tracking_events === 'string'
          ? JSON.parse(order.tracking_events)
          : order.tracking_events;
      } catch (e) {
        console.warn('⚠️  Failed to parse tracking_events');
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.json({
      success: true,
      found: true,
      order_id: order.id,
      message: trackingSummary.message,
      delivery_status: order.delivery_status || order.status,
      driver_name: order.driver_name || null,
      driver_phone: order.driver_phone || null,
      current_location: order.current_latitude && order.current_longitude ? {
        latitude: order.current_latitude,
        longitude: order.current_longitude,
        address: order.current_address || null
      } : null,
      estimated_arrival: order.estimated_arrival || null,
      last_update: order.last_location_update || order.updated_at,
      events: trackingEvents.slice(-5) // Last 5 events for voice context
    });

  } catch (error) {
    console.error('❌ Voice order tracking error:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create checkout for voice purchase - FIXED WITH ORCHESTRATOR
app.post('/voice/checkout/create', scheduleCheckoutLimiter, async (req, res) => {
  try {
    console.log('\n💳 VOICE: Creating Checkout via Orchestrator');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    safeLogRequestBody('Raw Retell data:', req);

    // EXTRACT ARGS: Handle multiple Retell formats
    // 1. Webhook: req.body.tool_call.args
    // 2. Direct function call: req.body.args
    // 3. Direct HTTP: req.body
    let args = req.body;

    if (req.body.tool_call && req.body.tool_call.args) {
      console.log('📥 Extracting from webhook tool_call.args');
      args = req.body.tool_call.args;
    } else if (req.body.args) {
      console.log('📥 Extracting from direct args');
      args = req.body.args;
    } else {
      console.log('📥 Using body directly');
    }

    console.log('Extracted args:', JSON.stringify(sanitizeForLog(args), null, 2));

    // CRITICAL: Get merchant_id from metadata (from voice/incoming handler)
    // Fallback to args if not in metadata
    const merchant_id = req.body.metadata?.merchant_id ||
      args.merchant_id ||
      req.body.merchant_id;

    if (!merchant_id) {
      console.error('❌ ERROR: merchant_id is missing from voice checkout creation');
      return res.status(400).json({
        success: false,
        error: 'merchant_id is required',
        message: 'Merchant ID not found in call metadata. This may indicate the customer has not completed onboarding.'
      });
    }

    console.log(`✅ Using merchant_id: ${merchant_id} for checkout creation`);

    // TRANSFORM: Retell flat format → PaymentRequest nested format
    const transformedData = {
      merchant_id: merchant_id, // Use from metadata
      customer: {
        name: args.customer_name || null,
        phone: args.customer_phone || null,  // Will be normalized by SMSService
        email: args.customer_email || null
      },
      items: [
        {
          product_id: args.product_id,
          quantity: args.quantity || 1
        }
      ],
      payment: {
        method: 'link',  // Voice always uses SMS link
        currency: 'USD'
      },
      source: {
        protocol: 'voice',
        platform: 'retell',
        input_type: 'voice'
      },
      metadata: {
        call_sid: args.call_sid || req.body.call?.call_id || null,
        original_request: req.body
      }
    };

    console.log('Transformed data:', JSON.stringify(transformedData, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Call the orchestrator
    const response = await PaymentOrchestrator.createCheckout(transformedData);

    console.log('Orchestrator response:', {
      success: response.success,
      checkout_id: response.checkout_id,
      sms_sent: response.metadata?.sms_sent
    });

    // ========== CUSTOMER CREATION ==========
    // Create or get customer from checkout (for cannabis e-commerce)
    if (response.isSuccess() && args.customer_phone) {
      try {
        const CustomerService = require('./services/customer-service');
        const merchantId = args.tenantContext?.merchant?.id ||
          args.tenantContext?.clinic?.merchant_id ||
          response.metadata?.merchant_id ||
          merchant_id ||
          null;

        // Get checkout record to pass to customer service
        const checkout = await db.getVoiceCheckout(response.checkout_id);
        if (checkout) {
          const customer = CustomerService.getOrCreateCustomerFromCheckout(checkout, merchantId);
          console.log(`[CUSTOMER] ✅ Customer ${customer.id} ready for checkout ${response.checkout_id}`);
        }
      } catch (customerError) {
        console.warn('[CUSTOMER] ⚠️ Error creating customer from checkout (non-fatal):', customerError.message);
        // Continue with checkout even if customer creation fails
      }
    }

    // ========== FHIR INTEGRATION (OPTIONAL - Only if therapy booked) ==========
    // Only create FHIR Patient if customer explicitly books a therapy appointment
    // For cannabis e-commerce, most customers won't need FHIR Patient records
    if (response.isSuccess() && args.customer_phone && args.book_therapy === true) {
      try {
        // Get merchant_id from tenant context or checkout
        const merchantId = args.tenantContext?.merchant?.id ||
          args.tenantContext?.clinic?.merchant_id ||
          response.metadata?.merchant_id ||
          merchant_id ||
          null;

        // Find or create FHIR patient with merchant_id (only if therapy is booked)
        const patient = await FHIRService.getOrCreatePatient({
          phone: args.customer_phone,
          email: args.customer_email,
          name: args.customer_name,
          merchant_id: merchantId
        });

        // Update checkout with FHIR patient ID
        await db.updateVoiceCheckout(response.checkout_id, {
          fhir_patient_id: patient.id
        });

        // Link customer to FHIR Patient
        const CustomerService = require('./services/customer-service');
        const checkoutForLink = await db.getVoiceCheckout(response.checkout_id);
        if (checkoutForLink) {
          const customer = CustomerService.getOrCreateCustomerFromCheckout(checkoutForLink, merchantId);
          if (customer && customer.id) {
            db.updateCustomer(customer.id, { fhir_patient_id: patient.id });
            console.log(`[FHIR] ✅ Linked customer ${customer.id} to FHIR Patient ${patient.id}`);
          }
        }

        console.log(`[FHIR] ✅ Linked checkout ${response.checkout_id} to Patient ${patient.id}${merchantId ? ` (merchant: ${merchantId})` : ''} (therapy booked)`);

        // Auto-create wallet for patient (if Circle is available)
        if (patient.id && merchantId) {
          try {
            const CircleService = require('./services/circle-service');
            const walletResult = await CircleService.getOrCreatePatientWallet(patient.id, {
              createIfNotExists: true,
              merchantId: merchantId
            });
            if (walletResult.success) {
              console.log(`[FHIR] ✅ Auto-created wallet for patient ${patient.id}`);
            } else {
              console.log(`[FHIR] ⚠️  Wallet creation skipped: ${walletResult.error}`);
            }
          } catch (walletError) {
            console.warn(`[FHIR] ⚠️  Wallet creation error (non-fatal):`, walletError.message);
          }
        }

        // If this is a medication/supplement product, create MedicationRequest
        if (response.metadata?.product) {
          const product = response.metadata.product;
          // Check if product is health-related (you can customize this logic)
          if (product.category === 'supplements' || product.category === 'medication') {
            await FHIRService.createMedicationRequest({
              patientId: patient.id,
              productName: product.name,
              productId: product.id,
              orderId: response.checkout_id,
              price: response.payment.amount,
              status: 'active'
            });
            console.log(`[FHIR] ✅ Created MedicationRequest for product: ${product.name}`);
          }
        }
      } catch (fhirError) {
        console.error('[FHIR] ⚠️ Error linking checkout to FHIR:', fhirError.message);
        // Continue with checkout even if FHIR fails
      }
    }
    // ======================================

    // Return response in Retell-friendly format
    if (response.isSuccess()) {
      console.log('✅ Checkout created successfully');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      res.json({
        success: true,
        checkout_id: response.checkout_id,
        amount: response.payment.amount,
        currency: response.payment.currency,
        payment_token: response.payment_token || response.metadata?.payment_token,
        status: response.payment.status,
        message: response.message,
        requires_verification: response.metadata?.verification_required || false,
        email_sent: response.metadata?.email_sent || false,
        metadata: {
          product: response.metadata?.product,
          customer_phone_normalized: transformedData.customer.phone,
          fraud_check: response.metadata?.fraud_check
        }
      });
    } else {
      console.error('❌ Checkout failed:', response.error);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      res.status(400).json({
        success: false,
        error: response.error,
        details: response.metadata
      });
    }

  } catch (error) {
    console.error('❌ Voice checkout error:', error);
    console.error('Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Payment page — Kelly flow: Stripe Elements + webhook-driven settlement
// Browser requests get HTML; API requests (Accept: application/json) get client_secret
const { paymentPageRouter } = require('./routes/payment-page-route');
app.get('/payment/:token', (req, res, next) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) return next();
  res.sendFile(path.join(__dirname, 'public', 'payment-page.html'));
});
app.use('/payment', paymentPageRouter);

// Process payment (Task 11, 14: unified flow; amount from checkout)
app.post('/process-payment', paymentLimiter, async (req, res) => {
  const PaymentProcessorService = require('./services/payment-processor-service');
  let idemKey;
  const claimOpType = 'process_payment';
  try {
    const { payment_method_id, checkout_id, amount, payment_method = 'stripe', idempotency_key, payment_token } = req.body;

    // Task 11: Resolve checkout from payment_token or checkout_id (unified with /api/payment/process)
    const checkout = await PaymentProcessorService.resolveCheckout(req.body);
    if (!checkout) {
      return res.status(400).json({ success: false, error: 'Checkout not found. Provide payment_token or checkout_id.' });
    }
    const resolvedCheckoutId = checkout.id;
    idemKey = idempotency_key || req.headers['idempotency-key'] || `process_${resolvedCheckoutId}_${payment_method}`;

    console.log(`\n💳 Processing payment for checkout: ${resolvedCheckoutId}`);

    // SECURITY: if this checkout/token requires identity verification, require the token to be verified
    // before allowing payment redemption/settlement.
    try {
      let tokenRecord = null;
      if (payment_token) tokenRecord = db.getPaymentToken ? db.getPaymentToken(payment_token) : null;
      if (!tokenRecord && resolvedCheckoutId && db.db) {
        tokenRecord = db.db
          .prepare(`SELECT * FROM payment_tokens WHERE checkout_id = ? ORDER BY created_at DESC LIMIT 1`)
          .get(resolvedCheckoutId);
      }

      const requiresVerification = !!tokenRecord?.verification_code;
      const isVerified = tokenRecord?.status === 'verified' || !!tokenRecord?.identity_verified_at;

      if (requiresVerification && !isVerified) {
        return res.status(403).json({
          success: false,
          error: 'Identity verification required before processing payment.',
          error_code: 'IDENTITY_NOT_VERIFIED',
          next_step: 'Verify identity using /voice/checkout/verify, then retry /process-payment.'
        });
      }
    } catch (_) {}

    const cached = db.getIdempotentResult && db.getIdempotentResult(idemKey, claimOpType);
    if (cached) {
      return res.json({ ...cached.result, idempotent: true });
    }
    const reserve = db.reserveIdempotencyKey && db.reserveIdempotencyKey(idemKey, claimOpType);
    if (reserve === 'in_progress') {
      return res.status(409).json({ success: false, error: 'Payment in progress', idempotent: true });
    }
    if (reserve === 'completed') {
      const c2 = db.getIdempotentResult(idemKey, claimOpType);
      if (c2) return res.json({ ...c2.result, idempotent: true });
    }

    // Task 14: Use checkout amount, never trust req.body.amount
    const chargeAmount = parseFloat(checkout.amount) || 0;
    console.log(`   Method: ${payment_method}`);
    console.log(`   Amount: $${chargeAmount}`);

    // Handle wallet payment
    if (payment_method === 'wallet') {
      try {
        // Find FHIR patient by email or phone
        let fhirPatient = null;
        if (checkout.customer_email) {
          fhirPatient = db.getFHIRPatientByEmail(checkout.customer_email);
        }
        if (!fhirPatient && checkout.customer_phone) {
          fhirPatient = db.getFHIRPatientByPhone(checkout.customer_phone);
        }

        if (!fhirPatient) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(400).json({
            success: false,
            error: 'Patient not found. Cannot process wallet payment.'
          });
        }

        // Check if CircleService is available
        if (!CircleService || !CircleService.isAvailable()) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(503).json({
            success: false,
            error: 'Wallet payment is not available. Circle service is not configured. Please use a card payment instead.'
          });
        }

        // Get patient wallet
        const walletResult = await CircleService.getOrCreatePatientWallet(fhirPatient.resource_id, {
          createIfNotExists: false
        });

        if (!walletResult.success || !walletResult.account) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(400).json({
            success: false,
            error: 'Patient wallet not found. Please use a card payment instead.'
          });
        }

        // Check wallet balance
        const balanceResult = await CircleService.getWalletBalance(walletResult.account.circle_wallet_id);

        if (!balanceResult.success) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(500).json({
            success: false,
            error: 'Could not retrieve wallet balance.'
          });
        }

        // Extract USDC balance from balances array
        const balances = balanceResult.balances || [];
        let walletBalance = 0;

        // Find USDC balance (token balances are usually in format { token: { symbol: 'USDC', ... }, amount: '1000000' })
        // Amount is typically in smallest unit (e.g., 6 decimals for USDC)
        for (const balance of balances) {
          if (balance.token && (balance.token.symbol === 'USDC' || balance.token.symbol === 'USDC.e')) {
            // Convert from smallest unit (6 decimals) to dollars
            const amount = parseFloat(balance.amount || '0');
            walletBalance = amount / 1000000; // USDC has 6 decimals
            break;
          }
        }

        if (walletBalance < chargeAmount) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(400).json({
            success: false,
            error: `Insufficient wallet balance. Available: $${walletBalance.toFixed(2)}, Required: $${chargeAmount.toFixed(2)}`
          });
        }

        // Transfer from patient wallet to provider wallet
        // Get provider wallet (system wallet or merchant wallet)
        const walletResolution = PaymentFlowService.resolveProviderWalletId({
          clinicId: checkout.clinic_id || null,
          merchantId: checkout.merchant_id || null
        });
        const providerWalletId = walletResolution.walletId;

        if (!providerWalletId) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(500).json({
            success: false,
            error: 'Provider wallet not configured. Cannot process wallet payment.'
          });
        }

        // Create transfer from patient to provider
        const transferResult = await CircleService.createTransfer({
          fromWalletId: walletResult.account.circle_wallet_id,
          toWalletId: providerWalletId,
          amount: chargeAmount,
          currency: 'USDC',
          claimId: checkout.appointment_id || checkout.id,
          description: `Payment for ${checkout.product_name || 'appointment'} - Checkout ${checkout_id}`
        });

        if (!transferResult.success) {
          if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
          return res.status(500).json({
            success: false,
            error: transferResult.error || 'Failed to process wallet transfer.'
          });
        }

        // Record the transfer
        const { v4: uuidv4 } = require('uuid');
        const transferId = uuidv4();

        db.db.prepare(`
          INSERT INTO circle_transfers (
            id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
            circle_transfer_id, status, created_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          transferId,
          null,
          walletResult.account.circle_wallet_id,
          providerWalletId,
          chargeAmount,
          'USDC',
          transferResult.transferId || transferResult.id,
          'completed',
          new Date().toISOString(),
          new Date().toISOString()
        );

        console.log(`✅ Wallet payment successful: ${transferResult.transferId}`);
        console.log(`   From: ${walletResult.account.circle_wallet_id}`);
        console.log(`   To: ${providerWalletId}`);
        console.log(`   Amount: $${chargeAmount} USDC`);

        // Update checkout status
        await db.updateVoiceCheckout(resolvedCheckoutId, {
          status: 'completed',
          payment_method: 'wallet',
          payment_intent_id: transferResult.transferId || transferResult.id
        });

        console.log(`✅ Checkout ${resolvedCheckoutId} marked as completed`);

        // Task 12, 15, 16: Financial audit, ledger, receipt
        await PaymentProcessorService.completePaymentSuccess({
          checkout, amount: chargeAmount, paymentMethod: 'wallet',
          transferId: transferResult.transferId || transferResult.id
        });

        // Auto-confirm appointment if linked
        if (checkout.appointment_id) {
          try {
            const BookingService = require('./services/booking-service');
            const confirmResult = await BookingService.confirmAppointment(
              checkout.appointment_id,
              checkout.clinic_id || null
            );
            if (confirmResult.success) {
              console.log(`✅ Appointment ${checkout.appointment_id} auto-confirmed after payment`);
            } else {
              console.warn(`⚠️  Could not auto-confirm appointment: ${confirmResult.error}`);
            }
          } catch (confirmError) {
            console.warn(`⚠️  Error auto-confirming appointment: ${confirmError.message}`);
          }
        }

        const result = PaymentFlowService.buildLifecycleResponse({
          stage: 'payment_settled',
          nextAction: 'complete',
          message: 'Wallet payment settled successfully',
          checkoutId: resolvedCheckoutId,
          paymentMethod: 'wallet',
          transferId: transferResult.transferId || transferResult.id,
          requiresVerification: false,
          extra: {
            appointment_confirmed: !!checkout.appointment_id,
            wallet_balance_after: walletBalance - chargeAmount,
            provider_wallet_source: walletResolution.source
          }
        });
        PaymentFlowService.logTransition('payment_settled_wallet', {
          checkout_id: resolvedCheckoutId,
          appointment_id: checkout.appointment_id,
          clinic_id: checkout.clinic_id,
          merchant_id: checkout.merchant_id,
          payment_method: 'wallet'
        });
        if (db.completeIdempotentResult) db.completeIdempotentResult(idemKey, claimOpType, result);
        return res.json(result);

      } catch (walletError) {
        console.error('❌ Wallet payment error:', walletError);
        if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
        return res.status(500).json({
          success: false,
          error: walletError.message || 'Wallet payment failed'
        });
      }
    }

    // Handle Stripe payment (default)
    if (!payment_method_id) {
      if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required for card payments'
      });
    }

    // Create Stripe payment intent (1.1–1.6: metadata, requires_action, error handling)
    if (!stripe) {
      if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
      return res.status(503).json({
        success: false,
        error: 'Payment processing is not configured. Please contact support.'
      });
    }

    // Task 15: Use capture_method: 'manual' for appointment deposit holds
    const visitChargeTiming = require('./config/visit-charge-timing');
    const useManualCapture = checkout.appointment_id && visitChargeTiming.shouldAuthorizeOnlyForAppointment();

    let paymentIntent;
    try {
      const createParams = {
        amount: Math.round(chargeAmount * 100),
        currency: 'usd',
        payment_method: payment_method_id,
        confirm: true,
        return_url: `${process.env.BASE_URL || 'http://localhost:4000'}/payment/success`,
        automatic_payment_methods: { enabled: true, allow_redirects: 'always' },
        metadata: {
          checkout_id: resolvedCheckoutId,
          merchant_id: String(checkout.merchant_id || ''),
          payment_token: payment_token || ''
        }
      };
      if (useManualCapture) {
        createParams.capture_method = 'manual';
      }
      const { withRetry } = require('./utils/retry');
      paymentIntent = await withRetry(() => stripe.paymentIntents.create(createParams), { maxAttempts: 3 });
    } catch (stripeErr) {
      console.error('❌ Stripe API error:', stripeErr.message, stripeErr.type, stripeErr.code);
      if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
      const isDecline = stripeErr.type === 'StripeCardError' || stripeErr.code === 'card_declined';
      const isNetwork = stripeErr.type === 'StripeConnectionError';
      return res.status(400).json({
        success: false,
        error: isDecline ? (stripeErr.message || 'Card was declined') : isNetwork ? 'Network error. Please try again.' : (stripeErr.message || 'Payment failed'),
        stripe_error_type: stripeErr.type,
        stripe_error_code: stripeErr.code
      });
    }

    // 1.3: Handle requires_action (3DS)
    if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_source_action') {
      console.log(`⚠️  Payment requires 3DS: ${paymentIntent.id}`);
      const result = PaymentFlowService.buildLifecycleResponse({
        stage: 'payment_action_required',
        nextAction: 'complete_3ds',
        message: 'Additional payment authentication is required',
        checkoutId: resolvedCheckoutId,
        paymentMethod: 'stripe',
        paymentIntentId: paymentIntent.id,
        requiresAction: true,
        requiresVerification: false,
        extra: {
          client_secret: paymentIntent.client_secret
        }
      });
      if (db.completeIdempotentResult) db.completeIdempotentResult(idemKey, claimOpType, result);
      return res.json(result);
    }

    // succeeded, processing = immediate capture; requires_capture = auth-only (Task 15)
    const terminalSuccess = ['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status);
    if (!terminalSuccess) {
      console.error(`❌ Payment unexpected status: ${paymentIntent.status}`);
      if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
      return res.status(400).json({
        success: false,
        error: `Payment ${paymentIntent.status}`,
        payment_intent_id: paymentIntent.id
      });
    }

    const authorizedOnly = paymentIntent.status === 'requires_capture';
    console.log(`✅ Stripe payment ${authorizedOnly ? 'authorized (requires_capture)' : 'successful'}: ${paymentIntent.id}`);

    // Update checkout status
    await db.updateVoiceCheckout(resolvedCheckoutId, {
      status: 'completed',
      payment_intent_id: paymentIntent.id,
      payment_method: 'stripe'
    });

    console.log(`✅ Checkout ${resolvedCheckoutId} marked as completed`);

    // Task 12, 15, 16: Financial audit, ledger, receipt
    await PaymentProcessorService.completePaymentSuccess({
      checkout, amount: chargeAmount, paymentMethod: 'stripe',
      paymentIntentId: paymentIntent.id
    });

    // Auto-confirm appointment if linked
    if (checkout.appointment_id) {
      try {
        const BookingService = require('./services/booking-service');
        const confirmResult = await BookingService.confirmAppointment(
          checkout.appointment_id,
          checkout.clinic_id || null
        );
        if (confirmResult.success) {
          console.log(`✅ Appointment ${checkout.appointment_id} auto-confirmed after payment`);
        } else {
          console.warn(`⚠️  Could not auto-confirm appointment: ${confirmResult.error}`);
        }
      } catch (confirmError) {
        console.warn(`⚠️  Error auto-confirming appointment: ${confirmError.message}`);
      }
    }

    const result = PaymentFlowService.buildLifecycleResponse({
      stage: authorizedOnly ? 'payment_authorized' : 'payment_settled',
      nextAction: authorizedOnly ? 'capture_payment' : 'complete',
      message: authorizedOnly ? 'Payment authorized and awaiting capture' : 'Card payment settled successfully',
      checkoutId: resolvedCheckoutId,
      paymentMethod: 'stripe',
      paymentIntentId: paymentIntent.id,
      requiresVerification: false,
      extra: {
        appointment_confirmed: !!checkout.appointment_id,
        requires_capture: authorizedOnly
      }
    });
    PaymentFlowService.logTransition(authorizedOnly ? 'payment_authorized_stripe' : 'payment_settled_stripe', {
      checkout_id: resolvedCheckoutId,
      appointment_id: checkout.appointment_id,
      clinic_id: checkout.clinic_id,
      merchant_id: checkout.merchant_id,
      payment_method: 'stripe'
    });
    if (db.completeIdempotentResult) db.completeIdempotentResult(idemKey, claimOpType, result);
    res.json(result);

  } catch (error) {
    console.error('❌ Payment processing error:', error);
    if (typeof idemKey !== 'undefined' && db.releaseIdempotencyKey) {
      db.releaseIdempotencyKey(idemKey, claimOpType);
    }
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// DASHBOARD API ENDPOINTS
// ============================================

// Signup
// Helper function to generate clinic slug from name
function generateClinicSlug(clinicName) {
  return clinicName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50); // Limit length
}

// Helper function to ensure unique clinic slug
async function ensureUniqueClinicSlug(baseSlug) {
  let slug = baseSlug;
  let counter = 1;

  while (await db.getClinicBySlug(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password, clinic_name, clinic_phone } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required'
      });
    }

    if (!clinic_name || !clinic_phone) {
      return res.status(400).json({
        success: false,
        error: 'Clinic name and phone number are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }

    // Validate phone number format (E.164)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    const normalizedPhone = clinic_phone.replace(/\s+/g, '');
    if (!phoneRegex.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid phone number in E.164 format (e.g., +15555551234)'
      });
    }

    // CRITICAL: Check if customer already exists (multitenancy check)
    const existingCustomer = db.getCustomerByEmail(email);
    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Check if user already exists (backward compatibility check)
    const existingUser = db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Check if clinic name/slug already exists
    const baseSlug = generateClinicSlug(clinic_name);
    if (baseSlug.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid clinic name. Please use alphanumeric characters.'
      });
    }

    // Check if phone number is already in use
    const existingClinicByPhone = await db.getClinicByPhoneNumber(normalizedPhone);
    if (existingClinicByPhone) {
      return res.status(400).json({
        success: false,
        error: 'This phone number is already registered to another clinic'
      });
    }

    // Generate unique clinic slug
    const clinicSlug = await ensureUniqueClinicSlug(baseSlug);

    console.log(`\n🏥 Creating new clinic with multitenancy: ${clinic_name}`);
    console.log(`   Slug: ${clinicSlug}`);
    console.log(`   Phone: ${normalizedPhone}`);
    console.log(`   Owner: ${name} (${email})`);

    // CRITICAL STEP 1: Create merchant with subdomain (multitenancy)
    const merchantId = `merchant-${uuidv4()}`;
    const apiKey = `mk_${crypto.randomBytes(32).toString('hex')}`;

    try {
      const merchant = {
        id: merchantId,
        name: clinic_name, // Use clinic_name as merchant name
        api_key: apiKey,
        api_url: '',
        webhook_url: '',
        enabled_platforms: ['voice'], // SaaS customers use voice platform
        status: 'active'
      };

      // This will automatically generate a unique subdomain
      db.createMerchant(merchant);

      // Get the merchant to retrieve the generated subdomain
      const createdMerchant = db.getMerchant(merchantId);
      console.log(`✅ Merchant created: ${merchantId} with subdomain: ${createdMerchant?.subdomain || 'N/A'}`);
    } catch (merchantError) {
      console.error('❌ Failed to create merchant:', merchantError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create merchant account. Please try again.'
      });
    }

    // CRITICAL STEP 2: Create customer record (multitenancy)
    const customerId = `cust_${uuidv4()}`;
    let password_hash;
    if (bcrypt) {
      password_hash = await bcrypt.hash(password, 10);
    } else {
      password_hash = crypto.createHash('sha256').update(password).digest('hex');
      console.log('⚠️  Using SHA256 instead of BCrypt (install bcryptjs for secure hashing)');
    }

    try {
      db.createCustomer({
        id: customerId,
        name,
        email,
        phone_number: normalizedPhone,
        company_name: clinic_name,
        customer_type: 'saas', // Landing page signups are SaaS customers
        merchant_id: merchantId,
        email_verified: true, // Auto-verify for landing page signups
        status: 'active',
        password_hash: password_hash
      });
      console.log(`✅ Customer created: ${customerId}`);
    } catch (customerError) {
      console.error('❌ Failed to create customer:', customerError);
      // Cleanup: delete merchant if customer creation fails
      try {
        db.prepare('DELETE FROM merchants WHERE id = ?').run(merchantId);
      } catch (cleanupError) {
        console.error('❌ Failed to cleanup merchant:', cleanupError);
      }
      return res.status(500).json({
        success: false,
        error: 'Failed to create customer account. Please try again.'
      });
    }

    // STEP 3: Create clinic record (backward compatibility)
    const clinicId = `clinic-${uuidv4()}`;

    try {
      db.createClinic({
        id: clinicId,
        clinic_slug: clinicSlug,
        name: clinic_name,
        phone_number: normalizedPhone,
        merchant_id: merchantId,
        status: 'active'
      });
      console.log(`✅ Clinic created: ${clinicId}`);
    } catch (clinicError) {
      console.error('❌ Failed to create clinic:', clinicError);
      // Don't fail - clinic is optional for multitenancy
    }

    // STEP 4: Create Retell agent
    let retellAgentId = null;
    let retellAgentStatus = 'pending';

    try {
      const retellService = new RetellService();
      const agentResult = await retellService.createAgent({
        name: clinic_name,
        phone_number: normalizedPhone
      });

      if (agentResult.success) {
        retellAgentId = agentResult.agent_id;
        retellAgentStatus = 'active';
        db.updateCustomerRetellAgent(customerId, retellAgentId, retellAgentStatus);
        console.log(`✅ Retell agent created: ${retellAgentId}`);
      } else {
        console.warn(`⚠️  Retell agent creation failed: ${agentResult.error}`);
        // Continue - agent can be created later
      }
    } catch (retellError) {
      console.error('❌ Retell agent creation error:', retellError);
      // Continue - agent can be created later
    }

    // Update clinic with Retell agent ID (if exists)
    if (retellAgentId && clinicId) {
      try {
        db.updateClinic(clinicId, {
          retell_agent_id: retellAgentId,
          retell_agent_status: retellAgentStatus
        });
      } catch (clinicUpdateError) {
        console.warn('⚠️  Failed to update clinic with Retell agent:', clinicUpdateError);
      }
    }

    // STEP 5: Link phone number to clinic (backward compatibility)
    if (clinicId) {
      try {
        db.createClinicPhoneNumber({
          id: `phone-${uuidv4()}`,
          clinic_id: clinicId,
          phone_number: normalizedPhone,
          status: 'active'
        });
        console.log(`✅ Phone number linked to clinic`);
      } catch (phoneError) {
        console.error('❌ Failed to link phone number:', phoneError);
        // Continue even if phone linking fails
      }
    }

    // STEP 6: Create user record (backward compatibility with clinic system)
    const userId = `user-${uuidv4()}`;
    try {
      db.createUser({
        id: userId,
        email,
        password_hash,
        name,
        role: 'healthcare_provider',
        merchant_id: merchantId,
        clinic_id: clinicId,
        auth_method: 'email'
      });
      console.log(`✅ User created: ${userId}`);
    } catch (userError) {
      console.error('❌ Failed to create user:', userError);
      // Don't fail - user record is for backward compatibility
    }

    // STEP 7: Allocate free credits on signup
    try {
      const customerType = 'saas'; // Landing page signups are SaaS customers
      const freeCredits = 250; // SaaS customers get 250 free minutes
      db.allocateFreeCredits(customerId, freeCredits);
      console.log(`✅ Allocated ${freeCredits} free credits to customer ${customerId} (${customerType})`);
    } catch (creditError) {
      console.error('❌ Failed to allocate free credits:', creditError);
      // Don't fail the request - credits can be allocated manually later
    }

    // STEP 8: Create customer session
    const sessionId = db.createCustomerSession(
      customerId,
      req.ip,
      req.get('user-agent')
    );

    // Set session cookie with domain for cross-subdomain access
    const isSecure = process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieOptions = {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    // Set domain for cross-subdomain cookie sharing in production
    if (process.env.NODE_ENV === 'production' || req.headers.host?.includes('doclittle.site')) {
      cookieOptions.domain = '.doclittle.site';
    }

    res.cookie('customer_session', sessionId, cookieOptions);

    // STEP 9: Get merchant to retrieve subdomain
    const merchant = db.getMerchant(merchantId);
    const subdomain = merchant?.subdomain || null;

    // STEP 10: Send welcome email with subdomain and password (async, don't block response)
    setImmediate(async () => {
      try {
        const EmailService = require('./services/email-service');
        await EmailService.sendWelcomeEmail(
          email,
          name,
          subdomain,
          'saas', // Landing page signups are SaaS customers
          merchantId,
          password // Send the password they chose
        );
        console.log(`✅ Welcome email sent to ${email} with subdomain: ${subdomain || 'N/A'}`);
      } catch (emailError) {
        console.error('❌ Failed to send welcome email:', emailError);
        // Don't fail the request if email fails
      }

      // STEP 11: Automatically set up Azure custom domain and SSL for new tenant subdomain
      if (subdomain) {
        try {
          const AzureDomainService = require('./services/azure-domain-service');
          console.log(`🌐 Starting automated Azure domain setup for subdomain: ${subdomain}`);

          const azureResult = await AzureDomainService.setupTenantDomain(subdomain, {
            rootDomain: process.env.AZURE_ROOT_DOMAIN || 'doclittle.site',
            appName: process.env.AZURE_APP_NAME || 'doclittle',
            resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'doclittle',
            skipSSL: process.env.AZURE_SKIP_SSL === 'true', // Allow skipping in dev
            maxRetries: 3,
            retryDelayMs: 60000 // 1 minute between retries
          });

          if (azureResult.success) {
            console.log(`✅ Azure domain setup completed for ${subdomain}.${azureResult.domain}`);
          } else if (azureResult.skipped) {
            console.log(`⏭️  Azure domain setup skipped: ${azureResult.reason}`);
          } else {
            console.warn(`⚠️  Azure domain setup partially completed for ${subdomain}: ${azureResult.error || azureResult.warning}`);
          }
        } catch (azureError) {
          console.error(`❌ Failed to set up Azure domain for ${subdomain}:`, azureError.message);
          // Don't fail the request - domain setup can be done manually later
        }
      } else {
        console.warn(`⚠️  No subdomain available for Azure domain setup`);
      }
    });

    console.log(`✅ Clinic signup completed with multitenancy: ${clinic_name} (subdomain: ${subdomain || 'N/A'})`);

    res.json({
      success: true,
      customer: {
        id: customerId,
        name,
        email,
        merchant_id: merchantId,
        subdomain: subdomain
      },
      user: {
        id: userId,
        email,
        name,
        role: 'healthcare_provider',
        merchant_id: merchantId,
        clinic_id: clinicId,
        clinic_slug: clinicSlug
      },
      clinic: {
        id: clinicId,
        name: clinic_name,
        slug: clinicSlug,
        phone: normalizedPhone,
        retell_agent_id: retellAgentId,
        retell_agent_status: retellAgentStatus
      },
      subdomain: subdomain, // Return subdomain for frontend
      clinic_slug: clinicSlug // For redirect (backward compatibility)
    });
  } catch (error) {
    console.error('❌ Signup error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create account'
    });
  }
});

// Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Test accounts removed for security
    // All authentication now goes through database

    // Check database for other users
    const user = db.getUserByEmail(email);

    if (user && user.password_hash) {
      // Database user with password
      let isValid = false;

      if (bcrypt) {
        // Use BCrypt if available
        isValid = await bcrypt.compare(password, user.password_hash);
      } else {
        // Fallback: use crypto comparison (NOT SECURE - for demo only)
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        isValid = (hash === user.password_hash);
      }

      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      // Update last login
      db.updateUserLastLogin(user.id);

      const session = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        merchant_id: user.merchant_id,
        picture: user.picture,
        token: Buffer.from(user.email).toString('base64')
      };

      console.log(`✅ User logged in: ${email}`);

      return res.json({
        success: true,
        user: session
      });
    }

    // No match found
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password'
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Google OAuth authentication
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential, email, name, picture } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Google credentials'
      });
    }

    // In production, verify the credential with Google
    // For now, accept any valid Google sign-in and create/find user

    // Check if user exists
    let user = db.getUserByEmail(email);

    if (!user) {
      // Create new user from Google account
      const userId = `user-${uuidv4()}`;

      // For Google OAuth users, merchant_id should be determined from user's clinic association
      // For now, set to null - user can be associated with clinic/merchant later
      // This prevents hardcoding and allows proper multi-tenant association
      db.createUser({
        id: userId,
        email,
        password_hash: null, // Google users don't have password
        name,
        role: 'healthcare_provider',
        merchant_id: null, // Will be set when user is associated with a clinic/merchant
        picture,
        auth_method: 'google',
        google_id: credential // Store Google ID for future reference
      });

      user = db.getUserByEmail(email);
      console.log(`✅ New user created via Google: ${email}`);
    } else {
      // Update picture if changed
      if (picture && user.picture !== picture) {
        db.updateUser(user.id, { picture });
      }
      console.log(`✅ Existing user logged in via Google: ${email}`);
    }

    // Update last login
    db.updateUserLastLogin(user.id);

    const session = {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture || picture,
      role: user.role,
      merchant_id: user.merchant_id,
      token: Buffer.from(user.email).toString('base64'),
      auth_method: 'google'
    };

    res.json({
      success: true,
      user: session
    });
  } catch (error) {
    console.error('❌ Google auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to authenticate with Google'
    });
  }
});

// Google Calendar OAuth connect
app.get('/auth/google/calendar/connect', (req, res) => {
  try {
    const { email, returnUrl } = req.query;

    if (!email) {
      return res.status(400).send('Missing email parameter');
    }

    const oauthClient = getGoogleOAuthClient();
    if (!oauthClient) {
      return res.status(400).send('Google OAuth is not configured on the server');
    }

    const state = encodeState({
      email,
      returnUrl: returnUrl || req.headers.referer || null
    });

    const scope = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    const authUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope,
      state
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('❌ Google Calendar connect error:', error);
    res.status(500).send('Failed to initiate Google Calendar connection');
  }
});

app.get('/auth/google/calendar/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const decodedState = decodeState(state || '');
  const email = decodedState.email;
  const returnUrl =
    decodedState.returnUrl ||
    process.env.CALENDAR_RETURN_URL ||
    (req.headers.origin
      ? `${req.headers.origin.replace(/\/$/, '')}/business/settings.html`
      : 'https://doclittle.site/unified-dashboard/business/settings.html');

  if (error) {
    console.error('❌ Google Calendar OAuth error:', error);
    return res.redirect(`${returnUrl}?calendarError=${encodeURIComponent(error)}`);
  }

  if (!code || !email) {
    return res.redirect(`${returnUrl}?calendarError=${encodeURIComponent('Missing authorization code or email')}`);
  }

  try {
    const user = db.getUserCalendarSettingsByEmail(email);
    if (!user) {
      return res.redirect(`${returnUrl}?calendarError=${encodeURIComponent('User not found')}`);
    }

    const oauthClient = getGoogleOAuthClient();
    if (!oauthClient) {
      return res.redirect(`${returnUrl}?calendarError=${encodeURIComponent('Google OAuth is not configured')}`);
    }

    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);

    if (!google) {
      return res.redirect(`${returnUrl}?calendarError=${encodeURIComponent('Google APIs not available')}`);
    }

    const calendar = google.calendar({ version: 'v3', auth: oauthClient });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });

    let calendarEmail = user.google_calendar_email || email;
    try {
      const profile = await oauth2.userinfo.get();
      if (profile?.data?.email) {
        calendarEmail = profile.data.email;
      }
    } catch (profileError) {
      console.warn('⚠️  Unable to load Google user info:', profileError.message);
    }

    const calendarList = await calendar.calendarList.list({ minAccessRole: 'writer' });
    const calendars = calendarList.data.items || [];
    const primaryCalendar = calendars.find(c => c.primary) || calendars[0] || null;

    const accessToken = oauthClient.credentials.access_token || tokens.access_token || null;
    const refreshToken = tokens.refresh_token !== undefined
      ? tokens.refresh_token
      : user.google_refresh_token;
    const expiryDate = oauthClient.credentials.expiry_date || tokens.expiry_date || null;

    db.setUserCalendarConnection(user.id, {
      connected: true,
      calendar_email: calendarEmail,
      calendar_id: primaryCalendar?.id || user.google_calendar_id || 'primary',
      calendar_name: primaryCalendar?.summary || primaryCalendar?.description || 'Primary Calendar',
      calendar_timezone: primaryCalendar?.timeZone || user.google_calendar_timezone || null,
      access_token: accessToken,
      refresh_token: refreshToken !== undefined ? refreshToken : undefined,
      token_expiry: expiryDate,
      scopes: tokens.scope || oauthClient.credentials.scope || null
    });

    res.redirect(`${returnUrl}?calendar=connected`);
  } catch (oauthError) {
    console.error('❌ Google Calendar callback error:', oauthError);
    res.redirect(`${returnUrl}?calendarError=${encodeURIComponent(oauthError.message || 'Failed to connect Google Calendar')}`);
  }
});

app.get('/api/calendar/status', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing email parameter'
      });
    }

    const user = db.getUserCalendarSettingsByEmail(email);
    if (!user) {
      // User doesn't exist yet - return success with not connected status
      return res.json({
        success: true,
        connected: false,
        calendar_email: email,
        calendar_id: 'primary',
        calendar_name: 'Primary Calendar',
        calendar_timezone: null,
        last_sync_at: null,
        scopes: null,
        needsReconnect: false,
        calendars: [],
        message: null
      });
    }

    const connected = !!user.google_calendar_connected && !!user.google_refresh_token;

    const response = {
      success: true,
      connected,
      calendar_email: user.google_calendar_email || user.email,
      calendar_id: user.google_calendar_id || 'primary',
      calendar_name: user.google_calendar_name || 'Primary Calendar',
      calendar_timezone: user.google_calendar_timezone || null,
      last_sync_at: user.google_calendar_sync_at,
      scopes: user.google_calendar_scopes,
      needsReconnect: !user.google_refresh_token,
      calendars: [],
      message: null
    };

    if (connected && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      const oauthClient = getGoogleOAuthClient();
      if (oauthClient) {
        oauthClient.setCredentials({
          refresh_token: user.google_refresh_token,
          access_token: user.google_access_token || undefined,
          expiry_date: user.google_token_expiry || undefined
        });

        try {
          if (!google) {
            throw new Error('Google APIs not available');
          }

          const calendar = google.calendar({ version: 'v3', auth: oauthClient });
          const list = await calendar.calendarList.list({ minAccessRole: 'writer' });
          const calendars = (list.data.items || []).map(item => ({
            id: item.id,
            name: item.summary,
            description: item.description,
            primary: !!item.primary,
            role: item.accessRole,
            timeZone: item.timeZone,
            selected: item.id === user.google_calendar_id
          }));

          response.calendars = calendars;
          response.needsReconnect = false;
          response.message = null;

          db.updateUserCalendarTokens(user.id, {
            access_token: oauthClient.credentials.access_token,
            token_expiry: oauthClient.credentials.expiry_date,
            refresh_token: oauthClient.credentials.refresh_token !== undefined
              ? oauthClient.credentials.refresh_token
              : undefined,
            error_message: null
          });
        } catch (calendarError) {
          console.warn('⚠️  Failed to list Google Calendars:', calendarError.message);
          response.needsReconnect = true;
          response.message = calendarError.message || 'Failed to access Google Calendar. Please reconnect.';

          db.updateUserCalendarTokens(user.id, {
            error_message: response.message
          });
        }
      }
    }

    res.json(response);
  } catch (error) {
    console.error('❌ Calendar status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load calendar status'
    });
  }
});

app.get('/api/calendar/calendars', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing email parameter'
      });
    }

    const user = db.getUserCalendarSettingsByEmail(email);
    if (!user || !user.google_refresh_token) {
      return res.json({
        success: true,
        connected: false,
        calendars: []
      });
    }

    const oauthClient = getGoogleOAuthClient();
    if (!oauthClient) {
      return res.status(400).json({
        success: false,
        error: 'Google OAuth is not configured on the server'
      });
    }

    oauthClient.setCredentials({
      refresh_token: user.google_refresh_token,
      access_token: user.google_access_token || undefined,
      expiry_date: user.google_token_expiry || undefined
    });

    try {
      if (!google) {
        return res.status(500).json({
          success: false,
          error: 'Google APIs not available'
        });
      }

      const calendar = google.calendar({ version: 'v3', auth: oauthClient });
      const list = await calendar.calendarList.list({ minAccessRole: 'writer' });
      const calendars = (list.data.items || []).map(item => ({
        id: item.id,
        name: item.summary,
        description: item.description,
        primary: !!item.primary,
        role: item.accessRole,
        timeZone: item.timeZone,
        selected: item.id === user.google_calendar_id
      }));

      db.updateUserCalendarTokens(user.id, {
        access_token: oauthClient.credentials.access_token,
        token_expiry: oauthClient.credentials.expiry_date,
        refresh_token: oauthClient.credentials.refresh_token !== undefined
          ? oauthClient.credentials.refresh_token
          : undefined,
        error_message: null
      });

      res.json({
        success: true,
        connected: true,
        calendars
      });
    } catch (calendarError) {
      console.error('❌ Google calendar list error:', calendarError);
      res.status(500).json({
        success: false,
        error: calendarError.message || 'Failed to load calendars'
      });
    }
  } catch (error) {
    console.error('❌ Calendar list error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load calendar list'
    });
  }
});

app.post('/api/calendar/select', async (req, res) => {
  try {
    const { email, calendar_id, calendar_name, calendar_timezone } = req.body || {};

    if (!email || !calendar_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing email or calendar_id'
      });
    }

    const user = db.getUserCalendarSettingsByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    db.updateUserCalendarSelection(user.id, {
      calendar_id,
      calendar_name,
      calendar_timezone
    });

    res.json({
      success: true,
      calendar_id,
      calendar_name,
      calendar_timezone
    });
  } catch (error) {
    console.error('❌ Calendar selection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update calendar selection'
    });
  }
});

app.post('/api/calendar/disconnect', async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing email'
      });
    }

    const user = db.getUserCalendarSettingsByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    db.clearUserCalendarConnection(user.id);

    res.json({
      success: true,
      message: 'Google Calendar disconnected'
    });
  } catch (error) {
    console.error('❌ Calendar disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect Google Calendar'
    });
  }
});

// ============================================
// CLIENT MANAGEMENT API (Admin Portal)
// ============================================

app.post('/api/admin/session', handleAdminLogin);
app.delete('/api/admin/session', handleAdminLogout);
app.get('/api/admin/session', adminSessionStatus);

// Seed test patients endpoint (S-4: SEED_ENABLED + block staging)
app.post('/api/admin/patients/seed-test', async (req, res) => {
  const env = process.env.NODE_ENV || '';
  if (env === 'production' || env === 'prod') {
    return res.status(403).json({
      success: false,
      error: 'Test patient seeding is not allowed in production environment'
    });
  }
  if (env === 'staging') {
    return res.status(403).json({
      success: false,
      error: 'Test patient seeding is not allowed in staging environment'
    });
  }
  if (process.env.SEED_ENABLED !== '1' && process.env.SEED_ENABLED !== 'true') {
    return res.status(403).json({
      success: false,
      error: 'Seed endpoint disabled. Set SEED_ENABLED=1 to enable.'
    });
  }

  try {
    const { v4: uuidv4 } = require('uuid');

    const testPatients = [
      {
        firstName: 'Sarah',
        lastName: 'Johnson',
        phone: '+18622307479',
        email: 'sarah.johnson@example.com',
        birthDate: '1985-05-20',
        memberId: 'TEST81941',
        payerId: 'AETNA',
        copay: 25,
        allowedAmount: 150,
        insurancePays: 125,
        deductibleTotal: 1000,
        deductibleRemaining: 600,
        coinsurancePercent: 20,
        planSummary: 'Standard PPO: outpatient mental health covered after copay; deductible applies to labs only.'
      },
      {
        firstName: 'Michael',
        lastName: 'Williams',
        phone: '+15551234567',
        email: 'michael.williams@example.com',
        birthDate: '1980-01-15',
        memberId: 'TEST902782',
        payerId: 'BCBS',
        copay: 20,
        allowedAmount: 150,
        insurancePays: 130,
        deductibleTotal: 500,
        deductibleRemaining: 200,
        coinsurancePercent: 20,
        planSummary: 'Covers outpatient mental health visits; prior auth not required for first 6 visits.'
      }
    ];

    let created = 0;
    let updated = 0;

    for (const patientData of testPatients) {
      try {
        const fullName = `${patientData.firstName} ${patientData.lastName}`;
        console.log(`\n📝 Processing: ${fullName} (${patientData.phone})`);

        // Normalize phone number for search (try both formats)
        const phoneVariants = [
          patientData.phone,
          patientData.phone.replace('+1', ''),
          patientData.phone.replace('+', ''),
          `+1${patientData.phone.replace(/[^\d]/g, '')}`,
          patientData.phone.replace(/[^\d]/g, '')
        ];

        // Check if patient already exists (try different phone formats)
        let existingPatient = null;
        for (const phoneVariant of phoneVariants) {
          existingPatient = db.db.prepare('SELECT * FROM fhir_patients WHERE phone = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1').get(phoneVariant);
          if (existingPatient) {
            console.log(`   Found existing patient with phone: ${phoneVariant}`);
            break;
          }
        }

        let patientId;
        if (existingPatient) {
          patientId = existingPatient.resource_id;
          console.log(`   ⏭️  Patient exists: ${patientId}, updating name...`);

          // Update patient name if needed
          const currentName = existingPatient.name || '';
          if (currentName !== fullName) {
            let resourceData = {};
            try {
              resourceData = JSON.parse(existingPatient.resource_data);
            } catch (e) { }

            resourceData.name = [{
              use: 'official',
              family: patientData.lastName,
              given: [patientData.firstName]
            }];
            resourceData.resourceType = 'Patient';

            db.db.prepare(`
              UPDATE fhir_patients
              SET name = ?,
                  resource_data = ?,
                  updated_at = datetime('now')
              WHERE resource_id = ?
            `).run(fullName, JSON.stringify(resourceData), patientId);
            console.log(`   ✅ Updated patient name to: ${fullName}`);
          }
          updated++;
        } else {
          // Create new patient
          console.log(`   ➕ Creating new patient...`);
          const patientResult = await FHIRService.getOrCreatePatient({
            name: {
              family: patientData.lastName,
              given: [patientData.firstName]
            },
            phone: patientData.phone,
            email: patientData.email,
            birthDate: patientData.birthDate
          }, false);

          if (!patientResult.patient) {
            console.warn(`   ⚠️  Failed to create patient ${fullName}`);
            continue;
          }

          patientId = patientResult.patient.id || patientResult.patient.resource_id;
          console.log(`   ✅ Created patient: ${patientId}`);
          created++;
        }

        // Check if eligibility check already exists
        const existingEligibility = db.db.prepare(`
          SELECT id FROM eligibility_checks
          WHERE patient_id = ? AND member_id = ? AND payer_id = ?
          LIMIT 1
        `).get(patientId, patientData.memberId, patientData.payerId);

        if (!existingEligibility) {
          // Create eligibility check
          console.log(`   💳 Creating eligibility check...`);
          const eligibilityId = `elig_${uuidv4()}`;

          // Bug 6: Use 99203 fallback to match getCptCodeForVisit new-patient PrimaryCare/routine
          const defaultCpt = (() => { try { return require('./utils/cpt-helper').getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine', isNewPatient: true }); } catch (_) { return '99203'; } })();
          db.db.prepare(`
            INSERT INTO eligibility_checks (
              id, patient_id, member_id, payer_id, service_code, date_of_service,
              eligible, copay_amount, allowed_amount, insurance_pays,
              deductible_total, deductible_remaining, coinsurance_percent,
              plan_summary, response_data, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            eligibilityId,
            patientId,
            patientData.memberId,
            patientData.payerId,
            defaultCpt,
            new Date().toISOString().split('T')[0],
            1,
            patientData.copay,
            patientData.allowedAmount,
            patientData.insurancePays,
            patientData.deductibleTotal,
            patientData.deductibleRemaining,
            patientData.coinsurancePercent,
            patientData.planSummary,
            JSON.stringify({
              eligible: true,
              copay: patientData.copay,
              allowedAmount: patientData.allowedAmount,
              insurancePays: patientData.insurancePays,
              deductibleTotal: patientData.deductibleTotal,
              deductibleRemaining: patientData.deductibleRemaining,
              coinsurancePercent: patientData.coinsurancePercent,
              planSummary: patientData.planSummary,
              message: `Eligible - Copay $${patientData.copay}`
            })
          );
          console.log(`   ✅ Eligibility check created`);
        } else {
          // Update existing eligibility check to ensure data is current
          console.log(`   🔄 Updating existing eligibility check...`);
          db.db.prepare(`
            UPDATE eligibility_checks
            SET copay_amount = ?,
                allowed_amount = ?,
                insurance_pays = ?,
                deductible_total = ?,
                deductible_remaining = ?,
                coinsurance_percent = ?,
                plan_summary = ?,
                response_data = ?,
                date_of_service = ?
            WHERE id = ?
          `).run(
            patientData.copay,
            patientData.allowedAmount,
            patientData.insurancePays,
            patientData.deductibleTotal,
            patientData.deductibleRemaining,
            patientData.coinsurancePercent,
            patientData.planSummary,
            JSON.stringify({
              eligible: true,
              copay: patientData.copay,
              allowedAmount: patientData.allowedAmount,
              insurancePays: patientData.insurancePays,
              deductibleTotal: patientData.deductibleTotal,
              deductibleRemaining: patientData.deductibleRemaining,
              coinsurancePercent: patientData.coinsurancePercent,
              planSummary: patientData.planSummary,
              message: `Eligible - Copay $${patientData.copay}`
            }),
            new Date().toISOString().split('T')[0],
            existingEligibility.id
          );
          console.log(`   ✅ Eligibility check updated`);
        }

        // Create or update patient_insurance record
        const existingInsurance = db.db.prepare(`
          SELECT id FROM patient_insurance
          WHERE patient_id = ? AND payer_id = ? AND member_id = ?
          LIMIT 1
        `).get(patientId, patientData.payerId, patientData.memberId);

        if (!existingInsurance) {
          console.log(`   🏥 Creating insurance record...`);
          db.db.prepare(`
            INSERT INTO patient_insurance (
              id, patient_id, payer_id, payer_name, member_id,
              is_primary, is_verified, created_at
            ) VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'))
          `).run(
            uuidv4(),
            patientId,
            patientData.payerId,
            patientData.payerId,
            patientData.memberId
          );
          console.log(`   ✅ Insurance record created`);
        } else {
          console.log(`   ⏭️  Insurance record already exists`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing patient ${patientData.firstName} ${patientData.lastName}:`, error.message);
        console.error(error.stack);
      }
    }

    return res.json({
      success: true,
      message: `Seeded test patients: ${created} created, ${updated} updated`,
      created,
      updated
    });
  } catch (error) {
    console.error('❌ Error seeding test patients:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.use('/api/admin', requireAdminAuth);

// Visit pricing admin (Task 16)
app.post('/api/admin/pricing', pricingRoutes.postPricing);

function createMerchantForClinic(name) {
  const merchantId = `merchant-${uuidv4()}`;
  const placeholderKey = generateApiKey('managed');
  db.createMerchant({
    id: merchantId,
    name: name || merchantId,
    api_key: placeholderKey,
    api_url: process.env.API_BASE_URL || 'https://api.doclittle.site',
    webhook_url: null,
    enabled_platforms: JSON.stringify(['voice']),
    status: 'active'
  });
  return merchantId;
}

function ensureMerchantForClinic(clinic) {
  if (clinic.merchant_id) {
    return clinic.merchant_id;
  }

  const clinicId = clinic.clinic_id || clinic.id;
  if (!clinicId) {
    console.warn('[ensureMerchantForClinic] Clinic missing clinic_id/id, cannot update');
    return createMerchantForClinic(clinic.name || 'Clinic');
  }
  const merchantId = createMerchantForClinic(clinic.name || clinicId);
  db.updateClinic(clinicId, { merchant_id: merchantId });
  clinic.merchant_id = merchantId;
  return merchantId;
}

function issueMerchantApiKey(merchantId, options = {}) {
  const apiKeyValue = generateApiKey('mk');
  const record = {
    id: `mkey_${uuidv4()}`,
    merchant_id: merchantId,
    key_hash: hashApiKey(apiKeyValue),
    key_prefix: apiKeyValue.slice(0, 8),
    key_suffix: apiKeyValue.slice(-4),
    label: options.label || 'Voice Agent',
    created_by: options.createdBy || 'system',
    status: 'active'
  };

  db.createMerchantApiKey(record);
  const stored = db.getMerchantApiKey(record.id);
  return {
    apiKey: apiKeyValue,
    record: stored
  };
}

function serializeApiKey(record) {
  if (!record) return null;
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    created_at: record.created_at,
    last_used_at: record.last_used_at,
    revoked_at: record.revoked_at,
    key_preview: `${record.key_prefix}...${record.key_suffix}`
  };
}

// Get all clients/clinics
app.get('/api/admin/clients', async (req, res) => {
  try {
    const clinics = db.prepare('SELECT * FROM clinics ORDER BY created_at DESC').all();
    const enriched = clinics.map((clinic) => {
      const result = { ...clinic };
      if (clinic.merchant_id) {
        const keys = db.getMerchantApiKeys(clinic.merchant_id);
        const activeKeys = keys.filter(k => k.status === 'active');
        const latest = activeKeys[0] || keys[0];
        result.api_key_summary = {
          total: keys.length,
          active: activeKeys.length,
          latest_preview: latest ? `${latest.key_prefix}...${latest.key_suffix}` : null
        };
      } else {
        result.api_key_summary = null;
      }
      return result;
    });
    res.json({
      success: true,
      clinics: enriched || []
    });
  } catch (error) {
    console.error('❌ Error fetching clients:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get single client/clinic
app.get('/api/admin/clients/:clinicId', async (req, res) => {
  try {
    const clinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        error: 'Clinic not found'
      });
    }
    const merchantId = ensureMerchantForClinic(clinic);
    const keys = merchantId ? db.getMerchantApiKeys(merchantId).map(serializeApiKey) : [];

    res.json({
      success: true,
      clinic: {
        ...clinic,
        merchant_id: merchantId
      },
      api_keys: keys
    });
  } catch (error) {
    console.error('❌ Error fetching client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create new client/clinic
app.post('/api/admin/clients', async (req, res) => {
  try {
    const { name, phone_number, retell_agent_id, email } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Clinic name is required'
      });
    }

    // Generate slug from name
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const clinicId = `clinic-${uuidv4()}`;
    const merchantId = createMerchantForClinic(name);
    const keyLabel = `${name} Voice Agent`;
    const issuedKey = issueMerchantApiKey(merchantId, {
      label: keyLabel,
      createdBy: req.adminSession?.id || 'admin'
    });

    // Insert clinic directly (matching database schema)
    db.prepare(`
      INSERT INTO clinics (
        clinic_id, name, slug, phone_number, email, 
        retell_agent_id, retell_agent_status, merchant_id, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clinicId,
      name,
      slug,
      phone_number || null,
      email || null,
      retell_agent_id || null,
      retell_agent_id ? 'active' : 'pending',
      merchantId,
      1
    );

    const clinic = {
      clinic_id: clinicId,
      name: name,
      slug: slug,
      phone_number: phone_number || null,
      email: email || null,
      retell_agent_id: retell_agent_id || null,
      retell_agent_status: retell_agent_id ? 'active' : 'pending',
      merchant_id: merchantId,
      is_active: true
    };

    // If phone number provided, link it
    if (phone_number) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO clinic_phone_numbers (phone_number, clinic_id, is_primary)
          VALUES (?, ?, ?)
        `).run(phone_number, clinicId, 1);
      } catch (phoneError) {
        console.warn('⚠️  Could not link phone number:', phoneError.message);
      }
    }

    res.json({
      success: true,
      clinic: clinic,
      api_key: issuedKey.apiKey,
      key: serializeApiKey(issuedKey.record),
      message: 'Client created successfully. Copy the API key now – it will not be shown again.'
    });
  } catch (error) {
    console.error('❌ Error creating client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update client/clinic
app.put('/api/admin/clients/:clinicId', async (req, res) => {
  try {
    const { name, phone_number, retell_agent_id, retell_agent_status, email } = req.body;
    const clinicId = req.params.clinicId;

    const existingClinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
    if (!existingClinic) {
      return res.status(404).json({
        success: false,
        error: 'Clinic not found'
      });
    }

    // Update clinic
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (retell_agent_id !== undefined) updates.retell_agent_id = retell_agent_id;
    if (retell_agent_status !== undefined) updates.retell_agent_status = retell_agent_status;
    if (email !== undefined) updates.email = email;

    // Build update query
    const fields = [];
    const values = [];
    Object.keys(updates).forEach(key => {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(clinicId);

    db.prepare(`UPDATE clinics SET ${fields.join(', ')} WHERE clinic_id = ?`).run(...values);

    // Update phone number link if changed
    if (phone_number && phone_number !== existingClinic.phone_number) {
      try {
        // Remove old phone link if exists
        db.prepare('DELETE FROM clinic_phone_numbers WHERE clinic_id = ?').run(clinicId);

        // Add new phone link
        db.prepare(`
          INSERT OR REPLACE INTO clinic_phone_numbers (phone_number, clinic_id, is_primary)
          VALUES (?, ?, ?)
        `).run(phone_number, clinicId, 1);
      } catch (phoneError) {
        console.warn('⚠️  Could not update phone number link:', phoneError.message);
      }
    }

    const updatedClinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
    res.json({
      success: true,
      clinic: updatedClinic,
      message: 'Client updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get comprehensive dashboard stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const clinics = db.prepare('SELECT * FROM clinics').all();
    const allCheckouts = await db.getAllVoiceCheckouts();

    // Get real call data
    const allCalls = db.prepare('SELECT * FROM voice_call_log ORDER BY created_at DESC').all();
    const allFunctionCalls = db.prepare('SELECT * FROM function_call_log ORDER BY created_at DESC').all();
    const allErrors = db.prepare('SELECT * FROM error_log WHERE resolved = 0 ORDER BY created_at DESC').all();

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const todayCheckouts = allCheckouts.filter(c => c.created_at?.startsWith(today));
    const yesterdayCheckouts = allCheckouts.filter(c => c.created_at?.startsWith(yesterday));
    const todayCalls = allCalls.filter(c => c.created_at?.startsWith(today));
    const yesterdayCalls = allCalls.filter(c => c.created_at?.startsWith(yesterday));

    const todayRevenue = todayCheckouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const yesterdayRevenue = yesterdayCheckouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const revenueChange = yesterdayRevenue > 0
      ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100).toFixed(1)
      : 100;

    const completedOrders = todayCheckouts.filter(c => c.status === 'completed').length;
    const conversionRate = todayCalls.length > 0 ? (completedOrders / todayCalls.length) * 100 : 0;

    // Calculate real minutes from call logs
    const totalMinutes = allCalls.reduce((sum, c) => sum + (c.call_duration_seconds || 0), 0) / 60;
    const todayMinutes = todayCalls.reduce((sum, c) => sum + (c.call_duration_seconds || 0), 0) / 60;

    // Calculate real response times from function calls
    const successfulFunctionCalls = allFunctionCalls.filter(f => f.success === 1);
    const avgResponseTime = successfulFunctionCalls.length > 0
      ? successfulFunctionCalls.reduce((sum, f) => sum + (f.response_time_ms || 0), 0) / successfulFunctionCalls.length
      : 0;

    // Calculate real error rate
    const totalRequests = allCalls.length + allFunctionCalls.length;
    const errorRate = totalRequests > 0 ? (allErrors.length / totalRequests * 100) : 0;

    const totalRevenue = allCheckouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    res.json({
      success: true,
      totalClients: clinics.length,
      todayRevenue: todayRevenue,
      yesterdayRevenue: yesterdayRevenue,
      revenueChange: revenueChange,
      todayCalls: todayCalls.length,
      totalCalls: allCalls.length,
      totalMinutes: Math.round(totalMinutes),
      todayMinutes: Math.round(todayMinutes),
      avgResponseTime: Math.round(avgResponseTime),
      errorRate: errorRate.toFixed(2),
      conversionRate: conversionRate.toFixed(1),
      totalRevenue: totalRevenue,
      totalOrders: allCheckouts.filter(c => c.status === 'completed').length,
      totalErrors: allErrors.length
    });
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get performance metrics
app.get('/api/admin/performance', async (req, res) => {
  try {
    // Placeholder performance data - implement real metrics
    res.json({
      success: true,
      responseTime: {
        p50: 120,
        p95: 350,
        p99: 680
      },
      errorRate: 0.8,
      successRate: 99.2,
      slowEndpoints: [
        { endpoint: '/api/pdf-coding/process', avg: 450, p95: 890, p99: 1200, requests: 1200 },
        { endpoint: '/voice/checkout/create', avg: 320, p95: 650, p99: 980, requests: 3500 }
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get cost analytics
app.get('/api/admin/costs', async (req, res) => {
  try {
    const clinics = db.prepare('SELECT * FROM clinics').all();
    const allCalls = db.prepare('SELECT * FROM voice_call_log').all();

    // Calculate real costs from actual call data
    const totalMinutes = allCalls.reduce((sum, c) => sum + ((c.call_duration_seconds || 0) / 60), 0);
    const twilioCost = totalMinutes * 0.013; // $0.013 per minute (Twilio pricing)
    const retellCost = totalMinutes * 0.02; // $0.02 per minute (Retell pricing)
    const infraCost = 4200; // Monthly infrastructure estimate (Azure App Service)

    // Calculate costs per client
    const allVoiceCheckouts = await db.getAllVoiceCheckouts();
    const byClient = clinics.map(clinic => {
      const clinicCalls = allCalls.filter(c => c.customer_id === clinic.clinic_id);
      const clinicMinutes = clinicCalls.reduce((sum, c) => sum + ((c.call_duration_seconds || 0) / 60), 0);
      const clinicTwilioCost = clinicMinutes * 0.013;
      const clinicRetellCost = clinicMinutes * 0.02;
      const clinicInfraCost = infraCost / clinics.length; // Shared infrastructure

      // Get revenue for this client
      const clinicCheckouts = allVoiceCheckouts.filter(c => {
        // Try to match by phone number or clinic_id if stored
        return c.customer_phone && db.getClinicPhoneNumber(c.customer_phone)?.clinic_id === clinic.clinic_id;
      });
      const clinicRevenue = clinicCheckouts
        .filter(c => c.status === 'completed')
        .reduce((sum, c) => sum + (c.amount || 0), 0);

      return {
        clinic_id: clinic.clinic_id,
        name: clinic.name,
        phone_number: clinic.phone_number,
        retell_agent_id: clinic.retell_agent_id,
        infrastructure: clinicInfraCost,
        twilio: clinicTwilioCost,
        retell: clinicRetellCost,
        total: clinicInfraCost + clinicTwilioCost + clinicRetellCost,
        revenue: clinicRevenue,
        margin: clinicRevenue > 0 ? ((clinicRevenue - (clinicInfraCost + clinicTwilioCost + clinicRetellCost)) / clinicRevenue * 100) : 0,
        call_count: clinicCalls.length,
        total_minutes: Math.round(clinicMinutes)
      };
    });

    res.json({
      success: true,
      infrastructure: infraCost,
      twilio: twilioCost,
      retell: retellCost,
      total: infraCost + twilioCost + retellCost,
      total_minutes: Math.round(totalMinutes),
      byClient: byClient
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get usage metrics
app.get('/api/admin/usage', async (req, res) => {
  try {
    const allCheckouts = await db.getAllVoiceCheckouts();
    const totalMinutes = allCheckouts.length * 2;

    res.json({
      success: true,
      apiRequests: allCheckouts.length * 10, // Estimate
      voiceMinutes: totalMinutes,
      webhookEvents: allCheckouts.length * 2 // Estimate
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get error logs
app.get('/api/admin/logs', async (req, res) => {
  try {
    const level = req.query.level || 'all';
    const clinicId = req.query.clinic_id;
    const limit = parseInt(req.query.limit) || 100;

    let query = 'SELECT * FROM error_log WHERE 1=1';
    const params = [];

    if (clinicId) {
      query += ' AND customer_id = ?';
      params.push(clinicId);
    }

    if (level !== 'all') {
      query += ' AND severity = ?';
      params.push(level);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const errors = db.prepare(query).all(...params);

    // Get clinic names for errors
    const logs = await Promise.all(errors.map(async (error) => {
      let clinicName = 'Unknown';
      if (error.customer_id) {
        const clinic = await db.getClinicById(error.customer_id);
        if (clinic) clinicName = clinic.name;
      }

      return {
        id: error.id,
        level: error.severity,
        message: error.error_message,
        type: error.error_type,
        clinic_id: error.customer_id,
        clinic_name: clinicName,
        endpoint: error.endpoint,
        timestamp: error.created_at,
        resolved: error.resolved === 1,
        context: error.context ? JSON.parse(error.context) : null
      };
    }));

    res.json({
      success: true,
      logs: logs,
      total: errors.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get per-client analytics
app.get('/api/admin/clients/:clinicId/analytics', async (req, res) => {
  try {
    const clinicId = req.params.clinicId;
    const clinic = await db.getClinicById(clinicId);

    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    // Get calls for this client
    const calls = db.prepare('SELECT * FROM voice_call_log WHERE customer_id = ? ORDER BY created_at DESC').all(clinicId);
    const functionCalls = db.prepare('SELECT * FROM function_call_log WHERE customer_id = ? ORDER BY created_at DESC').all(clinicId);
    const errors = db.prepare('SELECT * FROM error_log WHERE customer_id = ? AND resolved = 0 ORDER BY created_at DESC').all(clinicId);

    // Calculate metrics
    const totalMinutes = calls.reduce((sum, c) => sum + ((c.call_duration_seconds || 0) / 60), 0);
    const twilioCost = totalMinutes * 0.013;
    const retellCost = totalMinutes * 0.02;

    // Get revenue
    const checkouts = (await db.getAllVoiceCheckouts()).filter(c => {
      if (!c.customer_phone) return false;
      const phone = db.getClinicPhoneNumber(c.customer_phone);
      return phone && phone.clinic_id === clinicId;
    });
    const revenue = checkouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    // Calculate response times
    const successfulCalls = functionCalls.filter(f => f.success === 1);
    const avgResponseTime = successfulCalls.length > 0
      ? successfulCalls.reduce((sum, f) => sum + (f.response_time_ms || 0), 0) / successfulCalls.length
      : 0;

    res.json({
      success: true,
      clinic: {
        clinic_id: clinic.clinic_id,
        name: clinic.name,
        phone_number: clinic.phone_number,
        retell_agent_id: clinic.retell_agent_id
      },
      metrics: {
        total_calls: calls.length,
        total_minutes: Math.round(totalMinutes),
        total_function_calls: functionCalls.length,
        successful_function_calls: successfulCalls.length,
        failed_function_calls: functionCalls.filter(f => f.success === 0).length,
        total_errors: errors.length,
        avg_response_time_ms: Math.round(avgResponseTime),
        revenue: revenue,
        twilio_cost: twilioCost,
        retell_cost: retellCost,
        total_cost: twilioCost + retellCost,
        margin: revenue > 0 ? ((revenue - (twilioCost + retellCost)) / revenue * 100) : 0
      },
      recent_calls: calls.slice(0, 10),
      recent_errors: errors.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/clients/:clinicId/api-keys', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    const merchantId = ensureMerchantForClinic(clinic);
    const keys = merchantId ? db.getMerchantApiKeys(merchantId).map(serializeApiKey) : [];

    res.json({
      success: true,
      merchant_id: merchantId,
      keys
    });
  } catch (error) {
    console.error('❌ Error fetching API keys:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/clients/:clinicId/api-keys', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    const merchantId = ensureMerchantForClinic(clinic);
    if (!merchantId) {
      return res.status(500).json({ success: false, error: 'Unable to provision merchant for clinic' });
    }

    if (req.body?.rotate_existing) {
      db.revokeAllMerchantApiKeys(merchantId, req.adminSession?.id || 'admin');
    }

    const issued = issueMerchantApiKey(merchantId, {
      label: req.body?.label || `${clinic.name || 'Client'} Voice Agent`,
      createdBy: req.adminSession?.id || 'admin'
    });

    res.json({
      success: true,
      merchant_id: merchantId,
      api_key: issued.apiKey,
      key: serializeApiKey(issued.record),
      message: 'New API key generated. Copy it now – it will not be shown again.'
    });
  } catch (error) {
    console.error('❌ Error creating API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/clients/:clinicId/api-keys/:keyId/revoke', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    const merchantId = ensureMerchantForClinic(clinic);
    const key = db.getMerchantApiKey(req.params.keyId);
    if (!key || key.merchant_id !== merchantId) {
      return res.status(404).json({ success: false, error: 'API key not found for this clinic' });
    }

    db.revokeMerchantApiKey(key.id, req.adminSession?.id || 'admin');
    const refreshed = db.getMerchantApiKey(key.id);

    res.json({
      success: true,
      key: serializeApiKey(refreshed)
    });
  } catch (error) {
    console.error('❌ Error revoking API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/clients/:clinicId/api-keys/rotate', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }
    const merchantId = ensureMerchantForClinic(clinic);
    const { apiKey, keyId } = db.rotateMerchantApiKey(merchantId, req.adminSession?.id || 'admin');
    res.json({
      success: true,
      api_key: apiKey,
      key_id: keyId,
      message: 'Store the api_key securely; it will not be shown again.'
    });
  } catch (error) {
    console.error('❌ Error rotating API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Get all transactions
app.get('/api/admin/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const status = req.query.status;

    let checkouts = await db.getAllVoiceCheckouts();

    if (status && status !== 'flagged') {
      checkouts = checkouts.filter(c => c.status === status);
    }

    checkouts = checkouts.slice(0, limit);

    res.json({
      success: true,
      transactions: checkouts,
      count: checkouts.length
    });

  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get customers
app.get('/api/admin/customers', async (req, res) => {
  try {
    const allCheckouts = await db.getAllVoiceCheckouts();

    // Group by phone
    const customerMap = new Map();

    allCheckouts.forEach(checkout => {
      const phone = checkout.customer_phone;
      if (!phone) return;

      if (!customerMap.has(phone)) {
        customerMap.set(phone, {
          customer_phone: phone,
          customer_name: checkout.customer_name,
          customer_email: checkout.customer_email,
          orders: [],
          order_count: 0,
          total_spent: 0,
          first_order: checkout.created_at,
          last_order: checkout.created_at
        });
      }

      const customer = customerMap.get(phone);
      customer.orders.push(checkout);
      customer.order_count++;

      if (checkout.status === 'completed') {
        customer.total_spent += checkout.amount;
      }

      if (checkout.created_at < customer.first_order) {
        customer.first_order = checkout.created_at;
      }
      if (checkout.created_at > customer.last_order) {
        customer.last_order = checkout.created_at;
      }
    });

    const customers = Array.from(customerMap.values()).map(customer => {
      const completedOrders = customer.orders.filter(o => o.status === 'completed');

      let trustLevel = 'new';
      if (customer.order_count >= 5) {
        trustLevel = 'trusted';
      }

      return {
        ...customer,
        completed_orders: completedOrders.length,
        fraud_flags: 0,
        trust_level: trustLevel,
        avg_order_value: completedOrders.length > 0
          ? (customer.total_spent / completedOrders.length).toFixed(2)
          : 0,
        avg_fraud_score: 0
      };
    });

    customers.sort((a, b) => b.total_spent - a.total_spent);

    res.json({
      success: true,
      customers: customers,
      count: customers.length
    });

  } catch (error) {
    console.error('❌ Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get single customer
app.get('/api/admin/customers/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const allCheckouts = await db.getAllVoiceCheckouts();

    const orders = allCheckouts.filter(c => c.customer_phone === phone);

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const customer = {
      phone: phone,
      name: orders[0].customer_name,
      email: orders[0].customer_email,
      orders: orders,
      total_spent: orders
        .filter(o => o.status === 'completed')
        .reduce((sum, o) => sum + o.amount, 0),
      order_count: orders.length,
      first_order: orders[orders.length - 1].created_at,
      last_order: orders[0].created_at
    };

    res.json({
      success: true,
      customer: customer
    });

  } catch (error) {
    console.error('❌ Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get agent stats
app.get('/api/admin/agent/stats', async (req, res) => {
  try {
    const merchant_id = req.query.merchant_id;

    let voiceCheckouts = await db.getAllVoiceCheckouts();

    if (merchant_id) {
      voiceCheckouts = voiceCheckouts.filter(c => c.merchant_id === merchant_id);
    }

    const today = new Date().toISOString().split('T')[0];
    const todayCalls = voiceCheckouts.filter(c =>
      c.created_at.startsWith(today)
    );

    const stats = {
      total_calls: todayCalls.length,
      successful_calls: todayCalls.filter(c => c.status === 'completed').length,
      revenue: todayCalls
        .filter(c => c.status === 'completed')
        .reduce((sum, c) => sum + c.amount, 0),
      conversion_rate: todayCalls.length > 0
        ? (todayCalls.filter(c => c.status === 'completed').length / todayCalls.length * 100).toFixed(1)
        : 0,
      avg_order_value: todayCalls.filter(c => c.status === 'completed').length > 0
        ? (todayCalls
          .filter(c => c.status === 'completed')
          .reduce((sum, c) => sum + c.amount, 0) /
          todayCalls.filter(c => c.status === 'completed').length).toFixed(2)
        : 0
    };

    res.json({
      success: true,
      stats: stats,
      recent_calls: todayCalls.slice(0, 10)
    });

  } catch (error) {
    console.error('❌ Error fetching agent stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/api-keys
 * List all API keys (admin only)
 */
app.get('/api/admin/api-keys', async (req, res) => {
  try {
    const { customer_id, limit } = req.query;

    const filters = {};
    if (customer_id) filters.customer_id = customer_id;
    if (limit) filters.limit = parseInt(limit) || 100;

    const keys = db.getAllAPIKeys(filters);

    // Get customer info for each key
    const keysWithCustomer = keys.map(key => {
      const customer = db.getCustomer(key.customer_id);
      return {
        ...key,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          company_name: customer.company_name
        } : null
      };
    });

    res.json({
      success: true,
      api_keys: keysWithCustomer,
      count: keysWithCustomer.length
    });
  } catch (error) {
    console.error('❌ Error fetching API keys:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/api-keys/:keyId/recover
 * Recover (decrypt) an API key (admin only)
 */
app.get('/api/admin/api-keys/:keyId/recover', async (req, res) => {
  try {
    const { keyId } = req.params;

    const keyRecord = db.getAPIKeyById(keyId);
    if (!keyRecord) {
      return res.status(404).json({
        success: false,
        error: 'API key not found'
      });
    }

    if (!keyRecord.key_secret) {
      return res.status(404).json({
        success: false,
        error: 'API key secret not stored (cannot recover)'
      });
    }

    // Decrypt the API key
    const { decryptApiKey } = require('./utils/api-keys');
    const decryptedKey = decryptApiKey(keyRecord.key_secret);

    // Get customer info
    const customer = db.getCustomer(keyRecord.customer_id);

    res.json({
      success: true,
      api_key: decryptedKey,
      key_id: keyRecord.id,
      key_prefix: keyRecord.key_prefix,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        company_name: customer.company_name
      } : null,
      created_at: keyRecord.created_at,
      last_used_at: keyRecord.last_used_at,
      warning: 'This is a sensitive operation. The API key is only shown once here.'
    });
  } catch (error) {
    console.error('❌ Error recovering API key:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recover API key'
    });
  }
});

/**
 * GET /api/admin/feature-requests
 * List all feature requests (admin only)
 */
app.get('/api/admin/feature-requests', async (req, res) => {
  try {
    const { status, customer_id, limit } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (customer_id) filters.customer_id = customer_id;
    if (limit) filters.limit = parseInt(limit) || 100;

    const requests = db.getAllFeatureRequests(filters);

    // Get customer info for each request
    const requestsWithCustomer = requests.map(request => {
      const customer = db.getCustomer(request.customer_id);
      return {
        ...request,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          company_name: customer.company_name
        } : null
      };
    });

    res.json({
      success: true,
      feature_requests: requestsWithCustomer,
      count: requestsWithCustomer.length
    });
  } catch (error) {
    console.error('❌ Error fetching feature requests:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/feature-requests/:requestId/update
 * Update feature request status (approve/reject)
 */
app.post('/api/admin/feature-requests/:requestId/update', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, notes } = req.body;

    if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: pending, approved, or rejected'
      });
    }

    // Get the request to check if it exists
    const allRequests = db.getAllFeatureRequests({});
    const request = allRequests.find(r => r.id === requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Feature request not found'
      });
    }

    // Update status
    db.updateFeatureRequestStatus(requestId, status, notes || null);

    // If approved, add feature to customer's api_features
    if (status === 'approved') {
      const customer = db.getCustomer(request.customer_id);
      if (customer) {
        let apiFeatures = customer.api_features;
        if (typeof apiFeatures === 'string' && apiFeatures) {
          try {
            apiFeatures = JSON.parse(apiFeatures);
          } catch (e) {
            apiFeatures = [];
          }
        } else if (!apiFeatures) {
          apiFeatures = [];
        }

        if (!apiFeatures.includes(request.feature_name)) {
          apiFeatures.push(request.feature_name);
          db.db.prepare(`
            UPDATE customers 
            SET api_features = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(JSON.stringify(apiFeatures), customer.id);
        }
      }
    }

    res.json({
      success: true,
      message: `Feature request ${status} successfully`,
      request_id: requestId
    });
  } catch (error) {
    console.error('❌ Error updating feature request:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update feature request'
    });
  }
});

// ============================================
// BOOKING/APPOINTMENT ENDPOINTS
// ============================================

// Bug 2: Declare before resolveClinicIdFromRequest (function references it)
const FALLBACK_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || null;

function resolveClinicIdFromRequest(req, args = {}) {
  const directClinicId =
    args?.clinic_id ||
    req.headers['x-clinic-id'] ||
    req.query?.clinic_id ||
    (req.body && !req.body.args ? req.body.clinic_id : (req.body?.args?.clinic_id || req.body?.clinic_id)) ||
    null;

  if (directClinicId) {
    return directClinicId;
  }

  const fromPhone = req.body?.From || req.body?.from_number || req.body?.patient_phone || args?.patient_phone;
  if (fromPhone && db && db.getClinicPhoneNumber) {
    try {
      let normalized = fromPhone;
      try {
        const SMSService = require('./services/sms-service');
        normalized = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(fromPhone) : fromPhone.replace(/\D/g, '');
      } catch { normalized = fromPhone.replace(/\D/g, ''); }
      const row = db.getClinicPhoneNumber(normalized);
      if (row?.clinic_id) return row.clinic_id;
    } catch (_) {}
  }

  // Final fallback only when explicit/request-scoped clinic cannot be resolved.
  if (FALLBACK_CLINIC_ID) {
    return FALLBACK_CLINIC_ID;
  }

  // S-1: Do NOT fall back to arbitrary clinic - cross-tenant leak. Return null when clinic cannot be determined.
  return null;
}

function ensureSlotBundles(result, date, practitionerId = null) {
  if (!result || !result.success) return result;
  if (Array.isArray(result.slot_bundles) && result.slot_bundles.length) return result;

  const fromDisplay = Array.isArray(result.slots_with_display) ? result.slots_with_display : [];
  const fromSlots = Array.isArray(result.available_slots) ? result.available_slots : (Array.isArray(result.slots) ? result.slots : []);
  const base = fromDisplay.length
    ? fromDisplay.map((s) => ({
      time: s.time,
      date: date || null,
      display: s.slot_display || s.time,
      slot_start_iso: s.slot_start_iso || null,
      practitioner_id: practitionerId || null,
      lane: 'sync',
      is_async: false
    }))
    : fromSlots.map((t) => ({
      time: t,
      date: date || null,
      display: String(t),
      slot_start_iso: null,
      practitioner_id: practitionerId || null,
      lane: 'sync',
      is_async: false
    }));

  return { ...result, slot_bundles: base };
}

// Voice triage guards: ./services/voice-triage-guards.js (resolveVoiceSessionIdForGuard, requireVoiceSessionIdForTriageParity, enforceVoiceTriageGuardrailsForSession)

// Schedule new appointment (for voice agent)
app.post('/voice/appointments/schedule', scheduleCheckoutLimiter, async (req, res) => {
  try {
    console.log('\n📅 VOICE: Schedule Appointment');
    safeLogRequestBody('Request body:', req);

    // Extract args (handle Retell formats)
    let args = req.body.args || req.body;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to schedule appointments'
      });
    }

    // Extract customer_id from metadata (set during call registration)
    let customerId = null;
    if (args.metadata && args.metadata.customer_id) {
      customerId = args.metadata.customer_id;
    } else if (args.customer_id) {
      customerId = args.customer_id;
    } else if (req.body.metadata && req.body.metadata.customer_id) {
      customerId = req.body.metadata.customer_id;
    } else {
      // Try to find customer by clinic_id (legacy support)
      const clinic = await db.getClinicById(clinicId);
      if (clinic && clinic.merchant_id) {
        // Ensure a tenant-level customer exists for this clinic.
        const ensuredCustomerId =
          db.ensureCustomerIdForClinic?.(clinicId) ||
          db.getCustomerIdForClinic?.(clinicId) ||
          null;

        if (ensuredCustomerId) {
          customerId = ensuredCustomerId;
        } else {
          console.warn(`⚠️  No customer_id found for clinic ${clinicId}. Appointment will be created without tenant isolation.`);
        }
      }
    }

    const appointmentData = {
      patient_name: args.patient_name,
      patient_phone: args.patient_phone,
      patient_email: args.patient_email,
      patient_id: args.patient_id || args.confirmed_patient_id || null,
      appointment_type: args.appointment_type || 'Mental Health Consultation',
      date: args.date,  // YYYY-MM-DD
      time: args.time,  // HH:MM or "2:00 PM"
      duration_minutes: args.duration_minutes || 50,
      provider: args.provider,
      practitioner_id: args.practitioner_id || null,
      notes: args.notes,
      timezone: args.timezone || 'America/New_York',
      clinic_id: clinicId,
      customer_id: customerId,
      // W3-S4.2: Resolved ICD/CPT from triage for billing
      primary_icd10: args.primary_icd10 || null,
      primary_cpt: args.primary_cpt || null
    };

    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    // Phase 5: Backend guardrails when session_id / call_id present (Kelly + Retell direct parity)
    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (!enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'schedule')) return;

    // S4: hard-stop wrong linkage when a known patient_id name disagrees unless explicitly confirmed.
    if (appointmentData.patient_id && appointmentData.patient_name && db.getFHIRPatient) {
      try {
        const existing = db.getFHIRPatient(appointmentData.patient_id);
        const existingName = String(existing?.name || '').trim();
        const providedName = String(appointmentData.patient_name || '').trim();
        const allowNameMismatch =
          args.confirm_name_mismatch === true ||
          String(args.confirm_name_mismatch || '').toLowerCase() === 'true';
        if (existingName && providedName && !namesMatch(existingName, providedName) && !allowNameMismatch) {
          return res.status(409).json({
            success: false,
            error: 'NAME_MISMATCH',
            requires_name_confirmation: true,
            patient_id: appointmentData.patient_id,
            expected_name: existingName,
            provided_name: providedName,
            next_step: 'Confirm this is the same person, then retry with confirm_name_mismatch=true, or use the correct patient_id.'
          });
        }
      } catch (_) {}
    }

    const result = await BookingService.scheduleAppointment(appointmentData);
    if (result.success) invalidateSlotAvailabilityCache();

    // S1: duplicate detection should return explicit actionable 409 for voice clients.
    if (!result.success && result.duplicate && result.requiresPhoneConfirmation) {
      return res.status(409).json({
        ...result,
        error_code: 'DUPLICATE_PATIENT_PHONE_CONFIRMATION_REQUIRED',
        next_step: 'Ask the patient to confirm phone number. If it matches an existing patient, retry with confirmed_patient_id. Otherwise collect corrected contact details.'
      });
    }

    // Auto-checkout is intentionally centralized in KellyToolExecutor to avoid multi-path duplicate checkout creation.

    res.json(result);
  } catch (error) {
    console.error('❌ Error scheduling appointment:', error);
    const payload = { success: false, error: error.message };
    if (error.slot_conflict && Array.isArray(error.alternative_slots)) {
      payload.slot_conflict = true;
      payload.alternative_slots = error.alternative_slots;
    }
    res.status(500).json(payload);
  }
});

// Voice: Upsert patient intake (shared canonical schema)
// Allows the voice agent to capture DOB/location/etc after initial booking.
app.post('/voice/patient/intake', async (req, res) => {
  try {
    const args = req.body.args || req.body || {};
    const patient_id = (args.patient_id || args.patientId || '').toString().trim();
    const patient_email = (args.patient_email || args.email || '').toString().trim().toLowerCase();
    let patient_phone = (args.patient_phone || args.phone || '').toString().trim();

    // Validation (voice onboarding requirements)
    const dobRaw = (args.dob || args.date_of_birth || '').toString().trim();
    const countryRaw = (args.country || '').toString().trim();
    const cityRaw = (args.city || '').toString().trim();

    // Normalize phone early so patient resolution is stable
    if (patient_phone) {
      try {
        const SMSService = require('./services/sms-service');
        patient_phone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patient_phone) : patient_phone;
      } catch (_) {}
    }

    const errors = [];
    if (dobRaw) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobRaw);
      if (!m) {
        errors.push('dob must be in YYYY-MM-DD format');
      } else {
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        const dt = new Date(Date.UTC(y, mo - 1, d));
        const valid = dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === mo && dt.getUTCDate() === d;
        if (!valid) errors.push('dob is not a valid calendar date');
      }
    } else {
      errors.push('dob is required');
    }
    if (!countryRaw) errors.push('country is required');
    if (!cityRaw) errors.push('city is required');

    if (errors.length) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_validation_failed'); } catch (_) {}
      return res.status(400).json({
        success: false,
        error: errors.join('; '),
        message: "I couldn’t save that; let’s try again."
      });
    }

    let patientId = patient_id || null;
    if (!patientId && patient_email) {
      try { patientId = db.getFHIRPatientByEmail(patient_email)?.resource_id || null; } catch (_) {}
    }
    if (!patientId && patient_phone) {
      try { patientId = db.getFHIRPatientByPhone(patient_phone)?.resource_id || null; } catch (_) {}
    }
    if (!patientId && (patient_email || patient_phone || args.first_name || args.last_name || args.patient_name)) {
      try {
        const nm = (args.patient_name || [args.first_name, args.last_name].filter(Boolean).join(' ') || 'Unknown').toString();
        const created = await FHIRService.getOrCreatePatient({
          name: nm,
          phone: patient_phone || undefined,
          email: patient_email || undefined
        }, false);
        patientId = created?.patient?.id || null;
      } catch (_) {}
    }

    if (!patientId) {
      return res.status(400).json({ success: false, error: 'Unable to resolve patient_id (provide patient_id, patient_email, or patient_phone)' });
    }

    const payload = {
      first_name: args.first_name || '',
      last_name: args.last_name || '',
      dob: dobRaw,
      phone: patient_phone || '',
      email: patient_email || '',
      country: countryRaw,
      city: cityRaw,
      city_place_id: args.city_place_id || ''
    };
    if (args.insurance && typeof args.insurance === 'object') {
      payload.insurance = args.insurance;
    }
    const result = await PatientIntakeService.upsertIntakeByPatientId(patientId, payload);
    if (!result.success) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_save_failed'); } catch (_) {}
      return res.status(400).json({
        ...result,
        message: "I couldn’t save that; let’s try again."
      });
    }
    try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_save_success'); } catch (_) {}
    if (Array.isArray(result.missing_fields) && result.missing_fields.length) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_missing_fields'); } catch (_) {}
    }
    return res.json({
      ...result,
      message: "Thanks — you’re all set."
    });
  } catch (e) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_save_error'); } catch (_) {}
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Voice: Check patient onboarding status (DOB/country/city missing fields)
app.post('/voice/patient/intake/status', async (req, res) => {
  try {
    const args = req.body.args || req.body || {};
    const patient_id = (args.patient_id || args.patientId || '').toString().trim();
    const patient_email = (args.patient_email || args.email || '').toString().trim().toLowerCase();
    let patient_phone = (args.patient_phone || args.phone || '').toString().trim();
    if (patient_phone) {
      try {
        const SMSService = require('./services/sms-service');
        patient_phone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patient_phone) : patient_phone;
      } catch (_) {}
    }

    let patientId = patient_id || null;
    if (!patientId && patient_email) {
      try { patientId = db.getFHIRPatientByEmail(patient_email)?.resource_id || null; } catch (_) {}
    }
    if (!patientId && patient_phone) {
      try { patientId = db.getFHIRPatientByPhone(patient_phone)?.resource_id || null; } catch (_) {}
    }

    if (!patientId) {
      const missing_fields = ['dob', 'country', 'city'];
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_patient_not_found'); } catch (_) {}
      return res.json({
        success: true,
        patient_id: null,
        onboarding_complete: false,
        missing_fields
      });
    }

    const row = db.getFHIRPatient(patientId);
    const canonical = PatientIntakeService.canonicalFromPatientResource(row?.resource_data || {});
    const status = PatientIntakeService.onboardingStatusFromCanonical(canonical);
    if (status?.onboarding_complete) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_complete'); } catch (_) {}
    } else {
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_incomplete'); } catch (_) {}
      try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_missing_fields'); } catch (_) {}
    }
    return res.json({
      success: true,
      patient_id: patientId,
      ...status
    });
  } catch (e) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('voice_intake_status_error'); } catch (_) {}
    return res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// Confirm appointment (for voice agent)
app.post('/voice/appointments/confirm', async (req, res) => {
  try {
    console.log('\n✅ VOICE: Confirm Appointment');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    const appointmentId = args.appointment_id || args.confirmation_number;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to confirm appointments'
      });
    }

    const result = await BookingService.confirmAppointment(appointmentId, clinicId);

    res.json(result);
  } catch (error) {
    console.error('❌ Error confirming appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reschedule appointment (for voice agent)
app.post('/voice/appointments/reschedule', async (req, res) => {
  try {
    console.log('\n🔄 VOICE: Reschedule Appointment');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    const appointmentId = args.appointment_id || args.confirmation_number;
    const newDate = args.new_date || args.date;
    const newTime = args.new_time || args.time;
    const reason = args.reason || null;
    const timezone = args.timezone || null;
    if (timezone && !isValidIanaTimezone(timezone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".'
      });
    }
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to reschedule appointments'
      });
    }

    if (!newDate || !newTime) {
      return res.status(400).json({
        success: false,
        error: 'new_date and new_time are required for rescheduling'
      });
    }

    const result = await BookingService.rescheduleAppointment(
      appointmentId,
      newDate,
      newTime,
      reason,
      timezone,
      clinicId
    );
    if (result?.success) invalidateSlotAvailabilityCache();

    res.json(result);
  } catch (error) {
    console.error('❌ Error rescheduling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cancel appointment (for voice agent)
app.post('/voice/appointments/cancel', async (req, res) => {
  try {
    console.log('\n❌ VOICE: Cancel Appointment');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    const appointmentId = args.appointment_id || args.confirmation_number;
    const reason = args.reason || null;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to cancel appointments'
      });
    }

    const result = await BookingService.cancelAppointment(appointmentId, reason, clinicId);
    if (result?.success) invalidateSlotAvailabilityCache();

    res.json(result);
  } catch (error) {
    console.error('❌ Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get available slots (for voice agent)
// Uses SpecialistResolver + specialist-slot-service when appointment_type is a specialty and provider_profiles exist
app.post('/voice/appointments/available-slots', async (req, res) => {
  try {
    const args = req.body.args || req.body;
    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    const date = args.date;  // YYYY-MM-DD
    const provider = args.provider || null;
    const appointmentType = args.appointment_type || null;
    const timezone = args.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".'
      });
    }
    const lane = args.lane || 'sync';
    const clinicId = resolveClinicIdFromRequest(req, args) || args.clinic_id;
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to check availability'
      });
    }

    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (!enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'slots')) return;

    const practitionerId = args.practitioner_id || null;
    const cache = require('./services/cache-service');
    const cacheSession = sessionIdForGuard || 'no_session';
    // C10: namespace cache when REQUIRE_TRIAGE_FOR_VOICE flips so stale no_session entries are not reused
    const rtfvSeg =
      process.env.REQUIRE_TRIAGE_FOR_VOICE === '1' || process.env.REQUIRE_TRIAGE_FOR_VOICE === 'true'
        ? 'rtfv1'
        : 'rtfv0';
    const cacheKey = [clinicId, date || '', provider || '', appointmentType || '', timezone || '', practitionerId || '', lane || '', cacheSession, rtfvSeg].join('|');
    const cached = cache.get('slot_availability', cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Specialist path: when appointment_type is a specialty, use Resolver + specialist slots
    // W3-S5.3/W3-S5.4: Use language + state from session when call_id provided
    const { isSpecialtyType } = require('./services/specialist-slot-service');
    if (isSpecialtyType(appointmentType)) {
      try {
        const SpecialistResolverService = require('./services/specialist-resolver-service');
        const { getAvailableSlotsWithSpecialist } = require('./services/specialist-slot-service');
        let language = 'en';
        let patientState = null;
        const callId = args.call_id || args.session_id || sessionIdForGuard || null;
        let urgency = args.urgency || 'routine';
        if (callId && db) {
          try {
            if (db.getKellySessionLanguage) language = db.getKellySessionLanguage(callId) || language;
            const triageRow = db.getTriageSession ? db.getTriageSession(callId) : null;
            if (!language && triageRow?.detected_language) language = triageRow.detected_language;
            if (triageRow?.urgency) urgency = triageRow.urgency;
            if (db.getOrchestrateSessionBySessionId) {
              const row = db.getOrchestrateSessionBySessionId(callId);
              patientState = row?.flow_state?.patient_state || row?.flow_state?.state || null;
            }
            const ragResult = require('./services/triage-rag-service').getLatestForSession?.(callId);
            if (ragResult?.urgency) urgency = ragResult.urgency;
          } catch (_) {}
        }
        const patientTier = 2;
        const resolverResult = await SpecialistResolverService.resolve({
          clinicId,
          specialty: appointmentType,
          language,
          state: patientState,
          lane,
          urgency,
          patientTier,
          date
        });
        if (resolverResult.providers && resolverResult.providers.size > 0) {
          const slots = await getAvailableSlotsWithSpecialist({
            date,
            lane,
            providerMap: resolverResult.providers,
            clinicId,
            timezone,
            appointmentType
          });
          const result = {
            success: true,
            available_slots: slots.map(s => s.time === 'ASYNC' ? `Async review — ${s.practitioner_name}` : s.time),
            slot_bundles: slots,
            appointment_type: appointmentType,
            kelly_script: resolverResult.kellyScript
          };
          // M-S5.A: say_to_patient so LLM says kelly_script verbatim
          if (resolverResult.kellyScript) {
            result.say_to_patient = `Say this to the patient before presenting slots: "${resolverResult.kellyScript}"`;
          }
          cache.set('slot_availability', result, cacheKey);
          return res.json(result);
        }
      } catch (specErr) {
        console.warn('⚠️  Specialist slot path failed, falling back to standard:', specErr.message);
      }
    }

    const resultRaw = await BookingService.getAvailableSlots(date, provider, appointmentType, timezone, clinicId, practitionerId);
    const result = ensureSlotBundles(resultRaw, date, practitionerId);
    if (result.success) {
      cache.set('slot_availability', result, cacheKey);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error getting available slots:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search appointments (for voice agent)
app.post('/voice/appointments/search', async (req, res) => {
  try {
    console.log('\n🔍 VOICE: Search Appointments');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;
    const searchTerm = args.phone || args.email || args.patient_phone || args.patient_email;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to search appointments'
      });
    }

    const result = await BookingService.searchAppointments(searchTerm, clinicId);

    res.json(result);
  } catch (error) {
    console.error('❌ Error searching appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// API APPOINTMENTS (Task 7: Non-voice parity)
// ============================================

function apiAppointmentArgs(req) {
  if (req.method === 'GET') {
    return req.query;
  }
  return req.body?.args || req.body;
}

function invalidateSlotAvailabilityCache() {
  try {
    const cache = require('./services/cache-service');
    cache.clear('slot_availability');
  } catch (_) {}
}

app.post('/api/appointments/schedule', async (req, res) => {
  try {
    if (legacyAppointmentsApiDisabled(res)) return;
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required' });
    }
    const appointmentData = {
      patient_name: args.patient_name,
      patient_phone: args.patient_phone,
      patient_email: args.patient_email,
      appointment_type: args.appointment_type || 'Mental Health Consultation',
      date: args.date,
      time: args.time,
      duration_minutes: args.duration_minutes || 50,
      provider: args.provider,
      practitioner_id: args.practitioner_id || null,
      notes: args.notes,
      timezone: args.timezone || 'America/New_York',
      clinic_id: clinicId,
      customer_id: args.customer_id || null,
      primary_icd10: args.primary_icd10 || null,
      primary_cpt: args.primary_cpt || null
    };
    if (!isValidIanaTimezone(appointmentData.timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".' });
    }
    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (sessionIdForGuard && !enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'schedule')) return;

    const result = await BookingService.scheduleAppointment(appointmentData);
    if (result.success) invalidateSlotAvailabilityCache();

    // Auto-checkout is intentionally centralized in KellyToolExecutor to avoid multi-path duplicate checkout creation.

    res.json(result);
  } catch (error) {
    console.error('❌ API schedule error:', error);
    const payload = { success: false, error: error.message };
    if (error.slot_conflict) {
      payload.slot_conflict = true;
      payload.alternative_slots = error.alternative_slots || [];
      payload.slots_with_display = error.slots_with_display || [];
    }
    res.status(500).json(payload);
  }
});

app.get('/api/appointments/available-slots', async (req, res) => {
  try {
    if (legacyAppointmentsApiDisabled(res)) return;
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required' });
    }
    const date = args.date;
    if (!date) {
      return res.status(400).json({ success: false, error: 'date is required' });
    }
    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (sessionIdForGuard && !enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'slots')) return;
    const timezone = args.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".' });
    }

    const practitionerId = args.practitioner_id || null;
    const cache = require('./services/cache-service');
    const cacheKey = [clinicId, date, args.provider || '', args.appointment_type || '', timezone, practitionerId || ''].join('|');
    const cached = cache.get('slot_availability', cacheKey);
    if (cached) return res.json(cached);
    const resultRaw = await BookingService.getAvailableSlots(date, args.provider, args.appointment_type, timezone, clinicId, practitionerId);
    const result = ensureSlotBundles(resultRaw, date, practitionerId);
    if (result.success) cache.set('slot_availability', result, cacheKey);
    res.json(result);
  } catch (error) {
    console.error('❌ API available-slots error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/appointments/available-slots', async (req, res) => {
  try {
    if (legacyAppointmentsApiDisabled(res)) return;
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required' });
    }
    const date = args.date;
    if (!date) {
      return res.status(400).json({ success: false, error: 'date is required' });
    }
    const sessionIdForGuard = resolveVoiceSessionIdForGuard(args, req);
    if (sessionIdForGuard && !enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'slots')) return;
    const timezone = args.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".' });
    }

    const practitionerId = args.practitioner_id || null;
    const cache = require('./services/cache-service');
    const cacheKey = [clinicId, date, args.provider || '', args.appointment_type || '', timezone, practitionerId || ''].join('|');
    const cached = cache.get('slot_availability', cacheKey);
    if (cached) return res.json(cached);
    const resultRaw = await BookingService.getAvailableSlots(date, args.provider, args.appointment_type, timezone, clinicId, practitionerId);
    const result = ensureSlotBundles(resultRaw, date, practitionerId);
    if (result.success) cache.set('slot_availability', result, cacheKey);
    res.json(result);
  } catch (error) {
    console.error('❌ API available-slots error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/appointments/confirm', async (req, res) => {
  try {
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required' });
    const appointmentId = args.appointment_id || args.confirmation_number;
    if (!appointmentId) return res.status(400).json({ success: false, error: 'appointment_id is required' });
    const result = await BookingService.confirmAppointment(appointmentId, clinicId);
    res.json(result);
  } catch (error) {
    console.error('❌ API confirm error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/appointments/reschedule', async (req, res) => {
  try {
    if (legacyAppointmentsApiDisabled(res)) return;
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required' });
    const appointmentId = args.appointment_id || args.confirmation_number;
    const newDate = args.new_date || args.date;
    const newTime = args.new_time || args.time;
    if (!appointmentId || !newDate || !newTime) {
      return res.status(400).json({ success: false, error: 'appointment_id, new_date and new_time are required' });
    }
    if (args.timezone && !isValidIanaTimezone(args.timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".' });
    }
    const result = await BookingService.rescheduleAppointment(appointmentId, newDate, newTime, args.reason, args.timezone, clinicId);
    if (result?.success) invalidateSlotAvailabilityCache();
    res.json(result);
  } catch (error) {
    console.error('❌ API reschedule error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/appointments/cancel', async (req, res) => {
  try {
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required' });
    const appointmentId = args.appointment_id || args.confirmation_number;
    if (!appointmentId) return res.status(400).json({ success: false, error: 'appointment_id is required' });
    const result = await BookingService.cancelAppointment(appointmentId, args.reason, clinicId);
    if (result?.success) invalidateSlotAvailabilityCache();
    res.json(result);
  } catch (error) {
    console.error('❌ API cancel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/appointments/search', async (req, res) => {
  try {
    const args = apiAppointmentArgs(req);
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required' });
    const searchTerm = args.phone || args.email || args.patient_phone || args.patient_email;
    if (!searchTerm) return res.status(400).json({ success: false, error: 'phone, email, patient_phone or patient_email is required' });
    const result = await BookingService.searchAppointments(searchTerm, clinicId);
    res.json(result);
  } catch (error) {
    console.error('❌ API search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// INSURANCE & BILLING ENDPOINTS
// ============================================

/**
 * Collect and validate patient insurance information
 * POST /voice/insurance/collect
 * Used by voice agent during call to collect insurance info
 */
/**
 * Normalize name for comparison (remove extra spaces, convert to lowercase, remove punctuation)
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Compare two names for fraud detection
 * Returns true if names match (allowing for minor variations)
 */
function namesMatch(name1, name2) {
  if (!name1 || !name2) return false;

  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);

  // Exact match
  if (normalized1 === normalized2) return true;

  // Split into parts for comparison
  const parts1 = normalized1.split(' ').filter(p => p.length > 0);
  const parts2 = normalized2.split(' ').filter(p => p.length > 0);

  // If both have at least 2 parts, compare first and last names
  if (parts1.length >= 2 && parts2.length >= 2) {
    const first1 = parts1[0];
    const last1 = parts1[parts1.length - 1];
    const first2 = parts2[0];
    const last2 = parts2[parts2.length - 1];

    // First and last names must match
    return first1 === first2 && last1 === last2;
  }

  // If only one part, compare directly
  if (parts1.length === 1 && parts2.length === 1) {
    return parts1[0] === parts2[0];
  }

  // Partial match: check if all parts of shorter name are in longer name
  const shorter = parts1.length <= parts2.length ? parts1 : parts2;
  const longer = parts1.length > parts2.length ? parts1 : parts2;

  return shorter.every(part => longer.some(longPart => longPart === part || longPart.startsWith(part) || part.startsWith(longPart)));
}

app.post('/voice/insurance/collect', async (req, res) => {
  try {
    console.log('\n🏥 VOICE: Collect Insurance Information');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    // C4: Same session id requirement as schedule/slots when REQUIRE_TRIAGE_FOR_VOICE=1
    if (!requireVoiceSessionIdForTriageParity(req, res)) return;

    // Required: member_id
    if (!args.member_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: member_id'
      });
    }

    // Phase 5: Same DB triage guardrails as schedule/slots (impl-1); uses resolveVoiceSessionIdForGuard (session_id > metadata > call_id)
    const insuranceSessionId = resolveVoiceSessionIdForGuard(args, req);
    if (!enforceVoiceTriageGuardrailsForSession(insuranceSessionId, args, res, 'insurance')) return;

    // Optional: patient_id to link insurance to patient
    const patientId = args.patient_id || args.patientId || null;
    // Bug 5: Normalize phone for consistent lookups (getFHIRPatientByPhone, findOrCreatePatient)
    let patientPhone = (args.patient_phone || args.phone || '').toString().trim();
    if (patientPhone) {
      try {
        const SMSService = require('./services/sms-service');
        patientPhone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patientPhone) : patientPhone.replace(/\D/g, '');
      } catch (_) {
        patientPhone = patientPhone.replace(/\D/g, '');
      }
    }
    patientPhone = patientPhone || null;
    const patientName = args.patient_name || args.customer_name || null;
    const patientEmail = args.patient_email || args.customer_email || null;

    // ==========================================
    // FRAUD DETECTION: Name Validation
    // ==========================================
    const callId = args.call_id || null;
    const initialName = args.initial_name || null;

    // V-3: Get initial name from DB (works in multi-instance; no retellHandler dependency)
    let storedInitialName = initialName;
    if (callId && !storedInitialName && db?.getOrchestrateSessionBySessionId) {
      try {
        const row = db.getOrchestrateSessionBySessionId(callId);
        storedInitialName = row?.flow_state?.initial_name || null;
      } catch (error) {
        console.warn('⚠️  Could not get initial name from session:', error.message);
      }
    }

    // Validate name match if we have both initial name and provided name
    if (storedInitialName && patientName) {
      const namesMatchResult = namesMatch(storedInitialName, patientName);

      if (!namesMatchResult) {
        // FRAUD DETECTED: Names don't match
        console.error('\n🚨 FRAUD DETECTION ALERT: Name Mismatch');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`   Initial Name: "${storedInitialName}"`);
        console.error(`   Provided Name: "${patientName}"`);
        console.error(`   Call ID: ${callId || 'N/A'}`);
        console.error(`   Member ID: ${args.member_id}`);
        console.error(`   Phone: ${patientPhone || 'N/A'}`);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Log fraud attempt to database
        try {
          const fraudLogId = require('uuid').v4();
          db.db.prepare(`
            INSERT INTO fraud_attempts (
              id, call_id, patient_phone, initial_name, provided_name,
              member_id, fraud_type, risk_score, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            fraudLogId,
            callId,
            patientPhone,
            storedInitialName,
            patientName,
            args.member_id,
            'name_mismatch',
            90, // High risk score for name mismatch
            new Date().toISOString()
          );
          console.log(`✅ Fraud attempt logged: ${fraudLogId}`);
        } catch (logError) {
          console.error('❌ Could not log fraud attempt:', logError.message);
        }

        // Return error - DO NOT process insurance with mismatched name
        return res.status(403).json({
          success: false,
          error: 'Name verification failed. The name provided does not match the name you provided at the start of the call.',
          fraud_detected: true,
          fraud_type: 'name_mismatch',
          initial_name: storedInitialName,
          provided_name: patientName,
          message: 'For security reasons, we cannot process insurance information when the name does not match. Please verify your information and try again, or speak with a representative.',
          requires_verification: true
        });
      } else {
        console.log(`✅ Name validation passed: "${storedInitialName}" matches "${patientName}"`);
      }
    } else if (storedInitialName && !patientName) {
      // Initial name exists but no name provided in insurance collection
      // This might be okay if name is optional, but log it
      console.warn(`⚠️  Initial name stored (${storedInitialName}) but no name provided in insurance collection`);
    } else if (!storedInitialName && patientName && callId) {
      // No initial name stored yet - persist to DB (V-3: multi-instance safe)
      try {
        const row = db?.getOrchestrateSessionBySessionId?.(callId);
        const existingState = row?.flow_state || {};
        if (db?.upsertOrchestrateSession) {
          db.upsertOrchestrateSession({
            session_id: callId,
            channel: 'voice',
            patient_id: row?.patient_id || null,
            caller_phone: row?.caller_phone || patientPhone,
            clinic_id: row?.clinic_id || null,
            conversation_history: row?.conversation_history || [],
            flow_state: { ...existingState, initial_name: patientName.trim() }
          });
          console.log(`✅ Stored initial name from insurance collection: ${patientName}`);
        }
      } catch (error) {
        console.warn('⚠️  Could not store initial name:', error.message);
      }
    }

    // Try to find patient by phone if patient_id not provided
    // RULE: Phone number is the primary unique identifier for patients
    let foundPatient = null;
    if (!patientId && patientPhone) {
      try {
        foundPatient = db.getFHIRPatientByPhone(patientPhone);
        if (foundPatient) {
          console.log(`✅ Found patient by phone: ${foundPatient.resource_id}`);
          patientId = foundPatient.resource_id;

          // Verify name matches if provided (for fraud detection)
          if (patientName && foundPatient.name) {
            const FHIRService = require('./services/fhir-service');
            if (!FHIRService.namesMatch(patientName, foundPatient.name)) {
              console.warn(`⚠️  Name mismatch: Provided "${patientName}" but patient record has "${foundPatient.name}"`);
              // Still use the patient found by phone (phone is more reliable)
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Could not find patient by phone:', error.message);
      }
    }

    // If patient not found by phone, try to find by name (but require phone confirmation if duplicates exist)
    if (!foundPatient && patientName && !patientPhone) {
      console.warn('⚠️  Patient name provided but no phone number - phone number is required for duplicate detection');
    }

    // If patient found, try to get their insurance from database
    let payerId = args.payer_id || null;
    let payerName = args.payer_name || null;

    if (foundPatient && !payerId && !payerName) {
      try {
        // Try to get patient's insurance from database
        const patientInsurance = db.db.prepare(`
          SELECT * FROM patient_insurance 
          WHERE patient_id = ? AND member_id = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(foundPatient.resource_id, args.member_id);

        if (patientInsurance) {
          payerId = patientInsurance.payer_id;
          payerName = patientInsurance.payer_name;
          console.log(`✅ Found insurance in database: ${payerName} (${payerId})`);
        }
      } catch (error) {
        console.warn('⚠️  Could not find insurance in database:', error.message);
      }
    }

    // If still no payer info, try to look up by member_id history
    if (!payerId && !payerName) {
      // For demo: Try common payers or look up from existing eligibility checks
      try {
        const eligibilityCheck = db.db.prepare(`
          SELECT payer_id, payer_name FROM eligibility_checks 
          WHERE member_id = ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(args.member_id);

        if (eligibilityCheck) {
          payerId = eligibilityCheck.payer_id;
          payerName = eligibilityCheck.payer_name;
          console.log(`✅ Found payer from eligibility history: ${payerName} (${payerId})`);
        }
      } catch (error) {
        console.warn('⚠️  Could not find payer from eligibility history:', error.message);
      }
    }

    // Step 1: Get or validate payer information
    let validationResult = null;

    // If we already have payer_id from database lookup, validate it
    if (payerId && payerName) {
      // Validate they match
      const payer = db.getPayerByPayerId(payerId);
      if (payer && payer.payer_name === payerName) {
        validationResult = {
          success: true,
          payer_id: payerId,
          payer_name: payerName,
          member_id: args.member_id,
          apiCallSaved: true
        };
      }
    }

    // If we don't have validation result yet, try to get it
    if (!validationResult) {
      if (payerId && !payerName) {
        // We have payer_id but no payer_name - get payer name from database
        const payer = db.getPayerByPayerId(payerId);
        if (payer) {
          payerName = payer.payer_name;
          validationResult = {
            success: true,
            payer_id: payerId,
            payer_name: payerName,
            member_id: args.member_id,
            apiCallSaved: true
          };
        }
      } else if (payerName || args.payer_name) {
        // Validate payer name and get payer_id (use payerName from lookup or args.payer_name)
        const payerNameToValidate = payerName || args.payer_name;
        validationResult = await PayerCacheService.validatePatientInsurance(
          payerNameToValidate,
          args.member_id
        );

        if (!validationResult.success) {
          return res.json({
            success: false,
            error: validationResult.error,
            suggestions: validationResult.suggestions || []
          });
        }

        // If multiple matches, return suggestions for voice agent to confirm
        if (validationResult.multipleMatches) {
          return res.json({
            success: true,
            confirmed: false,
            multipleMatches: true,
            suggestions: validationResult.suggestions,
            message: validationResult.message,
            apiCallSaved: validationResult.apiCallSaved
          });
        }

        // Update payer_id and payer_name from validation
        if (validationResult.payer_id) {
          payerId = validationResult.payer_id;
          payerName = validationResult.payer_name;
        }
      } else {
        // No payer info at all - require payer_name
        return res.status(400).json({
          success: false,
          error: 'Missing required field: payer_name. Please provide insurance company name (e.g., Cigna, Aetna, Blue Cross).',
          requires_payer_name: true
        });
      }
    }

    // Step 2: Ensure we have a patient before checking eligibility
    // CRITICAL: Eligibility must be linked to a patient_id for proper retrieval
    let finalPatientId = patientId || (foundPatient ? foundPatient.resource_id : null);

    // If we have an email but no patient yet, try resolve by email (web OTP identity)
    if (!finalPatientId && patientEmail) {
      try {
        const byEmail = db.getFHIRPatientByEmail(patientEmail.trim().toLowerCase());
        if (byEmail) {
          finalPatientId = byEmail.resource_id;
          foundPatient = byEmail;
        }
      } catch (_) {}
    }

    // If no patient found yet, try to create or find by member_id in claims
    if (!finalPatientId && args.member_id) {
      // Try to find patient via claims (most reliable source)
      try {
        const claimRecord = db.db.prepare(`
          SELECT patient_id FROM insurance_claims 
          WHERE member_id = ? 
          ORDER BY submitted_at DESC 
          LIMIT 1
        `).get(args.member_id);

        if (claimRecord && claimRecord.patient_id) {
          finalPatientId = claimRecord.patient_id;
          foundPatient = db.getFHIRPatient(finalPatientId);
          console.log(`   ✅ Found patient via claims for member_id ${args.member_id}: ${finalPatientId}`);
        }
      } catch (error) {
        console.warn('⚠️  Could not find patient via claims:', error.message);
      }
    }

    // If still no patient and we have patient info, create patient
    if (!finalPatientId && (patientName || patientPhone || patientEmail)) {
      try {
        const FHIRService = require('./services/fhir-service');
        console.log('   📝 Creating/finding patient record for insurance collection...');

        const patientResult = await FHIRService.getOrCreatePatient({
          name: patientName || 'Unknown',
          phone: patientPhone,
          email: patientEmail
        }, true); // requirePhoneConfirmation = true

        // Check if duplicate was detected
        if (patientResult.duplicate && patientResult.requiresPhoneConfirmation) {
          console.log('   🚨 DUPLICATE DETECTED: Similar name found, phone confirmation required');

          // Return error response indicating phone confirmation is needed
          return res.status(409).json({
            success: false,
            duplicate: true,
            requiresPhoneConfirmation: true,
            error: patientResult.message || 'Duplicate patient found. Phone number confirmation required.',
            error_code: 'DUPLICATE_PATIENT_PHONE_CONFIRMATION_REQUIRED',
            duplicates: patientResult.duplicates || [],
            provided_name: patientResult.provided_name,
            provided_phone: patientResult.provided_phone,
            message: 'I found a patient with a similar name in our system. To verify your identity, please confirm your phone number. This helps ensure we have the correct patient record.',
            voice_agent_instruction: 'Ask the caller to confirm their phone number. If the phone number matches an existing patient, use that patient. If not, ask the caller to verify their information.',
            next_step: 'Confirm phone number (or email) and retry insurance collection with confirmed patient identity.'
          });
        }

        // Patient was found or created successfully
        if (patientResult.patient && patientResult.patient.id) {
          // Find the patient record in database
          const createdPatient = db.getFHIRPatient(patientResult.patient.id);
          if (createdPatient) {
            finalPatientId = createdPatient.resource_id;
            foundPatient = createdPatient;
            console.log(`   ✅ Patient record ${patientResult.foundBy}: ${finalPatientId}`);
          }
        } else if (patientResult.patient) {
          // Patient object might be the resource_data directly
          const createdPatient = db.getFHIRPatient(patientResult.patient.id || patientResult.patient.resource_id);
          if (createdPatient) {
            finalPatientId = createdPatient.resource_id;
            foundPatient = createdPatient;
            console.log(`   ✅ Patient record ${patientResult.foundBy}: ${finalPatientId}`);
          }
        }
      } catch (createError) {
        console.warn('⚠️  Could not create/find patient record:', createError.message);

        // If error is about phone number required, return helpful error
        if (createError.message && createError.message.includes('Phone number is required')) {
          return res.status(400).json({
            success: false,
            error: createError.message,
            requiresPhone: true,
            message: 'Phone number is required to create a new patient record. Please provide your phone number.'
          });
        }

        // For other errors, continue (don't block insurance collection)
      }
    }

    // Step 3: Check eligibility to get coverage details (if payer_id is available)
    let eligibilityResult = null;
    if (payerId && args.member_id) {
      try {
        const InsuranceService = require('./services/insurance-service');

        // Get patient info for eligibility check
        let finalPatientName = patientName || 'Patient';
        let dateOfBirth = '1990-01-01';

        if (foundPatient) {
          try {
            const patientData = typeof foundPatient.resource_data === 'string'
              ? JSON.parse(foundPatient.resource_data)
              : foundPatient.resource_data;

            if (patientData.name) {
              const nameParts = patientData.name[0];
              finalPatientName = nameParts.text ||
                (nameParts.given ? nameParts.given.join(' ') + ' ' + (nameParts.family || '') : 'Patient');
            }
            dateOfBirth = patientData.birthDate || dateOfBirth;
          } catch (parseError) {
            console.warn('⚠️  Could not parse patient data:', parseError.message);
          }
        }

        // W3-S4.6: Use resolved CPT from triage when call_id provided
        let serviceCode = args.service_code;
        if (!serviceCode && args.call_id) {
          try {
            const TriageRAGService = require('./services/triage-rag-service');
            const { getCptCodeForVisit } = require('./utils/cpt-helper');
            const triage = TriageRAGService.getLatestForSession(args.call_id);
            if (triage?.target_specialty) {
              serviceCode = getCptCodeForVisit({
                specialty: triage.target_specialty,
                isNewPatient: true,
                urgency: triage.urgency || 'routine'
              });
            }
          } catch (_) {}
        }
        serviceCode = serviceCode || (() => { try { return require('./utils/cpt-helper').getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine', isNewPatient: true }); } catch (_) { return '99203'; } })();

        const eligibilityData = {
          patientId: finalPatientId,
          patientName: finalPatientName,
          dateOfBirth: dateOfBirth,
          memberId: args.member_id,
          payerId: payerId,
          serviceCode,
          diagnosisCode: args.primary_icd10 || null,
          dateOfService: args.date_of_service || new Date().toISOString().split('T')[0]
        };

        eligibilityResult = await InsuranceService.checkEligibility(eligibilityData);
        console.log('✅ Eligibility checked:', eligibilityResult.success ? 'Covered' : 'Not covered');

        // IMPORTANT: Update eligibility record with patient_id if it was missing
        if (finalPatientId && eligibilityResult.id) {
          try {
            // Update the eligibility record to link it to the patient
            db.db.prepare(`
              UPDATE eligibility_checks 
              SET patient_id = ?
              WHERE id = ?
            `).run(finalPatientId, eligibilityResult.id);
            console.log(`   ✅ Linked eligibility record ${eligibilityResult.id} to patient ${finalPatientId}`);
          } catch (updateError) {
            console.warn('⚠️  Could not update eligibility record with patient_id:', updateError.message);
          }
        }
      } catch (eligError) {
        console.warn('⚠️  Could not check eligibility:', eligError.message);
        // Continue without eligibility data
      }
    }

    // Step 4: Store insurance info (if we have a patient)
    // Note: finalPatientId was already determined in Step 2
    let storedInsurance = null;

    if (finalPatientId && payerId && payerName) {
      // Store in patient_insurance table
      const { v4: uuidv4 } = require('uuid');
      const insuranceRecord = {
        id: `ins_${uuidv4()}`,
        patient_id: finalPatientId,
        payer_id: payerId,
        payer_name: payerName,
        member_id: args.member_id,
        group_number: args.group_number || null,
        plan_name: args.plan_name || null,
        is_primary: true
      };

      db.upsertPatientInsurance(insuranceRecord);
      storedInsurance = insuranceRecord;

      console.log(`✅ Insurance stored for patient: ${finalPatientId}`);

      // Keep canonical intake in sync (shared data format for web + voice)
      try {
        if (PatientIntakeService?.upsertIntakeByPatientId) {
          await PatientIntakeService.upsertIntakeByPatientId(finalPatientId, {
            insurance: {
              payer_name: payerName || '',
              payer_id: payerId || '',
              member_id: args.member_id || '',
              plan_name: args.plan_name || ''
            }
          });
        }
      } catch (_) {}
    } else if (patientPhone && !finalPatientId) {
      // Try to find patient by phone and link insurance
      try {
        const patient = db.getFHIRPatientByPhone(patientPhone);
        if (patient && payerId && payerName) {
          const { v4: uuidv4 } = require('uuid');
          const insuranceRecord = {
            id: `ins_${uuidv4()}`,
            patient_id: patient.resource_id,
            payer_id: payerId,
            payer_name: payerName,
            member_id: args.member_id,
            group_number: args.group_number || null,
            plan_name: args.plan_name || null,
            is_primary: true
          };

          db.upsertPatientInsurance(insuranceRecord);
          storedInsurance = insuranceRecord;

          console.log(`✅ Insurance stored for patient: ${patient.resource_id}`);

          // Keep canonical intake in sync (shared data format for web + voice)
          try {
            if (PatientIntakeService?.upsertIntakeByPatientId) {
              await PatientIntakeService.upsertIntakeByPatientId(patient.resource_id, {
                insurance: {
                  payer_name: payerName || '',
                  payer_id: payerId || '',
                  member_id: args.member_id || '',
                  plan_name: args.plan_name || ''
                }
              });
            }
          } catch (_) {}
        }
      } catch (patientError) {
        console.warn('⚠️  Could not link insurance to patient:', patientError.message);
      }
    }

    // Build response with eligibility data if available
    const response = {
      success: true,
      confirmed: true,
      payer_id: payerId,
      payer_name: payerName,
      member_id: args.member_id,
      message: `Insurance confirmed: ${payerName}`,
      stored: !!storedInsurance,
      insurance_id: storedInsurance?.id || null,
      patient_id: finalPatientId || (storedInsurance ? storedInsurance.patient_id : null), // Include patient_id in response
      apiCallSaved: validationResult?.apiCallSaved !== false
    };

    // Add eligibility/coverage information if available
    if (eligibilityResult && eligibilityResult.success) {
      response.coverage = {
        eligible: eligibilityResult.eligible || false,
        copay_amount: eligibilityResult.copay || eligibilityResult.copay_amount || 0,
        allowed_amount: eligibilityResult.allowedAmount || eligibilityResult.allowed_amount || 0,
        insurance_pays: eligibilityResult.insurancePays || eligibilityResult.insurance_pays || 0,
        deductible_total: eligibilityResult.deductibleTotal !== undefined ? eligibilityResult.deductibleTotal : (eligibilityResult.deductible_total || null),
        deductible_remaining: eligibilityResult.deductibleRemaining !== undefined ? eligibilityResult.deductibleRemaining : (eligibilityResult.deductible_remaining || null),
        coinsurance_percent: eligibilityResult.coinsurancePercent !== undefined ? eligibilityResult.coinsurancePercent : (eligibilityResult.coinsurance_percent || 0),
        plan_summary: eligibilityResult.planSummary || eligibilityResult.plan_summary || 'Plan details available'
      };

      // Calculate patient responsibility
      if (response.coverage.allowed_amount > 0) {
        const patientResponsibility = response.coverage.allowed_amount - (response.coverage.insurance_pays || 0);
        response.coverage.patient_responsibility = Math.max(0, patientResponsibility);
      }
    }

    return res.json(response);

  } catch (error) {
    console.error('❌ Error collecting insurance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check insurance eligibility
 * POST /voice/insurance/check-eligibility
 */
app.post('/voice/insurance/check-eligibility', async (req, res) => {
  try {
    console.log('\n🏥 VOICE: Check Insurance Eligibility');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    // Required fields
    if (!args.member_id || !args.payer_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: member_id, payer_id'
      });
    }

    // Get patient info if patient_id is provided
    let patientName = args.patient_name;
    let dateOfBirth = args.date_of_birth;
    let patientId = args.patient_id;

    if (args.patient_id) {
      // Try to get patient from FHIR patients table
      const patient = db.getFHIRPatient ? db.getFHIRPatient(args.patient_id) : null;
      if (patient) {
        try {
          const patientData = typeof patient.resource_data === 'string' ? JSON.parse(patient.resource_data) : patient.resource_data;
          patientName = patientName || patientData.name?.[0]?.text ||
            (patientData.name?.[0]?.given?.join(' ') + ' ' + patientData.name?.[0]?.family);
          dateOfBirth = dateOfBirth || patientData.birthDate;
          patientId = patient.resource_id;
        } catch (parseError) {
          console.warn('⚠️  Could not parse patient data:', parseError.message);
        }
      }
    }

    // Get appointment info if appointment_id is provided
    // W3-S4.6: Use resolved CPT from appointment.primary_cpt (triage) or getCptCodeForVisit
    let serviceCode = args.service_code;
    let dateOfService = args.date_of_service;

    if (args.appointment_id) {
      const appointment = await db.getAppointment(args.appointment_id);
      if (appointment) {
        serviceCode = serviceCode || appointment.primary_cpt || null;
        if (!serviceCode) {
          const apptType = appointment.appointment_type || '';
          const specialtyNames = ['Psychiatry', 'Cardiology', 'Pulmonology', 'Gastroenterology', 'Endocrinology', 'InfectiousDisease', 'Orthopedics', 'Neurology', 'Dermatology', 'PrimaryCare', 'ENT', 'Ophthalmology', 'Urology', 'EmergencyMedicine', 'ObstetricsGynecology', 'Pediatrics', 'Oncology'];
          if (specialtyNames.includes(apptType)) {
            try {
              const { getCptCodeForVisit } = require('./utils/cpt-helper');
              serviceCode = getCptCodeForVisit({ specialty: apptType, isNewPatient: true, urgency: 'routine' });
            } catch (_) {}
          }
          if (!serviceCode) {
            serviceCode = InsuranceService.mapAppointmentTypeToCPT(appointment.appointment_type, { urgency: 'routine' });
          }
        }
        dateOfService = dateOfService || appointment.date;
        patientId = patientId || appointment.patient_id;
      }
    }

    const eligibilityData = {
      patientId: patientId,
      patientName: patientName || 'Patient',
      dateOfBirth: dateOfBirth || '1990-01-01', // Default if not provided
      memberId: args.member_id,
      payerId: args.payer_id,
      serviceCode: serviceCode || (() => { try { const h = require('./utils/cpt-helper'); return h.getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine', isNewPatient: true }); } catch (_) { return '99203'; } })(),
      dateOfService: dateOfService || new Date().toISOString().split('T')[0]
    };

    const result = await InsuranceService.checkEligibility(eligibilityData);

    res.json(result);
  } catch (error) {
    console.error('❌ Error checking eligibility:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Submit insurance claim
 * POST /voice/insurance/submit-claim
 */
app.post('/voice/insurance/submit-claim', async (req, res) => {
  try {
    console.log('\n📋 VOICE: Submit Insurance Claim');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    // Required fields
    if (!args.appointment_id || !args.member_id || !args.payer_id || !args.total_amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: appointment_id, member_id, payer_id, total_amount'
      });
    }

    // Get appointment details
    const appointment = await db.getAppointment(args.appointment_id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Get patient info
    let patientName = args.patient_name;
    let dateOfBirth = args.date_of_birth;
    let patientId = appointment.patient_id;

    if (appointment.patient_id) {
      // Try to get patient from FHIR patients table
      const patient = db.getFHIRPatient ? db.getFHIRPatient(appointment.patient_id) : null;
      if (patient) {
        try {
          const patientData = typeof patient.resource_data === 'string' ? JSON.parse(patient.resource_data) : patient.resource_data;
          patientName = patientName || patientData.name?.[0]?.text ||
            (patientData.name?.[0]?.given?.join(' ') + ' ' + patientData.name?.[0]?.family);
          dateOfBirth = dateOfBirth || patientData.birthDate;
          patientId = patient.resource_id;
        } catch (parseError) {
          console.warn('⚠️  Could not parse patient data:', parseError.message);
        }
      }
    }

    const idempotencyKey = args.idempotency_key || req.headers['idempotency-key'] ||
      `claim_${args.appointment_id}_${args.member_id}_${args.service_code || 'default'}_${args.date_of_service || appointment.date}`;

    const claimOpType = 'claim_submit';
    const cached = db.getIdempotentResult && db.getIdempotentResult(idempotencyKey, claimOpType);
    if (cached) {
      return res.json({ ...cached.result, idempotent: true });
    }
    const reserve = db.reserveIdempotencyKey && db.reserveIdempotencyKey(idempotencyKey, claimOpType);
    if (reserve === 'in_progress') {
      return res.status(409).json({ success: false, error: 'Claim submission in progress', idempotent: true });
    }
    if (reserve === 'completed') {
      const c2 = db.getIdempotentResult(idempotencyKey, claimOpType);
      if (c2) return res.json({ ...c2.result, idempotent: true });
    }

    // W3-S4.2/W3-S4.5: Use resolved CPT/ICD from triage (appointment.primary_cpt, primary_icd10)
    const resolvedCpt = args.service_code || appointment.primary_cpt || InsuranceService.mapAppointmentTypeToCPT(appointment.appointment_type, { urgency: 'routine' });
    const resolvedIcd = args.diagnosis_code || appointment.primary_icd10 || InsuranceService.mapAppointmentTypeToICD10(appointment.appointment_type);

    const claimData = {
      appointmentId: args.appointment_id,
      patientId: patientId,
      patientName: patientName || appointment.patient_name,
      dateOfBirth: dateOfBirth || '1990-01-01',
      memberId: args.member_id,
      payerId: args.payer_id,
      serviceCode: resolvedCpt,
      diagnosisCode: resolvedIcd,
      totalAmount: parseFloat(args.total_amount),
      copayPaid: parseFloat(args.copay_paid || 0),
      dateOfService: args.date_of_service || appointment.date,
      blockchainProof: args.blockchain_proof || null,
      providerId: args.provider_id || null,
      npi: args.npi || null,
      idempotency_key: idempotencyKey
    };

    const result = await InsuranceService.submitClaim(claimData);

    if (result.success && db.completeIdempotentResult) {
      db.completeIdempotentResult(idempotencyKey, claimOpType, result);
    } else if (!result.success && db.releaseIdempotencyKey) {
      db.releaseIdempotencyKey(idempotencyKey, claimOpType);
    }

    // Send insurance billing email if claim was submitted successfully
    if (result.success && result.claimId) {
      try {
        const EmailService = require('./services/email-service');
        const insurerEmail = args.insurer_email || process.env.INSURER_BILLING_EMAIL || 'gigtogigdev@gmail.com';

        await EmailService.sendInsuranceBillingEmail(insurerEmail, {
          claimId: result.claimId,
          x12ClaimId: result.x12ClaimId,
          memberId: args.member_id,
          patientName: patientName || appointment.patient_name,
          serviceCode: args.service_code,
          totalAmount: parseFloat(args.total_amount),
          copayPaid: parseFloat(args.copay_paid || 0),
          dateOfService: args.date_of_service || appointment.date
        });

        console.log(`📧 Insurance billing email sent to: ${insurerEmail}`);
      } catch (emailError) {
        console.warn('⚠️  Failed to send insurance billing email:', emailError.message);
        // Don't fail the claim submission if email fails
      }
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error submitting claim:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check claim status
 * POST /voice/insurance/check-claim-status
 */
app.post('/voice/insurance/check-claim-status', async (req, res) => {
  try {
    console.log('\n🔍 VOICE: Check Claim Status');
    safeLogRequestBody('Request body:', req);

    const args = req.body.args || req.body;

    if (!args.claim_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: claim_id'
      });
    }

    const result = await InsuranceService.checkClaimStatus(args.claim_id);

    res.json(result);
  } catch (error) {
    console.error('❌ Error checking claim status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * vc-5: Create claim from DiagnosticReport (video visit case report)
 * POST /api/claims/create-from-diagnostic-report
 * Body: { appointment_id: string, icd10?: string[], cpt?: string[], total_amount?: number }
 */
app.post('/api/claims/create-from-diagnostic-report', async (req, res) => {
  try {
    const { appointment_id: appointmentId, icd10: icd10Override, cpt: cptOverride, total_amount: totalAmountOverride } = req.body || {};
    if (!appointmentId) return res.status(400).json({ success: false, error: 'appointment_id required' });

    const appt = await db.getAppointment(appointmentId);
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found' });
    const patientId = appt.patient_id;
    if (!patientId) return res.status(400).json({ success: false, error: 'Appointment has no patient' });

    let icd10Codes = Array.isArray(icd10Override) ? icd10Override : [];
    let cptCodes = Array.isArray(cptOverride) ? cptOverride.map(c => ({ code: typeof c === 'string' ? c : c?.code || c })) : [];

    const dr = db.getDiagnosticReportByEncounterId && db.getDiagnosticReportByEncounterId(appointmentId);
    if (dr?.reasoning_chain) {
      try {
        const chain = typeof dr.reasoning_chain === 'string' ? JSON.parse(dr.reasoning_chain) : dr.reasoning_chain;
        if (chain?.layers) {
          const codesLayer = chain.layers.find(l => l.codes || l.icd10 || l.cpt);
          if (codesLayer?.icd10) icd10Codes = icd10Codes.length ? icd10Codes : codesLayer.icd10.map(c => c?.code || c);
          if (codesLayer?.cpt) cptCodes = cptCodes.length ? cptCodes : (codesLayer.cpt || []).map(c => ({ code: c?.code || c }));
        }
      } catch (_) {}
    }
    if (icd10Codes.length === 0 || cptCodes.length === 0) {
      const roomId = `appt-${appointmentId}`;
      const aiRows = db.db?.prepare?.('SELECT codes FROM video_consult_ai_decisions WHERE room_id = ? ORDER BY created_at DESC LIMIT 1')?.get(roomId);
      if (aiRows?.codes) {
        try {
          const codes = typeof aiRows.codes === 'string' ? JSON.parse(aiRows.codes) : aiRows.codes;
          if (codes?.icd10?.length) icd10Codes = icd10Codes.length ? icd10Codes : codes.icd10.map(c => c?.code || c);
          if (codes?.cpt?.length) cptCodes = cptCodes.length ? cptCodes : (codes.cpt || []).map(c => ({ code: c?.code || c }));
        } catch (_) {}
      }
    }
    if (icd10Codes.length === 0 && cptCodes.length === 0) return res.status(400).json({ success: false, error: 'No ICD/CPT codes; ensure case report or RAG has completed' });

    if (cptCodes.length === 0 && icd10Codes.length > 0) {
      const DiagnosisCodeMapper = require('./services/diagnosis-code-mapper');
      cptCodes = DiagnosisCodeMapper.generateServiceLineItemsFromDiagnoses(icd10Codes, {
        maxServicesPerDiagnosis: 2,
        dateOfService: appt.date || new Date().toISOString().split('T')[0]
      }) || [];
    }
    const eligibility = db.getEligibilityChecksByPatient?.(patientId) || [];
    const latest = eligibility[0];
    const totalAmount = totalAmountOverride ?? (cptCodes.reduce((s, c) => s + (parseFloat(c.charge || c.amount || c.price) || 0), 0) || 150);

    const claimId = `claim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const claimData = {
      id: claimId,
      appointment_id: appointmentId,
      patient_id: patientId,
      member_id: latest?.member_id || 'N/A',
      payer_id: latest?.payer_id || 'N/A',
      service_code: (cptCodes.map(c => c.code || c.cpt_code).filter(Boolean).join(', ') || '90834').substring(0, 200),
      diagnosis_code: icd10Codes.map(d => typeof d === 'string' ? d : d.code || d).join(', ').substring(0, 200),
      total_amount: totalAmount,
      copay_amount: latest?.copay_amount || 0,
      insurance_amount: totalAmount - (latest?.copay_amount || 0),
      status: 'draft',
      response_data: JSON.stringify({ createdFrom: 'diagnostic-report', appointmentId })
    };
    db.createInsuranceClaim(claimData);
    res.json({ success: true, claimId });
  } catch (e) {
    console.error('[claims] create-from-diagnostic-report error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Create claim from PDF coding data
 * POST /api/claims/create-from-pdf
 */
app.post('/api/claims/create-from-pdf', async (req, res) => {
  try {
    console.log('\n📄 Creating claim from PDF coding data');
    const { patientId, coding, pricing, pdfText, fileName } = req.body;

    if (!patientId || !coding) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: patientId and coding are required'
      });
    }

    // Get patient info
    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    const patientData = typeof patient.resource_data === 'string'
      ? JSON.parse(patient.resource_data)
      : patient.resource_data;

    const name = patientData.name?.[0];
    const patientName = name
      ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim()
      : 'Unknown Patient';

    // Get latest eligibility check for insurance info
    const eligibility = db.getEligibilityChecksByPatient(patientId) || [];
    const latestEligibility = eligibility[0] || null;

    // Extract ICD-10 and CPT codes
    const icd10Codes = coding.icd10 || [];
    let cptCodes = pricing.breakdown || [];

    // If we have diagnosis codes but no CPT codes, generate service line items from diagnoses
    if (icd10Codes.length > 0 && cptCodes.length === 0) {
      const DiagnosisCodeMapper = require('./services/diagnosis-code-mapper');
      console.log('📋 Generating service line items from diagnosis codes:', icd10Codes.map(d => typeof d === 'string' ? d : d.code));

      cptCodes = DiagnosisCodeMapper.generateServiceLineItemsFromDiagnoses(icd10Codes, {
        maxServicesPerDiagnosis: 2,
        dateOfService: new Date().toISOString().split('T')[0]
      });

      console.log(`✅ Generated ${cptCodes.length} service line items from diagnosis codes`);
    }

    // Calculate totals (PDF breakdown uses 'price'; claims may use charge/amount/billed_amount)
    const lineAmount = (item) => parseFloat(item.charge || item.amount || item.billed_amount || item.price) || 0;
    const totalAmountBilled = cptCodes.reduce((sum, item) => sum + lineAmount(item), 0);
    const totalAllowedAmount = cptCodes.reduce((sum, item) => sum + (parseFloat(item.allowed_amount) || 0), 0);

    // Create claim ID
    const claimId = `claim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Prepare claim data (proof_of_care_hash for Tiba Spec 5.3, 5.4)
    const SettlementService = require('./services/settlement-service');
    const proofOfCareHash = SettlementService.generateProofOfCare(
      pdfText?.substring(0, 2000) || '',
      { icd10: icd10Codes, cpt: cptCodes },
      new Date().toISOString()
    );
    const claimData = {
      id: claimId,
      appointment_id: null, // No appointment for PDF-based claims
      patient_id: patientId,
      member_id: latestEligibility?.member_id || 'N/A',
      payer_id: latestEligibility?.payer_id || 'N/A',
      service_code: cptCodes.map(c => c.code || c.cpt_code).join(', ') || 'N/A',
      diagnosis_code: icd10Codes.map(d => typeof d === 'string' ? d : d.code || d).join(', ') || 'N/A',
      total_amount: totalAmountBilled,
      copay_amount: latestEligibility?.copay_amount || 0,
      insurance_amount: latestEligibility?.allowed_amount || 0,
      status: 'draft', // Start as draft, can be submitted later
      proof_of_care_hash: proofOfCareHash,
      response_data: JSON.stringify({
        coding: {
          ...coding,
          icd10: icd10Codes
        },
        pricing: {
          ...pricing,
          breakdown: cptCodes // Include generated service line items
        },
        pdfText: pdfText?.substring(0, 1000), // Store first 1000 chars of PDF text
        fileName,
        createdFrom: 'pdf-coding',
        createdAt: new Date().toISOString()
      })
    };

    // Save claim to database
    db.createInsuranceClaim(claimData);

    // Run pre-adjudication and persist real_time_plan_paid for Tiba reconciliation (Phase 5)
    try {
      const AdjudicationService = require('./services/adjudication-service');
      AdjudicationService.preAdjudicateClaim(claimId);
    } catch (adjErr) {
      console.warn('⚠️  Pre-adjudication on PDF claim skipped:', adjErr.message);
    }

    console.log(`✅ Claim created: ${claimId}`);

    res.json({
      success: true,
      claimId: claimId,
      message: 'Claim created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating claim from PDF:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get claim by ID with real Stedi data and EOB calculations
 * GET /api/claims/:id
 */
app.get('/api/claims/:id', async (req, res) => {
  try {
    const claimId = req.params.id;
    const claim = db.getClaimById(claimId);

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: 'Claim not found'
      });
    }

    // Get patient info from FHIR
    let patientData = null;
    let patientName = 'Unknown Patient';
    let subscriberId = claim.member_id || 'N/A';
    let groupNumber = 'N/A';

    if (claim.patient_id) {
      const patient = db.getFHIRPatient(claim.patient_id);
      if (patient) {
        patientData = typeof patient.resource_data === 'string'
          ? JSON.parse(patient.resource_data)
          : patient.resource_data;

        // Extract patient name
        const name = patientData.name?.[0];
        if (name) {
          patientName = `${(name.given || []).join(' ')} ${name.family || ''}`.trim();
        }
      }
    }

    // Get REAL Stedi eligibility data (most recent)
    let eligibility = null;
    let planSummary = 'N/A';
    let payerName = 'N/A';

    if (claim.patient_id) {
      const eligibilityChecks = db.getEligibilityChecksByPatient(claim.patient_id) || [];
      eligibility = eligibilityChecks[0] || null; // Most recent eligibility check

      if (eligibility) {
        // Parse response_data if it's a string to get full Stedi response
        if (eligibility.response_data) {
          try {
            const stediResponse = typeof eligibility.response_data === 'string'
              ? JSON.parse(eligibility.response_data)
              : eligibility.response_data;

            // Extract additional info from Stedi response
            planSummary = eligibility.plan_summary || stediResponse.plan_summary || stediResponse.plan_name || 'N/A';
            payerName = stediResponse.payer_name || eligibility.payer_id || 'N/A';
            subscriberId = eligibility.member_id || subscriberId;
          } catch (e) {
            console.warn('Could not parse eligibility response_data:', e.message);
          }
        }

        // Use plan_summary from database if available
        if (eligibility.plan_summary) {
          planSummary = eligibility.plan_summary;
        }
      }
    }

    // Parse claim response_data to get coding and pricing
    let claimDetails = {};
    if (claim.response_data) {
      try {
        claimDetails = typeof claim.response_data === 'string'
          ? JSON.parse(claim.response_data)
          : claim.response_data;
      } catch (e) {
        console.warn('Could not parse claim response_data:', e.message);
      }
    }

    // Calculate EOB using real Stedi eligibility data
    // For approved claims, prioritize stored EOB from response_data (has final approved amounts)
    const EOBCalculationService = require('./services/eob-calculation-service');
    let eobCalculation;

    // For approved/paid claims, use stored EOB if available (contains final approved amounts)
    if ((claim.status === 'approved' || claim.status === 'paid') && claimDetails.eob) {
      eobCalculation = claimDetails.eob;
      console.log(`✅ Using stored EOB for approved claim ${claimId}`);
    } else {
      // For pending/submitted claims or claims without stored EOB, calculate on the fly
      try {
        eobCalculation = EOBCalculationService.calculateEOBFromClaim(
          claim,
          eligibility || {},
          claimDetails
        );

        // If no line items were created but claim has data, ensure totals reflect claim amount
        if ((!eobCalculation.lineItems || eobCalculation.lineItems.length === 0) && claim.total_amount > 0) {
          eobCalculation.totals = eobCalculation.totals || {};
          eobCalculation.totals.amountBilled = claim.total_amount;
          eobCalculation.totals.allowedAmount = claimDetails.allowed_amount || claim.total_amount * 0.85;
          eobCalculation.totals.whatYouOwe = claim.total_amount;
        }

        // EOB transparency: persist audit for on-the-fly calculations
        db.recordEOBCalculationAudit({
          claimId,
          calculationInputs: {
            claimId: claim.id,
            total_amount: claim.total_amount,
            eligibility: eligibility ? { copay_amount: eligibility.copay_amount, deductible_remaining: eligibility.deductible_remaining } : null
          },
          calculationOutputs: eobCalculation,
          triggeredBy: 'get-claim-detail'
        });
      } catch (error) {
        console.error('Error calculating EOB:', error);
        // Fallback: create basic EOB structure
        eobCalculation = {
          lineItems: [],
          totals: {
            amountBilled: claim.total_amount || 0,
            allowedAmount: claimDetails.allowed_amount || 0,
            planPaid: 0,
            copay: eligibility?.copay_amount || 0,
            coinsurance: 0,
            deductible: 0,
            amountNotCovered: 0,
            whatYouOwe: claim.total_amount || 0
          }
        };
      }
    }

    // Extract diagnosis codes with descriptions
    const diagnosisCodes = [];
    const DiagnosisCodeMapper = require('./services/diagnosis-code-mapper');

    if (claimDetails.coding && claimDetails.coding.icd10) {
      diagnosisCodes.push(...claimDetails.coding.icd10.map(d => ({
        code: typeof d === 'string' ? d : d.code || d,
        description: typeof d === 'string'
          ? DiagnosisCodeMapper.getDiagnosisDescription(d)
          : (d.description || DiagnosisCodeMapper.getDiagnosisDescription(d.code || d))
      })));
    } else if (claim.diagnosis_code) {
      // Parse diagnosis codes from claim
      claim.diagnosis_code.split(',').forEach(code => {
        const trimmedCode = code.trim();
        if (trimmedCode && trimmedCode !== 'N/A') {
          diagnosisCodes.push({
            code: trimmedCode,
            description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
          });
        }
      });
    }

    // Get payer information
    if (claim.payer_id) {
      const payer = db.getPayerByPayerId(claim.payer_id);
      if (payer) {
        payerName = payer.payer_name || payerName;
      }
    }

    // Get Circle transfer data if exists
    let circleTransfer = null;
    if (claim.circle_transfer_id) {
      circleTransfer = db.getCircleTransferByCircleId(claim.circle_transfer_id);
    }

    // Settlement state (Tiba Phase 3.8) - explicit for API consumers
    let settlementDecisionParsed = null;
    if (claim.settlement_decision) {
      try {
        settlementDecisionParsed = typeof claim.settlement_decision === 'string' ? JSON.parse(claim.settlement_decision) : claim.settlement_decision;
      } catch (_) {}
    }
    const settlement = {
      settlement_state: claim.settlement_state || null,
      settlement_aggregate_confidence: claim.settlement_aggregate_confidence ?? null,
      settlement_amount_released: claim.settlement_amount_released ?? null,
      settlement_escrow_remainder: claim.settlement_escrow_remainder ?? null,
      settlement_decision: settlementDecisionParsed
    };

    // Build complete EOB response
    res.json({
      success: true,
      claim: {
        ...claim,
        patientData,
        patientName,
        subscriberId,
        groupNumber,
        payerName,
        planSummary,
        claimDetails,
        eligibility: eligibility || {},
        eob: eobCalculation,
        diagnosisCodes,
        circleTransfer,
        settlement
      },
      settlement,
      // Also include EOB at root level for easy access
      eob: eobCalculation,
      diagnosisCodes: diagnosisCodes
    });
  } catch (error) {
    console.error('❌ Error fetching claim:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================
 * CIRCLE PAYMENT API ENDPOINTS
 * ============================================
 */

/**
 * Create Circle wallet for an entity
 * POST /api/circle/wallets
 */
app.post('/api/circle/wallets', async (req, res) => {
  try {
    const { entityType, entityId, description } = req.body;

    if (!entityType || !entityId) {
      return res.status(400).json({
        success: false,
        error: 'entityType and entityId are required'
      });
    }

    // Check if wallet already exists
    const existingAccount = db.getCircleAccountByEntity(entityType, entityId);
    if (existingAccount) {
      return res.json({
        success: true,
        walletId: existingAccount.circle_wallet_id,
        account: existingAccount,
        message: 'Wallet already exists'
      });
    }

    // Check if SDK is available
    if (!CircleService || !CircleService.isAvailable()) {
      return res.status(500).json({
        success: false,
        error: 'Circle SDK not configured. Please set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in environment variables.'
      });
    }

    // First, get or create a wallet set
    // For simplicity, we'll create a default wallet set if it doesn't exist
    // In production, you'd want to store the wallet set ID in the database
    let walletSetId = process.env.CIRCLE_WALLET_SET_ID;

    if (!walletSetId) {
      // Create a default wallet set
      const walletSetResult = await CircleService.createWalletSet({
        name: 'Healthcare Billing Wallets',
        description: 'Default wallet set for healthcare billing'
      });

      if (!walletSetResult.success) {
        return res.status(500).json({
          success: false,
          error: `Failed to create wallet set: ${walletSetResult.error}`
        });
      }

      walletSetId = walletSetResult.walletSetId;
      // Store wallet set ID for future use
      process.env.CIRCLE_WALLET_SET_ID = walletSetId;
      console.log(`✅ Created wallet set: ${walletSetId}`);
    }

    // Create wallet via Circle SDK
    const result = await CircleService.createWallet({
      walletSetId: walletSetId,
      entityType,
      entityId,
      description: description || `${entityType} wallet for ${entityId}`
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to create wallet'
      });
    }

    // Store wallet in database
    const accountId = `circle-account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    db.createCircleAccount({
      id: accountId,
      entity_type: entityType,
      entity_id: entityId,
      circle_wallet_id: result.walletId,
      currency: 'USDC',
      status: 'active'
    });

    console.log(`✅ Circle wallet created: ${result.walletId} for ${entityType}:${entityId}`);

    res.json({
      success: true,
      walletId: result.walletId,
      walletData: result.walletData
    });
  } catch (error) {
    console.error('❌ Error creating Circle wallet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get wallet balance
 * GET /api/circle/wallets/:walletId/balance
 */
app.get('/api/circle/wallets/:walletId/balance', async (req, res) => {
  try {
    const { walletId } = req.params;
    const result = await CircleService.getWalletBalance(walletId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to get wallet balance'
      });
    }

    res.json({
      success: true,
      walletId: walletId,
      balances: result.balances
    });
  } catch (error) {
    console.error('❌ Error getting wallet balance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get Circle account by entity
 * GET /api/circle/accounts/:entityType/:entityId
 */
app.get('/api/circle/accounts/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    // Get merchant_id from tenant context if available
    const merchantId = req.tenant?.merchant?.id ||
      req.tenant?.clinic?.merchant_id ||
      req.query?.merchant_id ||
      null;

    const account = db.getCircleAccountByEntity(entityType, entityId);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Circle account not found'
      });
    }

    // Filter by merchant_id if provided (tenant-scoped wallets)
    if (merchantId && account.merchant_id && account.merchant_id !== merchantId) {
      return res.status(403).json({
        success: false,
        error: 'Wallet does not belong to this tenant'
      });
    }

    // Get balance from Circle
    let balance = null;
    if (account.circle_wallet_id) {
      const balanceResult = await CircleService.getWalletBalance(account.circle_wallet_id);
      if (balanceResult.success) {
        balance = balanceResult.balances;
      }
    }

    res.json({
      success: true,
      account: {
        ...account,
        balance
      }
    });
  } catch (error) {
    console.error('❌ Error getting Circle account:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─── Patient document upload (telemedicine) — NOT part of patient wallet ─────────────────────
// Upload = token-based document upload (lab results, photos before visit). Stored in patient_uploads/Azure.
// Patient wallet (below) = payments (HSA/Circle, deposit, pay-claim). Separate feature, same /api/patient prefix.
// Telemedicine Phase 3 — POST /api/patient/send-upload-link (upload link email)
const { sendUploadLinkHandler } = require('./routes/patient-upload-link');
app.post('/api/patient/send-upload-link', sendUploadLinkHandler);

// Phase 8: POST /api/patient/visits/:id/feedback — Token-validated feedback (no session required)
app.post('/api/patient/visits/:id/feedback', apiLimiter, express.json(), async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const { token, rating, helpful, comment } = req.body || {};
    const { verifyFeedbackToken } = require('./utils/upload-token');

    const payload = verifyFeedbackToken(token);
    if (!payload || payload.appointment_id !== appointmentId) {
      return res.status(400).json({ success: false, error: 'Invalid or expired feedback link. Please use the link from your email.' });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) return res.status(404).json({ success: false, error: 'Appointment not found' });

    const { v4: uuidv4 } = require('uuid');
    const id = 'fb-' + uuidv4();
    const ratingInt = rating != null ? (parseInt(rating, 10) >= 1 && parseInt(rating, 10) <= 5 ? parseInt(rating, 10) : null) : null;
    const helpfulInt = helpful != null ? (helpful === true || helpful === 1 || helpful === '1' ? 1 : 0) : null;
    const commentStr = typeof comment === 'string' ? comment.trim().slice(0, 2000) : '';

    db.db.prepare(`
      INSERT INTO visit_feedbacks (id, appointment_id, patient_id, rating, helpful, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, appointmentId, appointment.patient_id || null, ratingInt, helpfulInt, commentStr || null);

    return res.json({ success: true, message: 'Thank you for your feedback.' });
  } catch (e) {
    console.error('POST /api/patient/visits/:id/feedback error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Telemedicine Phase 4 — Patient upload portal (Tasks 25–33). Router: GET /upload, POST /upload
const uploadPortalRouter = require('./routes/upload-portal');
app.use('/', uploadPortalRouter);           // GET /upload?token=...
app.use('/api/patient', uploadPortalRouter); // POST /api/patient/upload

// gap10: Triage upload — session-scoped, stores to case_report_media for RAG
app.post('/api/triage/upload', apiLimiter, async (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.body?.session_id;
  if (!sessionId) return res.status(400).json({ success: false, error: 'x-session-id required' });
  let multer;
  try { multer = require('multer'); } catch (e) {
    return res.status(500).json({ success: false, error: 'Upload backend not configured' });
  }
  const uploadDir = path.join(__dirname, 'uploads', 'triage');
  try { if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true }); } catch (_) {}
  const m = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).array('files', 5);
  m(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: 'Upload failed' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, error: 'No files' });
    const saved = [];
    const patientId = (() => {
      try {
        const triageRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
        return triageRow?.patient_id || req.body?.patient_id || null;
      } catch (_) { return null; }
    })();
    for (const f of files) {
      try {
        const id = db.createCaseReportMedia({
          session_id: sessionId,
          patient_id: patientId,
          media_type: (f.mimetype || '').startsWith('image/') ? 'image' : 'document',
          mime_type: f.mimetype,
          file_name: f.originalname,
          file_size_bytes: f.size,
          storage_provider: 'local',
          context_note: f.originalname,
          uploaded_during: 'triage'
        });
        saved.push(id);
        // M-Doc.1: Dual-write to patient_documents when patient_id available
        if (patientId && db.createPatientDocument && f.buffer) {
          try {
            const ext = path.extname(f.originalname) || '.bin';
            const patientDir = path.join(uploadDir, 'patient_docs', patientId);
            if (!fs.existsSync(patientDir)) fs.mkdirSync(patientDir, { recursive: true });
            const storagePath = path.join(patientDir, `${id}${ext}`);
            fs.writeFileSync(storagePath, f.buffer);
            const docId = `pd-${id}`;
            db.createPatientDocument({
              id: docId,
              patient_id: patientId,
              file_name: f.originalname,
              file_type: f.mimetype || 'application/octet-stream',
              storage_path: storagePath,
              storage_provider: 'local',
              uploaded_by: 'triage'
            });
            // M-Doc.2: Async extraction for RAG query
            setImmediate(() => {
              const extraction = require('./services/patient-document-extraction');
              extraction.extractAndStore(
                { id: docId, patient_id: patientId, storage_path: storagePath, file_name: f.originalname, file_type: f.mimetype },
                null,
                db
              ).catch(e => console.warn('[triage/upload] extractAndStore:', e.message));
            });
          } catch (e2) {
            console.warn('[triage/upload] Dual-write patient_document:', e2.message);
          }
        }
      } catch (e) {
        console.warn('[triage/upload] createCaseReportMedia:', e.message);
      }
    }

    // Critical: update/create triage_sessions so the agent knows media was received.
    // Without this, Kelly may keep requesting uploads because `media_received` stays false.
    try {
      const mediaIdsJson = JSON.stringify(saved || []);
      if (db?.db?.prepare) {
        const r = db.db.prepare(`
          UPDATE triage_sessions
          SET media_received = 1,
              media_requested = 1,
              media_ids = COALESCE(?, media_ids)
          WHERE session_id = ?
        `).run(mediaIdsJson, sessionId);

        // If no triage_session row exists yet for this session_id, create a minimal one.
        if (r?.changes === 0 && db?.upsertTriageSession) {
          db.upsertTriageSession({
            session_id: sessionId,
            patient_id: patientId || null,
            media_requested: true,
            media_received: true,
            media_ids: saved || []
          });
        }
      }
    } catch (e) {
      console.warn('[triage/upload] failed to mark media_received:', e.message);
    }

    res.json({ success: true, count: saved.length, message: 'Upload received. You can continue with your description.' });
  });
});

// Telemedicine Phase 7 — Case report: internal transcript + callback (Tasks 53, 55, 56)
const caseReportRoutes = require('./routes/case-report');
app.use(caseReportRoutes);

// Telemedicine Phase 8 — DiagnosticReport API (Tasks 58–60: clinician/patient JWT, audit)
const diagnosticReportRoutes = require('./routes/diagnostic-report');
app.use('/api', diagnosticReportRoutes);

/**
 * Patient HSA Wallet - Link wallet address (for Privy/Magic client-created wallets)
 * PATCH /api/patient/:patientId/hsa-wallet
 * Body: { walletAddress: "0x..." }
 */
app.patch('/api/patient/:patientId/hsa-wallet', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { walletAddress } = req.body;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ success: false, error: 'Valid walletAddress (0x...) required' });
    }
    const patient = db.getFHIRPatient(patientId);
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' });
    if (db.updateFHIRPatientWallet) db.updateFHIRPatientWallet(patientId, walletAddress);
    const updated = db.getFHIRPatient(patientId);
    res.json({ success: true, patient_wallet_address: updated?.patient_wallet_address });
  } catch (err) {
    console.error('HSA wallet link error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get HSA wallet config for client (Privy/Magic init)
 * GET /api/patient/hsa-wallet/config
 */
app.get('/api/patient/hsa-wallet/config', (req, res) => {
  const HSAWalletService = require('./services/hsa-wallet-service');
  res.json(HSAWalletService.getClientConfig());
});

/**
 * Patient Wallet - Deposit money (test/sandbox)
 * POST /api/patient/wallet/deposit
 */
app.post('/api/patient/wallet/deposit', async (req, res) => {
  try {
    const { patientId, amount, method } = req.body;

    if (!patientId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'patientId and amount (positive number) are required'
      });
    }

    // Get or create patient wallet
    // First, check if patientId is a FHIR Patient resource_id
    // If so, use it directly; otherwise, try to find FHIR patient by phone/email
    let fhirPatientId = patientId;
    let account = db.getCircleAccountByEntity('patient', patientId);

    // If wallet doesn't exist, try to find FHIR patient and create wallet using resource_id
    if (!account) {
      // Check if this is already a FHIR Patient resource_id
      const fhirPatient = db.getFHIRPatient(patientId);

      if (fhirPatient) {
        // Use FHIR Patient resource_id directly
        fhirPatientId = fhirPatient.resource_id;
        console.log(`📋 Using FHIR Patient resource_id: ${fhirPatientId}`);
      } else {
        // Try to find FHIR patient by phone or email if provided
        const { phone, email } = req.body;
        if (phone || email) {
          let patient = null;
          if (phone) {
            patient = db.getFHIRPatientByPhone(phone);
          }
          if (!patient && email) {
            patient = db.getFHIRPatientByEmail(email);
          }

          if (patient) {
            fhirPatientId = patient.resource_id;
            console.log(`📋 Found FHIR Patient by contact info: ${fhirPatientId}`);
          }
        }
      }

      // Get or create wallet using FHIR Patient resource_id
      if (!CircleService || !CircleService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'Circle service is not configured. Please set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in environment variables.'
        });
      }

      // Get merchant_id from tenant context if available
      const merchantId = req.tenant?.merchant?.id ||
        req.tenant?.clinic?.merchant_id ||
        req.body?.merchant_id ||
        null;

      const walletResult = await CircleService.getOrCreatePatientWallet(fhirPatientId, {
        createIfNotExists: true,
        merchantId: merchantId
      });

      if (!walletResult.success) {
        return res.status(500).json({
          success: false,
          error: walletResult.error || 'Failed to create wallet'
        });
      }

      account = walletResult.account;

      // Update patientId to use FHIR resource_id for consistency
      if (fhirPatientId !== patientId) {
        console.log(`🔄 Updated patientId from ${patientId} to FHIR resource_id ${fhirPatientId}`);
        patientId = fhirPatientId;
      }
    }

    if (!account || !account.circle_wallet_id) {
      return res.status(500).json({
        success: false,
        error: 'Wallet not found or not initialized'
      });
    }

    // Handle different payment methods
    const { v4: uuidv4 } = require('uuid');
    const depositId = `deposit_${uuidv4()}`;

    if (method === 'test') {
      // For test/sandbox: Use Circle SDK to transfer test USDC from system wallet
      try {
        if (!CircleService || !CircleService.isAvailable()) {
          // Fallback: Create pending record if Circle not configured
          console.warn('⚠️  Circle service not available - creating pending deposit record');
          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            'system',
            account.circle_wallet_id,
            amount,
            'USDC',
            `deposit_${Date.now()}`,
            'pending',
            new Date().toISOString()
          );

          return res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            method: 'test',
            status: 'pending',
            message: `Deposit record created. Circle service is not configured - please set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.`,
            note: 'To enable real test USDC transfers, configure Circle API keys in environment variables.'
          });
        }

        // Attempt to fund wallet via Circle API
        const fundResult = await CircleService.fundWallet(account.circle_wallet_id, amount);

        if (fundResult.success) {
          // Record successful transfer
          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            process.env.CIRCLE_SYSTEM_WALLET_ID || 'system',
            account.circle_wallet_id,
            amount,
            'USDC',
            fundResult.transferId || `deposit_${Date.now()}`,
            'completed',
            new Date().toISOString(),
            new Date().toISOString()
          );

          console.log(`✅ Test deposit of $${amount} transferred to patient ${patientId} wallet via Circle`);

          res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            transferId: fundResult.transferId,
            method: 'test',
            message: `Successfully deposited $${amount.toFixed(2)} USDC to wallet (test mode)`
          });
        } else {
          // Fallback: Create pending record if Circle transfer fails
          // This allows the UI to work even if system wallet isn't set up
          console.warn(`⚠️  Circle funding failed: ${fundResult.error}. Creating pending record.`);

          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            'system',
            account.circle_wallet_id,
            amount,
            'USDC',
            `deposit_${Date.now()}`,
            'pending',
            new Date().toISOString()
          );

          res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            method: 'test',
            status: 'pending',
            message: `Deposit record created. ${fundResult.error || 'Please set up CIRCLE_SYSTEM_WALLET_ID to enable real transfers.'}`,
            note: 'To enable real test USDC transfers, create a system wallet in Circle Console, fund it with test USDC, and set CIRCLE_SYSTEM_WALLET_ID in .env'
          });
        }
      } catch (error) {
        console.error('Error funding wallet via Circle:', error);

        // Fallback: Create pending record
        db.db.prepare(`
          INSERT INTO circle_transfers (
            id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
            circle_transfer_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          depositId,
          null,
          'system',
          account.circle_wallet_id,
          amount,
          'USDC',
          `deposit_${Date.now()}`,
          'pending',
          new Date().toISOString()
        );

        res.json({
          success: true,
          depositId: depositId,
          amount: amount,
          walletId: account.circle_wallet_id,
          method: 'test',
          status: 'pending',
          message: `Deposit record created. Error: ${error.message}`,
          note: 'To enable real transfers, set up CIRCLE_SYSTEM_WALLET_ID with a funded system wallet'
        });
      }
    } else if (method === 'ach') {
      // ACH Bank Transfer - Circle API supports this
      // In production, this would:
      // 1. Create a deposit via Circle's ACH API
      // 2. Link user's bank account (if not already linked)
      // 3. Initiate ACH transfer
      // 4. Update status based on Circle webhook callbacks

      // For now, create pending deposit record
      db.db.prepare(`
        INSERT INTO circle_transfers (
          id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
          circle_transfer_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        depositId,
        null,
        'ach_bank', // ACH bank source
        account.circle_wallet_id,
        amount,
        'USDC',
        `ach_deposit_${Date.now()}`,
        'pending', // ACH transfers take 1-3 business days
        new Date().toISOString()
      );

      console.log(`✅ ACH deposit initiated for $${amount} to patient ${patientId} wallet`);

      res.json({
        success: true,
        depositId: depositId,
        amount: amount,
        walletId: account.circle_wallet_id,
        method: 'ach',
        status: 'pending',
        message: `ACH transfer initiated for $${amount.toFixed(2)}. Funds will be available in 1-3 business days.`,
        note: 'In production, this would integrate with Circle ACH API to initiate the bank transfer.'
      });
    } else if (method === 'wire') {
      // Wire Transfer - for large amounts, same-day
      db.db.prepare(`
        INSERT INTO circle_transfers (
          id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
          circle_transfer_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        depositId,
        null,
        'wire_bank',
        account.circle_wallet_id,
        amount,
        'USDC',
        `wire_deposit_${Date.now()}`,
        'pending',
        new Date().toISOString()
      );

      console.log(`✅ Wire transfer initiated for $${amount} to patient ${patientId} wallet`);

      res.json({
        success: true,
        depositId: depositId,
        amount: amount,
        walletId: account.circle_wallet_id,
        method: 'wire',
        status: 'pending',
        message: `Wire transfer initiated for $${amount.toFixed(2)}. Funds will be available same day.`,
        note: 'In production, this would integrate with Circle Wire Transfer API.'
      });
    } else if (method === 'stripe') {
      // Stripe Payment - Credit/Debit Card
      // Creates a Stripe Payment Intent and converts USD to USDC for wallet deposit
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        if (!stripe) {
          return res.status(500).json({
            success: false,
            error: 'Stripe not configured. Please set STRIPE_SECRET_KEY in environment variables.'
          });
        }

        // Get payment method ID from request (required for Stripe)
        const { payment_method_id, customer_email, customer_name } = req.body;

        if (!payment_method_id) {
          // If no payment method ID, create a Payment Intent that requires client-side confirmation
          if (!stripe) {
            return res.status(503).json({
              success: false,
              error: 'Payment processing is not configured. Please contact support.'
            });
          }

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            metadata: {
              patient_id: patientId,
              wallet_id: account.circle_wallet_id,
              deposit_id: depositId,
              type: 'wallet_deposit'
            },
            description: `Wallet deposit for patient ${patientId}`,
            receipt_email: customer_email || undefined
          });

          // Create pending deposit record
          db.db.prepare(`
            INSERT INTO circle_transfers (
              id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
              circle_transfer_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            depositId,
            null,
            'stripe',
            account.circle_wallet_id,
            amount,
            'USDC',
            paymentIntent.id,
            'pending',
            new Date().toISOString()
          );

          console.log(`💳 Stripe Payment Intent created for $${amount} wallet deposit: ${paymentIntent.id}`);

          res.json({
            success: true,
            depositId: depositId,
            amount: amount,
            walletId: account.circle_wallet_id,
            method: 'stripe',
            status: 'pending',
            payment_intent_id: paymentIntent.id,
            client_secret: paymentIntent.client_secret,
            requires_action: paymentIntent.status === 'requires_action',
            message: `Stripe payment initiated for $${amount.toFixed(2)}. Complete payment to fund wallet.`,
            note: 'Payment will be converted to USDC and deposited to your wallet after successful payment.'
          });
        } else {
          // Payment method provided - create and confirm payment intent
          if (!stripe) {
            return res.status(503).json({
              success: false,
              error: 'Payment processing is not configured. Please contact support.'
            });
          }

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            payment_method: payment_method_id,
            confirm: true,
            metadata: {
              patient_id: patientId,
              wallet_id: account.circle_wallet_id,
              deposit_id: depositId,
              type: 'wallet_deposit'
            },
            description: `Wallet deposit for patient ${patientId}`,
            receipt_email: customer_email || undefined
          });

          if (paymentIntent.status === 'succeeded') {
            // Payment successful - create pending transfer record
            // The actual wallet funding will happen via Stripe webhook for reliability
            // This ensures payment is confirmed before funding wallet

            db.db.prepare(`
              INSERT INTO circle_transfers (
                id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
                circle_transfer_id, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              depositId,
              null,
              'stripe',
              account.circle_wallet_id,
              amount,
              'USDC',
              paymentIntent.id,
              'pending', // Will be updated by webhook when Circle transfer completes
              new Date().toISOString()
            );

            console.log(`✅ Stripe payment successful: ${paymentIntent.id}`);
            console.log(`💰 Wallet deposit record created. Funding will be processed via webhook.`);

            // Attempt to fund wallet immediately (webhook will also handle this as backup)
            try {
              if (CircleService && CircleService.isAvailable()) {
                const fundResult = await CircleService.fundWallet(account.circle_wallet_id, amount);

                if (fundResult.success) {
                  // Update transfer status to completed
                  db.db.prepare(`
                    UPDATE circle_transfers 
                    SET status = ?, completed_at = ?, circle_transfer_id = ?
                    WHERE id = ?
                  `).run(
                    'completed',
                    new Date().toISOString(),
                    fundResult.transferId || paymentIntent.id,
                    depositId
                  );

                  console.log(`✅ Wallet funded immediately: ${fundResult.transferId}`);
                }
              }
            } catch (fundError) {
              console.warn(`⚠️  Immediate wallet funding failed, webhook will handle: ${fundError.message}`);
            }

            res.json({
              success: true,
              depositId: depositId,
              amount: amount,
              walletId: account.circle_wallet_id,
              method: 'stripe',
              status: 'completed',
              payment_intent_id: paymentIntent.id,
              stripe_payment_id: paymentIntent.id,
              message: `Successfully processed Stripe payment. Wallet deposit will be completed shortly.`,
              note: 'Payment received. USDC will be deposited to your wallet.'
            });
          } else if (paymentIntent.status === 'requires_action') {
            // Payment requires 3D Secure or other authentication
            db.db.prepare(`
              INSERT INTO circle_transfers (
                id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
                circle_transfer_id, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              depositId,
              null,
              'stripe',
              account.circle_wallet_id,
              amount,
              'USDC',
              paymentIntent.id,
              'pending',
              new Date().toISOString()
            );

            res.json({
              success: true,
              depositId: depositId,
              amount: amount,
              walletId: account.circle_wallet_id,
              method: 'stripe',
              status: 'requires_action',
              payment_intent_id: paymentIntent.id,
              client_secret: paymentIntent.client_secret,
              requires_action: true,
              message: 'Payment requires authentication. Please complete 3D Secure verification.',
              note: 'After payment is confirmed, funds will be converted to USDC and deposited to wallet.'
            });
          } else {
            // Payment failed or requires payment method
            res.status(400).json({
              success: false,
              error: `Payment failed: ${paymentIntent.status}`,
              payment_intent_id: paymentIntent.id,
              status: paymentIntent.status
            });
          }
        }
      } catch (error) {
        console.error('❌ Stripe payment error:', error);

        // Create failed deposit record
        db.db.prepare(`
          INSERT INTO circle_transfers (
            id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
            circle_transfer_id, status, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          depositId,
          null,
          'stripe',
          account.circle_wallet_id,
          amount,
          'USDC',
          `failed_${Date.now()}`,
          'failed',
          error.message,
          new Date().toISOString()
        );

        res.status(500).json({
          success: false,
          error: error.message || 'Stripe payment failed',
          depositId: depositId,
          method: 'stripe'
        });
      }
    } else {
      // Unknown payment method
      res.json({
        success: false,
        error: `Unknown payment method: ${method}. Supported methods: test, ach, wire, stripe`
      });
    }
  } catch (error) {
    console.error('❌ Error depositing to patient wallet:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Patient Wallet - Get transaction history
 * GET /api/patient/wallet/transactions
 */
app.get('/api/patient/wallet/transactions', async (req, res) => {
  try {
    const { patientId, filter = 'all' } = req.query;

    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: 'patientId is required'
      });
    }

    // Get patient wallet
    const account = db.getCircleAccountByEntity('patient', patientId);
    if (!account || !account.circle_wallet_id) {
      return res.json({
        success: true,
        transactions: []
      });
    }

    // Get transfers involving this wallet
    const transfers = db.db.prepare(`
      SELECT * FROM circle_transfers
      WHERE from_wallet_id = ? OR to_wallet_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(account.circle_wallet_id, account.circle_wallet_id);

    // Get claims paid by this patient
    const claims = db.getClaimsByPatient(patientId) || [];

    // Combine and format transactions
    const transactions = [];

    // Add transfers
    transfers.forEach(transfer => {
      const isDeposit = transfer.to_wallet_id === account.circle_wallet_id && transfer.from_wallet_id === 'system';
      const isPayment = transfer.from_wallet_id === account.circle_wallet_id;

      if (filter === 'all' || (filter === 'deposit' && isDeposit) || (filter === 'medical' && isPayment)) {
        transactions.push({
          id: transfer.id,
          type: isDeposit ? 'deposit' : 'payment',
          description: isDeposit ? 'Deposit' : 'Payment',
          amount: isDeposit ? transfer.amount : -transfer.amount,
          created_at: transfer.created_at,
          status: transfer.status
        });
      }
    });

    // Add claim payments (synchronously process)
    // Include ALL claims (submitted, approved, paid) so patient can see their bills
    for (const claim of claims) {
      // Show claims that are submitted, approved, paid, or locked
      // Include ALL statuses so patient can see their bills
      // Show ALL claims so patient can see their bills - including locked/submitted
      const shouldInclude = true;

      if (shouldInclude) {
        // Calculate patient responsibility from EOB
        let patientOwe = claim.total_amount;

        // Try to get EOB data (synchronously)
        try {
          const EOBCalculationService = require('./services/eob-calculation-service');
          const eligibility = db.getEligibilityChecksByPatient(patientId)?.[0] || {};
          let claimDetails = {};
          if (claim.response_data) {
            try {
              claimDetails = typeof claim.response_data === 'string'
                ? JSON.parse(claim.response_data)
                : claim.response_data;
            } catch (e) {
              // Ignore parse errors
            }
          }

          const eob = EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails);
          if (eob.totals) {
            patientOwe = eob.totals.whatYouOwe || patientOwe;
          }
        } catch (e) {
          // Use claim total if EOB calculation fails
          console.warn('Could not calculate EOB for transaction:', e.message);
        }

        // Determine transaction description based on status
        let description = `Medical Service`;
        if (claim.service_code) {
          const serviceCodes = claim.service_code.split(',').slice(0, 2).join(', ');
          description = `Medical Service (${serviceCodes})`;
        }

        // Add status to description
        const statusText = claim.status === 'submitted' ? ' - Submitted' :
          claim.status === 'approved' || claim.payment_status === 'paid' ? ' - Approved' :
            claim.status === 'paid' ? ' - Paid' : '';
        description += statusText;

        if (filter === 'all' || filter === 'medical') {
          transactions.push({
            id: claim.id,
            type: 'medical',
            description: description,
            amount: -patientOwe,
            created_at: claim.paid_at || claim.approved_at || claim.submitted_at || claim.created_at,
            status: claim.payment_status || claim.status,
            claimId: claim.id,
            claimStatus: claim.status,
            paymentStatus: claim.payment_status
          });
        }
      }
    }

    // Sort by date (newest first)
    transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      success: true,
      transactions: transactions
    });
  } catch (error) {
    console.error('❌ Error getting patient wallet transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Patient Wallet - Pay claim using wallet balance
 * POST /api/patient/wallet/pay-claim
 */
app.post('/api/patient/wallet/pay-claim', async (req, res) => {
  try {
    const { claimId, patientId } = req.body;

    if (!claimId || !patientId) {
      return res.status(400).json({
        success: false,
        error: 'claimId and patientId are required'
      });
    }

    // Get claim
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({
        success: false,
        error: 'Claim not found'
      });
    }

    // Calculate patient responsibility from EOB
    let patientOwe = claim.total_amount;
    try {
      const EOBCalculationService = require('./services/eob-calculation-service');
      const eligibility = db.getEligibilityChecksByPatient(patientId)?.[0] || {};
      let claimDetails = {};
      if (claim.response_data) {
        try {
          claimDetails = typeof claim.response_data === 'string'
            ? JSON.parse(claim.response_data)
            : claim.response_data;
        } catch (e) {
          // Ignore parse errors
        }
      }

      const eob = EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails);
      if (eob.totals) {
        patientOwe = eob.totals.whatYouOwe || patientOwe;
      }
    } catch (e) {
      console.warn('Could not calculate EOB, using claim total:', e.message);
    }

    // Get patient wallet
    const account = db.getCircleAccountByEntity('patient', patientId);
    if (!account || !account.circle_wallet_id) {
      return res.status(404).json({
        success: false,
        error: 'Patient wallet not found. Please create a wallet first.'
      });
    }

    // Check wallet balance
    const balanceResult = await CircleService.getWalletBalance(account.circle_wallet_id);
    let currentBalance = 0;

    if (balanceResult.success && balanceResult.balances && balanceResult.balances.length > 0) {
      const usdcBalance = balanceResult.balances.find(b => b.token?.symbol === 'USDC') || balanceResult.balances[0];
      currentBalance = parseFloat(usdcBalance.amount || usdcBalance.balance || 0);
    }

    if (currentBalance < patientOwe) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. You have $${currentBalance.toFixed(2)}, but need $${patientOwe.toFixed(2)}`,
        currentBalance: currentBalance,
        required: patientOwe
      });
    }

    // Get provider wallet
    const providerAccount = db.getCircleAccountByEntity('provider', 'default');
    if (!providerAccount || !providerAccount.circle_wallet_id) {
      return res.status(500).json({
        success: false,
        error: 'Provider wallet not found'
      });
    }

    // Create transfer from patient to provider
    const transferResult = await CircleService.createTransfer({
      fromWalletId: account.circle_wallet_id,
      toWalletId: providerAccount.circle_wallet_id,
      amount: patientOwe,
      currency: 'USDC',
      claimId: claimId,
      description: `Payment for claim ${claimId}`
    });

    if (!transferResult.success) {
      return res.status(500).json({
        success: false,
        error: transferResult.error || 'Failed to process payment'
      });
    }

    // Record transfer
    const { v4: uuidv4 } = require('uuid');
    const transferId = `transfer_${uuidv4()}`;

    db.createCircleTransfer({
      id: transferId,
      claim_id: claimId,
      from_wallet_id: account.circle_wallet_id,
      to_wallet_id: providerAccount.circle_wallet_id,
      amount: patientOwe,
      currency: 'USDC',
      circle_transfer_id: transferResult.transferId,
      status: transferResult.status || 'pending'
    });

    // Update claim payment status
    db.updateInsuranceClaim(claimId, {
      payment_status: 'paid',
      payment_amount: patientOwe,
      paid_at: new Date().toISOString()
    });

    console.log(`✅ Patient ${patientId} paid $${patientOwe.toFixed(2)} for claim ${claimId}`);

    res.json({
      success: true,
      claimId: claimId,
      amount: patientOwe,
      transferId: transferResult.transferId,
      message: 'Payment processed successfully'
    });
  } catch (error) {
    console.error('❌ Error processing patient payment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Submit claim for payment (Provider submits claim to Insurer)
 * POST /api/claims/:claimId/submit-payment
 */
app.post('/api/claims/:claimId/submit-payment', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: 'Claim not found'
      });
    }

    // Check if claim is already submitted or approved
    if (claim.status === 'submitted' || claim.status === 'approved' || claim.status === 'paid') {
      return res.status(400).json({
        success: false,
        error: `Claim is already ${claim.status}. Cannot submit again.`
      });
    }

    // Update claim status to submitted (no wallet required)
    db.updateInsuranceClaim(claimId, {
      status: 'submitted',
      payment_status: 'pending',
      submitted_at: new Date().toISOString()
    });

    console.log(`✅ Claim ${claimId} submitted for payment approval`);

    res.json({
      success: true,
      claimId: claimId,
      message: 'Claim submitted for payment approval',
      status: 'submitted'
    });
  } catch (error) {
    console.error('❌ Error submitting claim for payment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Pre-adjudicate claim (real-time adjudication estimate)
 * GET /api/claims/:claimId/pre-adjudicate
 */
app.get('/api/claims/:claimId/pre-adjudicate', async (req, res) => {
  try {
    const AdjudicationService = require('./services/adjudication-service');
    const result = AdjudicationService.preAdjudicateClaim(req.params.claimId);
    if (!result.success) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('❌ Error pre-adjudicating claim:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get Proof of Care status for a claim
 * GET /api/claims/:claimId/proof-of-care
 */
app.get('/api/claims/:claimId/proof-of-care', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const ProofOfCareService = require('./services/proof-of-care-service');
    const poc = await ProofOfCareService.verifyProofOfCare(claim);

    res.json({
      success: true,
      claimId,
      proofOfCare: {
        verified: poc.verified,
        totalWeight: poc.totalWeight,
        evidence: poc.evidence,
        reason: poc.reason
      }
    });
  } catch (error) {
    console.error('❌ Error getting Proof of Care:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get EOB calculation audit trail for a claim (full transparency)
 * GET /api/claims/:claimId/eob-audit
 */
app.get('/api/claims/:claimId/eob-audit', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const audits = db.getEOBCalculationAuditsByClaim(claimId, 50);
    const parsed = audits.map(a => ({
      id: a.id,
      claimId: a.claim_id,
      triggeredBy: a.triggered_by,
      created_at: a.created_at,
      calculationInputs: typeof a.calculation_inputs === 'string' ? JSON.parse(a.calculation_inputs || '{}') : a.calculation_inputs,
      calculationOutputs: typeof a.calculation_outputs === 'string' ? JSON.parse(a.calculation_outputs || '{}') : a.calculation_outputs
    }));

    res.json({ success: true, claimId, audits: parsed });
  } catch (error) {
    console.error('❌ Error getting EOB audit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get settlement recommendation for a claim (auto-approve vs manual review)
 * GET /api/claims/:claimId/settlement-recommendation
 */
app.get('/api/claims/:claimId/settlement-recommendation', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    let claimDetails = {};
    if (claim.response_data) {
      try {
        claimDetails = typeof claim.response_data === 'string'
          ? JSON.parse(claim.response_data)
          : claim.response_data;
      } catch (e) {
        console.warn('Could not parse claim response_data:', e.message);
      }
    }

    let eligibility = null;
    if (claim.patient_id) {
      const checks = db.getEligibilityChecksByPatient(claim.patient_id) || [];
      eligibility = checks[0] || null;
    }

    const EOBCalculationService = require('./services/eob-calculation-service');
    let eobCalculation;
    try {
      eobCalculation = EOBCalculationService.calculateEOBFromClaim(
        claim,
        eligibility || {},
        claimDetails
      );
    } catch (error) {
      eobCalculation = {};
    }

    const SettlementRulesService = require('./services/settlement-rules-service');
    const evaluation = SettlementRulesService.evaluateSettlementRules({
      claim,
      claimDetails,
      eobCalculation,
      eligibility: eligibility || {}
    });

    res.json({
      success: true,
      claimId,
      recommendation: {
        action: evaluation.action,
        reason: evaluation.reason,
        matchedRuleId: evaluation.matchedRuleId
      },
      context: {
        codingConfidence: claimDetails?.coding?.codingConfidence ?? claimDetails?.pricing?.codingConfidence,
        codingBand: claimDetails?.coding?.band,
        amount: claim.total_amount,
        payerId: claim.payer_id
      }
    });
  } catch (error) {
    console.error('❌ Error getting settlement recommendation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Approve claim and process payment (Insurer approves and pays)
 * POST /api/claims/:claimId/approve-payment
 */
app.post('/api/claims/:claimId/approve-payment', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: 'Claim not found'
      });
    }

    // Check if claim is already approved or paid
    if (claim.status === 'approved' || claim.status === 'paid') {
      return res.status(400).json({
        success: false,
        error: `Claim is already ${claim.status}. Cannot approve again.`
      });
    }

    // Parse claim details to calculate EOB
    let claimDetails = {};
    if (claim.response_data) {
      try {
        claimDetails = typeof claim.response_data === 'string'
          ? JSON.parse(claim.response_data)
          : claim.response_data;
      } catch (e) {
        console.warn('Could not parse claim response_data:', e.message);
      }
    }

    // Get eligibility data to calculate EOB and update deductions
    let eligibility = null;
    if (claim.patient_id) {
      const eligibilityChecks = db.getEligibilityChecksByPatient(claim.patient_id) || [];
      eligibility = eligibilityChecks[0] || null;
    }

    // Calculate EOB to get deductible and payment amounts
    const EOBCalculationService = require('./services/eob-calculation-service');
    let eobCalculation;
    let deductibleUsed = 0;
    let planPaidAmount = 0;

    try {
      eobCalculation = EOBCalculationService.calculateEOBFromClaim(
        claim,
        eligibility || {},
        claimDetails
      );
      deductibleUsed = eobCalculation.totals?.deductible || 0;
      planPaidAmount = eobCalculation.totals?.planPaid || 0;

      // EOB transparency: persist full calculation breakdown and audit trail
      db.recordEOBCalculationAudit({
        claimId,
        calculationInputs: {
          claimId: claim.id,
          total_amount: claim.total_amount,
          service_code: claim.service_code,
          diagnosis_code: claim.diagnosis_code,
          eligibility: eligibility ? {
            copay_amount: eligibility.copay_amount,
            deductible_total: eligibility.deductible_total,
            deductible_remaining: eligibility.deductible_remaining,
            coinsurance_percent: eligibility.coinsurance_percent
          } : null,
          claimDetailsKeys: Object.keys(claimDetails || {})
        },
        calculationOutputs: eobCalculation,
        triggeredBy: 'approve-payment'
      });
    } catch (error) {
      console.error('Error calculating EOB:', error);
      // Fallback: use claim total amount
      planPaidAmount = claim.insurance_amount || claim.total_amount * 0.85;
    }

    // Update eligibility to reflect deductible used
    if (eligibility && deductibleUsed > 0) {
      const currentDeductibleRemaining = parseFloat(eligibility.deductible_remaining || eligibility.deductible_total || 0);
      const newDeductibleRemaining = Math.max(0, currentDeductibleRemaining - deductibleUsed);

      // Create a new eligibility check record with updated deductible (maintains audit trail)
      const { v4: uuidv4 } = require('uuid');
      const updatedEligibility = {
        id: `elig_${uuidv4()}`,
        patient_id: eligibility.patient_id,
        member_id: eligibility.member_id,
        payer_id: eligibility.payer_id,
        service_code: eligibility.service_code,
        date_of_service: eligibility.date_of_service || new Date().toISOString().split('T')[0],
        eligible: eligibility.eligible,
        copay_amount: eligibility.copay_amount,
        allowed_amount: eligibility.allowed_amount,
        insurance_pays: eligibility.insurance_pays,
        deductible_total: eligibility.deductible_total,
        deductible_remaining: newDeductibleRemaining,
        coinsurance_percent: eligibility.coinsurance_percent,
        plan_summary: eligibility.plan_summary,
        response_data: eligibility.response_data,
        created_at: new Date().toISOString()
      };

      // Create new eligibility record with updated deductible
      db.createEligibilityCheck(updatedEligibility);
      console.log(`📊 Created updated eligibility record: Deductible used: $${deductibleUsed.toFixed(2)}, Remaining: $${newDeductibleRemaining.toFixed(2)}`);
    }

    // Calculate payment amount (insurance pays amount)
    const paymentAmount = planPaidAmount || claim.insurance_amount || (claim.total_amount * 0.85);

    // Evaluate settlement rules (auto-approve vs manual review)
    const SettlementRulesService = require('./services/settlement-rules-service');
    const settlementEvaluation = SettlementRulesService.evaluateSettlementRules({
      claim,
      claimDetails,
      eobCalculation,
      eligibility: eligibility || {}
    });

    if (!SettlementRulesService.shouldAllowApproval(settlementEvaluation)) {
      return res.status(403).json({
        success: false,
        error: 'Settlement rules require manual review',
        settlementRecommendation: {
          action: settlementEvaluation.action,
          reason: settlementEvaluation.reason,
          matchedRuleId: settlementEvaluation.matchedRuleId
        },
        message: 'Claim does not meet auto-approve criteria. Manual review required (SETTLEMENT_STRICT_AUTO is enabled).'
      });
    }

    // Proof of Care: when PROOF_OF_CARE_REQUIRED=1, block approval until care is verified
    const ProofOfCareService = require('./services/proof-of-care-service');
    const poc = await ProofOfCareService.verifyProofOfCare(claim);
    if (process.env.PROOF_OF_CARE_REQUIRED === '1' || process.env.PROOF_OF_CARE_REQUIRED === 'true') {
      if (!poc.verified) {
        return res.status(403).json({
          success: false,
          error: 'Proof of Care required',
          proofOfCare: { verified: poc.verified, evidence: poc.evidence, reason: poc.reason },
          message: 'Care must be verified before approval (PROOF_OF_CARE_REQUIRED is enabled).'
        });
      }
    }

    // Instant Settlement: Execute 3-way split (Insurer → Escrow → Provider + Revenue)
    let settlementResult = null;
    let circleTransferId = null;
    const providerAccount = db.getCircleAccountByEntity('provider', 'default');
    const insurerAccount = db.getCircleAccountByEntity('insurer', claim.payer_id);

    if (providerAccount && insurerAccount && providerAccount.circle_wallet_id && insurerAccount.circle_wallet_id) {
      try {
        const InstantSettlementService = require('./services/instant-settlement-service');
        
        // Ensure platform wallets exist (create if missing)
        await InstantSettlementService.ensurePlatformWallets();
        
        // Execute instant settlement with 3-way split
        settlementResult = await InstantSettlementService.executeInstantSettlement({
          claimId: claimId,
          totalApproved: paymentAmount,
          insurerWalletId: insurerAccount.circle_wallet_id,
          providerWalletId: providerAccount.circle_wallet_id,
          description: `Settlement for claim ${claimId}`
        });

        if (settlementResult.success) {
          // Use the first transfer ID (insurer → escrow) as the primary transfer ID
          circleTransferId = settlementResult.transfers[0]?.circleTransferId || null;
          console.log(`💰 Instant settlement completed: ${settlementResult.transfers.length} transfers`);
          console.log(`   Provider received: $${settlementResult.providerAmount.toFixed(2)}`);
          console.log(`   Platform fee: $${settlementResult.revenueAmount.toFixed(2)} (${settlementResult.platformFeePercent}%)`);
        } else {
          console.warn(`⚠️  Instant settlement failed: ${settlementResult.error}`);
          // Fallback: Try direct transfer if instant settlement fails
          if (settlementResult.error?.includes('Platform escrow wallet not found')) {
            console.log('ℹ️  Falling back to direct transfer (platform wallets not set up)');
            const CircleService = require('./services/circle-service');
            const fallbackResult = await CircleService.createTransfer({
              fromWalletId: insurerAccount.circle_wallet_id,
              toWalletId: providerAccount.circle_wallet_id,
              amount: paymentAmount,
              currency: 'USDC',
              claimId: claimId,
              description: `Payment for claim ${claimId} (fallback - direct transfer)`
            });
            if (fallbackResult.success) {
              circleTransferId = fallbackResult.transferId;
              db.createCircleTransfer({
                id: `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                claim_id: claimId,
                from_wallet_id: insurerAccount.circle_wallet_id,
                to_wallet_id: providerAccount.circle_wallet_id,
                amount: paymentAmount,
                currency: 'USDC',
                circle_transfer_id: fallbackResult.transferId,
                status: fallbackResult.status || 'pending'
              });
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Circle transfer failed (continuing without it):', error.message);
      }
    } else {
      console.log('ℹ️  Circle wallets not found, skipping transfer (approval will still proceed)');
    }

    // Update claim's response_data with final EOB calculation
    // This ensures "What You Owe" is properly calculated and stored for approved claims
    let updatedResponseData = claimDetails;
    if (eobCalculation) {
      updatedResponseData = {
        ...claimDetails,
        eob: eobCalculation,
        approved: true,
        approved_at: new Date().toISOString(),
        // Store final amounts
        allowed_amount: eobCalculation.totals?.allowedAmount || claimDetails.allowed_amount,
        deductible_applied: eobCalculation.totals?.deductible || 0,
        copay_applied: eobCalculation.totals?.copay || 0,
        coinsurance_applied: eobCalculation.totals?.coinsurance || 0,
        amount_not_covered: eobCalculation.totals?.amountNotCovered || 0,
        what_you_owe: eobCalculation.totals?.whatYouOwe || 0,
        plan_paid: eobCalculation.totals?.planPaid || planPaidAmount,
        // Update pricing breakdown with final amounts if available
        pricing: claimDetails.pricing ? {
          ...claimDetails.pricing,
          total_billed: eobCalculation.totals?.amountBilled || claim.total_amount,
          total_allowed: eobCalculation.totals?.allowedAmount || claimDetails.allowed_amount,
          total_plan_paid: eobCalculation.totals?.planPaid || planPaidAmount,
          total_patient_owes: eobCalculation.totals?.whatYouOwe || 0
        } : null
      };
    }

    // Update claim with payment information and final EOB data
    db.updateInsuranceClaim(claimId, {
      status: 'approved',
      payment_status: 'paid',
      payment_amount: paymentAmount,
      insurance_amount: planPaidAmount, // Update insurance amount with calculated plan paid
      circle_transfer_id: circleTransferId || null,
      approved_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
      response_data: JSON.stringify(updatedResponseData) // Store final EOB calculation
    });

    console.log(`✅ Claim ${claimId} approved: Payment $${paymentAmount.toFixed(2)}, Deductible used: $${deductibleUsed.toFixed(2)}, Patient owes: $${(eobCalculation?.totals?.whatYouOwe || 0).toFixed(2)}`);

    // Record insurance payment to related invoices (split if instant settlement succeeded)
    if (planPaidAmount > 0) {
      const amountBilled = eobCalculation?.totals?.amountBilled || 0;
      const invoices = db.getInvoicesByClaim(claimId);
      // Add payment to first matching invoice (one claim typically has one invoice)
      const target = invoices.find(
        (inv) => amountBilled > 0 && inv.amount >= amountBilled * 0.99
      );
      if (target) {
        if (settlementResult && settlementResult.success) {
          // Record split payments: provider amount + platform fee
          db.addInvoicePayment({
            invoice_id: target.id,
            payment_date: new Date().toISOString().split('T')[0],
            amount: settlementResult.providerAmount,
            payment_method: 'insurance',
            reference_number: `claim-${claimId}`,
            notes: `Insurance payment - claim approved (provider portion: $${settlementResult.providerAmount.toFixed(2)})`
          });
          db.addInvoicePayment({
            invoice_id: target.id,
            payment_date: new Date().toISOString().split('T')[0],
            amount: settlementResult.revenueAmount,
            payment_method: 'platform_fee',
            reference_number: `claim-${claimId}-fee`,
            notes: `Platform fee (${settlementResult.platformFeePercent}%): $${settlementResult.revenueAmount.toFixed(2)}`
          });
          console.log(`📋 Recorded split payments: Provider $${settlementResult.providerAmount.toFixed(2)} + Platform Fee $${settlementResult.revenueAmount.toFixed(2)}`);
        } else {
          // Fallback: single payment entry (direct transfer or no Circle)
          db.addInvoicePayment({
            invoice_id: target.id,
            payment_date: new Date().toISOString().split('T')[0],
            amount: planPaidAmount,
            payment_method: 'insurance',
            reference_number: `claim-${claimId}`,
            notes: 'Insurance payment - claim approved'
          });
          console.log(`📋 Recorded insurance payment $${planPaidAmount.toFixed(2)} for invoice ${target.invoice_number}`);
        }
      }
    }

    // Escrow orchestration: include route when ESCROW_ENABLED
    let settlementRoute = { route: 'direct' };
    if (process.env.ESCROW_ENABLED === '1' || process.env.ESCROW_ENABLED === 'true') {
      const EscrowOrchestratorService = require('./services/escrow-orchestrator-service');
      settlementRoute = await EscrowOrchestratorService.getSettlementRoute({
        claim,
        claimDetails,
        eobCalculation,
        eligibility: eligibility || {}
      });
    }

    res.json({
      success: true,
      claimId: claimId,
      transferId: circleTransferId,
      amount: paymentAmount,
      deductibleUsed: deductibleUsed,
      status: 'approved',
      paymentStatus: 'paid',
      message: 'Claim approved and payment processed',
      settlementRecommendation: {
        action: settlementEvaluation.action,
        reason: settlementEvaluation.reason,
        matchedRuleId: settlementEvaluation.matchedRuleId
      },
      proofOfCare: poc ? { verified: poc.verified, evidence: poc.evidence } : undefined,
      settlementRoute: settlementRoute.route,
      instantSettlement: settlementResult ? {
        success: settlementResult.success,
        providerAmount: settlementResult.providerAmount,
        revenueAmount: settlementResult.revenueAmount,
        platformFeePercent: settlementResult.platformFeePercent,
        transfers: settlementResult.transfers,
        message: settlementResult.message
      } : undefined
    });
  } catch (error) {
    console.error('❌ Error approving claim payment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Recover Stuck Escrow (Admin Endpoint)
 * POST /api/admin/recover-stuck-escrow/:claimId
 * 
 * Manually trigger recovery for a stuck escrow settlement.
 * Finds settlement attempt where Transfer 1 completed but Transfer 2/3 failed,
 * then retries failed transfers using idempotency keys.
 */
app.post('/api/admin/recover-stuck-escrow/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    
    const EscrowRecoveryService = require('./services/escrow-recovery-service');
    const result = await EscrowRecoveryService.recoverStuckEscrow(claimId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Recovery failed',
        recovered: result.recovered || [],
        errors: result.errors || []
      });
    }
    
    res.json({
      success: true,
      claimId: claimId,
      message: result.message,
      recovered: result.recovered,
      errors: result.errors
    });
  } catch (error) {
    console.error('❌ Error recovering stuck escrow:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recover stuck escrow'
    });
  }
});

/**
 * Recover All Stuck Escrows (Admin/Scheduled Job Endpoint)
 * POST /api/admin/recover-all-stuck-escrows
 * 
 * Finds all stuck escrows (Transfer 1 completed, Transfer 2 not completed, older than 1 hour)
 * and attempts recovery for each.
 * 
 * Query params: ?olderThanHours=1 (default: 1)
 */
app.post('/api/admin/recover-all-stuck-escrows', async (req, res) => {
  try {
    const olderThanHours = parseFloat(req.query.olderThanHours || '1');
    
    const EscrowRecoveryService = require('./services/escrow-recovery-service');
    const result = await EscrowRecoveryService.recoverAllStuckEscrows(olderThanHours);
    
    res.json({
      success: true,
      found: result.found,
      recovered: result.recovered,
      errors: result.errors,
      message: `Found ${result.found} stuck escrows, recovered ${result.recovered}`
    });
  } catch (error) {
    console.error('❌ Error recovering all stuck escrows:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recover stuck escrows'
    });
  }
});

/**
 * Task 45: Escrow timeout check and provider notification
 * POST /api/admin/escrow-timeout-notify
 * Call from cron when ESCROW_NOTIFY_ON_TIMEOUT=1
 */
app.post('/api/admin/escrow-timeout-notify', async (req, res) => {
  try {
    const EscrowOrchestrator = require('./services/escrow-orchestrator-service');
    const result = await EscrowOrchestrator.checkEscrowTimeoutAndNotify(db);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Escrow timeout notify error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get Fee Schedule Freshness (Admin Endpoint)
 * GET /api/admin/fee-schedules/freshness?payerId=BCBS
 * 
 * Returns freshness summary for a payer's fee schedule.
 * Shows total rates, stale rates, oldest/newest update dates.
 */
app.get('/api/admin/fee-schedules/freshness', (req, res) => {
  try {
    const { payerId } = req.query;
    
    if (!payerId) {
      return res.status(400).json({
        success: false,
        error: 'payerId query parameter is required'
      });
    }
    
    const FeeScheduleService = require('./services/fee-schedule-service');
    const freshness = FeeScheduleService.getFeeScheduleFreshness(payerId);
    
    res.json({
      success: true,
      ...freshness
    });
  } catch (error) {
    console.error('❌ Error getting fee schedule freshness:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get fee schedule freshness'
    });
  }
});

/**
 * Get Stale Fee Schedules (Admin Endpoint)
 * GET /api/admin/fee-schedules/stale?payerId=BCBS&olderThanDays=90
 * 
 * Lists all stale fee schedule rates (older than threshold).
 */
app.get('/api/admin/fee-schedules/stale', (req, res) => {
  try {
    const { payerId, olderThanDays } = req.query;
    const days = olderThanDays ? parseFloat(olderThanDays) : null;
    
    const FeeScheduleService = require('./services/fee-schedule-service');
    const staleRates = FeeScheduleService.getStaleFeeSchedules(payerId || null, days);
    
    res.json({
      success: true,
      count: staleRates.length,
      staleRates: staleRates.map(rate => ({
        payer_id: rate.payer_id,
        cpt_code: rate.cpt_code,
        allowed_amount: rate.allowed_amount,
        updated_at: rate.updated_at,
        effective_date: rate.effective_date,
        days_old: rate.updated_at ? Math.floor((Date.now() - new Date(rate.updated_at).getTime()) / (24 * 60 * 60 * 1000)) : null
      }))
    });
  } catch (error) {
    console.error('❌ Error getting stale fee schedules:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get stale fee schedules'
    });
  }
});

/**
 * Mark Fee Schedule Refreshed (Admin Endpoint)
 * POST /api/admin/fee-schedules/mark-refreshed
 * 
 * Updates updated_at timestamp for fee schedule rates after refresh.
 * Body: { payerId: "BCBS", cptCodes: ["90837", "90834"] } (cptCodes optional)
 */
app.post('/api/admin/fee-schedules/mark-refreshed', (req, res) => {
  try {
    const { payerId, cptCodes } = req.body;
    
    if (!payerId) {
      return res.status(400).json({
        success: false,
        error: 'payerId is required'
      });
    }
    
    const FeeScheduleService = require('./services/fee-schedule-service');
    const updated = FeeScheduleService.markFeeScheduleRefreshed(payerId, cptCodes || []);
    
    res.json({
      success: true,
      payerId: payerId,
      updated: updated,
      message: `Marked ${updated} fee schedule rate(s) as refreshed`
    });
  } catch (error) {
    console.error('❌ Error marking fee schedule refreshed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to mark fee schedule refreshed'
    });
  }
});

/**
 * Simulate Stedi Approval (Testing Endpoint)
 * POST /api/test/simulate-stedi-approval
 * 
 * This endpoint simulates Stedi's claim approval webhook.
 * It updates the claim status to APPROVED and automatically triggers
 * the instant settlement flow (3-way split: Insurer → Escrow → Provider + Revenue).
 * 
 * Body: { "claimId": "CLAIM-12345" }
 */
app.post('/api/test/simulate-stedi-approval', async (req, res) => {
  try {
    const { claimId } = req.body;

    if (!claimId) {
      return res.status(400).json({
        success: false,
        error: 'claimId is required'
      });
    }

    // Debug: Check all claims to see what's in the database
    console.log(`🔍 Looking for claim: ${claimId}`);
    const allClaims = db.db.prepare('SELECT id, status, payment_status FROM insurance_claims LIMIT 10').all();
    console.log(`📋 Found ${allClaims.length} claims in database:`, allClaims.map(c => c.id));
    
    // Also check if the exact claim ID exists (case-insensitive)
    const exactMatch = db.db.prepare('SELECT id FROM insurance_claims WHERE id = ? COLLATE NOCASE').get(claimId);
    console.log(`🔍 Exact match (case-insensitive):`, exactMatch);
    
    // Check database path - get the actual file path
    try {
      const dbInfo = db.db.prepare('PRAGMA database_list').all();
      console.log(`📁 Database file(s):`, dbInfo);
    } catch (e) {
      console.log(`📁 Could not get database path:`, e.message);
    }

    // Get claim (let for reassignment when resetting approved claims for testing)
    let claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({
        success: false,
        error: `Claim ${claimId} not found`,
        debug: {
          totalClaims: allClaims.length,
          sampleClaimIds: allClaims.map(c => c.id)
        }
      });
    }

    // For testing: allow resetting approved claims back to submitted
    const isAlreadyApproved = claim.status === 'approved' && claim.payment_status === 'paid';
    
    if (isAlreadyApproved) {
      console.log(`🔄 Resetting claim ${claimId} from approved to submitted for testing...`);
      // Reset to submitted status for testing
      db.updateInsuranceClaim(claimId, {
        status: 'submitted',
        payment_status: 'pending',
        approved_at: null,
        paid_at: null,
        payment_amount: null,
        circle_transfer_id: null
      });
      // Reload the claim
      const resetClaim = db.getClaimById(claimId);
      if (resetClaim) {
        claim = resetClaim;
      }
    }

    console.log(`🎯 Simulating Stedi approval for claim ${claimId}...`);
    console.log(`   Current status: ${claim.status}, Payment status: ${claim.payment_status}`);

    // Update claim status to approved (simulating Stedi webhook)
    db.updateInsuranceClaim(claimId, {
      status: 'approved',
      approved_at: new Date().toISOString()
    });

    // Trigger the approve-payment endpoint via internal HTTP request
    const http = require('http');
    const port = process.env.PORT || 4000;
    const host = 'localhost';
    
    // Bug 11: Properly resolve/reject Promise so handler completes
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({});
      const options = {
        hostname: host,
        port: port,
        path: `/api/claims/${claimId}/approve-payment`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Authorization': req.headers.authorization || ''
        }
      };

      const approveReq = http.request(options, (approveRes) => {
        let data = '';
        approveRes.on('data', (chunk) => {
          data += chunk;
        });
        approveRes.on('end', () => {
          try {
            const approveData = JSON.parse(data);
            if (!approveData.success) {
              res.status(approveRes.statusCode || 500).json({
                success: false,
                error: `Failed to approve payment: ${approveData.error}`,
                claimId: claimId
              });
              return resolve();
            }

            res.json({
              success: true,
              message: `Stedi approval simulated - Claim ${claimId} approved and instant settlement triggered`,
              claimId: claimId,
              approval: approveData,
              simulation: {
                source: 'Stedi (simulated)',
                timestamp: new Date().toISOString()
              }
            });
            resolve();
          } catch (parseError) {
            res.status(500).json({
              success: false,
              error: `Failed to parse approve-payment response: ${parseError.message}`
            });
            resolve();
          }
        });
      });

      approveReq.on('error', (error) => {
        console.error('❌ Error calling approve-payment:', error);
        res.status(500).json({
          success: false,
          error: `Failed to trigger approve-payment: ${error.message}`
        });
        resolve();
      });

      approveReq.write(postData);
      approveReq.end();
    });

  } catch (error) {
    console.error('❌ Error simulating Stedi approval:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to simulate Stedi approval'
    });
  }
});

/**
 * Reject claim (Insurer rejects claim)
 * POST /api/claims/:claimId/reject
 */
app.post('/api/claims/:claimId/reject', async (req, res) => {
  try {
    const { claimId } = req.params;
    const { reason } = req.body || {};
    const claim = db.getClaimById(claimId);

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: 'Claim not found'
      });
    }

    if (claim.status === 'approved' || claim.status === 'paid') {
      return res.status(400).json({
        success: false,
        error: `Claim is already ${claim.status}. Cannot reject.`
      });
    }

    db.updateInsuranceClaim(claimId, {
      status: 'rejected',
      payment_status: 'rejected',
      response_data: (() => {
        let rd = {};
        try {
          rd = claim.response_data ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data) : {};
        } catch (_) {}
        rd.rejectedAt = new Date().toISOString();
        rd.rejectionReason = reason || 'Rejected by insurer';
        return JSON.stringify(rd);
      })()
    });

    console.log(`❌ Claim ${claimId} rejected`);

    res.json({
      success: true,
      claimId,
      status: 'rejected',
      message: 'Claim rejected'
    });
  } catch (error) {
    console.error('❌ Error rejecting claim:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Task 46: Provider coding review queue for held / low-confidence claims
 * GET /api/admin/claims/review-queue?limit=50
 */
app.get('/api/admin/claims/review-queue', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const raw = db.getClaimsForReviewQueue ? db.getClaimsForReviewQueue({ limit }) : [];
    const SettlementRulesService = require('./services/settlement-rules-service');
    const claims = raw.map(c => {
      let claimDetails = {};
      try {
        claimDetails = c.response_data ? (typeof c.response_data === 'string' ? JSON.parse(c.response_data) : c.response_data) : {};
      } catch (_) {}
      const codingConfidence = claimDetails?.coding?.codingConfidence ?? claimDetails?.pricing?.codingConfidence ?? null;
      const evaluation = SettlementRulesService.evaluateSettlementRules({
        claim: c,
        claimDetails,
        eobCalculation: {},
        eligibility: {}
      });
      return {
        ...c,
        codingConfidence,
        needsReview: evaluation.action === 'manual_review',
        evaluationReason: evaluation.reason
      };
    }).filter(c => c.needsReview || (c.codingConfidence != null && parseFloat(c.codingConfidence) < 0.75));
    res.json({ success: true, claims, count: claims.length });
  } catch (error) {
    console.error('❌ Review queue error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Task 47: Claim resubmission after rejection
 * POST /api/admin/claims/:claimId/resubmit
 */
app.post('/api/admin/claims/:claimId/resubmit', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    if (claim.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: `Claim must be rejected to resubmit. Current status: ${claim.status}`
      });
    }
    db.updateInsuranceClaim(claimId, {
      status: 'draft',
      payment_status: 'pending',
      response_data: (() => {
        let rd = {};
        try {
          rd = claim.response_data ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data) : {};
        } catch (_) {}
        delete rd.rejectedAt;
        delete rd.rejectionReason;
        rd.resubmittedAt = new Date().toISOString();
        return JSON.stringify(rd);
      })()
    });
    res.json({
      success: true,
      claimId,
      status: 'draft',
      message: 'Claim reset for resubmission. Call POST /voice/insurance/submit-claim with corrected data.'
    });
  } catch (error) {
    console.error('❌ Resubmit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Circle webhook handler
 * POST /api/circle/webhook
 */
app.post('/api/circle/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['circle-signature'];
    const payload = req.body.toString();

    // Verify webhook signature
    const isValid = CircleService.verifyWebhookSignature(signature, payload);
    if (!isValid) {
      console.warn('⚠️  Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(payload);
    console.log('🔔 Circle webhook received:', event.type);

    // Handle different webhook event types
    if (event.type === 'transfer.completed' || event.type === 'transfer.settlement_completed') {
      const transferId = event.data?.id || event.data?.transferId;

      // Find transfer in database
      const transfer = db.getCircleTransferByCircleId(transferId);
      if (transfer) {
        // Update transfer status
        db.updateCircleTransfer(transfer.id, {
          status: 'completed',
          completed_at: new Date().toISOString()
        });

        // Update claim status
        if (transfer.claim_id) {
          db.updateInsuranceClaim(transfer.claim_id, {
            status: 'paid',
            payment_status: 'completed',
            paid_at: new Date().toISOString()
          });

          console.log(`✅ Payment completed for claim ${transfer.claim_id}`);
        }
      }
    } else if (event.type === 'transfer.failed') {
      const transferId = event.data?.id || event.data?.transferId;
      const transfer = db.getCircleTransferByCircleId(transferId);

      if (transfer) {
        db.updateCircleTransfer(transfer.id, {
          status: 'failed',
          error_message: event.data?.error || 'Transfer failed'
        });

        if (transfer.claim_id) {
          db.updateInsuranceClaim(transfer.claim_id, {
            payment_status: 'failed'
          });
        }
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Error processing Circle webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get claims for an appointment
 * GET /api/admin/insurance/claims?appointment_id=xxx
 */
app.get('/api/admin/insurance/claims', async (req, res) => {
  try {
    const filters = {};

    if (req.query.appointment_id) {
      filters.appointment_id = req.query.appointment_id;
    }

    if (req.query.patient_id) {
      filters.patient_id = req.query.patient_id;
    }

    if (req.query.status) {
      filters.status = req.query.status;
    }

    let claims = db.getAllClaims(filters);

    // Always return ALL claims including approved/paid so insurer can see them again
    // Don't filter out approved claims - user needs to see them
    claims = claims || [];

    res.json({
      success: true,
      claims,
      count: claims.length
    });
  } catch (error) {
    console.error('❌ Error fetching claims:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Fetch insurance payers from Stedi
 * GET /api/admin/insurance/payers?search=xxx&limit=100
 */
app.get('/api/admin/insurance/payers', async (req, res) => {
  try {
    const search = req.query.search || null;
    const limit = parseInt(req.query.limit) || 100;
    const transactionType = req.query.transaction_type || null;

    const options = {};
    if (search) options.search = search;
    if (limit) options.limit = limit;
    if (transactionType) options.transactionType = transactionType;

    const result = await InsuranceService.fetchPayers(options);

    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching payers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Search for a specific payer (uses cache service)
 * GET /api/admin/insurance/payers/search?q=blue+cross
 */
app.get('/api/admin/insurance/payers/search', async (req, res) => {
  try {
    const searchTerm = req.query.q || req.query.search;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: q or search'
      });
    }

    // Use cache service to minimize API calls
    const result = await PayerCacheService.searchPayer(searchTerm);

    res.json(result);
  } catch (error) {
    console.error('❌ Error searching payers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync payer list from Stedi (background job)
 * POST /api/admin/insurance/sync-payers?limit=1000
 */
app.post('/api/admin/insurance/sync-payers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;

    const result = await PayerCacheService.syncPayerList(limit);

    res.json(result);
  } catch (error) {
    console.error('❌ Error syncing payers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get payer cache statistics
 * GET /api/admin/insurance/payers/stats
 */
app.get('/api/admin/insurance/payers/stats', async (req, res) => {
  try {
    const stats = PayerCacheService.getCacheStats();

    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Fee schedule API – list by payer
 * GET /api/admin/fee-schedules?payerId=BCBS
 */
app.get('/api/admin/fee-schedules', async (req, res) => {
  try {
    const payerId = req.query.payerId;
    if (!payerId) {
      return res.status(400).json({ success: false, error: 'payerId query parameter required' });
    }
    const rows = db.getFeeSchedulesByPayer?.(payerId, 500) || [];
    res.json({ success: true, payerId, feeSchedules: rows, count: rows.length });
  } catch (error) {
    console.error('❌ Error listing fee schedules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Fee schedule API – add/upsert single
 * POST /api/admin/fee-schedules
 * Body: { payer_id, cpt_code, allowed_amount [, in_network, effective_date, end_date, source ] }
 */
app.post('/api/admin/fee-schedules', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.payer_id || !body.cpt_code || body.allowed_amount == null) {
      return res.status(400).json({
        success: false,
        error: 'payer_id, cpt_code, and allowed_amount are required'
      });
    }
    const id = db.upsertFeeSchedule?.(body);
    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('❌ Error upserting fee schedule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Fee schedule API – bulk upload
 * POST /api/admin/fee-schedules/bulk
 * Body: { items: [ { payer_id, cpt_code, allowed_amount [, in_network, effective_date, source ] }, ... ] }
 */
app.post('/api/admin/fee-schedules/bulk', async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : body;
    if (!items.length) {
      return res.status(400).json({
        success: false,
        error: 'items array required with payer_id, cpt_code, allowed_amount'
      });
    }
    const result = db.bulkUpsertFeeSchedules?.(items) || { inserted: 0 };
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Error bulk upserting fee schedules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Metrics endpoint (basic observability + LLM aggregates)
app.get('/api/admin/metrics', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const inMemory = Metrics.getAll();
    let llmAggregates = null;
    let cacheStats = null;
    try {
      if (typeof db.getLlmUsageAggregates === 'function') {
        llmAggregates = db.getLlmUsageAggregates(days);
      }
    } catch (e) { /* ignore */ }
    try {
      const cacheService = require('./services/cache-service');
      cacheStats = cacheService.getStats();
    } catch (e) { /* ignore */ }
    let postgresSyncRetry = null;
    try {
      if (typeof db.getRetryQueueDepth === 'function') {
        postgresSyncRetry = {
          retry_queue_depth: db.getRetryQueueDepth(),
          dlq_size: db.getDLQSize()
        };
      }
    } catch (e) { /* ignore */ }
    let circuitBreaker = null;
    try {
      const cb = require('./utils/circuit-breaker');
      if (typeof cb.getMetrics === 'function') {
        circuitBreaker = cb.getMetrics();
      }
    } catch (e) { /* ignore */ }
    let tokenBudget = null;
    try {
      const tb = require('./utils/token-budget');
      if (typeof tb.getConfig === 'function') {
        tokenBudget = tb.getConfig();
      }
    } catch (e) { /* ignore */ }
    let latencyBudget = null;
    try {
      const lb = require('./config/latency-budget');
      if (typeof lb.getViolationCount === 'function') {
        latencyBudget = { violations: lb.getViolationCount() };
      }
    } catch (e) { /* ignore */ }
    let clinicRateLimit = null;
    try {
      const crl = require('./utils/clinic-rate-limiter');
      if (typeof crl.getConfig === 'function') {
        clinicRateLimit = crl.getConfig();
      }
    } catch (e) { /* ignore */ }
    let dlqToolCalls = null;
    try {
      if (typeof db.getDlqToolCallsSize === 'function') {
        dlqToolCalls = { size: db.getDlqToolCallsSize() };
      }
    } catch (e) { /* ignore */ }
    let checkoutPolicy = {
      forbidden_payment_ready_phrase_count: 0,
      stale_checkout_prepared_count: 0,
      in_progress_after_confirmed_count: 0,
      alerts: [],
      threshold_15m: 0,
      status: 'ok'
    };
    try {
      const rows = typeof db.getOpsCounters === 'function' ? db.getOpsCounters(0.25) : [];
      const violationCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_forbidden_payment_ready_phrase')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const repeatedInProgressAfterConfirmed = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_in_progress_after_confirmed')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const duplicateOtpPromptCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_duplicate_otp_prompt')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const shippingReaskAfterCaptureCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_shipping_reask_after_capture')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const resumeRequiredCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_resume_required')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const productSwitchResetCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_product_switch_reset')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const stagePreparedTransitions = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_stage_transition_checkout_prepared')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const stageConfirmedTransitions = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_stage_transition_payment_confirmed')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const stageFailedTransitions = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_stage_transition_failed')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      let stalePreparedCount = 0;
      try {
        const staleRows = db.db.prepare(`
          SELECT COUNT(*) AS n
          FROM kelly_session_meta_kv s
          WHERE s.meta_key = 'checkout_stage'
            AND s.value = 'checkout_prepared'
            AND EXISTS (
              SELECT 1 FROM kelly_session_meta_kv t
              WHERE t.session_id = s.session_id
                AND t.meta_key = 'checkout_stage_updated_at_ms'
                AND CAST(t.value AS INTEGER) > 0
                AND CAST(t.value AS INTEGER) < ?
            )
        `).get(Date.now() - CHECKOUT_PREPARED_STALE_MS);
        stalePreparedCount = parseInt(String(staleRows?.n || '0'), 10) || 0;
      } catch (_) {}
      const alerts = [];
      if (violationCount > 0) {
        alerts.push({
          alert: 'checkout_forbidden_payment_ready_phrase',
          count: violationCount,
          severity: 'high',
          message:
            `${violationCount} reply(s) violated stage policy and were replaced with canonical templates. Investigate phrasing drift paths.`,
          action: 'Review [checkout-stage] policy_violation_replaced logs.'
        });
      }
      if (stalePreparedCount > 0) {
        alerts.push({
          alert: 'checkout_prepared_stale_sessions',
          count: stalePreparedCount,
          severity: 'high',
          message: `${stalePreparedCount} checkout_prepared session(s) are stale beyond threshold.`,
          action: 'Review reconciliation DLQ and stale checkout recovery.'
        });
      }
      if (repeatedInProgressAfterConfirmed > 0) {
        alerts.push({
          alert: 'checkout_in_progress_after_confirmed',
          count: repeatedInProgressAfterConfirmed,
          severity: 'medium',
          message: `${repeatedInProgressAfterConfirmed} response(s) mentioned in-progress after confirmed payment.`,
          action: 'Validate payment-status sync and copy mapping.'
        });
      }
      if (duplicateOtpPromptCount > 0) {
        alerts.push({
          alert: 'checkout_duplicate_otp_prompt',
          count: duplicateOtpPromptCount,
          severity: 'medium',
          message: `${duplicateOtpPromptCount} response(s) attempted to re-prompt OTP after verified stage.`,
          action: 'Review deterministic stage copy and fallback paths.'
        });
      }
      if (shippingReaskAfterCaptureCount > 0) {
        alerts.push({
          alert: 'checkout_shipping_reask_after_capture',
          count: shippingReaskAfterCaptureCount,
          severity: 'medium',
          message: `${shippingReaskAfterCaptureCount} response(s) asked for shipping after shipping was already captured.`,
          action: 'Review shipping persistence and stage-contract reply mapping.'
        });
      }
      checkoutPolicy = {
        forbidden_payment_ready_phrase_count: violationCount,
        stale_checkout_prepared_count: stalePreparedCount,
        in_progress_after_confirmed_count: repeatedInProgressAfterConfirmed,
        duplicate_otp_prompt_count: duplicateOtpPromptCount,
        shipping_reask_after_capture_count: shippingReaskAfterCaptureCount,
        resume_required_count: resumeRequiredCount,
        product_switch_reset_count: productSwitchResetCount,
        prepared_transition_count: stagePreparedTransitions,
        confirmed_transition_count: stageConfirmedTransitions,
        failed_transition_count: stageFailedTransitions,
        conversion_confirmed_over_prepared:
          stagePreparedTransitions > 0 ? Number((stageConfirmedTransitions / stagePreparedTransitions).toFixed(4)) : 0,
        alerts,
        threshold_15m: 0,
        slo_targets: {
          mount_failure_rate_max: 0.05,
          prepare_block_rate_max: 0.2,
          confirm_to_receipt_latency_ms_p95_max: 120000
        },
        status: alerts.length > 0 ? 'alert' : 'ok'
      };
    } catch (_) {}
    return res.json({
      success: true,
      metrics: inMemory,
      checkout_policy: checkoutPolicy,
      llm: llmAggregates,
      cache: cacheStats,
      postgres_sync_retry: postgresSyncRetry,
      circuit_breaker: circuitBreaker,
      token_budget: tokenBudget,
      latency_budget_violations: latencyBudget?.violations ?? 0,
      clinic_rate_limit: clinicRateLimit,
      dlq_tool_calls: dlqToolCalls,
      days
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Call dashboard (Section 1 - call volume, state transitions, tool usage, error rates)
app.get('/api/admin/dashboards/calls', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

    const voiceCalls = db.db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status != 'completed' AND status IS NOT NULL THEN 1 ELSE 0 END) as failed
      FROM voice_call_log WHERE created_at >= ?
    `).get(cutoffStr);

    const functionCalls = db.db.prepare(`
      SELECT function_name, COUNT(*) as count, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
      FROM function_call_log WHERE created_at >= ?
      GROUP BY function_name
    `).all(cutoffStr);

    const stateTransitions = db.db.prepare(`
      SELECT current_stage, COUNT(*) as count FROM voice_call_states
      WHERE updated_at >= ? GROUP BY current_stage
    `).all(cutoffStr);

    const codingDecisions = db.db.prepare(`
      SELECT COUNT(*) as total FROM coding_decisions WHERE created_at >= ?
    `).get(cutoffStr);

    const errorRate = voiceCalls?.total > 0
      ? Math.round(((voiceCalls.failed || 0) / voiceCalls.total) * 10000) / 100
      : 0;

    return res.json({
      success: true,
      days,
      voice_calls: { total: voiceCalls?.total ?? 0, completed: voiceCalls?.completed ?? 0, failed: voiceCalls?.failed ?? 0, error_rate_pct: errorRate },
      tool_usage: functionCalls,
      state_distribution: stateTransitions,
      coding_decisions: codingDecisions?.total ?? 0,
      dlq_tool_calls_size: typeof db.getDlqToolCallsSize === 'function' ? db.getDlqToolCallsSize() : 0
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// DLQ tool calls list (for audit/retry)
app.get('/api/admin/dlq-tool-calls', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = typeof db.getDlqToolCalls === 'function' ? db.getDlqToolCalls(limit) : [];
    const size = typeof db.getDlqToolCallsSize === 'function' ? db.getDlqToolCallsSize() : 0;
    return res.json({ success: true, items, total: size });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Cache stats for medical coding lookups (Phase 3.3)
app.get('/api/admin/cache-stats', async (req, res) => {
  try {
    const cacheService = require('./services/cache-service');
    const stats = cacheService.getStats();
    const hitRate = stats.hits + stats.misses > 0
      ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
      : 0;
    return res.json({ success: true, cache: { ...stats, hitRatePercent: hitRate } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Clear medical coding cache (e.g. after fee schedule or rule updates)
app.post('/api/admin/cache/clear', async (req, res) => {
  try {
    const cacheService = require('./services/cache-service');
    const bucket = req.query.bucket; // optional: code_lookup, payer_guidelines, payer_pricing, coding_rules
    cacheService.clear(bucket);
    return res.json({ success: true, cleared: bucket || 'all' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Feature flags (Section 15) - list and toggle
app.get('/api/admin/feature-flags', (req, res) => {
  try {
    const ff = require('./config/feature-flags');
    return res.json({ success: true, flags: ff.getAll() });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/api/admin/feature-flags', express.json(), async (req, res) => {
  try {
    const { flag_name, enabled_globally, enabled_for_clinic_ids, rollout_pct } = req.body || {};
    if (!flag_name) return res.status(400).json({ success: false, error: 'flag_name required' });
    db.db.prepare(`
      INSERT INTO feature_flags (flag_name, enabled_globally, enabled_for_clinic_ids, rollout_pct, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(flag_name) DO UPDATE SET
        enabled_globally = COALESCE(excluded.enabled_globally, feature_flags.enabled_globally),
        enabled_for_clinic_ids = COALESCE(excluded.enabled_for_clinic_ids, feature_flags.enabled_for_clinic_ids),
        rollout_pct = COALESCE(excluded.rollout_pct, feature_flags.rollout_pct),
        updated_at = datetime('now')
    `).run(flag_name, enabled_globally ? 1 : 0, typeof enabled_for_clinic_ids === 'string' ? enabled_for_clinic_ids : JSON.stringify(enabled_for_clinic_ids || null), rollout_pct ?? 100);
    return res.json({ success: true, flag_name });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Patient merge events review
app.get('/api/admin/patient-merge-events', async (req, res) => {
  try {
    const events = db.getRecentPatientMergeEvents ? db.getRecentPatientMergeEvents(100) : [];
    return res.json({ success: true, events });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/patient-merge-events/:id/review', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ success: false, error: 'id required' });
    }
    if (db.markPatientMergeEventReviewed) {
      const reviewer = req.admin && req.admin.email ? req.admin.email : 'admin';
      db.markPatientMergeEventReviewed(id, reviewer);
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Get patient insurance records
app.get('/api/admin/patients/:id/insurance', async (req, res) => {
  try {
    const patientId = req.params.id;
    const insurance = db.getAllPatientInsurance(patientId) || [];
    return res.json({ success: true, patientId, insurance });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent eligibility checks for a patient
app.get('/api/admin/patients/:id/eligibility', async (req, res) => {
  try {
    const patientId = req.params.id;
    let rows = db.getEligibilityChecksByPatient(patientId) || [];

    // Fallback: if no eligibility_checks, use patient_insurance (same source as patient portal)
    if (rows.length === 0) {
      const insuranceList = db.getAllPatientInsurance && db.getAllPatientInsurance(patientId);
      const primary = insuranceList && (insuranceList.find(i => i.is_primary) || insuranceList[0]);
      if (primary) {
        const payer = db.getPayerByPayerId(primary.payer_id);
        const payer_name = payer ? payer.payer_name : (primary.payer_name || primary.payer_id);
        rows = [{
          id: null,
          date_of_service: null,
          eligible: true,
          copay_amount: null,
          allowed_amount: null,
          insurance_pays: null,
          deductible_total: null,
          deductible_remaining: null,
          coinsurance_percent: null,
          plan_summary: primary.plan_name || 'Insurance on file',
          payer_id: primary.payer_id,
          payer_name,
          member_id: primary.member_id,
          service_code: null,
          created_at: null
        }];
      }
    }

    // Provide a compact view
    const elig = rows.map(r => {
      let payer_name = null;
      if (r.payer_id) {
        const payer = db.getPayerByPayerId(r.payer_id);
        payer_name = payer ? payer.payer_name : null;
      }
      return {
        id: r.id,
        date_of_service: r.date_of_service,
        eligible: !!r.eligible,
        copay_amount: r.copay_amount,
        allowed_amount: r.allowed_amount,
        insurance_pays: r.insurance_pays,
        deductible_total: r.deductible_total,
        deductible_remaining: r.deductible_remaining,
        coinsurance_percent: r.coinsurance_percent,
        plan_summary: r.plan_summary,
        payer_id: r.payer_id,
        payer_name: payer_name || r.payer_name || r.payer_id,
        member_id: r.member_id,
        service_code: r.service_code,
        created_at: r.created_at
      };
    });
    return res.json({ success: true, patientId, eligibility: elig, count: elig.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Restore Stedi patient data from eligibility_checks
app.post('/api/admin/patients/restore-stedi', async (req, res) => {
  try {
    // Use the new syncPatientsFromStedi method from FHIRService
    const result = await FHIRService.syncPatientsFromStedi();

    return res.json({
      success: true,
      message: 'Stedi patient data restoration complete',
      result
    });
  } catch (error) {
    console.error('❌ Error restoring Stedi patients:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync patients from Stedi (alternative endpoint)
/**
 * Update patient name
 * PUT /api/admin/patients/:patientId/name
 */
app.put('/api/admin/patients/:patientId/name', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { family, given } = req.body;

    if (!family || !given || !Array.isArray(given)) {
      return res.status(400).json({
        success: false,
        error: 'family and given (array) are required'
      });
    }

    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    const resource = typeof patient.resource_data === 'string'
      ? JSON.parse(patient.resource_data)
      : patient.resource_data;

    const oldName = resource.name?.[0]
      ? `${(resource.name[0].given || []).join(' ')} ${resource.name[0].family || ''}`.trim()
      : 'Unknown';

    // Update name
    if (!resource.name || !resource.name[0]) {
      resource.name = [{}];
    }
    resource.name[0].family = family;
    resource.name[0].given = given;
    resource.name[0].use = 'official';

    const result = db.updateFHIRPatient(patientId, resource);

    if (result && result.changes > 0) {
      const newName = `${given.join(' ')} ${family}`.trim();

      // Update appointments
      const appointments = db.getAllAppointments({}).filter(a => a.patient_id === patientId);
      appointments.forEach(appt => {
        db.updateAppointment(appt.id, { patient_name: newName });
      });

      console.log(`✅ Updated patient name: ${oldName} → ${newName}`);

      res.json({
        success: true,
        patientId,
        oldName,
        newName,
        appointmentsUpdated: appointments.length
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'No changes made'
      });
    }
  } catch (error) {
    console.error('❌ Error updating patient name:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/patients/sync-stedi', async (req, res) => {
  try {
    const result = await FHIRService.syncPatientsFromStedi();

    return res.json({
      success: true,
      message: `Synced ${result.created} new patients, linked ${result.linked} eligibility checks`,
      result
    });
  } catch (error) {
    console.error('❌ Error syncing patients from Stedi:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient-facing: Get all insurance cards for a patient
app.get('/api/patient/insurance', async (req, res) => {
  try {
    const { patientId } = req.query;

    if (!patientId) {
      return res.status(400).json({ success: false, error: 'Patient ID required' });
    }

    const insurance = db.getAllPatientInsurance(patientId) || [];

    return res.json({
      success: true,
      patientId,
      insurance,
      count: insurance.length
    });
  } catch (error) {
    console.error('Error fetching patient insurance:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Patient: Update insurance (onboarding)
app.put('/api/patient/insurance', apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'x-session-id required' });
    }

    const { payer_name, payer_id, member_id, plan_name } = req.body || {};
    if (!member_id && !payer_name && !payer_id) {
      return res.status(400).json({ success: false, error: 'At least payer or member_id required' });
    }

    // Resolve patient via profile API
    const profileResult = PatientPortalService.getPatientProfile(sessionId);
    if (!profileResult.success) {
      return res.status(401).json({ success: false, error: 'Invalid session or patient not found' });
    }

    // We need the FHIR patient_id; get from underlying db using email/phone again
    const sessionValidation = PatientPortalService.validateSession(sessionId);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    let patient = null;
    if (sessionValidation.email) {
      patient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (!patient && sessionValidation.phone) {
      patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found for insurance update' });
    }
    const patientId = patient.resource_id;

    // Resolve payer_id if missing
    let finalPayerId = payer_id || null;
    if (!finalPayerId && payer_name && PayerCacheService && PayerCacheService.searchPayer) {
      try {
        const payerMatch = await PayerCacheService.searchPayer(payer_name);
        if (payerMatch && payerMatch.payer_id) {
          finalPayerId = payerMatch.payer_id;
        }
      } catch (e) {
        console.warn('⚠️  Failed to search payer by name:', e.message);
      }
    }

    // Upsert patient_insurance
    try {
      if (db.upsertPatientInsurance) {
        db.upsertPatientInsurance({
          patient_id: patientId,
          payer_id: finalPayerId,
          payer_name,
          member_id,
          plan_name,
          is_primary: 1
        });
      } else {
        db.db.prepare(`
          INSERT INTO patient_insurance (patient_id, payer_id, payer_name, member_id, plan_name, is_primary)
          VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT(patient_id, payer_id, member_id) DO UPDATE SET
            payer_name = excluded.payer_name,
            plan_name = excluded.plan_name,
            is_primary = 1
        `).run(patientId, finalPayerId, payer_name || null, member_id || null, plan_name || null);
      }
    } catch (e) {
      console.error('❌ Failed to upsert patient_insurance:', e.message);
      return res.status(500).json({ success: false, error: 'Failed to update insurance' });
    }

    // Optionally: re-run eligibility if we have payer + member
    if (finalPayerId && member_id) {
      try {
        await InsuranceService.checkEligibility({
          patientId,
          memberId: member_id,
          payerId: finalPayerId
          // additional fields (serviceCode, dateOfService) can be added later
        });
      } catch (e) {
        console.warn('⚠️  Eligibility re-check failed during insurance update:', e.message);
      }
    }

    // Mark insurance_verified on fhir_patients
    try {
      db.db.prepare(`
        UPDATE fhir_patients
        SET insurance_verified = 1,
            insurance_verified_at = datetime('now')
        WHERE resource_id = ?
      `).run(patientId);
    } catch (_) {}

    return res.json({ success: true, patient_id: patientId });
  } catch (error) {
    console.error('❌ Error updating patient insurance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get EOB (Explanation of Benefits) data for a patient
app.get('/api/admin/patients/:id/eob', async (req, res) => {
  try {
    const patientId = req.params.id;

    // Get patient info
    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    // getFHIRPatient already parses JSON, so resource_data is already an object
    const patientData = patient.resource_data || {};
    const name = patientData.name?.[0];
    const patientName = name ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim() : 'Unknown';

    // Get claims for this patient FIRST (needed for member_id lookup)
    const claims = db.getClaimsByPatient(patientId) || [];

    // Get eligibility data
    // PRIORITY: Get eligibility with deductible information (same logic as /api/patient/benefits)
    let eligibility = db.getEligibilityChecksByPatient(patientId) || [];

    // If no eligibility found by patient_id, try to find by member_id from claims
    if (eligibility.length === 0 && claims.length > 0 && claims[0].member_id) {
      const memberId = claims[0].member_id;
      console.log(`   ℹ️  No eligibility found by patient_id, searching by member_id: ${memberId}`);
      const eligibilityByMember = db.db.prepare(`
        SELECT * FROM eligibility_checks
        WHERE member_id = ?
        ORDER BY deductible_total DESC NULLS LAST, created_at DESC
      `).all(memberId);

      if (eligibilityByMember && eligibilityByMember.length > 0) {
        eligibility = eligibilityByMember;
        console.log(`   ✅ Found ${eligibility.length} eligibility record(s) by member_id`);
      }
    }

    // Find the best eligibility record (one with deductible info, or most recent)
    let latestEligibility = null;

    // First, try to find one with complete deductible information
    const eligibilityWithDeductible = eligibility.find(e =>
      e.deductible_total !== null && e.deductible_total !== undefined
    );

    if (eligibilityWithDeductible) {
      latestEligibility = eligibilityWithDeductible;
      console.log(`   ✅ Using eligibility record with deductible: $${latestEligibility.deductible_total} total, $${latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : 0} remaining`);
    } else if (eligibility.length > 0) {
      // Fallback to most recent eligibility check
      latestEligibility = eligibility[0];
      console.log(`   ⚠️  Using most recent eligibility record (no deductible info): ${latestEligibility.id}`);

      // Try to find eligibility by member_id from claims if no deductible info
      if (claims.length > 0 && claims[0].member_id) {
        const memberId = claims[0].member_id;
        console.log(`   ℹ️  Searching for eligibility with deductible by member_id: ${memberId}`);
        const eligibilityByMemberWithDeductible = db.db.prepare(`
          SELECT * FROM eligibility_checks
          WHERE member_id = ? 
            AND deductible_total IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        `).get(memberId);

        if (eligibilityByMemberWithDeductible) {
          latestEligibility = eligibilityByMemberWithDeductible;
          console.log(`   ✅ Found eligibility record with deductible by member_id: $${latestEligibility.deductible_total} total, $${latestEligibility.deductible_remaining || 0} remaining`);

          // Link this eligibility to the current patient if it's not already linked
          if (!latestEligibility.patient_id || latestEligibility.patient_id !== patientId) {
            try {
              db.db.prepare(`
                UPDATE eligibility_checks 
                SET patient_id = ?
                WHERE id = ?
              `).run(patientId, latestEligibility.id);
              console.log(`   ✅ Linked eligibility record ${latestEligibility.id} to patient ${patientId}`);
              latestEligibility.patient_id = patientId;
            } catch (updateError) {
              console.warn(`   ⚠️  Could not link eligibility record: ${updateError.message}`);
            }
          }
        }
      }
    } else {
      console.log('   ℹ️  No eligibility data found for patient');

      // Last resort: try to find eligibility by member_id from claims
      if (claims.length > 0 && claims[0].member_id) {
        const memberId = claims[0].member_id;
        console.log(`   ℹ️  Last resort: searching for eligibility by member_id: ${memberId}`);
        const anyEligibility = db.db.prepare(`
          SELECT * FROM eligibility_checks
          WHERE member_id = ?
          ORDER BY deductible_total DESC NULLS LAST, created_at DESC
          LIMIT 1
        `).get(memberId);

        if (anyEligibility) {
          latestEligibility = anyEligibility;
          console.log(`   ✅ Found eligibility record by member_id: $${latestEligibility.deductible_total || 'N/A'} total, $${latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : 'N/A'} remaining`);

          // Link this eligibility to the current patient if it's not already linked
          if (!latestEligibility.patient_id || latestEligibility.patient_id !== patientId) {
            try {
              db.db.prepare(`
                UPDATE eligibility_checks 
                SET patient_id = ?
                WHERE id = ?
              `).run(patientId, latestEligibility.id);
              console.log(`   ✅ Linked eligibility record ${latestEligibility.id} to patient ${patientId}`);
              latestEligibility.patient_id = patientId;
            } catch (updateError) {
              console.warn(`   ⚠️  Could not link eligibility record: ${updateError.message}`);
            }
          }
        }
      }
    }

    // Get appointments for this patient
    const appointments = db.getAllAppointments({}).filter(a => a.patient_id === patientId);

    // Build EOB data combining claims, eligibility, and appointments
    const eobServices = [];

    for (const claim of claims) {
      // Parse response data to get detailed breakdown
      let responseData = {};
      try {
        if (claim.response_data) {
          responseData = typeof claim.response_data === 'string'
            ? JSON.parse(claim.response_data)
            : claim.response_data;
        }
      } catch (e) {
        console.warn('Failed to parse claim response_data:', e);
      }

      // Get appointment if linked
      const appointment = claim.appointment_id
        ? appointments.find(a => a.id === claim.appointment_id)
        : null;

      // Calculate EOB fields - Match the approved claim numbers from EOB image
      // Approved claim shows: $1800 billed, $200 allowed, $200 plan paid, $35 copay, $165 deductible, $1600 not covered, $1800 patient owes
      const amountBilled = claim.total_amount || 0;

      // Get allowed amount from eligibility data (REAL DATA, NO STATIC VALUES)
      // Priority: eligibility data > claim data > calculated
      let allowedAmount = 0;
      if (latestEligibility?.allowed_amount && latestEligibility.allowed_amount > 0) {
        // Use actual allowed amount from eligibility check
        allowedAmount = latestEligibility.allowed_amount;
      } else if (responseData.pricing && responseData.pricing.breakdown && responseData.pricing.breakdown.length > 0) {
        // Sum allowed amounts from pricing breakdown
        allowedAmount = responseData.pricing.breakdown.reduce((sum, item) =>
          sum + (parseFloat(item.allowed_amount) || 0), 0
        );
      } else if (responseData.allowed_amount) {
        allowedAmount = parseFloat(responseData.allowed_amount);
      } else if (claim.insurance_amount && claim.insurance_amount > 0) {
        // Use insurance amount from claim
        allowedAmount = claim.insurance_amount;
      } else if (amountBilled > 0) {
        // Calculate based on eligibility coinsurance if available
        // If deductible is met, insurance typically pays 80-90% after deductible
        if (latestEligibility && latestEligibility.deductible_remaining === 0) {
          // Deductible met - insurance pays coinsurance percentage
          const coinsurancePercent = latestEligibility.coinsurance_percent || 80;
          allowedAmount = amountBilled * (coinsurancePercent / 100);
        } else {
          // Deductible not met - use standard in-network rate
          allowedAmount = amountBilled * 0.85; // Standard 85% for in-network
        }
      }

      // Get copay from eligibility data (REAL DATA, NO STATIC VALUES)
      const copay = latestEligibility?.copay_amount || claim.copay_amount || 0;

      // Parse response data for detailed breakdown
      const deductibleApplied = responseData.deductible_applied || 0;
      const coinsuranceApplied = responseData.coinsurance_applied || 0;

      // Calculate plan paid, deductible, and coinsurance from REAL eligibility data
      // NO STATIC VALUES - use actual insurance data
      let planPaid = 0;
      let deductible = 0;
      let coinsurance = 0;

      if (latestEligibility && latestEligibility.eligible && allowedAmount > 0) {
        // Get deductible remaining from eligibility (REAL DATA)
        const deductibleRemaining = latestEligibility.deductible_remaining !== null
          ? latestEligibility.deductible_remaining
          : (latestEligibility.deductible_total || 0);

        // Apply deductible if there's remaining deductible
        if (deductibleRemaining > 0 && allowedAmount > 0) {
          // Deductible applies to allowed amount
          deductible = Math.min(deductibleRemaining, allowedAmount);
        }

        // Calculate amount after deductible
        const amountAfterDeductible = Math.max(0, allowedAmount - deductible);

        // Calculate coinsurance from eligibility data (REAL DATA)
        if (latestEligibility.coinsurance_percent && latestEligibility.coinsurance_percent > 0 && amountAfterDeductible > 0) {
          // Coinsurance is patient's share after deductible
          // If coinsurance is 10%, patient pays 10%, insurance pays 90%
          const patientCoinsuranceShare = (amountAfterDeductible * latestEligibility.coinsurance_percent) / 100;
          coinsurance = patientCoinsuranceShare;
        }

        // Plan paid = allowed amount - deductible - patient coinsurance share
        // OR use insurance_pays from eligibility if available
        if (latestEligibility.insurance_pays && latestEligibility.insurance_pays > 0) {
          planPaid = latestEligibility.insurance_pays;
        } else {
          // Calculate: allowed amount minus deductible minus patient coinsurance
          planPaid = Math.max(0, allowedAmount - deductible - coinsurance);
        }
      } else if (claim.insurance_amount && claim.insurance_amount > 0) {
        // Fallback to claim insurance_amount if eligibility not available
        planPaid = claim.insurance_amount;
      } else if (allowedAmount > 0) {
        // Last resort: use allowed amount as plan paid
        planPaid = allowedAmount;
      }

      // Use parsed values from claim response_data if available (from actual claim processing)
      if (deductibleApplied > 0) deductible = deductibleApplied;
      if (coinsuranceApplied > 0) coinsurance = coinsuranceApplied;

      const otherInsurancePaid = 0; // Usually 0

      // Amount not covered (difference between billed and allowed)
      // For approved claim: $1800 - $200 = $1600
      const amountNotCovered = Math.max(0, amountBilled - allowedAmount);

      // What you owe = Copay + Deductible + Coinsurance + Amount Not Covered
      // This matches the EOB image: $35 + $165 + $0 + $1600 = $1800
      const whatYouOwe = copay + deductible + coinsurance + amountNotCovered;

      // Get service type from CPT code
      const serviceType = claim.service_code
        ? `CPT ${claim.service_code}`
        : (appointment?.appointment_type || 'Mental Health Consultation');

      eobServices.push({
        // A. Date of Service
        date_of_service: appointment?.date || claim.submitted_at?.split('T')[0] || new Date().toISOString().split('T')[0],

        // B. Type of Service
        type_of_service: serviceType,

        // C. Amount Billed
        amount_billed: amountBilled,

        // D. Allowed Amount
        allowed_amount: allowedAmount,

        // E. Your Plan Paid
        plan_paid: planPaid,

        // F. Your Other Insurance Paid
        other_insurance_paid: otherInsurancePaid,

        // G. Copay
        copay: copay,

        // H. Coinsurance
        coinsurance: coinsurance,

        // I. Deductible
        deductible: deductible,

        // J. Amount Not Covered
        amount_not_covered: amountNotCovered,

        // K. What You Owe
        what_you_owe: whatYouOwe,

        // L. Claim Detail
        claim_detail: responseData.claim_detail_codes || [claim.status?.toUpperCase() || 'PENDING'],

        // Additional info
        claim_id: claim.id,
        x12_claim_id: claim.x12_claim_id,
        status: claim.status,
        diagnosis_code: claim.diagnosis_code,
        service_code: claim.service_code
      });
    }

    // Calculate totals
    const totals = {
      amount_billed: eobServices.reduce((sum, s) => sum + s.amount_billed, 0),
      allowed_amount: eobServices.reduce((sum, s) => sum + s.allowed_amount, 0),
      plan_paid: eobServices.reduce((sum, s) => sum + s.plan_paid, 0),
      other_insurance_paid: eobServices.reduce((sum, s) => sum + s.other_insurance_paid, 0),
      copay: eobServices.reduce((sum, s) => sum + s.copay, 0),
      coinsurance: eobServices.reduce((sum, s) => sum + s.coinsurance, 0),
      deductible: eobServices.reduce((sum, s) => sum + s.deductible, 0),
      amount_not_covered: eobServices.reduce((sum, s) => sum + s.amount_not_covered, 0),
      what_you_owe: eobServices.reduce((sum, s) => sum + s.what_you_owe, 0)
    };

    return res.json({
      success: true,
      patient: {
        id: patientId,
        name: patientName,
        subscriber_id: latestEligibility?.member_id || 'N/A',
        group_number: null,
        payer: latestEligibility?.payer_id || 'N/A'
      },
      eligibility: latestEligibility ? {
        plan_summary: latestEligibility.plan_summary || 'N/A',
        deductible_total: latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined ? latestEligibility.deductible_total : null,
        deductible_remaining: latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : null,
        coinsurance_percent: latestEligibility.coinsurance_percent !== null && latestEligibility.coinsurance_percent !== undefined ? latestEligibility.coinsurance_percent : null,
        copay_amount: latestEligibility.copay_amount !== null && latestEligibility.copay_amount !== undefined ? latestEligibility.copay_amount : null,
        allowed_amount: latestEligibility.allowed_amount !== null && latestEligibility.allowed_amount !== undefined ? latestEligibility.allowed_amount : null,
        insurance_pays: latestEligibility.insurance_pays !== null && latestEligibility.insurance_pays !== undefined ? latestEligibility.insurance_pays : null,
        eligible: latestEligibility.eligible === 1 || latestEligibility.eligible === true
      } : null,
      services: eobServices,
      totals: totals,
      claim_count: eobServices.length
    });
  } catch (error) {
    console.error('❌ Error fetching EOB data:', error);
    console.error('Error stack:', error.stack);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

// Get all patients with billing summary (EOB list view)
app.get('/api/admin/billing/eob', async (req, res) => {
  try {
    const patients = db.db.prepare('SELECT resource_id, name, phone, email FROM fhir_patients').all();

    const billingData = await Promise.all(patients.map(async (patient) => {
      try {
        // Get claims for this patient
        const claims = db.getClaimsByPatient(patient.resource_id) || [];
        const eligibility = db.getEligibilityChecksByPatient(patient.resource_id) || [];
        const latestEligibility = eligibility[0] || null;

        // Calculate totals
        const totalBilled = claims.reduce((sum, c) => sum + (c.total_amount || 0), 0);
        const totalPaid = claims.reduce((sum, c) => sum + (c.insurance_amount || 0), 0);
        const totalOwed = claims.reduce((sum, c) => {
          const copay = c.copay_amount || 0;
          return sum + copay;
        }, 0);

        return {
          patient_id: patient.resource_id,
          patient_name: patient.name || 'Unknown',
          patient_phone: patient.phone || null,
          patient_email: patient.email || null,
          payer: latestEligibility?.payer_id || null,
          member_id: latestEligibility?.member_id || null,
          claim_count: claims.length,
          total_billed: totalBilled,
          total_paid: totalPaid,
          total_owed: totalOwed,
          latest_claim_date: claims[0]?.submitted_at || null
        };
      } catch (error) {
        console.error(`Error processing patient ${patient.resource_id}:`, error);
        return null;
      }
    }));

    const filtered = billingData.filter(p => p !== null);

    return res.json({
      success: true,
      patients: filtered,
      count: filtered.length
    });
  } catch (error) {
    console.error('❌ Error fetching billing EOB list:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Refresh payer cache (by search term or sync chunk)
 * POST /api/admin/insurance/cache/refresh?search=...&limit=...
 */
app.post('/api/admin/insurance/cache/refresh', async (req, res) => {
  try {
    const search = req.query.search || null;
    const limit = parseInt(req.query.limit) || 200;

    if (search) {
      // Force fetch from Stedi and cache
      const result = await InsuranceService.fetchPayers({ search, limit });
      if (result.success && result.payers?.length) {
        // Cache via PayerCacheService by re-searching (it will cache)
        await PayerCacheService.searchPayer(search);
      }
      return res.json({ success: result.success, cached: result.count || 0 });
    }

    // Bulk sync
    const sync = await PayerCacheService.syncPayerList(limit);
    return res.json(sync);
  } catch (error) {
    console.error('❌ Error refreshing payer cache:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function _maskEmail(email) {
  const e = String(email || '').trim();
  if (!e || !e.includes('@')) return '';
  return e.replace(/(^.).+(@.+$)/, '$1***$2');
}

function _maskPhone(phone) {
  const p = String(phone || '').trim();
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `(***) ***-${digits.slice(-4)}`;
}

function _canViewClinicalPhi(req) {
  // Staff-only gate for clinical prep PHI.
  const scope = String(req?.user?.scope || '').toLowerCase();
  const role = String(req?.user?.role || '').toLowerCase();
  const isStaffScope = scope === 'clinician' || scope === 'staff' || scope === 'admin';
  const isStaffRole = role.includes('admin') || role.includes('clinician') || role.includes('staff');
  return !!(req?.providerId || req?.headers?.['x-provider-id'] || isStaffScope || isStaffRole);
}

// Dashboard: merged clinical prep payload for provider drawer
app.get('/api/admin/appointments/:id/clinical-prep', async (req, res) => {
  try {
    const appointmentId = String(req.params.id || '').trim();
    if (!appointmentId) return res.status(400).json({ success: false, error: 'appointment id required' });

    const appt = db.getAppointment ? await db.getAppointment(appointmentId) : null;
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found' });

    let caseSummaryRow = null;
    let caseSummary = null;
    try {
      caseSummaryRow = db.db.prepare('SELECT * FROM case_summaries WHERE appointment_id = ? LIMIT 1').get(appointmentId);
      if (caseSummaryRow?.summary_json) {
        caseSummary = typeof caseSummaryRow.summary_json === 'string'
          ? JSON.parse(caseSummaryRow.summary_json)
          : caseSummaryRow.summary_json;
      }
    } catch (_) {}

    const triageSessionId = caseSummaryRow?.session_id || null;
    const triage = triageSessionId && db.getTriageSession ? db.getTriageSession(triageSessionId) : null;
    const triageMedia = triageSessionId && db.getTriageMediaForSession ? (db.getTriageMediaForSession(triageSessionId) || []) : [];
    const phiAllowed = _canViewClinicalPhi(req);

    const documentItems = triageMedia.map(m => {
      const type = (m.mime_type || '').startsWith('image/') ? 'image' : (m.media_type || 'document');
      const detailUrl = m.storage_url || `/api/media/${encodeURIComponent(m.id)}`;
      const aiSummary = (() => {
        try {
          return (typeof m.ai_analysis === 'string' ? JSON.parse(m.ai_analysis) : m.ai_analysis)?.summary || null;
        } catch (_) {
          return null;
        }
      })();
      return {
        id: m.id,
        title: m.file_name || m.context_note || '',
        type,
        detail_url: detailUrl,
        ai_summary: aiSummary
      };
    });

    const categoryCounts = documentItems.reduce((acc, d) => {
      const k = String(d.type || 'document').toLowerCase();
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    const prep = {
      appointment: {
        id: appt.id,
        status: appt.status,
        appointment_type: appt.appointment_type,
        provider: appt.provider || null,
        date: appt.date,
        time: appt.time,
        timezone: appt.timezone || 'America/New_York',
        patient_id: appt.patient_id || null,
        patient_name: phiAllowed ? (appt.patient_name || '') : ((appt.patient_name || '').split(' ').map(n => n.slice(0, 1).toUpperCase()).join('') || 'N/A'),
        patient_phone: phiAllowed ? (appt.patient_phone || '') : _maskPhone(appt.patient_phone),
        patient_email: phiAllowed ? (appt.patient_email || '') : _maskEmail(appt.patient_email)
      },
      phi_allowed: phiAllowed,
      case_summary: caseSummary ? {
        chief_complaint: caseSummary.chief_complaint || '',
        target_specialty: caseSummary.target_specialty || null,
        urgency: caseSummary.urgency || null,
        safety_level: caseSummary.safety_level || null,
        red_flags: (() => {
          const out = [];
          if ((caseSummary.safety_level || '').toLowerCase() === 'high') out.push('high_safety_level');
          if ((caseSummary.urgency || '').toLowerCase() === 'emergency') out.push('emergency_urgency');
          if (String(caseSummary.soap_note || '').toLowerCase().includes('chest pain')) out.push('chest_pain_mentioned');
          if (String(caseSummary.soap_note || '').toLowerCase().includes('shortness of breath')) out.push('shortness_of_breath_mentioned');
          return out;
        })(),
        soap_note: caseSummary.soap_note || '',
        key_problems: (() => {
          const v = caseSummary?.opqrst?.associated_sx;
          if (Array.isArray(v)) return v.slice(0, 8);
          if (typeof v === 'string' && v.trim()) return v.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).slice(0, 8);
          return [];
        })()
      } : null,
      triage_session: triage ? {
        session_id: triageSessionId,
        onset: triage.onset,
        provocation: triage.provocation,
        quality: triage.quality,
        radiation: triage.radiation,
        severity: triage.severity,
        timing: triage.timing,
        associated_sx: triage.associated_sx,
        medications: triage.medications,
        allergies: triage.allergies,
        prior_diagnoses: triage.prior_diagnoses,
        prior_workups: triage.prior_workups,
        family_history: triage.family_history,
        alcohol_use: triage.alcohol_use,
        smoking_status: triage.smoking_status,
        phq2_score: triage.phq2_score,
        gad2_score: triage.gad2_score,
        safety_screen: triage.safety_screen,
        soap_note: triage.soap_note,
        target_specialty: triage.target_specialty,
        urgency: triage.urgency,
        safety_level: triage.safety_level,
        red_flags: (() => {
          const out = [];
          if ((triage.safety_level || '').toLowerCase() === 'high') out.push('high_safety_level');
          if ((triage.urgency || '').toLowerCase() === 'emergency') out.push('emergency_urgency');
          if (triage.referred_to_911) out.push('referred_to_911');
          if (String(triage.safety_screen || '').toLowerCase().includes('suic')) out.push('suicidality_screen_positive');
          return out;
        })()
      } : null,
      documents: {
        triage_session_id: triageSessionId,
        count: documentItems.length,
        categories: categoryCounts,
        items: documentItems
      },
      activity: {
        has_case_summary: !!caseSummary,
        summary_ready_at: caseSummaryRow?.created_at || null,
        triage_linked: !!triageSessionId
      },
      section_status: {
        case_summary: caseSummary ? { ready: true, error: null } : { ready: false, error: 'No case summary linked yet.' },
        triage: triage ? { ready: true, error: null } : { ready: false, error: 'No triage session linked yet.' },
        documents: documentItems.length > 0
          ? { ready: true, count: documentItems.length, error: null }
          : { ready: false, count: 0, error: 'No triage-linked documents yet.' },
        ehr: { ready: false, error: 'Use EHR tab to load synced chart data.' }
      }
    };

    try {
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'staff',
        actor_id: req?.user?.sub || req?.providerId || req?.headers?.['x-provider-id'] || 'unknown',
        patient_id: appt.patient_id || null,
        resource_type: 'appointment',
        resource_id: appointmentId,
        action: 'clinical_prep_read',
        metadata: { phi_allowed: phiAllowed, triage_session_id: triageSessionId, doc_count: triageMedia.length }
      });
    } catch (_) {}

    return res.json({ success: true, prep });
  } catch (error) {
    console.error('❌ Error fetching clinical prep payload:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Dashboard: Get all appointments
app.get('/api/admin/appointments', async (req, res) => {
  try {
    let clinicId = resolveClinicIdFromRequest(req);
    if (!clinicId && db.db) {
      try {
        const firstClinic = db.db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
        clinicId = firstClinic?.clinic_id || null;
      } catch (_) { /* clinics table may not exist */ }
    }
    // Support both start_date/end_date (YYYY-MM-DD) and start/end (ISO timestamps)
    let startDate = req.query.start_date;
    let endDate = req.query.end_date;
    if (req.query.start && !startDate) {
      const m = String(req.query.start).match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) startDate = m[1];
    }
    if (req.query.end && !endDate) {
      const m = String(req.query.end).match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) endDate = m[1];
    }
    const filters = {
      status: req.query.status,
      date: req.query.date,
      start_date: startDate,
      end_date: endDate,
      provider: req.query.provider,
      clinic_id: clinicId || undefined
    };

    const appointments = db.getAllAppointments(filters);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      success: true,
      appointments,
      count: appointments.length
    });
  } catch (error) {
    console.error('❌ Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Dashboard: Get upcoming appointments
app.get('/api/admin/appointments/upcoming', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    let clinicId = resolveClinicIdFromRequest(req);
    if (!clinicId && db.db) {
      try {
        const firstClinic = db.db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
        clinicId = firstClinic?.clinic_id || null;
      } catch (_) { /* clinics table may not exist */ }
    }
    const appointments = db.getUpcomingAppointments(limit, clinicId || null);

    res.json({
      success: true,
      appointments,
      count: appointments.length
    });
  } catch (error) {
    console.error('❌ Error fetching upcoming appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

function ensureAppointmentTodosTable() {
  try {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS appointment_todos (
        id TEXT PRIMARY KEY,
        appointment_id TEXT NOT NULL,
        content TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id)
      );
      CREATE INDEX IF NOT EXISTS idx_appointment_todos_appointment_id ON appointment_todos(appointment_id);
    `);
  } catch (e) {
    console.warn('⚠️  Could not ensure appointment_todos table:', e.message);
  }
}

// Dashboard: read appointment to-do list items
app.get('/api/admin/appointments/:id/todos', async (req, res) => {
  try {
    ensureAppointmentTodosTable();
    const apptId = String(req.params.id || '').trim();
    if (!apptId) return res.status(400).json({ success: false, error: 'Missing appointment id' });
    const rows = db.db.prepare(`
      SELECT id, content, completed, created_at, updated_at
      FROM appointment_todos
      WHERE appointment_id = ?
      ORDER BY created_at ASC
    `).all(apptId);
    return res.json({
      success: true,
      todos: (rows || []).map(r => ({
        id: r.id,
        content: r.content,
        completed: !!r.completed,
        created_at: r.created_at,
        updated_at: r.updated_at
      }))
    });
  } catch (error) {
    console.error('❌ Error reading appointment todos:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Dashboard: replace appointment to-do list items
app.put('/api/admin/appointments/:id/todos', async (req, res) => {
  try {
    ensureAppointmentTodosTable();
    const apptId = String(req.params.id || '').trim();
    if (!apptId) return res.status(400).json({ success: false, error: 'Missing appointment id' });
    const inputTodos = Array.isArray(req.body?.todos) ? req.body.todos : null;
    if (!inputTodos) {
      return res.status(400).json({ success: false, error: 'Body must include todos[]' });
    }
    const cleaned = inputTodos
      .map(t => ({
        id: String(t?.id || '').trim(),
        content: String(t?.content || '').trim(),
        completed: !!t?.completed
      }))
      .filter(t => t.id && t.content);

    const delStmt = db.db.prepare(`DELETE FROM appointment_todos WHERE appointment_id = ?`);
    const insStmt = db.db.prepare(`
      INSERT INTO appointment_todos (id, appointment_id, content, completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const tx = db.db.transaction((rows) => {
      delStmt.run(apptId);
      for (const t of rows) insStmt.run(t.id, apptId, t.content, t.completed ? 1 : 0);
    });
    tx(cleaned);
    return res.json({ success: true, count: cleaned.length });
  } catch (error) {
    console.error('❌ Error saving appointment todos:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Dashboard: Search known patients by name/phone/email for create-appointment modal.
app.get('/api/admin/patients/search', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.name || '').trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10) || 10, 50));
    if (q.length < 2) {
      return res.json({ success: true, patients: [] });
    }
    const pattern = `%${q.toLowerCase()}%`;
    const fetchCap = Math.min(Math.max(limit * 12, 48), 300);
    const rawRows = db.db.prepare(`
      SELECT
        patient_name AS name,
        patient_phone AS phone,
        patient_email AS email,
        datetime(COALESCE(start_time, created_at)) AS last_seen_at
      FROM appointments
      WHERE deleted_at IS NULL
        AND patient_name IS NOT NULL
        AND (
          LOWER(COALESCE(patient_name, '')) LIKE ?
          OR LOWER(COALESCE(patient_phone, '')) LIKE ?
          OR LOWER(COALESCE(patient_email, '')) LIKE ?
        )
      ORDER BY datetime(COALESCE(start_time, created_at)) DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, fetchCap);

    const {
      adminPatientSearchDedupeKey,
      formatE164Prefer,
      normalizePatientName,
      normalizeEmail
    } = require('./services/patient-contact-canonical');

    const seen = new Set();
    const patients = [];
    for (const row of rawRows || []) {
      const key = adminPatientSearchDedupeKey(row.name, row.phone, row.email);
      if (seen.has(key)) continue;
      seen.add(key);
      const emailNorm = normalizeEmail(row.email);
      patients.push({
        name: normalizePatientName(row.name),
        phone: row.phone ? formatE164Prefer(row.phone) : row.phone,
        email: emailNorm || row.email || null,
        last_seen_at: row.last_seen_at
      });
      if (patients.length >= limit) break;
    }
    return res.json({ success: true, patients });
  } catch (error) {
    console.error('❌ Error searching patients for admin create-appointment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// External EHR IDs for patient crosswalk (Athena/Epic/etc)
app.get('/api/admin/patients/:id/external-ids', async (req, res) => {
  try {
    const patientId = String(req.params.id || '').trim();
    if (!patientId) return res.status(400).json({ success: false, error: 'Missing patient id' });
    const rows = db.getPatientExternalIds(patientId);
    return res.json({ success: true, external_ids: rows || [] });
  } catch (error) {
    console.error('❌ Error fetching patient external IDs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/patients/:id/external-ids', async (req, res) => {
  try {
    const patientId = String(req.params.id || '').trim();
    if (!patientId) return res.status(400).json({ success: false, error: 'Missing patient id' });
    const {
      source_system,
      tenant_id,
      external_patient_id,
      mrn = null,
      status = 'active',
      metadata_json = null
    } = req.body || {};
    const row = db.upsertPatientExternalId({
      patient_id: patientId,
      source_system,
      tenant_id,
      external_patient_id,
      mrn,
      status,
      metadata_json
    });
    return res.json({ success: true, external_id: row });
  } catch (error) {
    console.error('❌ Error upserting patient external ID:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Send video link via SMS to patient for telehealth appointment
// Create appointment manually (for provider/admin UI)
app.post('/api/admin/appointments/create', async (req, res) => {
  try {
    const {
      patient_name,
      patient_phone,
      patient_email,
      appointment_type,
      date,
      time,
      provider,
      notes,
      timezone,
      clinic_id,
      customer_id
    } = req.body;

    if (!patient_name || !patient_phone || !date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: patient_name, patient_phone, date, and time are required'
      });
    }

    let clinicId = clinic_id || resolveClinicIdFromRequest(req);
    if (!clinicId && db.db) {
      try {
        const firstClinic = db.db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
        clinicId = firstClinic?.clinic_id || null;
        if (!clinicId) {
          clinicId = 'clinic-default';
          try {
            await db.createClinic({
              clinic_id: clinicId,
              name: 'Default Clinic',
              slug: 'default',
              phone_number: process.env.DEFAULT_CLINIC_PHONE || '+15550000000',
              email: process.env.DEFAULT_CLINIC_EMAIL || 'clinic@doclittle.com'
            });
          } catch (e) {
            if (!e.message?.includes('UNIQUE') && !e.message?.includes('duplicate')) throw e;
            /* clinic already exists */
          }
        }
      } catch (_) { /* clinics table may not exist */ }
    }
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required. Set DEFAULT_CLINIC_ID in .env or add a clinic in Admin.'
      });
    }

    const result = await BookingService.createFutureAppointment({
      patient_name,
      patient_phone,
      patient_email,
      appointment_type: appointment_type || 'Mental Health Consultation',
      date,
      time,
      provider: provider || 'DocLittle Mental Health Team',
      notes: notes || '',
      timezone: timezone || 'America/New_York',
      clinic_id: clinicId,
      customer_id: customer_id || null
    });

    // Lifecycle trigger: queue outbound EHR sync (best-effort, non-blocking).
    try {
      const createdApptId = result?.appointment?.id;
      if (createdApptId) {
        const apptRow = await db.getAppointment(createdApptId);
        if (apptRow?.patient_id) {
          db.enqueueEhrSyncJob({
            event_type: 'appointment_created',
            patient_id: apptRow.patient_id,
            appointment_id: createdApptId,
            source_system: 'athena',
            tenant_id: apptRow.clinic_id || 'clinic-default',
            idempotency_key: `appointment_created:${createdApptId}`,
            payload_json: {
              appointment_id: createdApptId,
              patient_name: apptRow.patient_name || null,
              date: apptRow.date || null,
              time: apptRow.time || null
            }
          });
        }
      }
    } catch (e) {
      console.warn('⚠️  Could not enqueue EHR sync job (appointment_created):', e.message);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error creating appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/appointments/:id/send-video-link', async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    const phone = appointment.patient_phone;
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'Patient has no phone number on file' });
    }
    const baseUrl = process.env.DASHBOARD_BASE_URL || process.env.BASE_URL || process.env.API_BASE_URL || `https://${req.headers.host || 'doclittle.site'}`;
    const roomName = appointment.video_room_name || `appt-${appointmentId}`;
    const videoUrl = `${baseUrl.replace(/\/$/, '')}/patients/video-call.html?room=${encodeURIComponent(roomName)}`;
    const message = `Your telehealth video visit: ${videoUrl}\n\nClick to join when it\'s time for your appointment.`;
    const result = await SMSService.sendSMS(phone, message);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Failed to send SMS' });
    }
    res.json({ success: true, message: 'Video link sent via SMS' });
  } catch (error) {
    console.error('❌ Send video link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PROVIDER OPERATIONAL ENDPOINTS
// ============================================

// Provider: Get today's schedule
app.get('/api/provider/today', async (req, res) => {
  try {
    const providerName = req.query.provider || null;
    const schedule = ProviderService.getTodaySchedule(providerName);

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      schedule,
      count: schedule.length
    });
  } catch (error) {
    console.error('❌ Error fetching today schedule:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Provider: Get next patient up
app.get('/api/provider/next-patient', async (req, res) => {
  try {
    const providerName = req.query.provider || null;
    const nextPatient = ProviderService.getNextPatient(providerName);

    if (!nextPatient) {
      return res.json({
        success: true,
        next_patient: null,
        message: 'No upcoming appointments today'
      });
    }

    res.json({
      success: true,
      next_patient: nextPatient
    });
  } catch (error) {
    console.error('❌ Error fetching next patient:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Provider: Get live stats for today
app.get('/api/provider/live-stats', async (req, res) => {
  try {
    const providerName = req.query.provider || null;
    const stats = ProviderService.getLiveStats(providerName);

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      stats
    });
  } catch (error) {
    console.error('❌ Error fetching live stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Provider: Get / set status (online/offline + availability)
app.get('/api/provider/status', async (req, res) => {
  try {
    const email = (req.query.email || '').toString().trim();
    if (!email) {
      return res.status(400).json({
        success: false,
        error_code: 'PROVIDER_EMAIL_REQUIRED',
        error: 'email query required'
      });
    }
    const status = ProviderService.getProviderStatus(email);
    const providerProfile = ProviderService.getProviderProfileByEmail(email);
    res.json({
      success: true,
      status: status || { is_online: false, availability_rules: null },
      provider_profile: providerProfile || null
    });
  } catch (error) {
    console.error('❌ Error fetching provider status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch('/api/provider/status', async (req, res) => {
  try {
    const { email, is_online, availability_rules } = req.body || {};
    const e = (email || '').toString().trim();
    if (!e) {
      return res.status(400).json({
        success: false,
        error_code: 'PROVIDER_EMAIL_REQUIRED',
        error: 'email required'
      });
    }
    const profile = ProviderService.ensureProviderProfileForEmail(e);
    if (!profile) {
      return res.status(404).json({
        success: false,
        error_code: 'PROVIDER_NOT_FOUND',
        error: `No provider account found for email ${e}`
      });
    }
    if (typeof is_online === 'boolean') {
      ProviderService.setProviderOnline(e, is_online);
    }
    if (availability_rules !== undefined) {
      ProviderService.setProviderAvailability(e, availability_rules);
    }
    const status = ProviderService.getProviderStatus(e);
    res.json({ success: true, status, provider_profile: profile });
  } catch (error) {
    console.error('❌ Error updating provider status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Provider: heartbeat extends online TTL and keeps presence fresh
app.post('/api/provider/status/heartbeat', async (req, res) => {
  try {
    const email = ((req.body && req.body.email) || req.query.email || '').toString().trim();
    if (!email) {
      return res.status(400).json({
        success: false,
        error_code: 'PROVIDER_EMAIL_REQUIRED',
        error: 'email required'
      });
    }
    const profile = ProviderService.ensureProviderProfileForEmail(email);
    if (!profile) {
      return res.status(404).json({
        success: false,
        error_code: 'PROVIDER_NOT_FOUND',
        error: `No provider account found for email ${email}`
      });
    }
    const status = ProviderService.heartbeatProvider(email);
    return res.json({ success: true, status, provider_profile: profile });
  } catch (error) {
    console.error('❌ Error applying provider heartbeat:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Provider: Get all providers
// Phase 2.4: GET /api/provider/async-queue — Appointments pending specialist review
app.get('/api/provider/async-queue', async (req, res) => {
  try {
    const clinicId = req.query.clinic_id || null;
    const queue = await db.getAsyncReviewQueue(clinicId);
    return res.json({ success: true, appointments: queue, count: queue.length });
  } catch (e) {
    console.error('GET /api/provider/async-queue error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/provider/providers', async (req, res) => {
  try {
    const providers = ProviderService.getProviders();

    res.json({
      success: true,
      providers
    });
  } catch (error) {
    console.error('❌ Error fetching providers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Provider: booking readiness matrix (calendar + availability + online)
app.get('/api/provider/booking-readiness', async (req, res) => {
  try {
    const clinicId = req.query.clinic_id || process.env.DEFAULT_CLINIC_ID || 'clinic-default';
    const rows = ProviderService.getProviderBookingReadinessForClinic(clinicId);
    return res.json({
      success: true,
      clinic_id: clinicId,
      booking_policy: {
        calendar_required_for_sync: String(process.env.CALENDAR_REQUIRED_FOR_SYNC || 'false').toLowerCase() === 'true',
        blocks_only_allowed: String(process.env.BLOCKS_ONLY_ALLOWED === undefined ? 'true' : process.env.BLOCKS_ONLY_ALLOWED).toLowerCase() !== 'false',
        prefer_synced_providers: String(process.env.PREFER_SYNCED_PROVIDERS || 'true').toLowerCase() !== 'false'
      },
      providers: rows,
      count: rows.length
    });
  } catch (error) {
    console.error('❌ Error fetching provider booking readiness:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Provider: booking observability (confidence ratios, fallback failures, drift alert)
app.get('/api/provider/booking-observability', async (req, res) => {
  try {
    const snapshot = BookingService.getCalendarObservabilitySnapshot
      ? BookingService.getCalendarObservabilitySnapshot()
      : null;
    return res.json({
      success: true,
      observability: snapshot || {
        window_started_at: new Date().toISOString(),
        confidence_counts: { high: 0, medium: 0, low: 0, total: 0 },
        confidence_percentages: { high: 0, medium: 0, low: 0 },
        booking_counts: { total: 0, blocks_only: 0 },
        blocks_only_ratio: 0,
        no_bookable_provider_failures_by_clinic: {},
        alerts: { blocks_only_drift: false }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching booking observability:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Phase 7.2: GET /api/provider/case-report?room= — OPQRST + ICD-10 + patient summary for video side-panel
app.get('/api/provider/case-report', async (req, res) => {
  try {
    const room = (req.query.room || '').toString().trim();
    if (!room) {
      return res.status(400).json({ success: false, error: 'room query required' });
    }

    let caseRecord = null;
    let appointment = null;

    if (room.startsWith('case-')) {
      const caseNumber = room.substring('case-'.length);
      caseRecord = db.db.prepare('SELECT * FROM case_records WHERE case_number = ? LIMIT 1').get(caseNumber);
      if (caseRecord?.session_id) {
        const s = db.db.prepare('SELECT flow_state FROM patient_orchestrate_sessions WHERE session_id = ? LIMIT 1').get(caseRecord.session_id);
        const fs = s?.flow_state ? (typeof s.flow_state === 'string' ? JSON.parse(s.flow_state) : s.flow_state) : {};
        const apptId = fs.appointment_id;
        if (apptId) appointment = await db.getAppointment(apptId);
      }
    } else if (room.startsWith('appt-')) {
      const appointmentId = room.substring('appt-'.length);
      appointment = await db.getAppointment(appointmentId);
      const caseNumber = appointment && db.getCaseNumberForAppointment && db.getCaseNumberForAppointment(appointment.id);
      if (caseNumber) {
        caseRecord = db.db.prepare('SELECT * FROM case_records WHERE case_number = ? LIMIT 1').get(caseNumber);
      }
    }

    if (!caseRecord && !appointment) {
      return res.json({ success: true, case_report: null });
    }

    let patientSummary = '';
    const patientId = caseRecord?.patient_id || appointment?.patient_id;
    if (patientId && db.getFHIRPatient) {
      const p = db.getFHIRPatient(patientId);
      if (p?.resource_data) {
        const r = typeof p.resource_data === 'string' ? JSON.parse(p.resource_data) : p.resource_data;
        const name = r.name?.[0] ? [r.name[0].given?.join(' '), r.name[0].family].filter(Boolean).join(' ') : null;
        patientSummary = name || appointment?.patient_name || '';
      }
    }
    if (!patientSummary && appointment) patientSummary = appointment.patient_name || '';

    const opqrst = caseRecord?.opqrst ? (typeof caseRecord.opqrst === 'string' ? caseRecord.opqrst : JSON.stringify(caseRecord.opqrst)) : '';
    let suggestedIcd10 = [];
    if (caseRecord?.suggested_icd10) {
      try {
        suggestedIcd10 = typeof caseRecord.suggested_icd10 === 'string' ? JSON.parse(caseRecord.suggested_icd10) : caseRecord.suggested_icd10;
        if (!Array.isArray(suggestedIcd10)) suggestedIcd10 = [suggestedIcd10];
      } catch (_) {
        suggestedIcd10 = [caseRecord.suggested_icd10];
      }
    }

    if (db.auditLog && (patientSummary || opqrst)) {
      db.auditLog('clinician', req.user?.sub || req.headers['x-session-id'] || 'anonymous', 'READ', 'CaseReport', caseRecord?.case_number || appointment?.id || room, req.ip || '', req.get('User-Agent') || '', '200');
    }

    return res.json({
      success: true,
      case_report: {
        case_number: caseRecord?.case_number || null,
        patient_summary: patientSummary,
        opqrst: opqrst || null,
        suggested_icd10: suggestedIcd10
      }
    });
  } catch (e) {
    console.error('GET /api/provider/case-report error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// vc-3: GET /api/provider/diagnostic-report/:appointmentId — completed AI case report (post-visit)
app.get('/api/provider/diagnostic-report/:appointmentId', async (req, res) => {
  try {
    const appointmentId = (req.params.appointmentId || '').toString().trim();
    if (!appointmentId) return res.status(400).json({ success: false, error: 'appointmentId required' });
    const row = db.getDiagnosticReportByEncounterId && db.getDiagnosticReportByEncounterId(appointmentId);
    if (!row) return res.json({ success: true, diagnostic_report: null });
    const conclusion = row.case_report_text || (row.resource_data?.conclusion) || '';
    const codes = [];
    if (row.resource_data?.result) {
      for (const ref of (row.resource_data.result || [])) {
        const drRef = typeof ref === 'object' && ref.reference ? ref.reference : '';
        if (drRef) codes.push(drRef);
      }
    }
    res.json({
      success: true,
      diagnostic_report: {
        id: row.resource_id,
        encounter_id: row.encounter_id,
        status: row.status,
        conclusion,
        case_report_text: row.case_report_text,
        created_at: row.created_at
      }
    });
  } catch (e) {
    console.error('GET /api/provider/diagnostic-report error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================
// PATIENT PORTAL ENDPOINTS
// ============================================

// OTP abuse protection beyond IP-only limits (mvp-36)
const otpKey = (req) => {
  const ip = (req.ip || req.connection?.remoteAddress || 'unknown').toString();
  const email = (req.body?.email || '').toString().toLowerCase().trim();
  return `${ip}::${email || 'no-email'}`;
};
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: otpKey,
  message: { success: false, error: 'Too many verification code requests. Please try again later.' }
});
const otpConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: otpKey,
  message: { success: false, error: 'Too many verification attempts. Please try again later.' }
});

// Patient: Send verification code
app.post('/api/patient/verify/send', botGuard, authLimiter, otpSendLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address required'
      });
    }

    const result = await PatientPortalService.sendVerificationCode(email, {
      ip: req.ip || req.connection?.remoteAddress || '',
      userAgent: req.get('User-Agent') || ''
    });

    if (result.success) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_send_success'); } catch (_) {}
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: null,
          resource_type: 'session',
          resource_id: result.session_id || null,
          action: 'otp_sent',
          metadata: { ip: req.ip || null }
        });
      } catch (_) {}
      res.json({
        success: true,
        session_id: result.session_id,
        existing_patient: !!result.existing_patient,
        message: result.message || 'Verification code sent to your email'
      });
    } else {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_send_failed'); } catch (_) {}
      res.status(400).json(result);
    }
  } catch (error) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('otp_send_error'); } catch (_) {}
    console.error('❌ Error sending verification code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Admin: revoke patient sessions by email or patient_id (basic security/admin tool)
app.post('/api/admin/patient-sessions/revoke', async (req, res) => {
  try {
    const { email, patient_id } = req.body || {};
    if (!email && !patient_id) {
      return res.status(400).json({ success: false, error: 'email or patient_id required' });
    }
    if (email) {
      db.revokePatientSessionsByEmail && db.revokePatientSessionsByEmail(email);
    }
    if (patient_id) {
      db.revokePatientSessionsByPatientId && db.revokePatientSessionsByPatientId(patient_id);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Error revoking patient sessions:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to revoke sessions' });
  }
});

// Patient: Verify code and login
// Use authLimiter to protect against brute-force code guessing
app.post('/api/patient/verify/confirm', botGuard, authLimiter, otpConfirmLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and verification code required'
      });
    }

    const result = PatientPortalService.verifyCode(email, code);

    if (result.success) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_confirm_success'); } catch (_) {}
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: result.patient_id || null,
          resource_type: 'session',
          resource_id: result.session_id || null,
          action: 'login_success',
          metadata: { ip: req.ip || null }
        });
      } catch (_) {}
      // Optional: cookie-based session storage (mvp-59). Frontend may still use x-session-id header.
      const isSecure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
      res.cookie('patient_session_id', result.session_id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure,
        maxAge: 24 * 60 * 60 * 1000 // 24h absolute, inactivity handled server-side
      });
      issueCsrfCookie(res);
      // Determine onboarding completeness to drive web redirect
      let onboarding_complete = false;
      let missing_fields = ['first_name', 'last_name', 'dob', 'phone', 'country', 'city'];
      try {
        const row = (result.patient_id && db.getFHIRPatient) ? db.getFHIRPatient(result.patient_id) : null;
        const resource = row?.resource_data
          ? (typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data)
          : null;
        if (resource && PatientIntakeService?.canonicalFromPatientResource) {
          const canonical = PatientIntakeService.canonicalFromPatientResource(resource);
          const status = PatientIntakeService.onboardingStatusFromCanonical(canonical);
          onboarding_complete = !!status.onboarding_complete;
          missing_fields = status.missing_fields || missing_fields;
        }
      } catch (_) {}
      res.json({
        success: true,
        session_id: result.session_id,
        patient_id: result.patient_id,
        email: result.email,
        created_patient: !!result.created_patient,
        onboarding_complete,
        missing_fields
      });
    } else {
      try { db.incrementOpsCounter && db.incrementOpsCounter('otp_confirm_failed'); } catch (_) {}
      res.status(400).json(result);
    }
  } catch (error) {
    try { db.incrementOpsCounter && db.incrementOpsCounter('otp_confirm_error'); } catch (_) {}
    console.error('❌ Error verifying code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Logout (invalidate session)
app.post('/api/patient/logout', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.body?.session_id;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID required'
      });
    }

    try {
      if (db.deletePatientSession) {
        db.deletePatientSession(sessionId);
      }
    } catch (_) {
      // ignore delete errors for logout
    }

    try {
      // Also delete any legacy patient_portal_sessions row
      db.db.prepare(`DELETE FROM patient_portal_sessions WHERE id = ?`).run(sessionId);
    } catch (_) {}

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error logging out patient session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Get documents list
app.get('/api/patient/documents', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found' });

    // FHIR-first read: DocumentReference table is canonical.
    let documentReferences = db.getFHIRDocumentReferencesByPatientId
      ? db.getFHIRDocumentReferencesByPatientId(patientId, 500).map(r => r.resource_data).filter(Boolean)
      : [];

    // Migration bridge: if none exist, derive from patient_documents and persist.
    if (documentReferences.length === 0) {
      const rows = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];
      documentReferences = [];
      for (const r of rows) {
        const dr = buildDocumentReferenceFromPatientDocRow(r, req);
        documentReferences.push(dr);
        try { db.createFHIRDocumentReference && db.createFHIRDocumentReference(dr); } catch (_) {}
      }
    }

    // Back-compat for existing UI: return a "documents" list derived from the DocumentReferences.
    const documents = documentReferences.map(dr => {
      const att = (dr.content && dr.content[0] && dr.content[0].attachment) ? dr.content[0].attachment : {};
      return {
        id: dr.id,
        patient_id: patientId,
        file_name: att.title || dr.description || 'Document',
        file_type: att.contentType || null,
        status: 'available',
        created_at: dr.date || null,
        fhir: { document_reference_id: dr.id, binary_url: att.url || null }
      };
    });

    res.json({ success: true, patient_id: patientId, documentReferences, documents });
  } catch (error) {
    console.error('❌ Error fetching patient documents:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Patient: Request a signed download URL for a document (mvp-39, mvp-61)
app.get('/api/patient/documents/:id/download', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const docId = req.params.id;
    const doc = db.getPatientDocumentById ? db.getPatientDocumentById(docId) : null;
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

    // Resolve patient and verify ownership
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) patient = db.getFHIRPatient(sessionValidation.patient_id);
    if (!patient && sessionValidation.email) patient = db.getFHIRPatientByEmail(sessionValidation.email);
    if (!patient && sessionValidation.phone) patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    const patientId = patient ? patient.resource_id : sessionValidation.patient_id;
    if (!patientId || doc.patient_id !== patientId) {
      return res.status(403).json({ success: false, error: 'Not allowed to access this document' });
    }

    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
    if (db.createPatientDocumentDownloadToken) {
      const created = db.createPatientDocumentDownloadToken({
        token,
        doc_id: docId,
        patient_id: patientId,
        expires_at: expiresAtIso
      });
      if (!created.success) {
        return res.status(500).json({ success: false, error: 'Failed to issue download token' });
      }
    }

    // Audit log
    try {
      db.insertHipaaAccessLog && db.insertHipaaAccessLog({
        user_id: null,
        patient_id: patientId,
        resource_type: 'patient_document',
        resource_id: docId,
        action: 'download_link_issued',
        ip_address: req.ip
      });
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'patient',
        actor_id: null,
        patient_id: patientId,
        resource_type: 'document',
        resource_id: docId,
        action: 'download_link_issued',
        metadata: { ip: req.ip || null }
      });
    } catch (_) {}

    return res.json({
      success: true,
      url: `${req.protocol}://${req.get('host')}/api/patient/documents/download/${token}`,
      expires_in_seconds: Math.max(30, ttlSeconds)
    });
  } catch (error) {
    console.error('❌ Error issuing document download link:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Patient: Consume signed URL token and stream document (mvp-39, mvp-61)
app.get('/api/patient/documents/download/:token', apiLimiter, async (req, res) => {
  try {
    const token = (req.params.token || '').toString();
    const entry = db.getPatientDocumentDownloadToken ? db.getPatientDocumentDownloadToken(token) : null;
    if (!entry) return res.status(404).send('Not found');
    if (entry.revoked_at) return res.status(410).send('Expired');
    if (entry.used_at) return res.status(410).send('Expired');
    if (entry.expires_at && Date.now() > new Date(entry.expires_at).getTime()) return res.status(410).send('Expired');

    const doc = db.getPatientDocumentById ? db.getPatientDocumentById(entry.doc_id) : null;
    if (!doc) return res.status(404).send('Not found');
    if (doc.patient_id !== entry.patient_id) return res.status(403).send('Forbidden');

    // One-time use (durable)
    if (db.markPatientDocumentDownloadTokenUsed) {
      db.markPatientDocumentDownloadTokenUsed(token);
    }

    // Audit
    try {
      db.insertHipaaAccessLog && db.insertHipaaAccessLog({
        user_id: null,
        patient_id: entry.patient_id,
        resource_type: 'patient_document',
        resource_id: entry.doc_id,
        action: 'download',
        ip_address: req.ip
      });
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'patient',
        actor_id: null,
        patient_id: entry.patient_id,
        resource_type: 'document',
        resource_id: entry.doc_id,
        action: 'download',
        metadata: { ip: req.ip || null }
      });
    } catch (_) {}

    // If stored in cloud, redirect to provider-signed URL (mvp-68)
    if (doc.storage_provider === 'azure') {
      const BlobStorage = require('./services/blob-storage');
      if (BlobStorage && BlobStorage.isAzureConfigured && BlobStorage.isAzureConfigured() && doc.storage_key) {
        const signed = BlobStorage.generateSignedUrl({
          blobName: doc.storage_key,
          expiresInSeconds: 120,
          contentDispositionFilename: doc.file_name || 'document'
        });
        return res.redirect(signed);
      }
    }

    const p = doc.storage_path;
    if (!p || !fs.existsSync(p)) return res.status(404).send('Not found');
    res.setHeader('Content-Type', doc.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name || 'document')}"`);
    return fs.createReadStream(p).pipe(res);
  } catch (error) {
    console.error('❌ Error streaming document:', error);
    return res.status(500).send('Internal error');
  }
});

// Patient: Upload documents (multipart)
app.post('/api/patient/documents', apiLimiter, withIdempotency('patient_docs_upload'), async (req, res, next) => {
  // Defer to multer middleware; require it here to avoid startup failure if not installed
  let multer;
  try {
    multer = require('multer');
  } catch (e) {
    console.error('❌ Multer is required for file uploads. Install with "npm install multer".');
    return res.status(500).json({ success: false, error: 'File upload backend not configured' });
  }

  const uploadDir = path.join(__dirname, 'uploads', 'patients');
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {
    console.error('❌ Failed to ensure upload directory:', e.message);
  }

  const storage = multer.diskStorage({
    destination: (req2, file, cb) => cb(null, uploadDir),
    filename: (req2, file, cb) => {
      const { v4: uuidv4 } = require('uuid');
      const ext = path.extname(file.originalname || '');
      cb(null, `${uuidv4()}${ext}`);
    }
  });

  const maxMb = parseInt(process.env.PATIENT_UPLOAD_MAX_MB || '10', 10);
  const maxFiles = Math.max(1, Math.min(parseInt(process.env.PATIENT_UPLOAD_MAX_FILES || '30', 10) || 30, 100));
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ]);
  const upload = multer({
    storage,
    limits: { fileSize: Math.max(1, maxMb) * 1024 * 1024, files: maxFiles },
    fileFilter: (req2, file, cb) => {
      if (!allowed.has(file.mimetype)) {
        return cb(new Error('Unsupported file type'));
      }
      cb(null, true);
    }
  }).array('files', maxFiles);

  upload(req, res, async (err) => {
    if (err) {
      console.error('❌ Error handling upload:', err);
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          error: `Too many files in one request (max ${maxFiles}). Choose fewer files, or upload in batches.`,
          error_code: 'LIMIT_FILE_COUNT',
          max_files: maxFiles
        });
      }
      const msg = (err.message && String(err.message).trim()) || 'Upload failed';
      return res.status(400).json({ success: false, error: msg });
    }

    try {
      const sessionId = req.headers['x-session-id'];
      if (!sessionId) return res.status(401).json({ success: false, error: 'x-session-id required' });
      const sessionValidation = PatientPortalService.validateSession(sessionId);
      if (!sessionValidation.valid) return res.status(401).json({ success: false, error: 'Invalid or expired session' });

      let patient = null;
      if (sessionValidation.email) {
        patient = db.getFHIRPatientByEmail(sessionValidation.email);
      }
      if (!patient && sessionValidation.phone) {
        patient = db.getFHIRPatientByPhone(sessionValidation.phone);
      }
      if (!patient) {
        return res.status(404).json({ success: false, error: 'Patient not found' });
      }
      const patientId = patient.resource_id;

      const saved = [];
      if (req.files && db.createPatientDocument) {
        for (const f of req.files) {
          try {
            // Minimal magic-byte validation (mvp-40)
            try {
              const fd = fs.openSync(f.path, 'r');
              const buf = Buffer.alloc(16);
              fs.readSync(fd, buf, 0, 16, 0);
              fs.closeSync(fd);
              const sig = buf.toString('hex');
              const isPdf = sig.startsWith('25504446'); // %PDF
              const isPng = sig.startsWith('89504e470d0a1a0a');
              const isJpg = sig.startsWith('ffd8ff');
              if (
                (f.mimetype === 'application/pdf' && !isPdf) ||
                (f.mimetype === 'image/png' && !isPng) ||
                (f.mimetype === 'image/jpeg' && !isJpg)
              ) {
                try { fs.unlinkSync(f.path); } catch (_) {}
                continue;
              }
            } catch (_) {}

            // Antivirus / content scan (PATIENT_WEB_PORTAL_TODO 12.2.3)
            const AntivirusService = require('./services/antivirus-service');
            if (!f.path || !fs.existsSync(f.path)) {
              return res.status(400).json({
                success: false,
                error: 'Uploaded file could not be read (temporary file missing). Please upload again.',
                error_code: 'UPLOAD_TEMP_FILE_MISSING'
              });
            }
            const avResult = await AntivirusService.scanFile(f.path);
            if (!avResult.safe) {
              const msg = avResult.error || AntivirusService.BLOCKED_MESSAGE;
              return res.status(403).json({ success: false, error: msg });
            }

            // Document lifecycle (mvp-69): uploaded -> processing -> available/failed
            let storage_provider = 'local';
            let storage_bucket = null;
            let storage_key = null;
            let storage_path = f.path;
            let status = 'processing';

            // Optional: upload to Azure Blob (mvp-68)
            try {
              const BlobStorage = require('./services/blob-storage');
              if (BlobStorage && BlobStorage.isAzureConfigured && BlobStorage.isAzureConfigured()) {
                const buf = fs.readFileSync(f.path);
                const { v4: uuidv4 } = require('uuid');
                const ext = path.extname(f.originalname || '') || '';
                const blobName = `patients/${patientId}/${uuidv4()}${ext}`;
                const uploaded = await BlobStorage.uploadBuffer({
                  buffer: buf,
                  contentType: f.mimetype,
                  blobName
                });
                storage_provider = uploaded.provider;
                storage_bucket = uploaded.bucket;
                storage_key = uploaded.key;
                storage_path = null;
                // Remove local temp file after blob upload
                try { fs.unlinkSync(f.path); } catch (_) {}
              }
            } catch (_) {}

            // Malware scanning MVP (mvp-69): after magic bytes validation, mark available
            status = 'available';

            const result = db.createPatientDocument({
              patient_id: patientId,
              file_name: f.originalname,
              file_type: f.mimetype,
              storage_path,
              storage_provider,
              storage_bucket,
              storage_key,
              uploaded_by: 'patient',
              status
            });
            saved.push(result.id);

            // Dual-write (triage): when session_id provided (triage chat), also create case_report_media so RAG can use upload context
            const triageSessionId = (req.body && req.body.session_id) ? String(req.body.session_id).trim() : null;
            if (triageSessionId && db.createCaseReportMedia) {
              try {
                db.createCaseReportMedia({
                  session_id: triageSessionId,
                  patient_id: patientId,
                  media_type: (f.mimetype || '').startsWith('image/') ? 'image' : 'document',
                  mime_type: f.mimetype,
                  file_name: f.originalname,
                  file_size_bytes: f.size,
                  storage_provider,
                  storage_key: storage_key || result.id,
                  context_note: f.originalname,
                  uploaded_during: 'triage'
                });
              } catch (e3) {
                console.warn('[patient/documents] Dual-write case_report_media:', e3.message);
              }
            }

            // Dual-write (Batch 5): persist a FHIR DocumentReference as the canonical metadata record.
            try {
              const rowForFhir = {
                id: result.id,
                patient_id: patientId,
                encounter_id: null,
                file_name: f.originalname,
                file_type: f.mimetype,
                created_at: new Date().toISOString()
              };
              const docRef = buildDocumentReferenceFromPatientDocRow(rowForFhir, req);
              if (db.createFHIRDocumentReference) db.createFHIRDocumentReference(docRef);
            } catch (_) {}
          } catch (e2) {
            console.error('❌ Failed to save patient_document record:', e2.message);
          }
        }
      }

      try {
        if (saved.length > 0 && db.insertAuditEvent) {
          for (const docId of saved) {
            db.insertAuditEvent({
              actor_type: 'patient',
              actor_id: null,
              patient_id: patientId,
              resource_type: 'document',
              resource_id: docId,
              action: 'upload',
              metadata: {}
            });
          }
        }
      } catch (_) {}

      res.json({ success: true, uploaded: saved.length, document_ids: saved });
    } catch (error) {
      console.error('❌ Error processing uploaded documents:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

// AUTH TOKEN ENDPOINTS (patient / clinician JWT issuers)
app.use('/api/auth', authTokenRoutes);

// LiveKit video token routes (used by patient video-call.html and provider HUD)
app.use('/api/livekit', livekitTokenRoutes);

// Patient: Get my appointments (requires session)
// Protected by general API rate limiter
app.get('/api/patient/appointments', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) {
      return res.status(404).json({ success: false, error: 'Patient not found for this session' });
    }

    // Migration bridge (Batch 3):
    // Ensure we have a FHIR Encounter per appointment so reads can be FHIR-first,
    // while keeping appointment mutation flows on the legacy appointments table for now.
    try {
      const FHIRResources = require('./models/fhir-resources');
      const legacy = PatientPortalService.getPatientAppointments(req.patientSessionId);
      if (legacy && legacy.success && Array.isArray(legacy.appointments)) {
        for (const apt of legacy.appointments) {
          const encId = apt.id; // align with DiagnosticReportForAppointment encounter ref: Encounter/{appointmentId}
          const existing = db.getFHIREncounter ? db.getFHIREncounter(encId) : null;

          const encStatus =
            apt.status === 'completed' ? 'finished' :
            apt.status === 'canceled' ? 'cancelled' :
            apt.status === 'live' ? 'in-progress' :
            'planned';

          const startTime = apt.start_time || null;
          const endTime = apt.end_time || null;
          const resource = FHIRResources.createEncounter({
            id: encId,
            patientId,
            patientName: apt.patient_name || '',
            callId: encId,
            status: encStatus,
            type: apt.appointment_type || 'Telehealth visit',
            startTime: startTime || new Date().toISOString(),
            ...(endTime ? { endTime } : {})
          });

          // Preserve the legacy appointment status for round-tripping UI states.
          resource.extension = Array.isArray(resource.extension) ? resource.extension : [];
          resource.extension.push({
            url: 'https://doclittle.health/extension/appointment-status',
            valueString: apt.status || 'unknown'
          });
          if (apt.payment_status) {
            resource.extension.push({
              url: 'https://doclittle.health/extension/payment-status',
              valueString: apt.payment_status
            });
          }

          if (!existing && db.createFHIREncounter) {
            db.createFHIREncounter(resource);
          } else if (existing && db.updateFHIREncounter) {
            db.updateFHIREncounter(encId, resource);
          }
        }
      }
    } catch (_) {}

    // FHIR-first read: Encounter search by patient
    const encounters = db.getPatientEncounters ? db.getPatientEncounters(patientId, 200) : [];

    // Return the legacy appointment response shape, derived from FHIR Encounters.
    // This keeps the patient UI stable while we migrate to fully FHIR-native objects.
    const pendingByAppt = {};
    for (const enc of encounters) {
      const apptId = enc.resource_id || enc.id || enc.resource_data?.id;
      if (!apptId) continue;
      const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(apptId);
      if (pending) {
        pendingByAppt[apptId] = {
          payment_status: pending.payment_status,
          payment_link: pending.payment_link,
          amount_due: pending.checkout?.amount ?? null,
          currency: pending.checkout?.currency ?? 'USD'
        };
        continue;
      }
      const latest = db.getLatestCheckoutForAppointment && db.getLatestCheckoutForAppointment(apptId);
      if (latest && latest.status === 'completed') {
        pendingByAppt[apptId] = { payment_status: 'paid', payment_link: null };
      }
    }

    const appts = await Promise.all(encounters.map(async (enc) => {
      const r = enc.resource_data || {};
      const apptId = r.id || enc.resource_id || enc.id;
      if (apptId && db.db) {
        try {
          const tomb = db.db.prepare('SELECT deleted_at FROM appointments WHERE id = ?').get(apptId);
          if (tomb && tomb.deleted_at) return null;
        } catch (_) {}
      }
      const subject = r.subject || {};
      const period = r.period || {};
      const typeText = (r.type && r.type[0] && (r.type[0].text || (r.type[0].coding && r.type[0].coding[0] && r.type[0].coding[0].display))) || '';
      const ext = Array.isArray(r.extension) ? r.extension : [];
      const legacyStatus = (ext.find(e => e.url === 'https://doclittle.health/extension/appointment-status') || {}).valueString;
      const status =
        legacyStatus ||
        (r.status === 'finished' ? 'completed' :
         r.status === 'cancelled' ? 'canceled' :
         r.status === 'in-progress' ? 'live' :
         'scheduled');

      const payInfo = pendingByAppt[apptId] || {};
      const startIso = period.start || null;
      const dt = startIso ? new Date(startIso) : null;
      // Use appointment.date when available (avoids UTC date-shift; appointments use clinic-local date)
      let date = null;
      let time = null;
      let legacyAppt = null;
      try {
        legacyAppt = apptId ? await db.getAppointment(apptId) : null;
        if (legacyAppt && legacyAppt.date) {
          date = legacyAppt.date;
          time = legacyAppt.time || (dt ? dt.toISOString().slice(11, 16) : null);
        }
      } catch (_) {}
      if (!date) {
        date = dt ? dt.toISOString().slice(0, 10) : null;
        time = dt ? dt.toISOString().slice(11, 16) : null;
      }
      if (!time && dt) time = dt.toISOString().slice(11, 16);

      const visitMode =
        (legacyAppt && legacyAppt.visit_mode) ||
        (() => {
          const vmExt = ext.find((e) => e.url === 'https://doclittle.health/extension/visit-mode');
          return vmExt && (vmExt.valueString || vmExt.valueCode);
        })() ||
        'sync_video';

      const extPaymentStatus = (ext.find((e) => e.url === 'https://doclittle.health/extension/payment-status') || {}).valueString || null;
      let paymentStatusOut = payInfo.payment_status || null;
      if (!paymentStatusOut && extPaymentStatus) paymentStatusOut = extPaymentStatus;
      if (!paymentStatusOut && legacyAppt && legacyAppt.payment_status) paymentStatusOut = legacyAppt.payment_status;

      return {
        id: apptId,
        patient_name: subject.display || '',
        appointment_type: typeText || 'Telehealth visit',
        provider: legacyAppt && legacyAppt.provider ? legacyAppt.provider : null,
        date,
        time,
        timezone: (legacyAppt && legacyAppt.timezone) ? legacyAppt.timezone : 'America/New_York',
        start_time: startIso,
        end_time: period.end || null,
        status,
        datetime_display: date && time ? PatientPortalService._formatDateTime(date, time) : '',
        can_reschedule: ['scheduled', 'confirmed'].includes(status),
        can_cancel: ['scheduled', 'confirmed'].includes(status),
        video_room: apptId,
        visit_mode: visitMode,
        payment_status: paymentStatusOut,
        payment_link: payInfo.payment_link || null,
        amount_due: (payInfo.amount_due != null ? payInfo.amount_due : null),
        currency: payInfo.currency || 'USD',
        fhir: { encounter_id: apptId }
      };
    }));

    const appointmentsOut = (appts || []).filter(Boolean);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({ success: true, appointments: appointmentsOut });
  } catch (error) {
    console.error('❌ Error getting patient appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Create Stripe Checkout Session for an appointment (Phase 1 web checkout)
// C3: Idempotency-Key prevents duplicate Stripe Checkout sessions on double-submit (BE4).
app.post(
  '/api/patient/appointments/:id/checkout',
  apiLimiter,
  requirePatientSession,
  withIdempotency('patient_checkout'),
  express.json(),
  async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    if (!stripe) {
      return res.status(503).json({ success: false, error: 'Stripe is not configured', request_id: req.id });
    }

    const sessionValidation = req.patientSession;
    const { patientId, patientEmail } = resolvePatientIdFromSession(sessionValidation);
    const appointmentId = req.params.id;

    const appt = await db.getAppointment(appointmentId);
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found', request_id: req.id });

    // Ownership + authz
    try {
      assertPatientOwnsAppointmentOrThrow(sessionValidation, appt);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message, request_id: req.id });
    }

    const clinicId = appt.clinic_id || resolveClinicIdFromRequest(req) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id missing for appointment checkout', request_id: req.id });

    // If a pending voice checkout already exists, reuse its checkout_id (prevents duplicate voice_checkouts).
    const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(appointmentId);
    let voiceCheckout = null;
    let checkoutId = null;
    if (pending && pending.checkout) {
      voiceCheckout = pending.checkout;
      checkoutId = voiceCheckout.id;
    }

    if (voiceCheckout && voiceCheckout.stripe_checkout_session_id) {
      let url = null;
      try {
        const s = await stripe.checkout.sessions.retrieve(voiceCheckout.stripe_checkout_session_id);
        url = s?.url || null;
      } catch (_) {}
      return res.json({
        success: true,
        checkout_id: voiceCheckout.id,
        stripe_checkout_session_id: voiceCheckout.stripe_checkout_session_id,
        checkout_url: url,
        request_id: req.id
      });
    }

    // Charge amount: server-resolved only (never trust req.body.amount_due for capture).
    // Order: pending voice checkout row (if any) → visit_pricing for clinic + appointment type.
    let amount = null;
    if (voiceCheckout != null && voiceCheckout.amount != null) {
      amount = parseFloat(voiceCheckout.amount);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      try {
        const pricing = db.getEffectiveVisitPrice(clinicId, appt.appointment_type || 'General Consult');
        amount = pricing?.effective_price != null ? parseFloat(pricing.effective_price) : null;
      } catch (_) {}
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Unable to resolve price for checkout',
        request_id: req.id
      });
    }
    const clientHint = req.body?.amount_due;
    if (clientHint != null && Number.isFinite(parseFloat(clientHint))) {
      const ch = parseFloat(clientHint);
      if (Math.abs(ch - amount) > 0.009) {
        console.warn('[patient checkout] Ignoring client amount_due mismatch', {
          appointmentId,
          client_amount_due: ch,
          server_amount: amount,
          request_id: req.id
        });
      }
    }

    const { v4: uuidv4 } = require('uuid');
    let checkout = voiceCheckout;
    if (!checkout) {
      // Create checkout record only when a pending one doesn't already exist.
      checkoutId = uuidv4();
      checkout = {
        id: checkoutId,
        merchant_id: (await db.getClinicById(clinicId))?.merchant_id,
        product_id: 'APPOINTMENT',
        product_name: appt.appointment_type ? `Appointment - ${appt.appointment_type}` : 'Appointment',
        quantity: 1,
        amount,
        customer_phone: appt.patient_phone || '0000000000',
        customer_name: appt.patient_name || 'Patient',
        customer_email: patientEmail || appt.patient_email || null,
        appointment_id: appointmentId,
        status: 'pending',
        clinic_id: clinicId
      };

      if (!checkout.merchant_id) {
        return res.status(500).json({ success: false, error: 'Clinic merchant is not configured', request_id: req.id });
      }
      await db.createVoiceCheckout(checkout);
    } else {
      // Ensure the checkout_id is consistent even when voiceCheckout was used.
      checkoutId = checkout.id;
    }

    const baseUrl = process.env.BASE_URL || process.env.API_BASE_URL || `http://localhost:${PORT}`;
    const ttlMinutes = parseInt(process.env.APPOINTMENT_PAYMENT_TTL_MINUTES || '30', 10);
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(10, ttlMinutes) * 60;

    const successUrl = `${baseUrl}/unified-dashboard/patients/payment-success.html?checkout_id=${encodeURIComponent(checkoutId)}&appointment_id=${encodeURIComponent(appointmentId)}`;
    const cancelUrl = `${baseUrl}/unified-dashboard/patients/wallet.html`;

    // Phase 4.2: Pre-auth for sync_video (capture at case report); capture immediately for async_review
    const visitMode = (appt.visit_mode || 'sync_video').toString();
    const usePreAuth = visitMode === 'sync_video';
    const paymentIntentData = {
      metadata: {
        checkout_id: checkoutId,
        appointment_id: appointmentId,
        patient_id: patientId || ''
      }
    };
    if (usePreAuth) {
      paymentIntentData.capture_method = 'manual';
    }

    // Tenant-scoped Stripe customer (clinic/merchant -> internal tenant customer -> Stripe customer).
    // This avoids relying on Stripe's "create customer from email" behavior for multi-tenant reporting.
    let stripeCustomerId = null;
    try {
      const tenantCustomerId =
        db.getCustomerIdForClinic?.(clinicId) ||
        db.ensureCustomerIdForClinic?.(clinicId) ||
        null;

      const tenantCustomer = tenantCustomerId ? db.getCustomer(tenantCustomerId) : null;
      if (tenantCustomer?.stripe_customer_id) {
        stripeCustomerId = tenantCustomer.stripe_customer_id;
      } else if (tenantCustomer?.email && stripe?.customers?.create) {
        const stripeCustomer = await stripe.customers.create({
          email: tenantCustomer.email,
          name: tenantCustomer.name || tenantCustomer.company_name || clinicId,
          metadata: {
            customer_id: tenantCustomer.id,
            clinic_id: clinicId,
          }
        });
        stripeCustomerId = stripeCustomer.id;
        if (stripeCustomerId) {
          db.updateCustomer && db.updateCustomer(tenantCustomer.id, { stripe_customer_id: stripeCustomerId });
        }
      }
    } catch (tenantStripeErr) {
      console.warn('⚠️ tenant Stripe customer resolution failed:', tenantStripeErr.message);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: expiresAt,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: checkout.product_name },
            unit_amount: Math.round(amount * 100)
          },
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: stripeCustomerId || undefined,
      customer_email: checkout.customer_email || undefined,
      payment_intent_data: paymentIntentData,
      metadata: {
        checkout_id: checkoutId,
        appointment_id: appointmentId,
        patient_id: patientId || '',
        request_id: req.id || ''
      }
    });

    await db.updateVoiceCheckout(checkoutId, {
      stripe_checkout_session_id: session.id,
      stripe_session_expires_at: new Date(expiresAt * 1000).toISOString()
    });

    auditBookingEvent(req, 'create_checkout', 'VoiceCheckout', checkoutId, 'success');

    // Expose the session URL to the patient UI
    return res.json({
      success: true,
      checkout_id: checkoutId,
      appointment_id: appointmentId,
      amount_due: amount,
      currency: 'USD',
      checkout_url: session.url,
      request_id: req.id
    });
  } catch (error) {
    console.error('❌ Error creating patient appointment checkout session:', error);
    return res.status(500).json({ success: false, error: error.message, request_id: req.id });
  }
  }
);

// Patient: Poll appointment/checkout payment status after Stripe redirect (BE7)
app.get('/api/patient/appointments/:id/payment-status', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const sessionValidation = req.patientSession;
    const appt = await db.getAppointment(appointmentId);
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found', request_id: req.id });
    try {
      assertPatientOwnsAppointmentOrThrow(sessionValidation, appt);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message, request_id: req.id });
    }

    const checkout = db.getLatestCheckoutForAppointment ? db.getLatestCheckoutForAppointment(appointmentId) : null;
    const paymentSettled = String(appt.payment_status || '').toLowerCase() === 'paid'
      || String(checkout?.status || '').toLowerCase() === 'completed';

    auditBookingEvent(req, 'read_payment_status', 'Appointment', appointmentId, 'success');
    return res.json({
      success: true,
      appointment_id: appointmentId,
      payment_status: appt.payment_status || null,
      checkout_status: checkout?.status || null,
      checkout_id: checkout?.id || null,
      settled: paymentSettled,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

// ============================================================
// Patient booking (chat-led) + triage (Phase 1 web)
// ============================================================
function parseIsoDateFromText(text) {
  const t = (text || '').toString();
  const m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return m[0];
  const lower = t.toLowerCase();
  if (lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (lower.includes('today')) return new Date().toISOString().slice(0, 10);
  return null;
}

function parseTimeFromText(text) {
  const t = (text || '').toString().toLowerCase();
  // "14:30"
  const m24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) return `${m24[1].padStart(2, '0')}:${m24[2]}`;
  // "2pm", "2:30 pm"
  const m12 = t.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ampm = m12[3];
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return null;
}

function isValidIanaTimezone(value) {
  const tz = (value || '').toString().trim();
  if (!tz) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
}

const { validateRequired, validateDate, combineValidators } = require('./middleware/input-validator');
const validatePatientBookingScheduleBody = combineValidators(
  validateRequired(['date', 'time']),
  validateDate('date')
);
const validatePatientTriageBody = validateRequired(['message']);

function validatePatientCheckoutChatBody(req, res, next) {
  const b = req.body || {};
  const msg = (b.message || '').toString().trim();
  if (!msg) {
    return res.status(400).json({ success: false, error: 'message is required', request_id: req.id });
  }
  if (msg.length > 4000) {
    return res.status(400).json({ success: false, error: 'message too long (max 4000 characters)', request_id: req.id });
  }
  const pid = (b.product_id || '').toString().trim();
  const provid = (b.provider_id || '').toString().trim();
  if (!pid) {
    return res.status(400).json({ success: false, error: 'product_id is required', request_id: req.id });
  }
  if (!provid) {
    return res.status(400).json({ success: false, error: 'provider_id is required', request_id: req.id });
  }
  return next();
}

function validatePatientAvailableSlotsQuery(req, res, next) {
  const date = (req.query?.date || '').toString().trim();
  if (!date) {
    return res.status(400).json({ success: false, error: 'date query parameter is required', request_id: req.id });
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD.', request_id: req.id });
  }
  return next();
}

function auditBookingEvent(req, action, resourceType, resourceId, result = 'success') {
  try {
    if (db.auditLog) {
      db.auditLog('patient', req?.patientSession?.patient_id || req?.patientSessionId || 'unknown', action, resourceType, resourceId, req.ip, req.get('User-Agent') || '', result);
    }
  } catch (_) {}
}

app.get('/api/patient/booking/available-slots', apiLimiter, requirePatientSession, validatePatientAvailableSlotsQuery, async (req, res) => {
  try {
    const args = req.query || {};
    const date = (args.date || '').toString().trim();
    const BookingService = require('./services/booking-service');
    const appointmentType = args.appointment_type || 'General Consult';
    const timezone = args.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Use a valid IANA timezone (e.g., America/New_York).', request_id: req.id });
    }
    const clinicId = resolveClinicIdFromRequest(req, args) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id required', request_id: req.id });
    const result = await BookingService.getAvailableSlots(date, null, appointmentType, timezone, clinicId, null);
    return res.json({ ...result, request_id: req.id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/patient/booking/schedule', apiLimiter, requirePatientSession, validatePatientBookingScheduleBody, withIdempotency('patient_booking_schedule'), express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const BookingService = require('./services/booking-service');
    const PatientPortalService = require('./services/patient-portal-service');

    const args = req.body || {};
    const clinicId = resolveClinicIdFromRequest(req, args) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id required', request_id: req.id });

    const sid = req.patientSessionId;
    const sessionValidation = PatientPortalService.validateSession(sid);
    const email = sessionValidation?.email || null;
    const mappedPatientId = sessionValidation?.patient_id || null;

    // Prefer canonical intake for name/phone
    let intake = null;
    try {
      const row = mappedPatientId ? db.getFHIRPatient(mappedPatientId) : null;
      const r = row?.resource_data ? (typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data) : null;
      if (r) {
        const PatientIntakeService = require('./services/patient-intake-service');
        intake = PatientIntakeService.canonicalFromPatientResource
          ? PatientIntakeService.canonicalFromPatientResource(r)
          : null;
      }
    } catch (_) {}

    const patient_name =
      args.patient_name ||
      [intake?.first_name, intake?.last_name].filter(Boolean).join(' ').trim() ||
      'Patient';

    const patient_phone = args.patient_phone || intake?.phone || null;
    const appointment_type = args.appointment_type || 'General Consult';
    const date = args.date;
    const time = args.time;
    const timezone = args.timezone || 'America/New_York';
    const notes = args.reason || args.notes || null;

    if (!email) return res.status(400).json({ success: false, error: 'Patient session missing email', request_id: req.id });
    if (!date || !time) return res.status(400).json({ success: false, error: 'date and time required', request_id: req.id });
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Use a valid IANA timezone (e.g., America/New_York).', request_id: req.id });
    }

    const result = await BookingService.scheduleAppointment({
      clinic_id: clinicId,
      patient_name,
      patient_phone,
      patient_email: email,
      appointment_type,
      date,
      time,
      timezone,
      notes,
      patient_id: mappedPatientId || null,
      visit_mode: args.visit_mode || 'sync_video'
    });
    if (result.success) invalidateSlotAvailabilityCache();
    if (!result.success) return res.status(400).json({ ...result, request_id: req.id });

    auditBookingEvent(req, 'schedule_appointment', 'Appointment', result.appointment?.id || null, 'success');

    return res.json({
      success: true,
      appointment: result.appointment,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

// Phase 2.4: POST /api/patient/async-review — Create async review case, returns appointment_id for payment
app.post('/api/patient/async-review', apiLimiter, requirePatientSession, express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const PatientPortalService = require('./services/patient-portal-service');
    const BookingService = require('./services/booking-service');

    const sid = req.patientSessionId;
    const sessionValidation = PatientPortalService.validateSession(sid);
    const email = sessionValidation?.email || null;
    const mappedPatientId = sessionValidation?.patient_id || null;
    const clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id required' });
    if (!email) return res.status(400).json({ success: false, error: 'Patient session missing email' });

    const body = req.body || {};
    const timezone = body.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".' });
    }
    const patient_name = body.patient_name || [sessionValidation?.first_name, sessionValidation?.last_name].filter(Boolean).join(' ').trim() || 'Patient';
    const patient_phone = body.patient_phone || sessionValidation?.phone || null;
    const result = await BookingService.createAsyncReviewAppointment({
      patient_name,
      patient_phone,
      patient_email: email,
      clinic_id: clinicId,
      reason: body.reason || body.notes || '',
      attachment_ids: body.attachment_ids || [],
      customer_id: body.customer_id || null,
      patient_id: mappedPatientId || null,
      timezone
    });

    return res.json({
      success: true,
      appointment_id: result.appointment.id,
      ...result
    });
  } catch (e) {
    console.error('POST /api/patient/async-review error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Shared handler for chat triage (orch-6: consolidated orchestrate + triage/message)
async function handlePatientTriageMessage(req) {
  const PatientPortalService = require('./services/patient-portal-service');
  const KellyAgentService = require('./services/kelly-agent-service');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  // S-1: No last-resort fallback clinic (multi-tenant leak). Use env, request, or patient's clinic only.
  let clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
  if (!clinicId && mappedPatientId && db?.getPatientClinicIds) {
    try {
      const patientClinics = db.getPatientClinicIds(mappedPatientId);
      clinicId = patientClinics?.[0] || null;
    } catch (_) {}
  }
  if (!clinicId) return { status: 400, json: { success: false, error: 'clinic_id required. Set DEFAULT_CLINIC_ID in .env, include clinic_id in request, or ensure patient has appointments.', request_id: req.id } };
  const message = (req.body?.message || '').toString();
  const trimmedMessage = message.trim();
  const MAX_TRIAGE_MESSAGE_LENGTH = 4000;
  if (!trimmedMessage) {
    return { status: 400, json: { success: false, error: 'message is required', request_id: req.id } };
  }
  if (trimmedMessage.length > MAX_TRIAGE_MESSAGE_LENGTH) {
    return {
      status: 400,
      json: {
        success: false,
        error: `message too long (max ${MAX_TRIAGE_MESSAGE_LENGTH} characters)`,
        code: 'TRIAGE_MESSAGE_TOO_LONG',
        request_id: req.id
      }
    };
  }
  const state = req.body?.state || {};
  const meta = req.body?.meta || {};
  let session_id = (req.body?.session_id || state.session_id || '').toString().trim() || null;
  if (!session_id) session_id = require('uuid').v4();

  const row = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
  let conversationHistory = Array.isArray(row?.conversation_history) ? row.conversation_history : [];
  let existingFlowState = row?.flow_state && typeof row.flow_state === 'object' ? row.flow_state : {};

  // Fresh chat session only: wipe stale triage/RAG/Kelly rows when there is no orchestrate
  // row yet OR turn_count === 0 (first persisted turn). We intentionally do NOT wipe when
  // turn_count >= 1 even if RAG is missing — that would destroy in-progress triage. The Kelly
  // test harness uses a new UUID suffix per case run (run-kelly-tests.sh) so session_id does
  // not collide on shared dev DB.
  const turns = Number(row?.turn_count ?? 0);
  const orchestrateEmpty = !row || turns === 0;
  const staleResetHours = (() => {
    const n = Number(process.env.CHAT_SESSION_STALE_RESET_HOURS ?? 8);
    return Number.isFinite(n) && n > 0 ? n : 8;
  })();
  const inactiveHours = (() => {
    if (!row?.last_activity_at) return 0;
    const t = new Date(row.last_activity_at).getTime();
    if (!Number.isFinite(t)) return 0;
    return (Date.now() - t) / (1000 * 60 * 60);
  })();
  const explicitSessionReset = meta?.new_session === true || String(meta?.new_session || '').toLowerCase() === 'true';
  const staleSessionReset = !!row && turns >= 1 && inactiveHours >= staleResetHours;
  const shouldWipeClinicalState = orchestrateEmpty || explicitSessionReset || staleSessionReset;
  if (shouldWipeClinicalState && db?.wipeChatSessionClinicalState) {
    db.wipeChatSessionClinicalState(session_id);
    if (explicitSessionReset || staleSessionReset) {
      conversationHistory = [];
      existingFlowState = {};
    }
  }

  const result = await KellyAgentService.processTurn({
    message: trimmedMessage,
    sessionId: session_id,
    channel: 'chat',
    clinicId,
    patientId: mappedPatientId,
    patientName: null,
    patientEmail: email,
    portalSessionId: sid
  });

  // Always persist chat conversation history so the next turn has the right
  // triage/OPQRST state even when the LLM/tool loop had to fall back.
  if (db?.upsertOrchestrateSession) {
    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: trimmedMessage },
      { role: 'assistant', content: result.reply }
    ];
    const baseTurnCount = (explicitSessionReset || staleSessionReset) ? 0 : (row?.turn_count || 0);
    const newTurnCount = baseTurnCount + 1;
    let preferredLanguage = row?.preferred_language || 'en';
    // orch-4: Persist preferred_language from first 1–2 turns or explicit language request
    try {
      const { detectLanguageFromText, detectLanguagePreferenceRequest } = require('./services/patient-orchestrator-service');
      const langReq = detectLanguagePreferenceRequest(trimmedMessage);
      if (langReq?.isLanguageRequest && langReq?.code) {
        preferredLanguage = langReq.code;
      } else if (newTurnCount <= 2) {
        preferredLanguage = detectLanguageFromText(trimmedMessage).code || preferredLanguage;
      }
    } catch (_) {}
    try {
      db.upsertOrchestrateSession({
        session_id,
        channel: 'chat',
        patient_id: mappedPatientId,
        portal_session_id: sid,
        clinic_id: clinicId,
        conversation_history: updatedHistory,
        flow_state: result.state || existingFlowState || state,
        turn_count: newTurnCount,
        preferred_language: preferredLanguage
      });
    } catch (e) {
      console.warn('⚠️  Failed to persist chat session:', e.message);
    }
  }

  const reply = (result.reply && String(result.reply).trim()) || "I'm here. How can I help you today?";
  return {
    status: 200,
    json: {
      success: true,
      reply,
      session_id: session_id,
      state: result.state || state,
      // Expose tool usage for E2E metrics harness (used by scripts/run-kelly-tests.sh)
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      next_chips: result.next_chips || [],
      clear_chips: !Array.isArray(result.next_chips) || result.next_chips.length === 0,
      chips_display: result.chips_display,
      redirect_to: result.redirect_to,
      next_step: result.next_step,
      request_id: req.id
    }
  };
}

// POST /api/patient/checkout-chat/turn — Kelly agent for retail checkout (commerce tools only)
function _isMidFlightCheckout(sessionId, message) {
  const hasVerificationCode = /\b\d{6}\b/.test(String(message || ''));
  let hasCheckoutProgress = false;
  try {
    const progress = db?.getCommerceCheckoutProgress?.(sessionId) || null;
    hasCheckoutProgress = !!(progress?.checkout_id || progress?.checkout_intent);
  } catch (_) {}
  return hasVerificationCode || hasCheckoutProgress;
}

async function _runCheckoutGraphWithCircuitBreaker(CheckoutGraph, payload, timeoutMs = 2000) {
  try {
    return await Promise.race([
      CheckoutGraph.processTurn(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CHECKOUT_GRAPH_TIMEOUT')), timeoutMs))
    ]);
  } catch (e) {
    return { success: false, error: e.message || 'checkout_graph_failed' };
  }
}

function _safeCheckoutDegradeResponse() {
  return {
    success: true,
    safe_degraded: true,
    human_handoff_recommended: true,
    reply:
      "I'm having trouble processing this securely right now. Please try again in a moment, and if needed I can connect you to a specialist to complete checkout safely.",
    toolsUsed: [],
    next_chips: [],
    chips_display: null,
    next_step: 'safe_retry_or_handoff'
  };
}

function _looksLikeCardOrCvv(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  const hasCvv = /\b(cvv|cvc|security code)\b/i.test(s);
  const digits = s.replace(/\D/g, '');
  const hasLongCardLike = digits.length >= 13 && digits.length <= 19;
  return hasCvv || hasLongCardLike;
}

function _getCheckoutStage(sessionId) {
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    return String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage') || '');
  } catch (_) {
    return '';
  }
}

function _normalizeResumeDecision(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'continue' || v === 'resume') return 'continue';
  if (v === 'start_over' || v === 'restart' || v === 'reset') return 'start_over';
  return '';
}

function _applyCheckoutResumeDecision(sessionId, decision, source = 'checkout_resume_decision') {
  try {
    const normalized = _normalizeResumeDecision(decision);
    if (!sessionId || !normalized) return { applied: false, decision: '' };
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    if (normalized === 'start_over') {
      const reset = KellyToolExecutor.hardResetCheckoutContext?.(sessionId, `${source}:start_over`);
      KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision', 'start_over');
      KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision_at_ms', String(Date.now()));
      return { applied: true, decision: normalized, reset: !!reset?.success };
    }
    KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision', 'continue');
    KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision_at_ms', String(Date.now()));
    return { applied: true, decision: normalized };
  } catch (_) {
    return { applied: false, decision: '' };
  }
}

function _applyProductScopeForSession(sessionId, productId, source = 'product_scope') {
  try {
    const sid = String(sessionId || '').trim();
    const pid = String(productId || '').trim();
    if (!sid || !pid) return { applied: false, changed: false };
    const lastPid = String(KellyToolExecutor._getSessionMeta?.(sid, 'checkout_product_id') || '').trim();
    if (!lastPid) {
      KellyToolExecutor._setSessionMeta?.(sid, 'checkout_product_id', pid);
      return { applied: true, changed: false };
    }
    if (lastPid !== pid) {
      const reset = KellyToolExecutor.hardResetCheckoutContext?.(sid, `${source}:product_switch`);
      KellyToolExecutor._setSessionMeta?.(sid, 'checkout_product_id', pid);
      KellyToolExecutor._setSessionMeta?.(sid, 'checkout_product_switched_at_ms', String(Date.now()));
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_product_switch_reset'); } catch (_) {}
      return { applied: true, changed: true, reset: !!reset?.success };
    }
    return { applied: true, changed: false };
  } catch (_) {
    return { applied: false, changed: false };
  }
}

async function _runCheckoutContextBackfillOnce() {
  try {
    const rows = db.db.prepare(`
      SELECT DISTINCT session_id
      FROM kelly_session_meta_kv
      WHERE meta_key IN ('checkout_stage','commerce_email_verified','commerce_shipping_complete')
    `).all();
    if (!Array.isArray(rows) || rows.length < 1) return;
    for (const r of rows) {
      const sid = String(r?.session_id || '').trim();
      if (!sid) continue;
      const currentVersion = String(KellyToolExecutor._getSessionMeta?.(sid, 'checkout_context_version') || '').trim();
      if (!currentVersion) KellyToolExecutor._setSessionMeta?.(sid, 'checkout_context_version', '1');
      const shipComplete = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_shipping_complete') || '0') === '1';
      if (shipComplete) {
        const shipVersion = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_shipping_context_version') || '').trim();
        if (!shipVersion) KellyToolExecutor._setSessionMeta?.(sid, 'commerce_shipping_context_version', '1');
        const shipUpdated = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_shipping_updated_at_ms') || '').trim();
        if (!shipUpdated) KellyToolExecutor._setSessionMeta?.(sid, 'commerce_shipping_updated_at_ms', String(Date.now()));
      }
      const verifiedEmail = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_email_verified') || '').trim();
      if (verifiedEmail) {
        const vctx = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_email_verified_context_version') || '').trim();
        if (!vctx) KellyToolExecutor._setSessionMeta?.(sid, 'commerce_email_verified_context_version', '1');
      }
    }
    try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_context_backfill_applied'); } catch (_) {}
  } catch (_) {}
}

const CHECKOUT_PREPARED_STALE_MS = Math.max(
  60000,
  parseInt(process.env.CHECKOUT_PREPARED_STALE_MS || '1800000', 10) || 1800000
);
const CHECKOUT_RAIL_GUARDS_ENABLED =
  String(process.env.CHECKOUT_RAIL_GUARDS_ENABLED || 'true').toLowerCase() !== 'false';
const CHECKOUT_STAGE_SYNC_INTENT_AWARE =
  String(process.env.CHECKOUT_STAGE_SYNC_INTENT_AWARE || 'true').toLowerCase() !== 'false';
const CHECKOUT_STALE_INFLIGHT_TTL_MS = Math.max(
  30000,
  parseInt(process.env.CHECKOUT_STALE_INFLIGHT_TTL_MS || '120000', 10) || 120000
);

async function _syncCheckoutPaymentStatusIfPrepared(sessionId, source = 'server_sync') {
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    const CheckoutPaymentStatusService = require('./services/checkout-payment-status-service');
    const stage = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage') || '');
    if (stage !== 'checkout_prepared') return { stage };

    const updatedAtMs = parseInt(
      String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_updated_at_ms') || '0'),
      10
    );
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0 && Date.now() - updatedAtMs > CHECKOUT_PREPARED_STALE_MS) {
      const merchantId = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
      KellyToolExecutor._setCheckoutStage(sessionId, 'failed', { reason: 'checkout_prepared_stale_timeout' });
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', 'stale_timeout');
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', 'failed');
      if (merchantId && db?.clearCommerceCartCheckoutLock) {
        try { db.clearCommerceCartCheckoutLock(sessionId, merchantId); } catch (_) {}
      }
      return { stage: 'failed', stale: true };
    }

    const paymentIntentId = String(
      KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_payment_intent_id') || ''
    ).trim();
    if (!paymentIntentId) {
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', `${source}:missing_pi`);
      return { stage };
    }

    const status = await CheckoutPaymentStatusService.getCheckoutPaymentStatus({ payment_intent_id: paymentIntentId });
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', String(status?.source || source));
    if (!status?.success) return { stage };
    const confirmAttempted = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'payment_confirm_attempted') || '0') === '1';
    if (String(status.stripe_status || '') === 'requires_payment_method' && !confirmAttempted) {
      // Before any confirm attempt, requires_payment_method is expected for a fresh PI.
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', 'pending_card_entry');
      return { stage: 'checkout_prepared', stripe_status: 'requires_payment_method' };
    }

    KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', String(status.stripe_status || 'unknown'));
    const mappedStage = String(status.checkout_stage || 'checkout_prepared');
    if (mappedStage === 'payment_confirmed') {
      // Do not announce confirmation until receipt/order can be retrieved.
      let receiptOrOrderRetrievable = false;
      try {
        const hasReceipt = db.db.prepare(
          `SELECT 1 FROM payment_receipts WHERE external_payment_id = ? AND deleted_at IS NULL LIMIT 1`
        ).get(paymentIntentId);
        const hasOrder = db.db.prepare(
          `SELECT 1 FROM voice_checkouts WHERE payment_intent_id = ? AND merchant_order_id IS NOT NULL LIMIT 1`
        ).get(paymentIntentId);
        receiptOrOrderRetrievable = !!(hasReceipt || hasOrder);
      } catch (_) {}
      if (receiptOrOrderRetrievable) {
        KellyToolExecutor._setCheckoutStage(sessionId, 'payment_confirmed', {
          payment_intent_id: paymentIntentId
        });
      } else {
        KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', `${source}:awaiting_reconciliation`);
        try {
          db.enqueueToolCallDLQ && db.enqueueToolCallDLQ({
            call_id: `checkout_reconcile_${sessionId}_${Date.now()}`,
            function_name: 'checkout_payment_reconciliation',
            parameters: { session_id: sessionId, payment_intent_id: paymentIntentId },
            error_message: 'payment_succeeded_but_receipt_or_order_unavailable'
          });
        } catch (_) {}
        return { stage: 'checkout_prepared', stripe_status: status.stripe_status };
      }
    } else if (mappedStage === 'failed') {
      const merchantId = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
      KellyToolExecutor._setCheckoutStage(sessionId, 'failed', {
        reason: String(status.stripe_status || 'payment_failed'),
        payment_intent_id: paymentIntentId
      });
      if (merchantId && db?.clearCommerceCartCheckoutLock) {
        try { db.clearCommerceCartCheckoutLock(sessionId, merchantId); } catch (_) {}
      }
    }
    return { stage: mappedStage, stripe_status: status.stripe_status };
  } catch (_) {
    return { stage: _getCheckoutStage(sessionId) || 'collecting_details' };
  }
}

function _runCheckoutStaleInFlightRecoveryOnce() {
  try {
    const CheckoutWorkflowService = require('./services/checkout-workflow-service');
    const out = CheckoutWorkflowService.recoverStaleInFlightSessions({
      ttlMs: CHECKOUT_STALE_INFLIGHT_TTL_MS,
      limit: 200
    });
    if (out?.recovered > 0) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_stale_inflight_recovered'); } catch (_) {}
    }
    return out;
  } catch (_) {
    return { scanned: 0, recovered: 0 };
  }
}

function buildStageContract(sessionId) {
  const stage = _getCheckoutStage(sessionId) || 'collecting_details';
  let paymentStatus = '';
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    paymentStatus = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'payment_outcome_status') || '').toLowerCase();
  } catch (_) {}
  const nextActionsByStage = {
    collecting_details: ['provide_email'],
    code_sent: ['enter_code'],
    code_verified: ['continue_secure_checkout'],
    checkout_prepared: ['complete_payment_form'],
    payment_confirmed: ['view_receipt', 'track_delivery'],
    failed: ['retry_current_context', 'start_over_new_context']
  };
  let paymentFailureReason = '';
  let stageMeta = {};
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    paymentFailureReason = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_reason') || '');
    stageMeta = {
      source: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_source') || ''),
      actor: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_actor') || ''),
      reason: paymentFailureReason,
      context_version: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_context_version') || ''),
      timestamp_ms: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_timestamp_ms') || '')
    };
  } catch (_) {}
  let commerceCheckout = null;
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    const rawLast = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'last_commerce_checkout_chat') || '').trim();
    const checkoutIdMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_checkout_id') || '').trim();
    const paymentIntentIdMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_payment_intent_id') || '').trim();
    const merchantIdMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
    let parsed = null;
    if (rawLast) {
      try {
        parsed = JSON.parse(rawLast);
      } catch (_) {
        parsed = null;
      }
    }
    const parsedCheckout = parsed && parsed.commerce_checkout && typeof parsed.commerce_checkout === 'object'
      ? parsed.commerce_checkout
      : null;
    const parsedPa = parsedCheckout && parsedCheckout.payment_action && typeof parsedCheckout.payment_action === 'object'
      ? parsedCheckout.payment_action
      : null;
    const parsedPi = parsedPa && parsedPa.payment_intent_id ? String(parsedPa.payment_intent_id) : '';
    const parsedCs = parsedPa && parsedPa.client_secret ? String(parsedPa.client_secret) : '';
    const pi = paymentIntentIdMeta || parsedPi;
    const cs = parsedCs;
    if ((stage === 'checkout_prepared' || stage === 'payment_confirmed') && (pi || cs || checkoutIdMeta)) {
      commerceCheckout = {
        success: true,
        checkout_id: checkoutIdMeta || (parsedCheckout && parsedCheckout.checkout_id) || null,
        payment_intent_id: pi || null,
        merchant_id: merchantIdMeta || null,
        payment_action: pi
          ? {
              type: 'stripe_payment_intent',
              payment_intent_id: pi,
              client_secret: cs || null,
              requires_action: false
            }
          : null
      };
    }
  } catch (_) {}
  return {
    checkout_stage: stage,
    allowed_next_actions: nextActionsByStage[stage] || ['provide_email'],
    policy_flags: {
      can_show_payment_form: stage === 'checkout_prepared',
      can_show_receipt: stage === 'payment_confirmed',
      verification_required: stage === 'collecting_details' || stage === 'code_sent',
      payment_pending: stage === 'checkout_prepared' || paymentStatus === 'processing',
      payment_failed: stage === 'failed' || ['requires_payment_method', 'canceled', 'failed'].includes(paymentStatus),
      can_retry_payment: stage === 'failed',
      can_start_over: stage === 'failed'
    },
    commerce_checkout: commerceCheckout,
    stage_meta: stageMeta,
    payment_failure_reason: stage === 'failed' ? paymentFailureReason || paymentStatus || 'payment_failed' : null
  };
}

function _checkoutStageTemplate(stage, email = null) {
  if (stage === 'code_sent') {
    const e = String(email || '').trim();
    return e
      ? `We sent a 6-digit verification code to ${e}. Please enter that code in chat to continue to secure checkout.`
      : 'We sent a 6-digit verification code to your email. Please enter that code in chat to continue to secure checkout.';
  }
  if (stage === 'code_verified') {
    return 'Email verified. Continue secure checkout and I will prepare secure payment now.';
  }
  if (stage === 'checkout_prepared') {
    return 'Secure checkout is prepared. Complete payment in the secure checkout form.';
  }
  if (stage === 'payment_confirmed') {
    return 'Payment confirmed. Your order is complete and receipt details are available.';
  }
  if (stage === 'failed') {
    return 'Payment was not completed. Please retry secure checkout to continue.';
  }
  return null;
}

function _canonicalRailCopy(key, data = {}) {
  const email = String(data.email || '').trim();
  const byKey = {
    provide_email: 'Please share your email address so I can send a 6-digit verification code.',
    enter_code: email
      ? `We sent a 6-digit verification code to ${email}. Please enter that code to continue.`
      : 'We sent a 6-digit verification code to your email. Please enter that code to continue.',
    shipping_required: 'Please share your full shipping address (street, city, state, ZIP) before secure checkout.',
    stale_verification: 'Your verification state expired for this checkout. Please request and verify a new 6-digit code.',
    cart_changed: 'Your cart changed, so verification details were reset for safety. Please verify email and shipping again.',
    prepared_ready: 'Secure checkout is ready. Please complete payment in the secure checkout form.',
    payment_confirmed: 'Payment confirmed. Your order is complete and receipt details are available.',
    payment_failed: 'Payment was not completed. Say "**continue secure checkout**" to retry secure payment.'
  };
  return byKey[key] || '';
}

function _estimateCheckoutLLMCostUsd(usage = null) {
  const prompt = Number(usage?.prompt_tokens || 0);
  const completion = Number(usage?.completion_tokens || 0);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || (prompt <= 0 && completion <= 0)) return null;
  // Conservative estimate for checkout logs; exact billing source remains provider invoices.
  const primary = String(process.env.KELLY_PRIMARY_PROVIDER || 'anthropic').toLowerCase();
  const inRatePerM = primary === 'groq' ? 0.59 : 3.0;
  const outRatePerM = primary === 'groq' ? 0.79 : 15.0;
  const usd = ((prompt / 1_000_000) * inRatePerM) + ((completion / 1_000_000) * outRatePerM);
  return Number.isFinite(usd) ? Number(usd.toFixed(6)) : null;
}

function _logCheckoutLLMUsage(sessionId, usage) {
  if (!usage || typeof usage !== 'object') return;
  try {
    const estimated_cost_usd = _estimateCheckoutLLMCostUsd(usage);
    console.info('[checkout-llm-usage]', {
      session_id: String(sessionId || ''),
      prompt_tokens: Number(usage.prompt_tokens || 0),
      completion_tokens: Number(usage.completion_tokens || 0),
      total_tokens: Number(usage.total_tokens || 0),
      estimated_cost_usd
    });
  } catch (_) {}
}

function _isExplicitCheckoutResetIntent(message) {
  return /\b(reset checkout|reset|start over|new order|cancel checkout)\b/i.test(String(message || ''));
}

function _mapAlreadyInProgressCopyByStage(sessionId) {
  const stage = _getCheckoutStage(sessionId) || 'collecting_details';
  if (stage === 'payment_confirmed') {
    try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_in_progress_after_confirmed'); } catch (_) {}
    return 'Payment is already confirmed for this session. Your receipt details are available.';
  }
  if (stage === 'failed') {
    return _canonicalRailCopy('payment_failed');
  }
  if (stage === 'checkout_prepared') {
    return _canonicalRailCopy('prepared_ready');
  }
  if (stage === 'code_verified') {
    return 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.';
  }
  return _canonicalRailCopy('provide_email');
}

function _extractShippingAddressParts(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const scrubbed = raw.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig, ' ').replace(/\s+/g, ' ').trim();
  const zipMatch = scrubbed.match(/\b(\d{5})(?:-\d{4})?\b/);
  const stateMatch = scrubbed.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|DC)\b/i);
  const nyHint = /\b(nyc|new york city|new york|bronx|brooklyn|queens|staten island|manhattan)\b/i.test(scrubbed);
  const hasStreetNumber = /\b\d{1,6}\b/.test(scrubbed);
  const hasStreetWord = /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/i.test(scrubbed);
  const parts = scrubbed.split(',').map((s) => s.trim()).filter(Boolean);
  const city = parts.length >= 2 ? parts[parts.length - 2] : '';
  const state = stateMatch ? String(stateMatch[1]).toUpperCase() : (nyHint ? 'NY' : '');
  return {
    raw: scrubbed || raw,
    line1: parts[0] || raw,
    city: city || '',
    state,
    postal_code: zipMatch ? zipMatch[1] : '',
    complete: !!(zipMatch && state && hasStreetNumber && hasStreetWord)
  };
}

async function _maybeHandleDeterministicCommerceVerificationTurn({
  message,
  sessionId,
  clinicId,
  patientId,
  channel
}) {
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    const msg = String(message || '').trim();
    const emailMatch = msg.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    const codeMatch = msg.match(/\b(\d{6})\b/);
    const pendingEmail = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') || '').trim();
    let stage = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage') || '');
    const verifiedEmailMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_verified') || '').trim().toLowerCase();
    const shippingCompleteMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
    const shippingLine1Meta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_line1') || '').trim();
    // Reconcile drifted resume state so verified sessions do not regress to email prompts.
    if ((stage === 'collecting_details' || stage === 'code_sent') && verifiedEmailMeta) {
      KellyToolExecutor._setCheckoutStage?.(sessionId, 'code_verified', {
        reason: 'resume_state_reconciliation',
        source: 'deterministic_handler'
      });
      stage = 'code_verified';
    }
    if (stage === 'code_verified' && shippingCompleteMeta && shippingLine1Meta) {
      KellyToolExecutor._setSessionMeta?.(sessionId, 'commerce_email_pending', verifiedEmailMeta || String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') || ''));
    }
    const shipping = _extractShippingAddressParts(msg);
    const continueIntent = /\b(continue|proceed|secure checkout|checkout now|continue checkout)\b/i.test(msg);
    const paymentHelpIntent = /\b(how do i pay|how to pay|pay now|where do i pay|payment (form|screen|link)|ready to pay)\b/i.test(msg);
    const visibilityHelpIntent = /\b(i can'?t see|cant see|cannot see|don'?t see|where is (the )?(payment|checkout)|nothing shows|not showing)\b/i.test(msg);
    const checkoutRailIntent = /\b(confirm cart|checkout|pay|payment|verify|verification|code|email|secure checkout)\b/i.test(msg);
    const railLockedStage = stage === 'checkout_prepared' || stage === 'payment_confirmed' || stage === 'failed';
    const resetIntent = _isExplicitCheckoutResetIntent(msg);
    let shippingCaptured = false;

    // Hard rail lock: once payment is prepared/terminal, never drift back to verification prompts.
    if (railLockedStage && !resetIntent && (emailMatch || codeMatch || continueIntent || paymentHelpIntent || visibilityHelpIntent || checkoutRailIntent)) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }

    if (shipping && shipping.complete) {
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_address', shipping.raw);
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_line1', shipping.line1);
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_city', shipping.city);
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_state', shipping.state);
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_postal_code', shipping.postal_code);
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_complete', '1');
      KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_updated_at_ms', String(Date.now()));
      KellyToolExecutor._setSessionMeta(
        sessionId,
        'commerce_shipping_context_version',
        String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_context_version') || '1')
      );
      try {
        const merchantIdForFp = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
        if (merchantIdForFp) {
          const cartForFp = db.getCommerceCart(sessionId, merchantIdForFp);
          const fpItems = Array.isArray(cartForFp?.items) ? [...cartForFp.items] : [];
          fpItems.sort((a, b) => String(a.product_id || '').localeCompare(String(b.product_id || '')));
          const fp = JSON.stringify(
            fpItems.map((it) => ({
              product_id: String(it.product_id || ''),
              quantity: Number(it.quantity || 0),
              unit_price: Number(it.unit_price || 0)
            }))
          );
          KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_cart_fingerprint', fp);
        }
      } catch (_) {}
      shippingCaptured = true;
      if (stage !== 'code_verified') {
        if (emailMatch && !codeMatch) {
          // Continue into deterministic email handler below so mixed email+address
          // in one turn sends code and persists shipping together.
        } else {
          const pending = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') || '').trim();
          if (pending) {
            return {
              handled: true,
              result: {
                reply: _canonicalRailCopy('enter_code', { email: pending }),
                endCall: false,
                toolsUsed: ['save_shipping_address']
              }
            };
          }
          return {
            handled: true,
            result: {
              reply: _canonicalRailCopy('provide_email'),
              endCall: false,
              toolsUsed: ['save_shipping_address']
            }
          };
        }
      } else {
        return {
          handled: true,
          result: {
            reply: 'Shipping address saved. Say "**continue secure checkout**" and I will prepare secure payment now.',
            endCall: false,
            toolsUsed: ['save_shipping_address']
          }
        };
      }
    }

    // Never restart verification while payment is in progress or already confirmed.
    if (emailMatch && !codeMatch && (stage === 'checkout_prepared' || stage === 'payment_confirmed')) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }

    // Deterministic email intercept: always send verification code on first email capture.
    if (emailMatch && !codeMatch) {
      const email = String(emailMatch[0]).toLowerCase();
      const sent = await KellyToolExecutor.execute(
        'send_commerce_verification_code',
        { email },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (sent?.success) {
        return {
          handled: true,
          result: {
            reply: shippingCaptured
            ? `I saved your shipping address. ${_canonicalRailCopy('enter_code', { email })}`
            : _canonicalRailCopy('enter_code', { email }),
            endCall: false,
            toolsUsed: ['send_commerce_verification_code']
          }
        };
      }
      return {
        handled: true,
        result: {
          reply: 'I could not send the verification code just now. Please confirm your email and try again.',
          endCall: false,
          toolsUsed: ['send_commerce_verification_code']
        }
      };
    }

    // Deterministic code intercept: verify code as soon as user provides 6 digits.
    if (codeMatch && pendingEmail) {
      const code = codeMatch[1];
      const verify = await KellyToolExecutor.execute(
        'verify_commerce_code',
        { email: pendingEmail, code },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (verify?.success) {
        return {
          handled: true,
          result: {
            reply: 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.',
            endCall: false,
            toolsUsed: ['verify_commerce_code']
          }
        };
      }
      return {
        handled: true,
        result: {
          reply: 'That verification code did not match. Please try the 6-digit code again or ask me to resend.',
          endCall: false,
          toolsUsed: ['verify_commerce_code']
        }
      };
    }

    // Deterministic post-prepare/terminal continue intercepts should never fall back to LLM.
    if (continueIntent && (stage === 'checkout_prepared' || stage === 'payment_confirmed' || stage === 'failed')) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }
    // Deterministic payment-help intercept for prepared/terminal stages.
    if (paymentHelpIntent && (stage === 'checkout_prepared' || stage === 'payment_confirmed' || stage === 'failed')) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }

    // Deterministic continue-checkout intercept: only after verified stage + complete shipping.
    if (continueIntent && stage === 'code_verified') {
      const verifiedEmail =
        String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_verified') || pendingEmail || '').trim().toLowerCase();
      const shippingComplete = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
      const shippingRaw = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_address') || '').trim();
      if (!verifiedEmail) {
        return {
          handled: true,
          result: {
            reply: 'Please share your email so I can send a 6-digit verification code first.',
            endCall: false,
            toolsUsed: []
          }
        };
      }
      if (!shippingComplete || !shippingRaw) {
        const storedLine1 = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_line1') || '').trim();
        const storedCity = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_city') || '').trim();
        const storedState = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_state') || '').trim();
        const storedZip = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_postal_code') || '').trim();
        const missing = [];
        if (!storedLine1) missing.push('street address');
        if (!storedCity) missing.push('city');
        if (!storedState) missing.push('state');
        if (!storedZip) missing.push('ZIP code');
        return {
          handled: true,
          result: {
            reply: missing.length
              ? `I still need your ${missing.join(', ')} before secure checkout.`
              : _canonicalRailCopy('shipping_required'),
            endCall: false,
            toolsUsed: []
          }
        };
      }
      const prep = await KellyToolExecutor.execute(
        'prepare_commerce_checkout',
        { customer_email: verifiedEmail, shipping_address: shippingRaw, use_cart: true },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (prep?.success) {
        return {
          handled: true,
          result: {
            reply: 'Secure checkout is prepared. Complete payment in the secure checkout interface below.',
            endCall: false,
            toolsUsed: ['prepare_commerce_checkout'],
            commerce_checkout: prep?.commerce_checkout || null
          }
        };
      }
      if (String(prep?.error || '') === 'checkout_already_in_progress') {
        return {
          handled: true,
          result: {
            reply: _mapAlreadyInProgressCopyByStage(sessionId),
            endCall: false,
            toolsUsed: ['prepare_commerce_checkout']
          }
        };
      }
      return {
        handled: true,
        result: {
          reply: String(prep?.message || 'I could not prepare checkout yet. Please try again.'),
          endCall: false,
          toolsUsed: ['prepare_commerce_checkout']
        }
      };
    }
  } catch (_) {}
  return { handled: false, result: null };
}

async function handlePatientCheckoutChatMessage(req) {
  const PatientPortalService = require('./services/patient-portal-service');
  const KellyAgentService = require('./services/kelly-agent-service');
  const CheckoutGraph = require('./services/checkout-graph');
  const { resolveMerchantIdForCheckoutChat, applyCommerceQuantityIntentIfEligible } = require('./utils/public-commerce-helpers');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  let clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
  if (!clinicId && mappedPatientId && db?.getPatientClinicIds) {
    try {
      const patientClinics = db.getPatientClinicIds(mappedPatientId);
      clinicId = patientClinics?.[0] || null;
    } catch (_) {}
  }
  if (!clinicId) {
    return {
      status: 400,
      json: {
        success: false,
        error: 'clinic_id required. Set DEFAULT_CLINIC_ID in .env, include clinic_id in request, or ensure patient has appointments.',
        request_id: req.id
      }
    };
  }
  const message = (req.body?.message || '').toString().trim();
  const productId = (req.body?.product_id || '').toString().trim();
  const providerId = (req.body?.provider_id || '').toString().trim();
  let session_id = (req.body?.session_id || '').toString().trim() || null;
  if (!session_id) session_id = require('uuid').v4();
  if (_getCheckoutStage(session_id) === 'checkout_prepared') {
    await _syncCheckoutPaymentStatusIfPrepared(session_id, 'turn_pre_reply');
  }
  if (_looksLikeCardOrCvv(message)) {
    return {
      status: 200,
      json: {
        success: true,
        reply: 'For your security, please do not enter card numbers or CVV in chat. Use the secure payment form only.',
        session_id,
        ...buildStageContract(session_id),
        toolsUsed: [],
        request_id: req.id
      }
    };
  }
  const deterministic = await _maybeHandleDeterministicCommerceVerificationTurn({
    message,
    sessionId: session_id,
    clinicId,
    patientId: mappedPatientId,
    channel: 'chat'
  });
  if (deterministic.handled) {
    return {
      status: 200,
      json: {
        success: true,
        reply: deterministic.result.reply,
        session_id,
        ...buildStageContract(session_id),
        toolsUsed: Array.isArray(deterministic.result.toolsUsed) ? deterministic.result.toolsUsed : [],
        request_id: req.id
      }
    };
  }

  const merchantIdEarly = resolveMerchantIdForCheckoutChat({ providerId, clinicId });
  if (merchantIdEarly && message) {
    try {
      await applyCommerceQuantityIntentIfEligible({
        message,
        sessionId: session_id,
        merchantId: merchantIdEarly,
        productId: productId || undefined
      });
    } catch (e) {
      console.warn('⚠️  commerce quantity intent:', e.message);
    }
  }

  const graphPayload = {
    message,
    sessionId: session_id,
    clinicId,
    patientId: mappedPatientId,
    patientEmail: email,
    productId,
    providerId
  };
  let result = await _runCheckoutGraphWithCircuitBreaker(CheckoutGraph, graphPayload, 2000);
  if (!result?.success) {
    if (_isMidFlightCheckout(session_id, message)) {
      result = _safeCheckoutDegradeResponse();
    } else {
    result = await KellyAgentService.processTurn({
      message,
      sessionId: session_id,
      channel: 'chat',
      clinicId,
      patientId: mappedPatientId,
      patientName: null,
      patientEmail: email,
      portalSessionId: sid,
      commerceCheckout: { productId, providerId }
    });
    }
  }

  const row = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
  let conversationHistory = Array.isArray(row?.conversation_history) ? row.conversation_history : [];
  // Commerce flow does not use triage wipe rules — persist turns for continuity.
  if (db?.upsertOrchestrateSession) {
    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: result.reply }
    ];
    const newTurnCount = (row?.turn_count || 0) + 1;
    try {
      db.upsertOrchestrateSession({
        session_id,
        channel: 'chat',
        patient_id: mappedPatientId,
        portal_session_id: sid,
        clinic_id: clinicId,
        conversation_history: updatedHistory,
        flow_state: { ...(row?.flow_state || {}), commerce_checkout: { product_id: productId, provider_id: providerId } },
        turn_count: newTurnCount,
        preferred_language: row?.preferred_language || 'en'
      });
    } catch (e) {
      console.warn('⚠️  Failed to persist checkout chat session:', e.message);
    }
  }

  const reply = normalizeCheckoutVerificationReply(
    (result.reply && String(result.reply).trim()) || "I'm here. How can I help you today?",
    session_id
  );
  return {
    status: 200,
    json: {
      success: true,
      reply,
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      redirect_to: result.redirect_to || null,
      next_chips: result.next_chips || [],
      chips_display: result.chips_display,
      next_step: result.next_step,
      quote_id: result.quote_id || null,
      commerce_checkout: result.commerce_checkout || null,
      llm_usage: result.llm_usage || null,
      safe_degraded: !!result.safe_degraded,
      human_handoff_recommended: !!result.human_handoff_recommended,
      request_id: req.id
    }
  };
}

function normalizeCheckoutVerificationReply(text, sessionId = null) {
  const s = String(text || '').trim();
  if (!s) return s;
  const stage = _getCheckoutStage(sessionId) || 'collecting_details';
  if (
    stage === 'checkout_prepared' &&
    /\b(email address|6-?digit verification code|send (a )?code|verify your email|what'?s your email|shipping address|street, city, state, ZIP)\b/i.test(s)
  ) {
    return 'Secure checkout is prepared. Complete payment in the secure checkout form.';
  }
  try {
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    const shippingComplete =
      String(KellyToolExecutor?._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
    if (
      stage === 'code_verified' &&
      /\b(6-digit verification code|send code|enter (the )?6-digit code|verification code)\b/i.test(s)
    ) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_duplicate_otp_prompt'); } catch (_) {}
      return 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.';
    }
    if (
      stage === 'code_verified' &&
      shippingComplete &&
      /\b(share|provide).{0,30}(full )?shipping address\b/i.test(s)
    ) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_shipping_reask_after_capture'); } catch (_) {}
      return 'Shipping address saved. Say "**continue secure checkout**" and I will prepare secure payment now.';
    }
  } catch (_) {}
  if (/checkout (is )?already in progress|already in progress/i.test(s)) {
    return _mapAlreadyInProgressCopyByStage(sessionId);
  }
  const forbiddenByStage = {
    collecting_details: /\b(checkout is ready|secure payment is now ready|checkout (is )?already in progress|already in progress|payment form|order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order|enter your card|card details)\b/i,
    code_sent: /\b(checkout is ready|secure payment is now ready|checkout (is )?already in progress|already in progress|payment form|order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order|enter your card|card details)\b/i,
    code_verified: /\b(order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order|receipt)\b/i,
    checkout_prepared: /\b(order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order)\b/i,
    payment_confirmed: null,
    failed: /\b(order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order)\b/i
  };
  const templateByStage = {
    collecting_details: () => 'Please share your email address so I can send a 6-digit verification code to continue to secure checkout.',
    code_sent: (email) =>
      email
        ? `We sent a 6-digit verification code to ${email}. Please enter that code to continue to secure checkout.`
        : 'We sent a 6-digit verification code to your email. Please enter that code to continue to secure checkout.',
    code_verified: () => 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.',
    checkout_prepared: () => 'Secure checkout is prepared. Complete payment in the secure checkout form.',
    payment_confirmed: () => 'Payment confirmed. Your order is complete and receipt details are available.',
    failed: () => 'Payment was not completed. Please say "**continue secure checkout**" to retry.'
  };
  const forbidden = Object.prototype.hasOwnProperty.call(forbiddenByStage, stage)
    ? forbiddenByStage[stage]
    : forbiddenByStage.collecting_details;
  if (forbidden && forbidden.test(s)) {
    try {
      db.incrementOpsCounter && db.incrementOpsCounter('checkout_forbidden_payment_ready_phrase');
    } catch (_) {}
    try {
      console.warn('[checkout-stage] policy_violation_replaced', {
        session_id: String(sessionId || ''),
        stage,
        snippet: s.slice(0, 220)
      });
    } catch (_) {}
    const templateFn = templateByStage[stage];
    if (templateFn) {
      let email = null;
      try {
        const KellyToolExecutor = require('./services/kelly-tool-executor');
        email =
          KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') ||
          KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_verified') ||
          null;
      } catch (_) {}
      const canonical = templateFn(email);
      if (canonical) return canonical;
    }
  }

  if (stage === 'code_sent' || stage === 'collecting_details') {
    const looksLikeHandoff =
      /(secure payment page|secure payment form|taken to .*secure payment|complete your purchase|enter your card details)/i.test(s);
    const mentionsVerification = /(verification code|6-?digit code|verify your email)/i.test(s);
    if (looksLikeHandoff && !mentionsVerification) {
      return `${s} Before payment, please enter the 6-digit verification code we emailed you.`;
    }
  }
  return s;
}

async function _runCheckoutPreparedBackfillOnce() {
  try {
    const rows = db.db.prepare(`
      SELECT session_id, value AS updated_at_ms
      FROM kelly_session_meta_kv
      WHERE meta_key = 'checkout_stage_updated_at_ms'
        AND session_id IN (
          SELECT session_id FROM kelly_session_meta_kv
          WHERE meta_key = 'checkout_stage' AND value = 'checkout_prepared'
        )
    `).all();
    const stale = (rows || []).filter((r) => {
      const ts = parseInt(String(r?.updated_at_ms || '0'), 10);
      return Number.isFinite(ts) && ts > 0 && (Date.now() - ts > CHECKOUT_PREPARED_STALE_MS);
    });
    if (!stale.length) return;
    const KellyToolExecutor = require('./services/kelly-tool-executor');
    for (const row of stale) {
      const sid = String(row?.session_id || '').trim();
      if (!sid) continue;
      KellyToolExecutor._setCheckoutStage(sid, 'failed', { reason: 'legacy_stuck_checkout_prepared_backfill' });
      KellyToolExecutor._setSessionMeta(sid, 'payment_outcome_status', 'failed');
      KellyToolExecutor._setSessionMeta(sid, 'payment_status_source', 'startup_backfill');
      KellyToolExecutor._setSessionMeta(sid, 'payment_status_last_checked_at', String(Date.now()));
      try {
        db.enqueueToolCallDLQ && db.enqueueToolCallDLQ({
          call_id: `checkout_backfill_${sid}`,
          function_name: 'checkout_backfill_reconciliation',
          parameters: { session_id: sid },
          error_message: 'legacy_stuck_checkout_prepared_session_recovered'
        });
      } catch (_) {}
    }
    try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_stale_prepared_backfill_recovered'); } catch (_) {}
  } catch (_) {}
}

// POST /api/patient/checkout-chat/turn/stream — Same as /turn but streams Groq token deltas (SSE).
async function handlePatientCheckoutChatMessageStream(req, res) {
  const PatientPortalService = require('./services/patient-portal-service');
  const KellyAgentService = require('./services/kelly-agent-service');
  const CheckoutGraph = require('./services/checkout-graph');
  const { resolveMerchantIdForCheckoutChat, applyCommerceQuantityIntentIfEligible } = require('./utils/public-commerce-helpers');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  let clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
  if (!clinicId && mappedPatientId && db?.getPatientClinicIds) {
    try {
      const patientClinics = db.getPatientClinicIds(mappedPatientId);
      clinicId = patientClinics?.[0] || null;
    } catch (_) {}
  }
  const sseWrite = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  if (!clinicId) {
    sseWrite({
      type: 'error',
      success: false,
      error:
        'clinic_id required. Set DEFAULT_CLINIC_ID in .env, include clinic_id in request, or ensure patient has appointments.',
      request_id: req.id
    });
    return res.end();
  }
  const message = (req.body?.message || '').toString().trim();
  const productId = (req.body?.product_id || '').toString().trim();
  const providerId = (req.body?.provider_id || '').toString().trim();
  let session_id = (req.body?.session_id || '').toString().trim() || null;
  if (!session_id) session_id = require('uuid').v4();
  if (_getCheckoutStage(session_id) === 'checkout_prepared') {
    await _syncCheckoutPaymentStatusIfPrepared(session_id, 'stream_pre_reply');
  }
  if (_looksLikeCardOrCvv(message)) {
    sseWrite({
      type: 'done',
      success: true,
      reply: 'For your security, please do not enter card numbers or CVV in chat. Use the secure payment form only.',
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: [],
      request_id: req.id
    });
    return res.end();
  }
  const deterministic = await _maybeHandleDeterministicCommerceVerificationTurn({
    message,
    sessionId: session_id,
    clinicId,
    patientId: mappedPatientId,
    channel: 'chat'
  });
  if (deterministic.handled) {
    sseWrite({
      type: 'done',
      success: true,
      reply: deterministic.result.reply,
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: Array.isArray(deterministic.result.toolsUsed) ? deterministic.result.toolsUsed : [],
      commerce_checkout: deterministic.result.commerce_checkout || null,
      request_id: req.id
    });
    return res.end();
  }

  const onStreamDelta = (text) => {
    if (text) sseWrite({ type: 'delta', text: String(text) });
  };

  try {
    const merchantIdEarly = resolveMerchantIdForCheckoutChat({ providerId, clinicId });
    if (merchantIdEarly && message) {
      try {
        await applyCommerceQuantityIntentIfEligible({
          message,
          sessionId: session_id,
          merchantId: merchantIdEarly,
          productId: productId || undefined
        });
      } catch (e) {
        console.warn('⚠️  commerce quantity intent (stream):', e.message);
      }
    }

    const graphPayload = {
      message,
      sessionId: session_id,
      clinicId,
      patientId: mappedPatientId,
      patientEmail: email,
      productId,
      providerId
    };
    let result = await _runCheckoutGraphWithCircuitBreaker(CheckoutGraph, graphPayload, 2000);
    if (!result?.success) {
      if (_isMidFlightCheckout(session_id, message)) {
        result = _safeCheckoutDegradeResponse();
      } else {
      result = await KellyAgentService.processTurn({
        message,
        sessionId: session_id,
        channel: 'chat',
        clinicId,
        patientId: mappedPatientId,
        patientName: null,
        patientEmail: email,
        portalSessionId: sid,
        commerceCheckout: { productId, providerId },
        onStreamDelta,
        onToolStatus: (toolName, text) => {
          sseWrite({ type: 'tool_status', tool: toolName, text: text || '…' });
        }
      });
      }
    }

    const row = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
    let conversationHistory = Array.isArray(row?.conversation_history) ? row.conversation_history : [];
    if (db?.upsertOrchestrateSession) {
      const updatedHistory = [
        ...conversationHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: result.reply }
      ];
      const newTurnCount = (row?.turn_count || 0) + 1;
      try {
        db.upsertOrchestrateSession({
          session_id,
          channel: 'chat',
          patient_id: mappedPatientId,
          portal_session_id: sid,
          clinic_id: clinicId,
          conversation_history: updatedHistory,
          flow_state: {
            ...(row?.flow_state || {}),
            commerce_checkout: { product_id: productId, provider_id: providerId }
          },
          turn_count: newTurnCount,
          preferred_language: row?.preferred_language || 'en'
        });
      } catch (e) {
        console.warn('⚠️  Failed to persist checkout chat session (stream):', e.message);
      }
    }

    const reply = normalizeCheckoutVerificationReply(
      (result.reply && String(result.reply).trim()) || "I'm here. How can I help you today?"
      , session_id);
    sseWrite({
      type: 'done',
      success: true,
      reply,
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      redirect_to: result.redirect_to || null,
      next_chips: result.next_chips || [],
      chips_display: result.chips_display,
      next_step: result.next_step,
      quote_id: result.quote_id || null,
      commerce_checkout: result.commerce_checkout || null,
      safe_degraded: !!result.safe_degraded,
      human_handoff_recommended: !!result.human_handoff_recommended,
      request_id: req.id
    });
    return res.end();
  } catch (e) {
    console.error('checkout-chat stream error:', e);
    sseWrite({ type: 'error', success: false, error: e.message || 'stream_failed', request_id: req.id });
    return res.end();
  }
}

// POST /api/patient/orchestrate — Alias for triage/message (deprecated: use triage/message) (P-1: CSRF)
app.post('/api/patient/orchestrate', apiLimiter, requirePatientSession, requireCsrfForCookieAuth, validatePatientTriageBody, express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const out = await handlePatientTriageMessage(req);
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/patient/triage/message', apiLimiter, requirePatientSession, requireCsrfForCookieAuth, validatePatientTriageBody, express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const out = await handlePatientTriageMessage(req);
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post(
  '/api/patient/checkout-chat/turn',
  apiLimiter,
  requirePatientSession,
  requireCsrfForCookieAuth,
  validatePatientCheckoutChatBody,
  express.json(),
  async (req, res) => {
    try {
      await rotatePatientSessionIfNeeded(req, res);
      const out = await handlePatientCheckoutChatMessage(req);
      return res.status(out.status).json(out.json);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message, request_id: req.id });
    }
  }
);

app.post(
  '/api/patient/checkout-chat/turn/stream',
  apiLimiter,
  requirePatientSession,
  requireCsrfForCookieAuth,
  validatePatientCheckoutChatBody,
  express.json(),
  async (req, res) => {
    try {
      await rotatePatientSessionIfNeeded(req, res);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      await handlePatientCheckoutChatMessageStream(req, res);
    } catch (e) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: e.message, request_id: req.id });
      }
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', success: false, error: e.message })}\n\n`);
      } catch (_) {}
      return res.end();
    }
  }
);

// Public checkout-chat routes (guest chat-first commerce, no patient session required)
app.post('/api/public/checkout-chat/turn', apiLimiter, validatePatientCheckoutChatBody, express.json(), async (req, res) => {
  const { startTrace, endTrace } = require('./services/langsmith-trace-service');
  const requestedSessionId = (req.body?.session_id || '').toString().trim() || null;
  const requestedProductId = (req.body?.product_id || '').toString().trim() || null;
  const resumeDecision = _normalizeResumeDecision(req.body?.resume_decision);
  const stageBefore = requestedSessionId ? _getCheckoutStage(requestedSessionId) : null;
  const traceCtx = await startTrace({
    name: 'public_checkout_chat_turn',
    inputs: {
      session_id: requestedSessionId,
      message: String(req.body?.message || ''),
      product_id: (req.body?.product_id || '').toString().trim() || null,
      provider_id: (req.body?.provider_id || '').toString().trim() || null
    },
    metadata: {
      route: '/api/public/checkout-chat/turn',
      source: 'landing_page',
      checkout_stage_before: stageBefore
    },
    tags: ['landing-page', 'checkout', 'kelly']
  });
  try {
    if (!req.patientSessionId) {
      req.patientSessionId = (req.headers['x-session-id'] || '').toString().trim() || null;
    }
    if (CHECKOUT_RAIL_GUARDS_ENABLED && requestedSessionId && requestedProductId) {
      _applyProductScopeForSession(requestedSessionId, requestedProductId, 'public_turn');
    }
    if (requestedSessionId && resumeDecision) {
      _applyCheckoutResumeDecision(requestedSessionId, resumeDecision, 'public_turn');
    }
    const out = await handlePatientCheckoutChatMessage(req);
    const traceSessionId = out?.json?.session_id || requestedSessionId;
    const stageAfter = traceSessionId ? _getCheckoutStage(traceSessionId) : null;
    await endTrace(traceCtx, {
      outputs: {
        success: !!out?.json?.success,
        status: out?.status || 200,
        session_id: traceSessionId,
        terminal_state: out?.json?.terminal_state || null,
        checkout_stage_before: stageBefore,
        checkout_stage_after: stageAfter
      },
      usage: out?.json?.llm_usage || null
    });
    _logCheckoutLLMUsage(traceSessionId, out?.json?.llm_usage || null);
    return res.status(out.status).json(out.json);
  } catch (e) {
    await endTrace(traceCtx, { error: e?.message || 'public_checkout_chat_turn_failed' });
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/checkout-chat/turn/stream', apiLimiter, validatePatientCheckoutChatBody, express.json(), async (req, res) => {
  const { startTrace, endTrace } = require('./services/langsmith-trace-service');
  const requestedSessionId = (req.body?.session_id || '').toString().trim() || null;
  const requestedProductId = (req.body?.product_id || '').toString().trim() || null;
  const resumeDecision = _normalizeResumeDecision(req.body?.resume_decision);
  const stageBefore = requestedSessionId ? _getCheckoutStage(requestedSessionId) : null;
  const traceCtx = await startTrace({
    name: 'public_checkout_chat_turn_stream',
    inputs: {
      session_id: requestedSessionId,
      message: String(req.body?.message || ''),
      product_id: (req.body?.product_id || '').toString().trim() || null,
      provider_id: (req.body?.provider_id || '').toString().trim() || null
    },
    metadata: {
      route: '/api/public/checkout-chat/turn/stream',
      source: 'landing_page',
      checkout_stage_before: stageBefore
    },
    tags: ['landing-page', 'checkout', 'kelly', 'stream']
  });
  try {
    if (!req.patientSessionId) {
      req.patientSessionId = (req.headers['x-session-id'] || '').toString().trim() || null;
    }
    if (CHECKOUT_RAIL_GUARDS_ENABLED && requestedSessionId && requestedProductId) {
      _applyProductScopeForSession(requestedSessionId, requestedProductId, 'public_turn_stream');
    }
    if (requestedSessionId && resumeDecision) {
      _applyCheckoutResumeDecision(requestedSessionId, resumeDecision, 'public_turn_stream');
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    await handlePatientCheckoutChatMessageStream(req, res);
    const stageAfter = requestedSessionId ? _getCheckoutStage(requestedSessionId) : null;
    await endTrace(traceCtx, {
      outputs: {
        success: true,
        session_id: requestedSessionId,
        checkout_stage_before: stageBefore,
        checkout_stage_after: stageAfter
      }
    });
  } catch (e) {
    await endTrace(traceCtx, { error: e?.message || 'public_checkout_chat_stream_failed' });
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: e.message, request_id: req.id });
    }
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', success: false, error: e.message })}\n\n`);
    } catch (_) {}
    return res.end();
  }
});

// Lightweight stage-sync endpoint for deterministic checkout UI restore.
app.get('/api/public/checkout-chat/stage', apiLimiter, async (req, res) => {
  try {
    const session_id = String(req.query.session_id || '').trim();
    const productId = String(req.query.product_id || '').trim();
    const resumeDecision = _normalizeResumeDecision(req.query.resume_decision);
    const uiMode = String(req.query.ui_mode || '').trim().toLowerCase();
    const checkoutIntent = String(req.query.checkout_intent || '').trim() === '1';
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    if (resumeDecision) {
      _applyCheckoutResumeDecision(session_id, resumeDecision, 'public_stage_sync');
    }
    if (CHECKOUT_RAIL_GUARDS_ENABLED && productId) {
      _applyProductScopeForSession(session_id, productId, 'public_stage_sync');
    }
    await _syncCheckoutPaymentStatusIfPrepared(session_id, 'public_stage_sync');
    const contract = buildStageContract(session_id);
    let effectiveContract = contract;
    let resumeRequired = false;
    if (CHECKOUT_STAGE_SYNC_INTENT_AWARE && String(contract.checkout_stage) === 'checkout_prepared') {
      let storedDecision = '';
      try {
        storedDecision = String(KellyToolExecutor._getSessionMeta?.(session_id, 'checkout_resume_decision') || '').trim();
      } catch (_) {}
      const resumeAllowed =
        resumeDecision === 'continue' ||
        storedDecision === 'continue' ||
        checkoutIntent;
      if (!resumeAllowed) {
        try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_resume_required'); } catch (_) {}
        effectiveContract = {
          checkout_stage: 'collecting_details',
          allowed_next_actions: ['resume_or_start_over'],
          policy_flags: {
            can_show_payment_form: false,
            can_show_receipt: false,
            verification_required: false,
            payment_pending: false,
            payment_failed: false,
            resume_required: true
          }
        };
        resumeRequired = true;
      }
    }
    if (
      String(effectiveContract?.checkout_stage || '') === 'checkout_prepared' &&
      effectiveContract?.commerce_checkout &&
      effectiveContract.commerce_checkout.payment_action &&
      String(effectiveContract.commerce_checkout.payment_action.type || '') === 'stripe_payment_intent' &&
      !effectiveContract.commerce_checkout.payment_action.client_secret
    ) {
      try {
        const piId = String(effectiveContract.commerce_checkout.payment_action.payment_intent_id || '').trim();
        if (piId && process.env.STRIPE_SECRET_KEY) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const pi = await stripe.paymentIntents.retrieve(piId);
          const cs = String(pi?.client_secret || '').trim();
          if (cs) {
            effectiveContract = {
              ...effectiveContract,
              commerce_checkout: {
                ...effectiveContract.commerce_checkout,
                payment_action: {
                  ...effectiveContract.commerce_checkout.payment_action,
                  client_secret: cs
                }
              }
            };
          }
        }
      } catch (_) {}
    }
    return res.json({
      success: true,
      session_id,
      resume_decision_applied: resumeDecision || null,
      checkout_stage: effectiveContract.checkout_stage,
      policy_flags: effectiveContract.policy_flags,
      allowed_next_actions: effectiveContract.allowed_next_actions,
      commerce_checkout: effectiveContract.commerce_checkout || null,
      resume_required: resumeRequired,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.get('/api/public/checkout-chat/invariants', apiLimiter, async (req, res) => {
  try {
    const session_id = String(req.query.session_id || '').trim();
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    const CheckoutWorkflowService = require('./services/checkout-workflow-service');
    const report = CheckoutWorkflowService.validateCheckoutInvariants(session_id);
    return res.json({
      success: true,
      session_id,
      valid: !!report?.valid,
      stage: report?.stage || null,
      violations: Array.isArray(report?.violations) ? report.violations : [],
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/checkout-chat/reset', apiLimiter, express.json(), async (req, res) => {
  try {
    const session_id = String(req.body?.session_id || '').trim();
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    const reason = String(req.body?.reason || 'explicit_user_reset').trim() || 'explicit_user_reset';
    const reset = KellyToolExecutor.hardResetCheckoutContext?.(session_id, reason);
    const contract = buildStageContract(session_id);
    return res.json({
      success: !!reset?.success,
      session_id,
      checkout_context_version: reset?.checkout_context_version || null,
      checkout_stage: contract.checkout_stage,
      policy_flags: contract.policy_flags,
      allowed_next_actions: contract.allowed_next_actions,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/checkout-chat/payment-session/refresh', apiLimiter, express.json(), async (req, res) => {
  try {
    const { resolveMerchantIdForCheckoutChat } = require('./utils/public-commerce-helpers');
    const session_id = String(req.body?.session_id || '').trim();
    const provider_id = String(req.body?.provider_id || '').trim();
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    const stage = String(_getCheckoutStage(session_id) || '').trim();
    if (stage !== 'checkout_prepared' && stage !== 'code_verified') {
      return res.status(409).json({
        success: false,
        error: 'checkout_not_refreshable',
        checkout_stage: stage || 'collecting_details',
        request_id: req.id
      });
    }
    const merchantId = resolveMerchantIdForCheckoutChat({
      providerId: provider_id || undefined,
      clinicId: process.env.DEFAULT_CLINIC_ID || 'clinic-default'
    });
    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'merchant_required', request_id: req.id });
    }
    const cart = db.getCommerceCart(session_id, merchantId);
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
      return res.status(400).json({ success: false, error: 'cart_empty', request_id: req.id });
    }
    const email = String(
      KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_email_verified') ||
      KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_pending_email') ||
      req.body?.email ||
      ''
    ).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'email_required', request_id: req.id });
    }
    const phone = String(req.body?.phone || KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_customer_phone') || '').trim();
    const shippingLine1 = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_line1') || '').trim();
    const shippingCity = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_city') || '').trim();
    const shippingState = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_state') || '').trim();
    const shippingPostal = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_postal_code') || '').trim();
    const shippingLine2 = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_line2') || '').trim();
    const shippingAddress = shippingLine1 && shippingCity && shippingState && shippingPostal
      ? {
          line1: shippingLine1,
          line2: shippingLine2 || undefined,
          city: shippingCity,
          state: shippingState,
          postal_code: shippingPostal,
          country: 'US'
        }
      : undefined;
    try { db.clearCommerceCartCheckoutLock(session_id, merchantId); } catch (_) {}
    const checkoutResult = await PaymentOrchestrator.createCheckout({
      merchant_id: merchantId,
      customer: {
        name: String(req.body?.name || String(email).split('@')[0] || 'Customer'),
        phone: phone || '',
        email
      },
      items: cart.items.map((it) => ({
        product_id: it.product_id,
        name: it.name,
        unit_price: Number(it.unit_price),
        quantity: Number(it.quantity),
        total: Number(it.total)
      })),
      payment: { method: 'direct_stripe', currency: 'USD' },
      shipping_address: shippingAddress,
      metadata: {
        kelly_session_id: session_id,
        cart_session_id: session_id,
        refresh_reason: String(req.body?.reason || 'stale_payment_intent')
      }
    });
    if (!checkoutResult || checkoutResult.success === false) {
      return res.status(502).json({
        success: false,
        error: checkoutResult?.error || 'checkout_refresh_failed',
        message: checkoutResult?.message || 'Unable to refresh payment session',
        request_id: req.id
      });
    }
    try {
      if (checkoutResult.checkout_id) db.setCommerceCartCheckoutLock(session_id, merchantId, checkoutResult.checkout_id);
    } catch (_) {}
    KellyToolExecutor._setCheckoutStage(session_id, 'checkout_prepared', {
      checkout_id: checkoutResult.checkout_id || '',
      payment_intent_id: checkoutResult.payment?.payment_intent_id || checkoutResult.payment_intent_id || '',
      merchant_id: merchantId,
      source: 'refresh_payment_session'
    });
    const normalized = KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
      success: true,
      checkout: {
        checkout_id: checkoutResult.checkout_id || null,
        payment_link: checkoutResult.payment_link || null,
        payment_token: checkoutResult.payment_token || null,
        payment_intent_id: checkoutResult.payment?.payment_intent_id || checkoutResult.payment_intent_id || null,
        client_secret: checkoutResult.payment?.client_secret || checkoutResult.client_secret || null,
        requires_action: !!checkoutResult.requires_action,
        payment: checkoutResult.payment || null,
        message: checkoutResult.message || 'Checkout payment session refreshed'
      },
      cart
    });
    try {
      KellyToolExecutor._setSessionMeta(session_id, 'last_commerce_checkout_chat', JSON.stringify(normalized.commerce_checkout || {}));
    } catch (_) {}
    const contract = buildStageContract(session_id);
    return res.json({
      success: true,
      session_id,
      checkout_stage: contract.checkout_stage,
      policy_flags: contract.policy_flags,
      allowed_next_actions: contract.allowed_next_actions,
      commerce_checkout: normalized.commerce_checkout || contract.commerce_checkout || null,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'refresh_failed', request_id: req.id });
  }
});

// GET /api/patient/triage/history — Fetch conversation history for resume (orch-5)
app.get('/api/patient/triage/history', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const session_id = (req.query.session_id || '').toString().trim();
    if (!session_id) return res.json({ success: true, history: [], state: null });
    const row = db.getOrchestrateSessionBySessionId?.(session_id);
    if (!row) return res.json({ success: true, history: [], state: null });
    const hist = row.conversation_history ? (typeof row.conversation_history === 'string' ? JSON.parse(row.conversation_history) : row.conversation_history) : [];
    const fs = row.flow_state ? (typeof row.flow_state === 'string' ? JSON.parse(row.flow_state) : row.flow_state) : null;
    return res.json({ success: true, history: hist, state: fs, session_id: row.session_id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Patient: Mark appointment as completed (end of video visit)
app.post('/api/patient/appointments/:id/complete', apiLimiter, requirePatientSession, requireCsrfForCookieAuth, withIdempotency('patient_appt_complete'), async (req, res) => {
  try {
    const sessionValidation = req.patientSession;

    const appointmentId = req.params.id;
    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    // Ownership + authz (mvp-27)
    try {
      assertPatientOwnsAppointmentOrThrow(sessionValidation, appointment);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message });
    }

    // Mark as completed
    try {
      db.updateAppointmentStatus(appointmentId, 'completed', null, appointment.clinic_id || null);
        console.log('[Appointments] ✅ Appointment completed', {
          appointment_id: appointmentId,
          patient_id: appointment.patient_id || null
        });
    } catch (e) {
      return res.status(409).json({ success: false, error: e.message });
    }

    // Dual-write: keep FHIR Encounter in sync (Batch 5)
    try { await syncFhirEncounterFromAppointment(appointmentId); } catch (_) {}

    try {
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'patient',
        actor_id: null,
        patient_id: appointment.patient_id || sessionValidation.patient_id || null,
        resource_type: 'appointment',
        resource_id: appointmentId,
        action: 'completed',
        metadata: {}
      });
    } catch (_) {}

    // Optionally trigger FHIR DiagnosticReport creation for this appointment.
    try {
      if (FHIRService && typeof FHIRService.createDiagnosticReportForAppointment === 'function') {
        await FHIRService.createDiagnosticReportForAppointment(appointmentId);
      }
    } catch (e) {
      console.warn('⚠️  Failed to create DiagnosticReport for completed appointment:', e.message);
    }

    // Post-visit notification (mvp-48). Failure must not block response.
    try {
      const EmailService = require('./services/email-service');
      const { v4: uuidv4 } = require('uuid');
      const idem = `appt:${appointmentId}:patient_post_visit_summary_ready`;
      if (db.enqueueNotificationJob) {
        db.enqueueNotificationJob({
          id: uuidv4(),
          channel: 'email',
          type: 'patient_post_visit_summary_ready',
          to_address: appointment.patient_email,
          patient_id: appointment.patient_id || null,
          appointment_id: appointmentId,
          idempotency_key: idem,
          payload_json: JSON.stringify({ appointment }),
          max_attempts: 6
        });
      } else if (EmailService && typeof EmailService.sendPostVisitSummaryReady === 'function') {
        await EmailService.sendPostVisitSummaryReady(appointment);
      }
    } catch (e) {
      console.warn('⚠️  Post-visit email failed:', e.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error completing appointment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Patient: Get benefits data (for patient dashboard)
// Protected by general API rate limiter
app.get('/api/patient/benefits', apiLimiter, async (req, res) => {
  try {
    const { patientName, patientPhone, patientId, memberId, patient_id: patientIdSnake } = req.query;
    const resolvedPatientId = patientId || patientIdSnake;

    console.log('\n🏥 PATIENT BENEFITS: Fetching benefits data');
    console.log('   Query params:', { patientName, patientPhone, patientId: resolvedPatientId, memberId });

    let patient = null;

    // Find patient by ID, phone, name, or member_id (insurance number) — V-1: support patient_id from collect_insurance
    if (resolvedPatientId) {
      console.log('   Searching by patient ID:', resolvedPatientId);
      patient = db.getFHIRPatient(resolvedPatientId);
    } else if (memberId) {
      // Search by insurance member_id (for voice agent)
      // PRIORITY: Find patient that has BOTH claims AND eligibility data (most complete data)
      console.log('   Searching by insurance member ID:', memberId);
      try {
        // STRATEGY 1: Find patient via claims (claims have the most complete data)
        // This ensures we get the patient that actually has billing history
        // CRITICAL: Prioritize patients with the MOST claims AND non-zero billing amounts
        const claimRecord = db.db.prepare(`
          SELECT patient_id, COUNT(*) as claim_count, SUM(CASE WHEN total_amount > 0 THEN total_amount ELSE 0 END) as total_billed
          FROM insurance_claims 
          WHERE member_id = ? AND patient_id IS NOT NULL
          GROUP BY patient_id
          ORDER BY claim_count DESC, total_billed DESC, patient_id
          LIMIT 1
        `).get(memberId);

        if (claimRecord && claimRecord.patient_id) {
          const foundPatient = db.getFHIRPatient(claimRecord.patient_id);
          if (foundPatient && !foundPatient.is_deleted) {
            patient = foundPatient;
            console.log(`   ✅ Found patient via claims (${claimRecord.claim_count} claims, $${claimRecord.total_billed || 0} billed): ${patient.resource_id}`);
          } else {
            console.warn(`   ⚠️  Patient ${claimRecord.patient_id} found via claims but is deleted or invalid`);
          }
        } else {
          console.log('   ℹ️  No claims found for member_id, will try other strategies');
        }

        // STRATEGY 2: If no claims found, try eligibility_checks with deductible data
        // PRIORITIZE: Patients with eligibility that have phone numbers (more reliable identity)
        if (!patient) {
          const eligibilityRecord = db.db.prepare(`
            SELECT e.patient_id, p.phone
            FROM eligibility_checks e
            LEFT JOIN fhir_patients p ON e.patient_id = p.resource_id AND p.is_deleted = 0
            WHERE e.member_id = ? 
              AND e.patient_id IS NOT NULL 
              AND e.deductible_total IS NOT NULL
            ORDER BY p.phone DESC, e.created_at DESC 
            LIMIT 1
          `).get(memberId);

          if (eligibilityRecord && eligibilityRecord.patient_id) {
            const foundPatient = db.getFHIRPatient(eligibilityRecord.patient_id);
            if (foundPatient && !foundPatient.is_deleted) {
              patient = foundPatient;
              console.log(`   ✅ Found patient via eligibility record (with deductible data, phone: ${eligibilityRecord.phone ? 'yes' : 'no'}): ${patient.resource_id}`);
            }
          }
        }

        // STRATEGY 3: If still not found, try any eligibility record
        // PRIORITIZE: Patients with phone numbers (more reliable identity)
        if (!patient) {
          const eligibilityRecord = db.db.prepare(`
            SELECT e.patient_id, p.phone
            FROM eligibility_checks e
            LEFT JOIN fhir_patients p ON e.patient_id = p.resource_id AND p.is_deleted = 0
            WHERE e.member_id = ? 
              AND e.patient_id IS NOT NULL
            ORDER BY p.phone DESC, e.created_at DESC 
            LIMIT 1
          `).get(memberId);

          if (eligibilityRecord && eligibilityRecord.patient_id) {
            const foundPatient = db.getFHIRPatient(eligibilityRecord.patient_id);
            if (foundPatient && !foundPatient.is_deleted) {
              patient = foundPatient;
              console.log(`   ✅ Found patient via eligibility record (phone: ${eligibilityRecord.phone ? 'yes' : 'no'}): ${patient.resource_id}`);
            }
          }
        }

        // STRATEGY 4: Try patient_insurance table as fallback
        // PRIORITIZE: Patients with phone numbers (more reliable identity)
        if (!patient) {
          const insuranceRecord = db.db.prepare(`
            SELECT i.patient_id, p.phone
            FROM patient_insurance i
            LEFT JOIN fhir_patients p ON i.patient_id = p.resource_id AND p.is_deleted = 0
            WHERE i.member_id = ? 
            ORDER BY p.phone DESC, i.is_primary DESC, i.created_at DESC 
            LIMIT 1
          `).get(memberId);

          if (insuranceRecord && insuranceRecord.patient_id) {
            const foundPatient = db.getFHIRPatient(insuranceRecord.patient_id);
            if (foundPatient && !foundPatient.is_deleted) {
              patient = foundPatient;
              console.log(`   ✅ Found patient via insurance record (phone: ${insuranceRecord.phone ? 'yes' : 'no'}): ${patient.resource_id}`);
            }
          }
        }

        // STRATEGY 5: If we have patientName, try to match by name + member_id in claims
        if (!patient && patientName) {
          console.log('   Trying to find patient by name + member_id in claims...');
          const claimRecordByName = db.db.prepare(`
            SELECT patient_id FROM insurance_claims 
            WHERE member_id = ? 
            ORDER BY submitted_at DESC 
            LIMIT 1
          `).get(memberId);

          if (claimRecordByName && claimRecordByName.patient_id) {
            const potentialPatient = db.getFHIRPatient(claimRecordByName.patient_id);
            // Verify name matches
            if (potentialPatient) {
              const patientData = typeof potentialPatient.resource_data === 'string'
                ? JSON.parse(potentialPatient.resource_data)
                : potentialPatient.resource_data;
              const name = patientData.name?.[0];
              const fullName = name
                ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim().toLowerCase()
                : '';

              if (fullName.includes(patientName.toLowerCase()) || patientName.toLowerCase().includes(fullName)) {
                patient = potentialPatient;
                console.log(`   ✅ Found patient via claim record (name verified): ${patient.resource_id}`);
              }
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Error searching by member_id:', error.message);
      }
    } else if (patientPhone) {
      console.log('   Searching by phone:', patientPhone);
      patient = db.getFHIRPatientByPhone(patientPhone);
    } else if (patientName) {
      // Search by name - try exact match first, then partial
      console.log('   Searching by name:', patientName);
      const patients = db.searchFHIRPatients({ name: patientName });
      console.log(`   Found ${patients ? patients.length : 0} patient(s) with name "${patientName}"`);

      if (patients && patients.length > 0) {
        // Try to find exact match first
        const exactMatch = patients.find(p => {
          const name = p.name || '';
          return name.toLowerCase().includes(patientName.toLowerCase());
        });
        patient = exactMatch || patients[0];
      }

      // If no match, try searching with just first or last name
      if (!patient && patientName.includes(' ')) {
        const nameParts = patientName.split(' ');
        for (const namePart of nameParts) {
          if (namePart.length > 2) {
            const partialPatients = db.searchFHIRPatients({ name: namePart });
            if (partialPatients && partialPatients.length > 0) {
              patient = partialPatients[0];
              console.log(`   Found patient with partial name match: "${namePart}"`);
              break;
            }
          }
        }
      }
    }

    if (!patient) {
      console.log('   ❌ Patient not found');
      return res.status(404).json({
        success: false,
        error: `Patient not found${patientName ? `: ${patientName}` : ''}`,
        suggestion: 'Ensure the patient has been created and synced into the system before requesting benefits.'
      });
    }

    console.log(`   ✅ Found patient: ${patient.name || patient.resource_id}`);

    const patientResourceId = patient.resource_id;

    // Get patient insurance
    let insurance = db.getPatientInsurance(patientResourceId);

    // Get eligibility checks for this patient
    // PRIORITY: Get the most recent eligibility check that has COMPLETE deductible information
    let eligibilityChecks = db.getEligibilityChecksByPatient(patientResourceId) || [];

    // Also check eligibility by member_id (in case patient has multiple records)
    if (memberId && eligibilityChecks.length === 0) {
      console.log('   ℹ️  No eligibility found by patient_id, searching by member_id...');
      const eligibilityByMember = db.db.prepare(`
        SELECT * FROM eligibility_checks
        WHERE member_id = ? AND (patient_id = ? OR patient_id IS NULL)
        ORDER BY created_at DESC
      `).all(memberId, patientResourceId);

      if (eligibilityByMember && eligibilityByMember.length > 0) {
        eligibilityChecks = eligibilityByMember;
        console.log(`   ✅ Found ${eligibilityChecks.length} eligibility record(s) by member_id`);
      }
    }

    // Filter to get the best eligibility record (one with deductible info, or most recent)
    let latestEligibility = null;

    // First, try to find one with complete deductible information
    const eligibilityWithDeductible = eligibilityChecks.find(e =>
      e.deductible_total !== null && e.deductible_total !== undefined
    );

    if (eligibilityWithDeductible) {
      latestEligibility = eligibilityWithDeductible;
      console.log(`   ✅ Using eligibility record with deductible: $${latestEligibility.deductible_total} total, $${latestEligibility.deductible_remaining || 0} remaining`);
    } else if (eligibilityChecks.length > 0) {
      // Fallback to most recent eligibility check
      latestEligibility = eligibilityChecks[0];
      console.log(`   ⚠️  Using most recent eligibility record (no deductible info): ${latestEligibility.id}`);
    } else {
      console.log('   ℹ️  No eligibility data found for patient');
    }

    // If we still don't have eligibility but have member_id, try to find ANY eligibility for this member_id
    if (!latestEligibility && memberId) {
      console.log('   ℹ️  Searching for eligibility by member_id across all patients...');
      const anyEligibility = db.db.prepare(`
        SELECT * FROM eligibility_checks
        WHERE member_id = ?
        ORDER BY deductible_total DESC NULLS LAST, created_at DESC
        LIMIT 1
      `).get(memberId);

      if (anyEligibility) {
        latestEligibility = anyEligibility;
        console.log(`   ✅ Found eligibility record by member_id: ${anyEligibility.id}`);
        console.log(`   Deductible: $${anyEligibility.deductible_total || 0} total, $${anyEligibility.deductible_remaining || 0} remaining`);

        // If this eligibility doesn't have a patient_id or has a different patient_id, update it to match current patient
        if (!anyEligibility.patient_id || (anyEligibility.patient_id && anyEligibility.patient_id !== patientResourceId)) {
          try {
            db.db.prepare(`
              UPDATE eligibility_checks 
              SET patient_id = ?
              WHERE id = ?
            `).run(patientResourceId, anyEligibility.id);
            console.log(`   ✅ Linked eligibility record ${anyEligibility.id} to patient ${patientResourceId}`);
            // Update the latestEligibility object to reflect the change
            latestEligibility.patient_id = patientResourceId;
          } catch (updateError) {
            console.warn(`   ⚠️  Could not update eligibility record with patient_id: ${updateError.message}`);
            if (anyEligibility.patient_id && anyEligibility.patient_id !== patientResourceId) {
              console.log(`   ⚠️  Eligibility record has different patient_id (${anyEligibility.patient_id}), but using it for benefits`);
            }
          }
        }
      }
    }

    // If no insurance record exists, create it from eligibility or default data
    if (!insurance) {
      if (latestEligibility) {
        // Create insurance from eligibility data
        console.log('   📝 Creating insurance record from eligibility...');
        try {
          const { v4: uuidv4 } = require('uuid');
          db.upsertPatientInsurance({
            id: `ins_${uuidv4()}`,
            patient_id: patientResourceId,
            payer_id: latestEligibility.payer_id,
            payer_name: latestEligibility.payer_name || latestEligibility.payer_id,
            member_id: latestEligibility.member_id,
            group_number: null,
            plan_name: latestEligibility.plan_summary ? latestEligibility.plan_summary.split(' - ')[0] : null,
            relationship_code: 'self',
            is_primary: true,
            is_verified: true,
            verified_at: new Date().toISOString()
          });
          insurance = db.getPatientInsurance(patientResourceId);
          console.log('   ✅ Created insurance record from eligibility');
        } catch (error) {
          console.error('   ❌ Error creating insurance from eligibility:', error.message);
        }
      }
    }

    // Get payer info if available (for better payer name resolution)
    let payerInfo = null;
    let resolvedPayerName = null;
    if (insurance && insurance.payer_id) {
      payerInfo = db.getPayerByPayerId(insurance.payer_id);
      resolvedPayerName = payerInfo ? payerInfo.payer_name : insurance.payer_name;
      // If we still don't have a good name, try to map common payer IDs
      if (!resolvedPayerName || resolvedPayerName === insurance.payer_id) {
        const payerNameMap = {
          'BCBS': 'Blue Cross Blue Shield',
          'AETNA': 'Aetna',
          'UHG': 'UnitedHealthcare',
          'CIGNA': 'Cigna',
          'ANTHEM': 'Anthem',
          'HUMANA': 'Humana'
        };
        resolvedPayerName = payerNameMap[insurance.payer_id] || insurance.payer_id;
      }
    }

    // Get all claims for this patient
    const claims = db.getClaimsByPatient(patientResourceId) || [];

    // Calculate stats
    const pendingClaims = claims.filter(c => c.status === 'pending' || c.status === 'submitted').length;
    const totalBills = claims.reduce((sum, c) => sum + (parseFloat(c.total_amount) || 0), 0);

    // Parse patient data
    const patientData = typeof patient.resource_data === 'string'
      ? JSON.parse(patient.resource_data)
      : patient.resource_data;

    const name = patientData.name?.[0];
    const patientDisplayName = name
      ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim()
      : 'Unknown Patient';

    return res.json({
      success: true,
      patient: {
        id: patientResourceId,
        name: patientDisplayName,
        phone: patient.phone,
        email: patient.email,
        birthDate: patientData.birthDate
      },
      insurance: insurance ? {
        payer_id: insurance.payer_id,
        payer_name: resolvedPayerName,
        member_id: insurance.member_id,
        group_number: insurance.group_number,
        plan_name: insurance.plan_name,
        is_primary: insurance.is_primary,
        is_verified: insurance.is_verified
      } : null,
      eligibility: latestEligibility ? {
        eligible: !!latestEligibility.eligible,
        copay_amount: latestEligibility.copay_amount || 0,
        allowed_amount: latestEligibility.allowed_amount || 0,
        insurance_pays: latestEligibility.insurance_pays || 0,
        deductible_total: latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined
          ? latestEligibility.deductible_total
          : null,
        deductible_remaining: latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined
          ? latestEligibility.deductible_remaining
          : (latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined
            ? latestEligibility.deductible_total
            : null),
        deductible_met: (latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined)
          ? (latestEligibility.deductible_total - (latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : 0))
          : 0,
        coinsurance_percent: latestEligibility.coinsurance_percent || 0,
        plan_summary: latestEligibility.plan_summary || 'Plan details available',
        service_code: latestEligibility.service_code,
        date_of_service: latestEligibility.date_of_service,
        created_at: latestEligibility.created_at,
        // Parse additional data from response_data if available
        response_data: latestEligibility.response_data
          ? (typeof latestEligibility.response_data === 'string'
            ? JSON.parse(latestEligibility.response_data)
            : latestEligibility.response_data)
          : null
      } : null,
      stats: {
        pending_claims: pendingClaims,
        total_bills: totalBills,
        total_claims: claims.length
      },
      claims: await Promise.all(claims.slice(0, 10).map(async (c) => {
        // Parse response_data to get detailed claim information
        let responseData = {};
        try {
          if (c.response_data) {
            responseData = typeof c.response_data === 'string'
              ? JSON.parse(c.response_data)
              : c.response_data;
          }
        } catch (e) {
          console.warn('Failed to parse claim response_data:', e);
        }

        // For approved claims, use stored EOB from response_data if available
        // This ensures "What You Owe" reflects the final approved amounts
        let fullClaimDetails = null;

        // Check if claim has stored EOB (especially for approved claims)
        if (responseData.eob && (c.status === 'approved' || c.status === 'paid')) {
          // Use stored EOB for approved claims - this has the final approved amounts
          fullClaimDetails = {
            eob: responseData.eob,
            diagnosisCodes: [],
            pricing: responseData.pricing || null
          };

          // Extract diagnosis codes from response_data
          const DiagnosisCodeMapper = require('./services/diagnosis-code-mapper');
          if (responseData.coding && responseData.coding.icd10) {
            fullClaimDetails.diagnosisCodes = responseData.coding.icd10.map(d => ({
              code: typeof d === 'string' ? d : d.code || d,
              description: typeof d === 'object' && d.description
                ? d.description
                : DiagnosisCodeMapper.getDiagnosisDescription(typeof d === 'string' ? d : (d.code || d))
            }));
          } else if (c.diagnosis_code) {
            c.diagnosis_code.split(',').forEach(code => {
              const trimmedCode = code.trim();
              if (trimmedCode && trimmedCode !== 'N/A') {
                fullClaimDetails.diagnosisCodes.push({
                  code: trimmedCode,
                  description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
                });
              }
            });
          }
        } else if (!responseData.pricing && !responseData.coding && c.id) {
          // For non-approved claims or claims without stored EOB, calculate on the fly
          try {
            // Get eligibility for this patient
            const eligibilityChecks = db.getEligibilityChecksByPatient(patientResourceId) || [];
            const latestEligibility = eligibilityChecks[0] || null;

            // Calculate EOB if we have eligibility data
            if (latestEligibility) {
              const EOBCalculationService = require('./services/eob-calculation-service');
              try {
                const eobCalculation = EOBCalculationService.calculateEOBFromClaim(
                  c,
                  latestEligibility,
                  responseData
                );

                // Extract diagnosis codes
                const DiagnosisCodeMapper = require('./services/diagnosis-code-mapper');
                const diagnosisCodes = [];

                if (responseData.coding && responseData.coding.icd10) {
                  diagnosisCodes.push(...responseData.coding.icd10.map(d => ({
                    code: typeof d === 'string' ? d : d.code || d,
                    description: typeof d === 'string'
                      ? DiagnosisCodeMapper.getDiagnosisDescription(d)
                      : (d.description || DiagnosisCodeMapper.getDiagnosisDescription(d.code || d))
                  })));
                } else if (c.diagnosis_code) {
                  c.diagnosis_code.split(',').forEach(code => {
                    const trimmedCode = code.trim();
                    if (trimmedCode && trimmedCode !== 'N/A') {
                      diagnosisCodes.push({
                        code: trimmedCode,
                        description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
                      });
                    }
                  });
                }

                fullClaimDetails = {
                  eob: eobCalculation,
                  diagnosisCodes: diagnosisCodes,
                  pricing: eobCalculation.lineItems ? {
                    breakdown: eobCalculation.lineItems.map(item => ({
                      code: item.cptCode,
                      description: item.description,
                      charge: item.billedAmount,
                      allowed_amount: item.allowedAmount,
                      patient_owes: item.patientOwes
                    }))
                  } : null
                };
              } catch (eobError) {
                console.warn(`Failed to calculate EOB for claim ${c.id}:`, eobError.message);
              }
            }
          } catch (error) {
            console.warn(`Failed to get full claim details for ${c.id}:`, error.message);
          }
        } else if (responseData.pricing || responseData.coding) {
          // Claim has pricing/coding data but no EOB - extract what we can
          const DiagnosisCodeMapper = require('./services/diagnosis-code-mapper');
          const diagnosisCodes = [];

          if (responseData.coding && responseData.coding.icd10) {
            responseData.coding.icd10.forEach(d => {
              const codeStr = typeof d === 'string' ? d : (d.code || d);
              if (codeStr && codeStr !== 'N/A') {
                diagnosisCodes.push({
                  code: codeStr,
                  description: typeof d === 'object' && d.description
                    ? d.description
                    : DiagnosisCodeMapper.getDiagnosisDescription(codeStr)
                });
              }
            });
          } else if (c.diagnosis_code) {
            c.diagnosis_code.split(',').forEach(code => {
              const trimmedCode = code.trim();
              if (trimmedCode && trimmedCode !== 'N/A') {
                diagnosisCodes.push({
                  code: trimmedCode,
                  description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
                });
              }
            });
          }

          fullClaimDetails = {
            eob: null,
            diagnosisCodes: diagnosisCodes,
            pricing: responseData.pricing || null
          };
        }

        return {
          id: c.id,
          status: c.status,
          total_amount: c.total_amount,
          copay_amount: c.copay_amount,
          insurance_amount: c.insurance_amount,
          submitted_at: c.submitted_at,
          payment_status: c.payment_status,
          service_code: c.service_code,
          diagnosis_code: c.diagnosis_code,
          member_id: c.member_id,
          payer_id: c.payer_id,
          // Include detailed breakdown if available
          response_data: responseData,
          // Extract pricing breakdown for easier access
          pricing: fullClaimDetails?.pricing || responseData.pricing || null,
          coding: responseData.coding || null,
          // Include EOB calculation if available
          eob: fullClaimDetails?.eob || null,
          diagnosisCodes: fullClaimDetails?.diagnosisCodes || []
        };
      }))
    });
  } catch (error) {
    console.error('❌ Error getting patient benefits:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Reschedule appointment (requirePatientSession sets usedCookieAuth so CSRF is enforced only for cookie auth)
app.put('/api/patient/appointments/:id/reschedule', requirePatientSession, requireCsrfForCookieAuth, withIdempotency('patient_appt_reschedule'), async (req, res) => {
  try {
    const session = req.patientSession;
    const appointmentId = req.params.id;
    const { new_date, new_time } = req.body;

    if (!validateYyyyMmDd(new_date) || !validateHhMm(new_time)) {
      return res.status(400).json({ success: false, error: 'Invalid new_date or new_time' });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Ownership + authz (mvp-27)
    try {
      assertPatientOwnsAppointmentOrThrow(session, appointment);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message });
    }

    // State machine enforcement (mvp-22)
    if (!['scheduled', 'confirmed', 'pending', 'pending_payment'].includes((appointment.status || '').toLowerCase())) {
      return res.status(409).json({ success: false, error: `Cannot reschedule appointment in status '${appointment.status}'` });
    }

    const clinicId = appointment.clinic_id || null;

    // Use existing reschedule endpoint logic
    const result = await BookingService.rescheduleAppointment(
      appointmentId,
      new_date,
      new_time,
      null,
      null,
      clinicId
    );
    if (result.success) invalidateSlotAvailabilityCache();

    if (result.success) {
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: session.patient_id || null,
          resource_type: 'appointment',
          resource_id: appointmentId,
          action: 'rescheduled',
          metadata: { new_date, new_time }
        });
      } catch (_) {}
      // Dual-write: keep FHIR Encounter in sync (Batch 5)
      try { await syncFhirEncounterFromAppointment(appointmentId); } catch (_) {}
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error rescheduling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Cancel appointment (requirePatientSession sets usedCookieAuth so CSRF enforced only for cookie auth)
app.delete('/api/patient/appointments/:id', requirePatientSession, requireCsrfForCookieAuth, withIdempotency('patient_appt_cancel'), async (req, res) => {
  try {
    const session = req.patientSession;
    const appointmentId = req.params.id;
    const { reason } = req.body;

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Ownership + authz (mvp-27)
    try {
      assertPatientOwnsAppointmentOrThrow(session, appointment);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message });
    }

    // State machine enforcement (mvp-22)
    if (!['scheduled', 'confirmed', 'pending', 'pending_payment'].includes((appointment.status || '').toLowerCase())) {
      return res.status(409).json({ success: false, error: `Cannot cancel appointment in status '${appointment.status}'` });
    }

    const clinicId = appointment.clinic_id || null;

    // Use existing cancel endpoint logic
    const result = await BookingService.cancelAppointment(appointmentId, reason, clinicId);
    if (result.success) invalidateSlotAvailabilityCache();

    if (result.success) {
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: session.patient_id || null,
          resource_type: 'appointment',
          resource_id: appointmentId,
          action: 'canceled',
          metadata: { reason: reason || '' }
        });
      } catch (_) {}
      // Dual-write: keep FHIR Encounter in sync (Batch 5)
      try { await syncFhirEncounterFromAppointment(appointmentId); } catch (_) {}
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Get profile
app.get('/api/patient/profile', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const result = PatientPortalService.getPatientProfile(req.patientSessionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('❌ Error getting patient profile:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Update profile (onboarding)
app.put('/api/patient/profile', apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'x-session-id required' });
    }

    const {
      name,
      first_name: firstNameRaw,
      last_name: lastNameRaw,
      dob,
      phone,
      email: emailRaw
    } = req.body || {};

    const firstName = firstNameRaw || (name ? name.split(' ')[0] : null);
    const lastName =
      lastNameRaw || (name ? name.split(' ').slice(1).join(' ') || null : null);

    if (!firstName && !lastName && !dob && !phone && !emailRaw) {
      return res.status(400).json({ success: false, error: 'No profile fields provided' });
    }

    // Resolve existing FHIR patient via portal session
    const sessionValidation = PatientPortalService.validateSession(sessionId);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    let patient = null;
    let emailPatient = null;
    let phonePatient = null;
    if (sessionValidation.email) {
      emailPatient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (sessionValidation.phone) {
      phonePatient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }

    // Decide primary vs secondary when email/phone resolve different patients
    if (emailPatient && phonePatient && emailPatient.resource_id !== phonePatient.resource_id) {
      const primary = emailPatient; // prefer email-based identity
      const secondary = phonePatient;
      console.warn('[PatientPortal] ⚠️ Email/phone map to different patients, merging', {
        primary_id: primary.resource_id,
        secondary_id: secondary.resource_id
      });
      try {
        if (FHIRService && typeof FHIRService.mergePatients === 'function') {
          FHIRService.mergePatients(primary.resource_id, secondary.resource_id);
        }
      } catch (e) {
        console.warn('[PatientPortal] ⚠️ mergePatients failed:', e.message);
      }
      patient = primary;
    } else {
      patient = emailPatient || phonePatient || null;
    }

    // Canonical email: always prefer verified email from session
    const email = sessionValidation.email || emailRaw || null;

    // If no patient exists yet, create via FHIRService.getOrCreatePatient
    let patientId;
    if (!patient) {
      const getOrCreateResult = await FHIRService.getOrCreatePatient(
        {
          name: name || [firstName, lastName].filter(Boolean).join(' '),
          firstName,
          lastName,
          phone,
          email
        },
        false
      );
      const fhirPatient = getOrCreateResult.patient;
      patientId = fhirPatient.id || getOrCreateResult.resource_id || null;
    } else {
      patientId = patient.resource_id;
    }

    if (!patientId) {
      return res.status(500).json({ success: false, error: 'Unable to resolve or create patient record' });
    }

    // Update FHIR Patient record in DB
    try {
      const existing = db.getFHIRPatient(patientId);
      let resource = existing && existing.resource_data
        ? (typeof existing.resource_data === 'string'
          ? JSON.parse(existing.resource_data)
          : existing.resource_data)
        : { resourceType: 'Patient' };

      // Name
      if (firstName || lastName) {
        resource.name = resource.name || [{}];
        resource.name[0].given = [firstName || resource.name[0].given?.[0] || ''];
        resource.name[0].family = lastName || resource.name[0].family || '';
      }

      // Birth date
      if (dob) {
        resource.birthDate = dob;
      }

      // Telecom
      resource.telecom = resource.telecom || [];
      const upsertTelecom = (system, value) => {
        if (!value) return;
        const existingEntry = resource.telecom.find(t => t.system === system);
        if (existingEntry) {
          existingEntry.value = value;
        } else {
          resource.telecom.push({ system, value });
        }
      };
      if (phone) upsertTelecom('phone', phone);
      if (email) upsertTelecom('email', email);

      const displayName = name || [firstName, lastName].filter(Boolean).join(' ');

      db.upsertFHIRPatient
        ? db.upsertFHIRPatient(patientId, resource, { phone, email, name: displayName })
        : db.db.prepare(`
            UPDATE fhir_patients
            SET resource_data = ?, phone = COALESCE(?, phone), email = COALESCE(?, email), name = COALESCE(?, name),
                profile_verified = 1,
                profile_verified_at = datetime('now'),
                updated_at = datetime('now')
            WHERE resource_id = ?
          `).run(JSON.stringify(resource), phone || null, email || null, displayName || null, patientId);
    } catch (e) {
      console.error('❌ Failed to update FHIR patient profile:', e.message);
      return res.status(500).json({ success: false, error: 'Failed to update profile' });
    }

    console.log('[PatientPortal] ✅ Profile updated', {
      session_id: sessionId,
      patient_id: patientId,
      has_phone: !!phone,
      has_email: !!email
    });

    // Update patient_sessions mapping if present
    try {
      if (db.updatePatientSession) {
        db.updatePatientSession(sessionId, { patient_id: patientId, email: email || sessionValidation.email });
      }
    } catch (e) {
      console.warn('⚠️  Failed to update patient_sessions from profile update:', e.message);
    }

    return res.json({ success: true, patient_id: patientId });
  } catch (error) {
    console.error('❌ Error updating patient profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dashboard: Billing summary by patient (derived from appointments)
app.get('/api/admin/billing', async (req, res) => {
  try {
    const appointments = db.getAllAppointments({});

    // Helper: start of current ISO week (Monday)
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day; // adjust so Monday is start
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const byPatient = new Map();

    appointments.forEach(appt => {
      const key = appt.patient_id || appt.patient_phone || appt.patient_email || appt.patient_name;
      if (!key) return;

      if (!byPatient.has(key)) {
        byPatient.set(key, {
          patient_id: appt.patient_id || null,
          patient_name: appt.patient_name || 'Unknown',
          patient_phone: appt.patient_phone || null,
          patient_email: appt.patient_email || null,
          total_appointments: 0,
          confirmed_appointments: 0,
          cancelled_appointments: 0,
          week_appointments: 0,
          total_amount: 0,
          week_amount: 0,
          last_appointment_at: null
        });
      }

      const record = byPatient.get(key);
      record.total_appointments += 1;
      if (appt.status === 'confirmed') record.confirmed_appointments += 1;
      if (appt.status === 'cancelled') record.cancelled_appointments += 1;

      // Determine appointment start date for week calc
      const startIso = appt.start_time || (appt.date ? `${appt.date}T${(appt.time || '00:00')}:00` : null);
      const apptDate = startIso ? new Date(startIso) : null;
      if (apptDate && apptDate >= monday) {
        record.week_appointments += 1;
      }

      // Estimated billed amount using visit_pricing (falls back to defaults if missing)
      const { DEFAULT_FALLBACK } = require('./config/pricing-fallbacks');
      const price = db.getEffectiveVisitPrice(appt.clinic_id || null, appt.appointment_type || 'General Consult')?.effective_price ?? DEFAULT_FALLBACK;
      record.total_amount = Number((record.total_amount + price).toFixed(2));
      if (apptDate && apptDate >= monday) {
        record.week_amount = Number((record.week_amount + price).toFixed(2));
      }

      if (!record.last_appointment_at || (apptDate && apptDate > new Date(record.last_appointment_at))) {
        record.last_appointment_at = apptDate ? apptDate.toISOString() : record.last_appointment_at;
      }
    });

    const results = Array.from(byPatient.values()).sort((a, b) => (b.last_appointment_at || '').localeCompare(a.last_appointment_at || ''));

    res.json({
      success: true,
      pricing_source: 'visit_pricing',
      patients: results,
      count: results.length
    });
  } catch (error) {
    console.error('❌ Error building billing summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// WEBHOOK ENDPOINTS
// ============================================

// Retell LLM WebSocket endpoint - handle HEAD/GET requests for health checks
app.head('/webhook/retell/llm', (req, res) => {
  res.status(200).end();
});

app.get('/webhook/retell/llm', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Retell LLM WebSocket endpoint is available',
    websocket: true
  });
});

// Retell events webhook (call end, status updates)
app.post('/webhook/retell/events', express.json(), async (req, res) => {
  try {
    // Log everything for debugging
    console.log('\n📥 ========================================');
    console.log('📥 RETELL WEBHOOK RECEIVED');
    console.log('📥 ========================================');
    const { safeLogHeaders } = require('./services/payment-security');
    safeLogHeaders('Request Headers:', req);
    safeLogRequestBody('Request body:', req);
    console.log('📥 ========================================\n');

    // Always respond with success so Retell doesn't retry
    res.json({
      received: true,
      timestamp: new Date().toISOString()
    });

    // Process the webhook data
    const body = req.body || {};
    const callId = body.call_id || body.call?.call_id;

    // Check for different event types
    if (body.event) {
      console.log(`📊 Event Type: ${body.event}`);
    }

    if (callId) {
      console.log(`📞 Call ID: ${callId}`);

      // Update call log when call ends
      if (body.event === 'call_ended' || body.call_status === 'ended' || body.call_status === 'completed') {
        try {
          // Get call duration from Retell
          const durationSeconds =
            body.duration_seconds ||
            body.call?.duration_seconds ||
            (body.call?.duration_ms ? Math.round(body.call.duration_ms / 1000) : null);

          // Update voice call log (for customer calls)
          const existingCall = db.db.prepare('SELECT * FROM voice_call_log WHERE call_id = ?').get(callId);
          if (existingCall) {
            // Get function call count for this call
            const functionCalls = db.db.prepare('SELECT COUNT(*) as count FROM function_call_log WHERE call_id = ?').get(callId);
            const functionCallCount = functionCalls ? functionCalls.count : 0;

            // Update call log
            db.db.prepare(`
              UPDATE voice_call_log 
              SET call_duration_seconds = ?,
                  function_calls_count = ?,
                  status = 'completed'
              WHERE call_id = ?
            `).run(
              durationSeconds,
              functionCallCount,
              callId
            );

            console.log(`✅ Updated voice call log for ${callId}: ${durationSeconds}s, ${functionCallCount} functions`);
          }

          // Update lead call (for sales calls)
          const leadCall = db.db.prepare('SELECT * FROM lead_calls WHERE call_id = ?').get(callId);
          if (leadCall) {
            const callCost = durationSeconds ? (durationSeconds / 60) * 0.05 : null;

            db.db.prepare(`
              UPDATE lead_calls 
              SET call_status = 'completed',
                  call_duration_seconds = ?,
                  call_cost = ?,
                  updated_at = datetime('now')
              WHERE call_id = ?
            `).run(durationSeconds, callCost, callId);

            // Create activity
            db.createLeadActivity({
              lead_id: leadCall.lead_id,
              activity_type: 'call',
              activity_subject: 'Call Completed',
              activity_description: `Sales call completed. Duration: ${durationSeconds ? Math.round(durationSeconds / 60) : 'unknown'} minutes. Cost: $${callCost ? callCost.toFixed(2) : 'unknown'}`,
              created_by: 'system',
              metadata: JSON.stringify({
                retell_call_id: callId,
                duration_seconds: durationSeconds,
                cost: callCost
              })
            });

            console.log(`✅ Updated lead call for ${callId}: ${durationSeconds}s, $${callCost ? callCost.toFixed(2) : 'unknown'}`);
          }
        } catch (updateError) {
          console.error('❌ Failed to update call log:', updateError.message);
        }
      }
    }

    if (body.call_status) {
      console.log(`📊 Call Status: ${body.call_status}`);
    }

  } catch (err) {
    console.error('❌ Error in /webhook/retell/events:', err.message);
    console.error(err.stack);

    // Still respond with success to avoid retries
    try {
      res.status(200).json({
        received: true,
        error: err.message
      });
    } catch (e) {
      console.error('Failed to send response:', e.message);
    }
  }
});

// Patient: Get my DiagnosticReports (requires session)
app.get('/api/patient/my-records', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found for this session' });

    // FHIR-first read:
    // - DiagnosticReport: visit summaries
    // - DocumentReference: uploaded/available documents
    const drRows = db.getDiagnosticReportsByPatientId
      ? db.getDiagnosticReportsByPatientId(patientId, 50)
      : [];
    let docRefs = db.getFHIRDocumentReferencesByPatientId
      ? db.getFHIRDocumentReferencesByPatientId(patientId, 500).map(r => r.resource_data).filter(Boolean)
      : [];
    if (docRefs.length === 0) {
      const docRows = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];
      docRefs = [];
      for (const r of docRows) {
        const dr = buildDocumentReferenceFromPatientDocRow(r, req);
        docRefs.push(dr);
        try { db.createFHIRDocumentReference && db.createFHIRDocumentReference(dr); } catch (_) {}
      }
    }

    const records = [];
    for (const r of drRows) {
      const resource = r.resource_data || null;
      records.push({
        type: 'DiagnosticReport',
        id: r.resource_id || r.id,
        encounter_id: r.encounter_id || (resource?.encounter?.reference || '').replace(/^Encounter\//, '') || null,
        status: r.status || resource?.status || 'unknown',
        created_at: r.created_at || null,
        summary: (resource?.conclusion || r.case_report_text || '').toString().slice(0, 400),
        fhir: resource
      });
    }
    for (const dr of docRefs) {
      const att = dr.content?.[0]?.attachment || {};
      records.push({
        type: 'DocumentReference',
        id: dr.id,
        encounter_id: (dr.context?.encounter?.[0]?.reference || '').replace(/^Encounter\//, '') || null,
        status: dr.status || 'current',
        created_at: dr.date || null,
        summary: att.title || dr.description || 'Document',
        download_url: att.url || null,
        fhir: dr
      });
    }

    return res.json({ success: true, patient_id: patientId, records });
  } catch (error) {
    console.error('[api/patient/my-records] error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal error'
    });
  }
});

// M-Doc.3: POST /api/patient/records/query — Ask about uploaded records (labs, visit notes, etc.)
app.post('/api/patient/records/query', apiLimiter, requirePatientSession, express.json(), async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found for this session' });

    const query = (req.body?.query || req.body?.q || '').toString().trim();
    if (!query) return res.status(400).json({ success: false, error: 'query required' });

    const PatientRecordsQueryService = require('./services/patient-records-query-service');
    const { answer, sources } = await PatientRecordsQueryService.queryPatientRecords(patientId, query);
    return res.json({ success: true, answer, sources });
  } catch (error) {
    console.error('[api/patient/records/query] error:', error);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// Patient: Get receipts (mvp-24)
app.get('/api/patient/receipts', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) {
      patient = db.getFHIRPatient(sessionValidation.patient_id);
    }
    if (!patient && sessionValidation.email) {
      patient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (!patient && sessionValidation.phone) {
      patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }

    const patientId = patient ? patient.resource_id : (sessionValidation.patient_id || null);
    const receipts = db.getMergedReceiptsForPatient
      ? db.getMergedReceiptsForPatient(patientId, sessionValidation.email || null, 50)
      : db.getPaymentReceiptsForPatient
        ? db.getPaymentReceiptsForPatient(patientId, sessionValidation.email || null, 50)
        : [];
    return res.json({ success: true, receipts });
  } catch (error) {
    console.error('❌ Error fetching patient receipts:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// API v1 aliases (mvp-31)
// ============================================
app.get('/api/v1/patient/appointments', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    // Delegate to the same FHIR-first logic as /api/patient/appointments
    req.url = '/api/patient/appointments';
    return app._router.handle(req, res, () => res.status(404).json({ success: false, error: 'Not found' }));
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: 'internal_error' });
  }
});
app.get('/api/v1/patient/receipts', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) {
      patient = db.getFHIRPatient(sessionValidation.patient_id);
    }
    if (!patient && sessionValidation.email) {
      patient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (!patient && sessionValidation.phone) {
      patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }
    const patientId = patient ? patient.resource_id : (sessionValidation.patient_id || null);
    const receipts = db.getMergedReceiptsForPatient
      ? db.getMergedReceiptsForPatient(patientId, sessionValidation.email || null, 50)
      : db.getPaymentReceiptsForPatient
        ? db.getPaymentReceiptsForPatient(patientId, sessionValidation.email || null, 50)
        : [];
    return res.json({ success: true, receipts });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, code: 'internal_error' });
  }
});

// ============================================
// Admin visibility (mvp-52) — admin-only
// ============================================
app.get('/api/admin/patient-portal/sessions', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const rows = db.db.prepare(`
      SELECT id, email, patient_id, verified, verified_at, expires_at, last_seen_at, created_at, ip_address
      FROM patient_portal_sessions
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, sessions: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
app.get('/api/admin/patient-portal/appointments', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const rows = db.db.prepare(`
      SELECT id, clinic_id, patient_email, patient_phone, patient_id, status, payment_status, start_time, end_time, created_at, updated_at
      FROM appointments
      ORDER BY datetime(start_time) DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, appointments: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
app.get('/api/admin/patient-portal/payments', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const checkouts = db.db.prepare(`
      SELECT id, appointment_id, customer_email, customer_phone, amount, payment_method, status, payment_intent_id, created_at, completed_at
      FROM voice_checkouts
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    const receipts = db.db.prepare(`
      SELECT id, checkout_id, appointment_id, patient_email, amount, currency, status, issued_at, created_at
      FROM payment_receipts
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, checkouts, receipts });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================
// Ops / reliability dashboard (mvp-78)
// ============================================
app.get('/api/admin/ops/summary', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const notif = db.getNotificationQueueStats ? db.getNotificationQueueStats() : { success: true, by_status: {} };
    const dead = db.listDeadNotificationJobs ? db.listDeadNotificationJobs(50) : [];
    const counters = db.getOpsCounters ? db.getOpsCounters(24) : [];
    return res.json({
      success: true,
      notification_queue: notif.success ? notif.by_status : {},
      notification_dead_letter: dead,
      ops_counters_24h: counters
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Retell end-of-call webhook
app.post('/webhook/retell/end-of-call', async (req, res) => {
  try {
    console.log('\n📞 ========================================');
    console.log('📞 RETELL: End of call webhook');
    console.log('📞 ========================================');
    safeLogRequestBody('Webhook body:', req);
    console.log('📞 ========================================\n');

    const callId = req.body.call_id;

    // ========== FHIR COMPLETION ==========
    // Complete FHIR Encounter and store transcript
    if (callId && global.activeCalls && global.activeCalls[callId]) {
      try {
        const callInfo = global.activeCalls[callId];
        console.log(`[FHIR] Completing call resources for: ${callId}`);

        // Prepare call summary with transcript and analysis
        const callSummary = {
          encounterId: callInfo.encounterId,
          patientId: callInfo.patientId,
          duration: req.body.call_analysis?.call_duration,
          transcript: req.body.transcript || [],
          callAnalysis: req.body.call_analysis,
          endTime: new Date().toISOString()
        };

        // Complete the FHIR encounter and store transcript
        await FHIRService.completeVoiceCall(callId, callSummary);
        console.log(`[FHIR] ✅ Completed Encounter: ${callInfo.encounterId}`);
        console.log(`[FHIR] ✅ Stored transcript as Communication resource`);

        // Clean up active call tracking
        delete global.activeCalls[callId];
      } catch (fhirError) {
        console.error('[FHIR] ❌ Error completing FHIR resources:', fhirError.message);
        console.error('[FHIR] Stack:', fhirError.stack);
        // Continue processing webhook even if FHIR fails
      }
    } else {
      console.log(`[FHIR] ⚠️ No active call found for callId: ${callId}`);
    }
    // ======================================

    res.json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('❌ Error processing Retell webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stripe webhook
app.post('/webhook/stripe', async (req, res) => {
  if (process.env.ALLOW_LEGACY_STRIPE_WEBHOOK !== '1') {
    return res.status(410).json({
      success: false,
      error: 'Legacy webhook path disabled. Use POST /webhooks/stripe.',
      canonical_path: '/webhooks/stripe'
    });
  }
  try {
    console.log('\n💳 STRIPE: Webhook received');

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      if (!stripe) {
        return res.status(503).json({
          success: false,
          error: 'Stripe webhook processing is not configured'
        });
      }

      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        console.log(`✅ PaymentIntent ${paymentIntent.id} succeeded`);

        // Check if this is a wallet deposit payment
        if (paymentIntent.metadata && paymentIntent.metadata.type === 'wallet_deposit') {
          console.log(`💰 Processing wallet deposit for PaymentIntent ${paymentIntent.id}`);

          const depositId = paymentIntent.metadata.deposit_id;
          const walletId = paymentIntent.metadata.wallet_id;
          const patientId = paymentIntent.metadata.patient_id;
          const amount = paymentIntent.amount / 100; // Convert from cents to dollars

          try {
            // Find the pending transfer record
            const transferStmt = db.db.prepare(`
              SELECT * FROM circle_transfers 
              WHERE id = ? OR circle_transfer_id = ?
              ORDER BY created_at DESC LIMIT 1
            `);
            const transfer = transferStmt.get(depositId, paymentIntent.id);

            if (transfer && transfer.status === 'pending') {
              // Fund the wallet with USDC
              const CircleService = require('./services/circle-service');
              const fundResult = await CircleService.fundWallet(walletId, amount);

              if (fundResult.success) {
                // Update transfer status to completed
                const updateStmt = db.db.prepare(`
                  UPDATE circle_transfers 
                  SET status = ?, completed_at = ?, circle_transfer_id = ?
                  WHERE id = ?
                `);
                updateStmt.run(
                  'completed',
                  new Date().toISOString(),
                  fundResult.transferId || paymentIntent.id,
                  depositId
                );

                console.log(`✅ Wallet deposit completed: ${depositId}`);
                console.log(`   Amount: $${amount.toFixed(2)} USDC`);
                console.log(`   Wallet: ${walletId}`);
                console.log(`   Circle Transfer: ${fundResult.transferId}`);
              } else {
                console.error(`❌ Failed to fund wallet: ${fundResult.error}`);
                // Keep status as pending - will retry or handle manually
              }
            } else if (!transfer) {
              // Transfer record doesn't exist - create it
              const insertStmt = db.db.prepare(`
                INSERT INTO circle_transfers (
                  id, claim_id, from_wallet_id, to_wallet_id, amount, currency,
                  circle_transfer_id, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `);
              insertStmt.run(
                depositId || `deposit_${Date.now()}`,
                null,
                'stripe',
                walletId,
                amount,
                'USDC',
                paymentIntent.id,
                'pending',
                new Date().toISOString()
              );

              // Try to fund wallet
              if (CircleService && CircleService.isAvailable()) {
                const fundResult = await CircleService.fundWallet(walletId, amount);

                if (fundResult.success) {
                  const updateStmt = db.db.prepare(`
                    UPDATE circle_transfers 
                    SET status = ?, completed_at = ?, circle_transfer_id = ?
                    WHERE circle_transfer_id = ?
                  `);
                  updateStmt.run(
                    'completed',
                    new Date().toISOString(),
                    fundResult.transferId || paymentIntent.id,
                    paymentIntent.id
                  );

                  console.log(`✅ Wallet deposit created and completed from webhook`);
                }
              } else {
                console.warn('⚠️  Circle service not available - wallet deposit will remain pending');
              }
            }
          } catch (error) {
            console.error(`❌ Error processing wallet deposit webhook:`, error);
            // Don't throw - we'll retry or handle manually
          }
        } else if (paymentIntent.metadata && paymentIntent.metadata.checkout_id) {
          // VOICE CHECKOUT PAYMENT - Complete checkout automatically
          console.log(`💳 Processing voice checkout payment: ${paymentIntent.id}`);
          console.log(`   Checkout ID: ${paymentIntent.metadata.checkout_id}`);

          try {
            const checkoutId = paymentIntent.metadata.checkout_id;
            const checkout = await db.getVoiceCheckout(checkoutId);

            if (!checkout) {
              console.error(`❌ Checkout not found: ${checkoutId}`);
              // Return 200 to prevent Stripe retries, but log error
              return res.json({ received: true, error: 'Checkout not found' });
            }

            // IDEMPOTENCY: Check if already completed
            if (checkout.status === 'completed') {
              console.log(`✅ Checkout ${checkoutId} already completed - skipping`);
              return res.json({ received: true, message: 'Already completed' });
            }

            // Process payment token if provided
            if (paymentIntent.metadata.payment_token) {
              const PaymentService = require('./services/payment-service');
              const tokenResult = await PaymentService.processPayment(
                paymentIntent.metadata.payment_token,
                paymentIntent.id
              );

              if (!tokenResult.success) {
                console.warn(`⚠️  Token processing failed: ${tokenResult.error}`);
                // Continue anyway - payment succeeded in Stripe
              }
            }

            // Complete checkout (inline implementation - same logic as /voice/checkout/complete route)
            const { v4: uuidv4 } = require('uuid');
            const axios = require('axios');
            const VoiceAdapter = require('./adapters/voice-adapter');

            // Get merchant - return error if not found (no fallback for security)
            let merchant = db.getMerchant(checkout.merchant_id);

            if (!merchant) {
              console.error('❌ ERROR: Merchant not found for checkout:', checkout.id);
              console.error('   Checkout merchant_id:', checkout.merchant_id);
              throw new Error('Merchant not found. Please ensure merchant is configured in the system.');
            }

            // Decrement inventory
            if (checkout.product_id && checkout.quantity) {
              try {
                const product = db.getProduct(checkout.product_id);
                if (product && product.merchant_id === checkout.merchant_id && product.inventory >= checkout.quantity) {
                  db.updateInventory(checkout.product_id, checkout.quantity);
                }
              } catch (inventoryError) {
                console.error('❌ Error decrementing inventory:', inventoryError);
              }
            }

            // Create order
            const orderData = VoiceAdapter.toMerchantOrderFormat(checkout);
            let merchantOrder = null;

            if (merchant.api_url) {
              try {
                const orderResponse = await axios.post(`${merchant.api_url}/api/orders`, orderData, { timeout: 10000 });
                merchantOrder = orderResponse.data.order;
              } catch (apiError) {
                console.error('❌ Merchant API call failed:', apiError.message);
              }
            }

            if (!merchantOrder) {
              const orderId = uuidv4();
              db.createOrder({
                id: orderId,
                merchant_id: checkout.merchant_id,
                product_id: checkout.product_id,
                quantity: checkout.quantity,
                customer_email: checkout.customer_email || 'guest@example.com',
                customer_name: checkout.customer_name,
                customer_phone: checkout.customer_phone,
                total_amount: checkout.amount,
                status: 'paid',
                payment_status: 'paid',
                source: 'voice'
              });
              merchantOrder = { id: orderId };
            }

            // Update checkout status
            await db.updateVoiceCheckout(checkoutId, {
              status: 'completed',
              payment_intent_id: paymentIntent.id,
              merchant_order_id: merchantOrder.id,
              completed_at: new Date().toISOString()
            });

            // Phase 4.1 & 4.2: Confirm appointment (S-3: defer to avoid blocking; handle errors)
            if (checkout.appointment_id) {
              const apptId = checkout.appointment_id;
              const clinicIdForConfirm = checkout.clinic_id || null;
              const piId = paymentIntent.id;
              const piStatus = paymentIntent.status;
              // Bug 4: Wrap async callback so rejections are caught (setImmediate doesn't await)
              setImmediate(() => {
                (async () => {
                  try {
                    const BookingService = require('./services/booking-service');
                    await BookingService.confirmAppointment(apptId, clinicIdForConfirm);
                    const apt = await db.getAppointment(apptId);
                    if (apt && apt.visit_mode === 'sync_video' && piStatus === 'requires_capture' && db.updateAppointment) {
                      db.updateAppointment(apptId, { stripe_payment_intent_id: piId }, clinicIdForConfirm);
                    }
                    console.log(`✅ Appointment ${apptId} confirmed via webhook`);
                  } catch (confirmErr) {
                    console.error(`❌ setImmediate confirmAppointment failed: ${confirmErr.message}`, confirmErr.stack);
                  }
                })().catch(e => console.error('Unhandled webhook setImmediate error:', e));
              });
            }

            // Create transaction record for admin tracking
            db.createTransaction({
              id: uuidv4(),
              merchant_id: checkout.merchant_id,
              platform: 'voice',
              platform_order_id: checkoutId,
              merchant_order_id: merchantOrder.id,
              product_id: checkout.product_id,
              amount: checkout.amount,
              status: 'completed',
              customer_email: checkout.customer_email || checkout.customer_phone,
              completed_at: new Date().toISOString()
            });

            console.log(`✅ Voice checkout ${checkoutId} completed via webhook`);
          } catch (error) {
            console.error(`❌ Error completing voice checkout from webhook:`, error);
            console.error(`   Checkout ID: ${paymentIntent.metadata.checkout_id}`);
            console.error(`   Payment Intent: ${paymentIntent.id}`);
            console.error(`   Error: ${error.message}`);
            console.error(`   Stack: ${error.stack}`);

            // Log error but return 200 to prevent Stripe retries
            // Admin can manually retry failed checkouts
            // Return 200 so Stripe doesn't retry (we'll handle manually)
            return res.json({
              received: true,
              error: 'Checkout completion failed - logged for manual review'
            });
          }
        } else {
          // Regular payment intent - handle as before
          console.log(`📝 Processing regular payment: ${paymentIntent.id}`);
        }
        break;

      case 'checkout.session.completed':
        const checkoutSession = event.data.object;
        console.log(`✅ Checkout session completed: ${checkoutSession.id}`);

        // Handle payment method setup (for pay-as-you-go billing)
        if (checkoutSession.mode === 'setup' && checkoutSession.setup_intent) {
          try {
            const setupIntent = await stripe.setupIntents.retrieve(checkoutSession.setup_intent);
            const customerId = checkoutSession.metadata?.customer_id;

            if (customerId && setupIntent.payment_method) {
              const paymentMethod = await stripe.paymentMethods.retrieve(setupIntent.payment_method);

              // Update customer with payment method
              db.updateCustomer(customerId, {
                stripe_customer_id: checkoutSession.customer || null,
                stripe_payment_method_id: setupIntent.payment_method,
                card_last4: paymentMethod.card?.last4 || null,
                card_brand: paymentMethod.card?.brand || null,
                card_verified: 1,
                card_verified_at: new Date().toISOString()
              });

              console.log(`✅ Payment method saved for customer ${customerId}`);
            }
          } catch (error) {
            console.error('❌ Error processing setup intent:', error);
          }
        }
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        console.log(`❌ PaymentIntent ${failedPayment.id} failed`);

        // Update wallet deposit status if this was a wallet deposit
        if (failedPayment.metadata && failedPayment.metadata.type === 'wallet_deposit') {
          const depositId = failedPayment.metadata.deposit_id;

          try {
            const updateStmt = db.db.prepare(`
              UPDATE circle_transfers 
              SET status = ?, error_message = ?
              WHERE id = ? OR circle_transfer_id = ?
            `);
            updateStmt.run(
              'failed',
              `Payment failed: ${failedPayment.last_payment_error?.message || 'Unknown error'}`,
              depositId,
              failedPayment.id
            );

            console.log(`❌ Wallet deposit marked as failed: ${depositId}`);
          } catch (error) {
            console.error(`❌ Error updating failed deposit:`, error);
          }
        } else if (failedPayment.metadata && failedPayment.metadata.checkout_id) {
          // VOICE CHECKOUT PAYMENT FAILED - Update checkout status
          const checkoutId = failedPayment.metadata.checkout_id;
          console.log(`❌ Voice checkout payment failed: ${checkoutId}`);

          try {
            await db.updateVoiceCheckout(checkoutId, {
              status: 'failed',
              payment_intent_id: failedPayment.id
            });

            // Create failed transaction record for admin tracking
            const { v4: uuidv4 } = require('uuid');
            const checkout = await db.getVoiceCheckout(checkoutId);
            if (checkout) {
              db.createTransaction({
                id: uuidv4(),
                merchant_id: checkout.merchant_id,
                platform: 'voice',
                platform_order_id: checkoutId,
                product_id: checkout.product_id,
                amount: checkout.amount,
                status: 'failed',
                customer_email: checkout.customer_email || checkout.customer_phone,
                completed_at: null
              });
            }

            console.log(`✅ Checkout ${checkoutId} marked as failed`);
          } catch (error) {
            console.error(`❌ Error updating failed checkout:`, error);
          }
        }
        break;

      case 'payment_intent.canceled':
        const canceledPayment = event.data.object;
        console.log(`🚫 PaymentIntent ${canceledPayment.id} canceled`);

        if (canceledPayment.metadata && canceledPayment.metadata.checkout_id) {
          // VOICE CHECKOUT PAYMENT CANCELED - Update checkout status
          const checkoutId = canceledPayment.metadata.checkout_id;
          console.log(`🚫 Voice checkout payment canceled: ${checkoutId}`);

          try {
            await db.updateVoiceCheckout(checkoutId, {
              status: 'cancelled',
              payment_intent_id: canceledPayment.id
            });

            // Create cancelled transaction record for admin tracking
            const { v4: uuidv4 } = require('uuid');
            const checkout = await db.getVoiceCheckout(checkoutId);
            if (checkout) {
              db.createTransaction({
                id: uuidv4(),
                merchant_id: checkout.merchant_id,
                platform: 'voice',
                platform_order_id: checkoutId,
                product_id: checkout.product_id,
                amount: checkout.amount,
                status: 'cancelled',
                customer_email: checkout.customer_email || checkout.customer_phone,
                completed_at: null
              });
            }

            console.log(`✅ Checkout ${checkoutId} marked as cancelled`);
          } catch (error) {
            console.error(`❌ Error updating cancelled checkout:`, error);
          }
        }
        break;

      case 'charge.refunded':
        const charge = event.data.object;
        console.log(`↩️  Charge ${charge.id} refunded`);
        const paymentIntentId = charge.payment_intent;
        if (paymentIntentId) {
          try {
            const refundAmount = (charge.amount_refunded || 0) / 100;
            db.insertFinancialEvent({
              event_type: 'refund',
              actor_type: 'system',
              actor_id: null,
              amount: -refundAmount,
              currency: (charge.currency || 'usd').toUpperCase(),
              rail_type: 'stripe',
              status: 'succeeded',
              cause: 'charge_refunded',
              metadata: { charge_id: charge.id, payment_intent_id: paymentIntentId }
            });
            console.log(`✅ Refund event recorded: $${refundAmount}`);
          } catch (e) {
            console.warn('⚠️  insertFinancialEvent for refund failed:', e.message);
          }
        }
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('❌ Error processing Stripe webhook:', error);
    console.error('   Event type:', event?.type);
    console.error('   Payment Intent:', event?.data?.object?.id);
    console.error('   Stack:', error.stack);

    // S-3: Always return 200 to Stripe—prevents retry storms. Log for manual review.
    res.status(200).json({
      received: true,
      error: 'Webhook processing failed - logged for review',
      error_message: error.message
    });
  }
});

// ============================================
// EHR INTEGRATION ENDPOINTS
// ============================================

// Initiate OAuth connection to EHR (1upHealth aggregator)
app.get('/api/ehr/connect', async (req, res) => {
  try {
    const { ehr_name, provider_id } = req.query;

    if (!ehr_name) {
      return res.status(400).json({
        success: false,
        error: 'ehr_name is required (epic, cerner, athena, etc.)'
      });
    }

    const providerId = provider_id || 'default';
    const authData = EHRAggregatorService.generateAuthUrl(ehr_name, providerId);

    res.json({
      success: true,
      auth_url: authData.auth_url,
      state: authData.state,
      message: 'Redirect user to auth_url to connect EHR'
    });
  } catch (error) {
    console.error('Error generating EHR auth URL:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// OAuth callback from EHR
app.get('/api/ehr/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing code or state parameter'
      });
    }

    const result = await EHRAggregatorService.exchangeCodeForToken(code, state);

    // Redirect to success page or return JSON
    res.json({
      success: true,
      message: 'EHR connected successfully',
      connection_id: result.connection_id,
      patient_id: result.patient_id
    });
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync encounters from EHR (manual trigger)
app.post('/api/ehr/sync/encounters', async (req, res) => {
  try {
    const { connection_id, date } = req.body;

    if (!connection_id) {
      return res.status(400).json({
        success: false,
        error: 'connection_id is required'
      });
    }

    const result = await EHRSyncService.syncConnection(connection_id, date);

    res.json({
      success: true,
      synced: result.synced,
      date: result.date,
      message: `Synced ${result.synced} encounters`
    });
  } catch (error) {
    console.error('Error syncing encounters:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Sync specific appointment
app.post('/api/ehr/sync/appointment/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;
    await EHRSyncService.syncAppointment(appointmentId);

    res.json({
      success: true,
      message: 'Appointment synced successfully'
    });
  } catch (error) {
    console.error('Error syncing appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get EHR connections for provider
app.get('/api/admin/ehr/connections', async (req, res) => {
  try {
    const { provider_id } = req.query;
    const connections = provider_id
      ? db.getEHRConnectionsByProvider(provider_id)
      : db.getActiveEHRConnections();

    res.json({
      success: true,
      connections: connections.map(conn => ({
        id: conn.id,
        ehr_name: conn.ehr_name,
        provider_id: conn.provider_id,
        connected_at: conn.connected_at,
        expires_at: conn.expires_at
      }))
    });
  } catch (error) {
    console.error('Error fetching EHR connections:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Debug/ops: inspect EHR sync queue (latest first)
app.get('/api/admin/ehr/sync-jobs', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '50', 10) || 50, 200));
    const rows = status
      ? db.db.prepare(`
          SELECT * FROM ehr_sync_jobs
          WHERE status = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(status, limit)
      : db.db.prepare(`
          SELECT * FROM ehr_sync_jobs
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit);
    res.json({ success: true, jobs: rows || [] });
  } catch (error) {
    console.error('Error fetching EHR sync jobs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get EHR summary for appointment
app.get('/api/admin/appointments/:id/ehr-summary', async (req, res) => {
  try {
    const { id } = req.params;
    const summary = db.getEHRSummaryForAppointment(id);

    if (!summary) {
      return res.json({
        success: true,
        synced: false,
        message: 'No EHR data found for this appointment'
      });
    }

    res.json({
      success: true,
      synced: true,
      encounter: {
        id: summary.encounter.id,
        start_time: summary.encounter.start_time,
        end_time: summary.encounter.end_time,
        status: summary.encounter.status
      },
      conditions: summary.conditions.map(c => ({
        icd10_code: c.icd10_code,
        description: c.description,
        is_primary: c.is_primary === 1
      })),
      procedures: summary.procedures.map(p => ({
        cpt_code: p.cpt_code,
        modifier: p.modifier,
        description: p.description
      })),
      observations: summary.observations.map(o => ({
        type: o.type,
        value: o.value,
        unit: o.unit
      }))
    });
  } catch (error) {
    console.error('Error fetching EHR summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get EHR summary for patient
app.get('/api/admin/patients/:id/ehr-summary', async (req, res) => {
  try {
    const { id } = req.params;

    // Get FHIR patient ID from resource_id
    const fhirPatient = db.getFHIRPatient(id);
    if (!fhirPatient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    const summaries = db.getEHRSummaryForPatient(fhirPatient.resource_id);

    res.json({
      success: true,
      patient_id: id,
      encounters: summaries.map(summary => ({
        encounter: {
          id: summary.encounter.id,
          start_time: summary.encounter.start_time,
          end_time: summary.encounter.end_time,
          status: summary.encounter.status
        },
        conditions: summary.conditions.map(c => ({
          icd10_code: c.icd10_code,
          description: c.description,
          is_primary: c.is_primary === 1
        })),
        procedures: summary.procedures.map(p => ({
          cpt_code: p.cpt_code,
          modifier: p.modifier,
          description: p.description
        })),
        observations: summary.observations.map(o => ({
          type: o.type,
          value: o.value,
          unit: o.unit
        }))
      }))
    });
  } catch (error) {
    console.error('Error fetching patient EHR summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// EPIC FHIR DIRECT INTEGRATION ENDPOINTS
// ============================================

// Initiate OAuth connection to Epic
app.get('/api/ehr/epic/connect', async (req, res) => {
  try {
    const { provider_id, patient_id } = req.query;

    const providerId = provider_id || 'default';
    const authData = await EpicAdapter.generateAuthUrl(providerId, patient_id || null);

    res.json({
      success: true,
      auth_url: authData.auth_url,
      state: authData.state,
      ehr_name: 'epic',
      message: 'Redirect user to auth_url to connect Epic EHR'
    });
  } catch (error) {
    console.error('Error generating Epic auth URL:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Epic OAuth callback
app.get('/api/ehr/epic/callback', async (req, res) => {
  try {
    console.log('\n🔗 Epic OAuth Callback Received');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const { sanitizeForLog, safeLogHeaders } = require('./services/payment-security');
    console.log('Query params:', JSON.stringify(sanitizeForLog(req.query || {})));
    console.log('Full URL:', req.url);
    safeLogHeaders('Headers:', req);

    const { code, state, error, error_description, error_uri } = req.query;

    // Check if Epic returned an error
    if (error) {
      console.error('❌ Epic OAuth Error:', error);
      console.error('   Description:', error_description);
      console.error('   Error URI:', error_uri);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Epic Authorization Error</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #e53e3e; }
            .error-box { background: #fed7d7; border: 2px solid #e53e3e; border-radius: 8px; padding: 20px; margin: 20px 0; }
            code { background: #f7fafc; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>❌ Epic Authorization Failed</h1>
          <div class="error-box">
            <p><strong>Error:</strong> <code>${error}</code></p>
            ${error_description ? `<p><strong>Description:</strong> ${error_description}</p>` : ''}
            ${error_uri ? `<p><strong>More info:</strong> <a href="${error_uri}">${error_uri}</a></p>` : ''}
          </div>
          <p>Common causes:</p>
          <ul style="text-align: left; display: inline-block;">
            <li>User denied authorization</li>
            <li>Redirect URI mismatch</li>
            <li>Invalid client ID or scopes</li>
          </ul>
          <p><a href="/api/ehr/epic/connect">Try again</a></p>
        </body>
        </html>
      `);
    }

    // Check if code and state are present
    if (!code || !state) {
      console.error('❌ Missing code or state parameter');
      console.error('   Received params:', Object.keys(req.query));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Epic Callback Error</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #e53e3e; }
            .info-box { background: #bee3f8; border: 2px solid #3182ce; border-radius: 8px; padding: 20px; margin: 20px 0; }
            code { background: #f7fafc; padding: 2px 6px; border-radius: 4px; }
            pre { background: #f7fafc; padding: 10px; border-radius: 4px; text-align: left; overflow-x: auto; }
          </style>
        </head>
        <body>
          <h1>❌ Missing Authorization Parameters</h1>
          <div class="info-box">
            <p>The callback was received but <code>code</code> or <code>state</code> parameters are missing.</p>
            <p><strong>Received parameters:</strong></p>
            <pre>${JSON.stringify(req.query, null, 2)}</pre>
          </div>
          <p>Possible causes:</p>
          <ul style="text-align: left; display: inline-block;">
            <li>Epic redirected without authorization code (user may have cancelled)</li>
            <li>Redirect URI mismatch - check Epic app settings</li>
            <li>Query parameters were lost in transit</li>
          </ul>
          <p><a href="/api/ehr/epic/connect">Try connecting again</a></p>
        </body>
        </html>
      `);
    }

    console.log('✅ Code and state received, exchanging for token...');
    const result = await EpicAdapter.exchangeCodeForToken(code, state);

    console.log('✅ Epic connection successful!');
    console.log('   Connection ID:', result.connection_id);
    console.log('   Patient ID:', result.patient_id);
    console.log('   Scope:', result.scope);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Epic Connected Successfully</title>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
          h1 { color: #48bb78; }
          .success-box { background: #c6f6d5; border: 2px solid #48bb78; border-radius: 8px; padding: 20px; margin: 20px 0; }
          code { background: #f7fafc; padding: 2px 6px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>✅ Epic EHR Connected Successfully!</h1>
        <div class="success-box">
          <p><strong>Connection ID:</strong> <code>${result.connection_id}</code></p>
          ${result.patient_id ? `<p><strong>Patient ID:</strong> <code>${result.patient_id}</code></p>` : ''}
          <p><strong>Status:</strong> Active</p>
        </div>
        <p>The EHR sync service will now automatically sync data from Epic every 2 minutes.</p>
        <p>You can close this window.</p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Error in Epic OAuth callback:', error);
    console.error('   Stack:', error.stack);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Epic Connection Error</title>
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
          h1 { color: #e53e3e; }
          .error-box { background: #fed7d7; border: 2px solid #e53e3e; border-radius: 8px; padding: 20px; margin: 20px 0; }
          code { background: #f7fafc; padding: 2px 6px; border-radius: 4px; }
          pre { background: #f7fafc; padding: 10px; border-radius: 4px; text-align: left; overflow-x: auto; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>❌ Connection Error</h1>
        <div class="error-box">
          <p><strong>Error:</strong> ${error.message}</p>
          ${process.env.NODE_ENV === 'development' ? `<pre>${error.stack}</pre>` : ''}
        </div>
        <p><a href="/api/ehr/epic/connect">Try again</a></p>
      </body>
      </html>
    `);
  }
});

// Sync Epic encounters
app.post('/api/ehr/epic/sync', async (req, res) => {
  try {
    const { connection_id, patient_id, date } = req.body;

    if (!connection_id) {
      return res.status(400).json({
        success: false,
        error: 'connection_id is required'
      });
    }

    const { v4: uuidv4 } = require('uuid');
    const syncDate = date || new Date().toISOString().split('T')[0];

    // Get connection to find patient_id
    const connection = db.db.prepare(`
      SELECT * FROM ehr_connections WHERE id = ? AND ehr_name = 'epic'
    `).get(connection_id);

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Epic connection not found'
      });
    }

    const epicPatientId = patient_id || connection.patient_id;
    if (!epicPatientId) {
      return res.status(400).json({
        success: false,
        error: 'patient_id is required (either in connection or request body)'
      });
    }

    console.log(`🔄 Syncing Epic data for patient ${epicPatientId} on ${syncDate}...`);

    // Fetch encounters from Epic
    const encounters = await EpicAdapter.fetchEncounters(connection_id, epicPatientId, syncDate);
    console.log(`   Found ${encounters.length} encounter(s) in Epic`);

    let synced = 0;
    let totalConditions = 0;
    let totalProcedures = 0;
    let totalObservations = 0;

    // For each encounter, fetch and store related data
    for (const entry of encounters) {
      const encounter = entry.resource;

      // Only sync finished encounters
      if (encounter.status !== 'finished' && encounter.status !== 'completed') {
        console.log(`   Skipping encounter ${encounter.id} (status: ${encounter.status})`);
        continue;
      }

      // Get patient ID from encounter
      const encPatientId = encounter.subject?.reference?.replace('Patient/', '') ||
        encounter.subject?.id || epicPatientId;

      // Find matching DocLittle patient by Epic patient ID
      // First, try to find by resource_id matching Epic patient ID
      let doclittlePatient = db.db.prepare(`
        SELECT * FROM fhir_patients WHERE resource_id = ?
      `).get(encPatientId);

      // If not found, use the first patient or create a link
      if (!doclittlePatient && epicPatientId) {
        // For now, we'll use the connection's patient_id if available
        doclittlePatient = db.db.prepare(`
          SELECT * FROM fhir_patients WHERE resource_id = ?
        `).get(epicPatientId);
      }

      if (!doclittlePatient) {
        console.warn(`   ⚠️  Patient ${encPatientId} not found in DocLittle, skipping encounter ${encounter.id}`);
        continue;
      }

      const patientId = doclittlePatient.resource_id;
      const encounterId = encounter.id;
      const startTime = encounter.period?.start || null;
      const endTime = encounter.period?.end || null;
      const status = encounter.status;

      // Check if already synced
      const existing = db.db.prepare(`
        SELECT id FROM ehr_encounters WHERE fhir_encounter_id = ?
      `).get(encounterId);

      if (existing) {
        console.log(`   ⏭️  Encounter ${encounterId} already synced, skipping`);
        continue;
      }

      // Store encounter
      const ehrEncounterId = uuidv4();
      db.db.prepare(`
        INSERT INTO ehr_encounters 
        (id, fhir_encounter_id, patient_id, appointment_id, provider_id, 
         start_time, end_time, status, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        ehrEncounterId,
        encounterId,
        patientId,
        null, // No appointment link for now
        encounter.participant?.[0]?.individual?.reference?.replace('Practitioner/', '') || null,
        startTime,
        endTime,
        status,
        JSON.stringify(encounter)
      );

      // Fetch and store conditions (ICD-10 codes)
      try {
        const conditions = await EpicAdapter.fetchConditions(connection_id, encPatientId, encounterId);
        const icdCodes = EpicAdapter.extractICDCodes(conditions);

        for (const code of icdCodes) {
          db.db.prepare(`
            INSERT INTO ehr_conditions 
            (id, ehr_encounter_id, icd10_code, description, is_primary, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            uuidv4(),
            ehrEncounterId,
            code.code,
            code.display,
            code.primary ? 1 : 0,
            JSON.stringify(code)
          );
          totalConditions++;
        }
      } catch (error) {
        console.error(`   ❌ Error syncing conditions for encounter ${encounterId}:`, error.message);
      }

      // Fetch and store procedures (CPT codes)
      try {
        const procedures = await EpicAdapter.fetchProcedures(connection_id, encPatientId, encounterId);
        const cptCodes = EpicAdapter.extractCPTCodes(procedures);

        for (const code of cptCodes) {
          db.db.prepare(`
            INSERT INTO ehr_procedures 
            (id, ehr_encounter_id, cpt_code, modifier, description, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            uuidv4(),
            ehrEncounterId,
            code.code,
            code.modifier,
            code.display,
            JSON.stringify(code)
          );
          totalProcedures++;
        }
      } catch (error) {
        console.error(`   ❌ Error syncing procedures for encounter ${encounterId}:`, error.message);
      }

      // Fetch and store observations
      try {
        const observations = await EpicAdapter.fetchObservations(connection_id, encPatientId, encounterId);

        for (const entry of observations) {
          const observation = entry.resource;
          const type = observation.code?.coding?.[0]?.display || observation.code?.text || 'unknown';
          const value = observation.valueQuantity?.value ||
            observation.valueString ||
            observation.valueCodeableConcept?.coding?.[0]?.display ||
            null;
          const unit = observation.valueQuantity?.unit || null;

          db.db.prepare(`
            INSERT INTO ehr_observations 
            (id, ehr_encounter_id, type, value, unit, raw_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            uuidv4(),
            ehrEncounterId,
            type,
            value?.toString(),
            unit,
            JSON.stringify(observation)
          );
          totalObservations++;
        }
      } catch (error) {
        console.error(`   ❌ Error syncing observations for encounter ${encounterId}:`, error.message);
      }

      console.log(`   ✅ Synced encounter ${encounterId}`);
      synced++;
    }

    console.log(`✅ Epic sync completed: ${synced} encounters, ${totalConditions} conditions, ${totalProcedures} procedures, ${totalObservations} observations`);

    res.json({
      success: true,
      synced: synced,
      encounters_found: encounters.length,
      conditions: totalConditions,
      procedures: totalProcedures,
      observations: totalObservations,
      message: `Synced ${synced} encounters from Epic`
    });
  } catch (error) {
    console.error('Error syncing Epic encounters:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get Epic connection status
app.get('/api/ehr/epic/status', async (req, res) => {
  try {
    const { connection_id } = req.query;

    if (!connection_id) {
      return res.status(400).json({
        success: false,
        error: 'connection_id is required'
      });
    }

    const connection = db.getEHRConnection(connection_id);

    if (!connection || connection.ehr_name !== 'epic') {
      return res.status(404).json({
        success: false,
        error: 'Epic connection not found'
      });
    }

    // Check if token is valid
    const isExpired = connection.expires_at && new Date(connection.expires_at) < new Date();

    res.json({
      success: true,
      connected: !!connection.connected_at,
      expired: isExpired,
      expires_at: connection.expires_at,
      patient_id: connection.patient_id
    });
  } catch (error) {
    console.error('Error checking Epic status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoints (comprehensive)
app.get('/health', healthCheckHandler);
app.get('/health/ready', readinessCheck);
app.get('/health/live', livenessCheck);
app.get('/health/voice-deps', async (req, res) => {
  try {
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER || null;
    const retellAgentId = process.env.RETELL_AGENT_ID || null;
    const defaultSubdomain = constants.TENANTS?.DEFAULT_SUBDOMAIN || 'akin-dunbar';

    const clinicPhone = twilioPhone ? db.getClinicPhoneNumber(twilioPhone) : null;
    const defaultMerchant = db.getMerchantBySubdomain ? db.getMerchantBySubdomain(defaultSubdomain) : null;

    const checks = {
      retell_api_key_present: !!process.env.RETELL_API_KEY,
      retell_agent_id_present: !!retellAgentId,
      twilio_phone_present: !!twilioPhone,
      twilio_phone_mapped_to_clinic: !!clinicPhone?.clinic_id,
      default_tenant_exists: !!defaultMerchant?.id
    };

    const ok = Object.values(checks).every(Boolean);
    return res.status(ok ? 200 : 503).json({
      success: ok,
      checks,
      details: {
        twilio_phone_number: twilioPhone,
        mapped_clinic_id: clinicPhone?.clinic_id || null,
        mapped_clinic_name: clinicPhone?.clinic_name || null,
        default_subdomain: defaultSubdomain,
        default_merchant_id: defaultMerchant?.id || null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Root endpoint - API information (moved to /api for API status)
app.get('/api', (req, res) => {
  const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || `http://${req.headers.host}`;
  res.json({
    success: true,
    service: 'DocLittle Middleware Platform',
    version: '3.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: `${baseUrl}/health`,
      fhir: `${baseUrl}/fhir`,
      docs: `${baseUrl}/docs`,
      webhooks: {
        retell_llm: `wss://${req.headers.host.replace('http', 'ws')}/webhook/retell/llm`,
        retell_events: `${baseUrl}/webhook/retell/events`,
        stripe: `${baseUrl}/webhooks/stripe`
      }
    },
    documentation: `${baseUrl}/docs`,
    signup: `${baseUrl}/`
  });
});

// ============================================
// STRIPE ISSUING: WEBHOOKS
// ============================================

// Stripe Issuing webhook handler
app.post('/webhooks/stripe/issuing', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_ISSUING_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.warn('⚠️  STRIPE_ISSUING_WEBHOOK_SECRET not configured. Skipping webhook verification.');
      // Continue without verification in development
    }

    let event;
    try {
      if (!stripe) {
        return res.status(503).json({
          success: false,
          error: 'Stripe Issuing webhook processing is not configured'
        });
      }

      if (webhookSecret) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        // In development, parse without verification
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📥 Stripe Issuing webhook received: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case 'issuing_authorization.created':
      case 'issuing_authorization.request':
        await handleAuthorizationEvent(event.data.object);
        break;

      case 'issuing_transaction.created':
        await handleTransactionCreated(event.data.object);
        break;

      case 'issuing_card.created':
        await handleCardCreated(event.data.object);
        break;

      case 'issuing_card.updated':
        await handleCardUpdated(event.data.object);
        break;

      default:
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Error handling Stripe Issuing webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle authorization events
async function handleAuthorizationEvent(authorization) {
  try {
    console.log(`💳 Authorization: ${authorization.id} for card ${authorization.card}`);

    // Find card in database
    const card = db.getCardByStripeId(authorization.card);
    if (!card) {
      console.warn(`⚠️  Card not found for authorization: ${authorization.card}`);
      return;
    }

    // Store authorization (you might want to create an authorizations table)
    console.log(`✅ Authorization stored for card ${card.id}`);
  } catch (error) {
    console.error('❌ Error handling authorization event:', error);
  }
}

// Handle transaction created
async function handleTransactionCreated(transaction) {
  try {
    console.log(`💳 Transaction: ${transaction.id} for card ${transaction.card}`);

    // Find card in database
    const card = db.getCardByStripeId(transaction.card);
    if (!card) {
      console.warn(`⚠️  Card not found for transaction: ${transaction.card}`);
      return;
    }

    // Create transaction record
    const transactionId = `transaction-${uuidv4()}`;
    db.createCardTransaction({
      id: transactionId,
      card_id: card.id,
      patient_id: card.patient_id,
      clinic_id: card.clinic_id,
      stripe_transaction_id: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      merchant_name: transaction.merchant_data?.name || null,
      merchant_category: transaction.merchant_data?.category || null,
      status: transaction.type, // 'capture' or 'refund'
      authorization_code: transaction.authorization || null,
      metadata: {
        created_at: new Date().toISOString(),
        stripe_transaction: transaction
      }
    });

    console.log(`✅ Transaction stored: ${transactionId}`);
  } catch (error) {
    console.error('❌ Error handling transaction event:', error);
  }
}

// Handle card created
async function handleCardCreated(cardData) {
  try {
    console.log(`💳 Card created: ${cardData.id}`);
    // Card should already be in database from API call
    // This is just for webhook confirmation
  } catch (error) {
    console.error('❌ Error handling card created event:', error);
  }
}

// Handle card updated
async function handleCardUpdated(cardData) {
  try {
    console.log(`💳 Card updated: ${cardData.id}`);

    // Find card in database
    const card = db.getCardByStripeId(cardData.id);
    if (!card) {
      console.warn(`⚠️  Card not found for update: ${cardData.id}`);
      return;
    }

    // Update card status if changed
    if (cardData.status && cardData.status !== card.status) {
      db.updateCardStatus(card.id, cardData.status);
      console.log(`✅ Card status updated: ${card.id} -> ${cardData.status}`);
    }

    // Update spending controls if changed
    if (cardData.spending_controls) {
      db.updateCardSpendingControls(card.id, cardData.spending_controls);
      console.log(`✅ Card spending controls updated: ${card.id}`);
    }
  } catch (error) {
    console.error('❌ Error handling card updated event:', error);
  }
}

// ============================================
// STRIPE ISSUING: PATIENT CARDS API
// ============================================

// Get patient cards
app.get('/api/patient/:patientId/cards', async (req, res) => {
  try {
    const { patientId } = req.params;

    // Get cards (JSON fields are already parsed by database function)
    const cards = db.getCardsByPatientId(patientId);

    res.json({
      success: true,
      cards: cards,
      count: cards.length
    });
  } catch (error) {
    console.error('❌ Error fetching patient cards:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch cards'
    });
  }
});

// Create card for patient
app.post('/api/patient/:patientId/cards', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { spending_limit, spending_interval, clinic_id } = req.body;

    // Get patient
    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    // Create card using FHIR service
    const result = await FHIRService.createPatientCard(patient.resource_data, {
      clinic_id: clinic_id || null,
      spending_limit: spending_limit || 100000, // $1,000 default
      spending_interval: spending_interval || 'all_time'
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to create card'
      });
    }

    res.json({
      success: true,
      card: {
        card_id: result.card_id,
        cardholder_id: result.cardholder_id,
        last4: result.last4,
        brand: result.brand
      }
    });
  } catch (error) {
    console.error('❌ Error creating patient card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create card'
    });
  }
});

// Get card details (including PAN and CVC for virtual cards)
app.get('/api/patient/cards/:cardId', requireAdminAuth, async (req, res) => {
  try {
    const { cardId } = req.params;

    // Get card from database
    const card = db.getCardById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    // Get card details from Stripe (if Stripe Issuing is enabled)
    let cardDetails = null;
    if (StripeIssuingService && card.stripe_card_id) {
      const stripeIssuing = new StripeIssuingService();
      const detailsResult = await stripeIssuing.getCardDetails(card.stripe_card_id);
      if (detailsResult.success) {
        cardDetails = {
          pan: detailsResult.pan, // Primary Account Number (card number)
          cvc: detailsResult.cvc, // Card Verification Code
          last4: detailsResult.last4,
          brand: detailsResult.brand,
          expiry_month: detailsResult.expiry_month,
          expiry_year: detailsResult.expiry_year
        };
      }
    }

    res.json({
      success: true,
      card: {
        ...card,
        // JSON fields are already parsed by database function
        details: cardDetails // PAN and CVC (only for virtual cards, in live mode)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching card details:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch card details'
    });
  }
});

// Update card spending controls
app.patch('/api/patient/cards/:cardId/spending-controls', async (req, res) => {
  try {
    const { cardId } = req.params;
    const { spending_limit, spending_interval, allowed_categories, blocked_categories } = req.body;

    // Get card from database
    const card = db.getCardById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    if (!StripeIssuingService || !card.stripe_card_id) {
      return res.status(400).json({
        success: false,
        error: 'Stripe Issuing not configured'
      });
    }

    // Build spending controls
    const spendingControls = {
      spending_limits: [
        {
          amount: spending_limit || 100000,
          interval: spending_interval || 'all_time'
        }
      ]
    };

    if (allowed_categories) {
      spendingControls.allowed_categories = allowed_categories;
    }

    if (blocked_categories) {
      spendingControls.blocked_categories = blocked_categories;
    }

    // Update in Stripe
    const stripeIssuing = new StripeIssuingService();
    const result = await stripeIssuing.updateCardSpendingControls(card.stripe_card_id, spendingControls);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to update spending controls'
      });
    }

    // Update in database
    db.updateCardSpendingControls(cardId, spendingControls);

    res.json({
      success: true,
      card: {
        ...card,
        spending_controls: spendingControls
      }
    });
  } catch (error) {
    console.error('❌ Error updating card spending controls:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update spending controls'
    });
  }
});

// Cancel card
app.post('/api/patient/cards/:cardId/cancel', async (req, res) => {
  try {
    const { cardId } = req.params;

    // Get card from database
    const card = db.getCardById(cardId);
    if (!card) {
      return res.status(404).json({
        success: false,
        error: 'Card not found'
      });
    }

    if (!StripeIssuingService || !card.stripe_card_id) {
      return res.status(400).json({
        success: false,
        error: 'Stripe Issuing not configured'
      });
    }

    // Cancel in Stripe
    const stripeIssuing = new StripeIssuingService();
    const result = await stripeIssuing.cancelCard(card.stripe_card_id);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to cancel card'
      });
    }

    // Update status in database
    db.updateCardStatus(cardId, 'canceled');

    res.json({
      success: true,
      message: 'Card canceled successfully'
    });
  } catch (error) {
    console.error('❌ Error canceling card:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel card'
    });
  }
});

// Get card transactions
app.get('/api/patient/cards/:cardId/transactions', async (req, res) => {
  try {
    const { cardId } = req.params;

    // Get transactions (JSON fields are already parsed by database function)
    const transactions = db.getTransactionsByCardId(cardId);

    res.json({
      success: true,
      transactions: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('❌ Error fetching card transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transactions'
    });
  }
});

// Get patient transactions (all cards)
app.get('/api/patient/:patientId/transactions', async (req, res) => {
  try {
    const { patientId } = req.params;

    // Get transactions (JSON fields are already parsed by database function)
    const transactions = db.getTransactionsByPatientId(patientId);

    res.json({
      success: true,
      transactions: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('❌ Error fetching patient transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch transactions'
    });
  }
});

app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// ============================================
// START SERVER
// ============================================

// ============================================
// TEST ENDPOINTS (for development/testing)
// ============================================

// Test appointment email booking
app.post('/api/test/appointment-email', async (req, res) => {
  try {
    console.log('\n🧪 TEST: Appointment Email Booking');
    safeLogRequestBody('Request body:', req);

    const { patient_name, patient_phone, patient_email, appointment_type, date, time, timezone } = req.body;

    if (!patient_email) {
      return res.status(400).json({
        success: false,
        error: 'patient_email is required for testing'
      });
    }

    // Create test appointment
    const testAppointment = {
      patient_name: patient_name || 'Test Patient',
      patient_phone: patient_phone || '+15551234567',
      patient_email: patient_email,
      appointment_type: appointment_type || 'Cardiology Consultation',
      date: date || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      time: time || '2:00 PM',
      timezone: timezone || 'America/New_York',
      notes: 'Test appointment for email verification'
    };

    console.log('📋 Creating test appointment...');
    const bookingResult = await BookingService.scheduleAppointment(testAppointment);

    if (!bookingResult.success) {
      return res.status(400).json({
        success: false,
        error: bookingResult.error,
        requiresEmail: bookingResult.requiresEmail,
        requiresPhone: bookingResult.requiresPhone
      });
    }

    // Get appointment from database to check email status
    const appointment = await db.getAppointment(bookingResult.appointment.id);

    // Check if email was sent
    let emailSent = false;
    let emailProvider = 'none';

    if (appointment && appointment.patient_email) {
      // Try to send email again to verify
      try {
        const emailResult = await EmailService.sendAppointmentConfirmation(appointment);
        emailSent = emailResult.success;
        emailProvider = emailResult.provider || 'unknown';
        console.log(`📧 Email test result: ${emailSent ? 'SENT' : 'FAILED'} (${emailProvider})`);
      } catch (emailError) {
        console.warn('⚠️  Email test failed:', emailError.message);
      }
    }

    res.json({
      success: true,
      message: 'Test appointment created successfully',
      appointment: {
        id: bookingResult.appointment.id,
        confirmation_number: bookingResult.appointment.confirmation_number,
        patient_name: appointment.patient_name,
        patient_email: appointment.patient_email,
        date: appointment.date,
        time: appointment.time,
        appointment_type: appointment.appointment_type,
        status: appointment.status
      },
      emailSent: emailSent,
      emailProvider: emailProvider,
      emailAddress: appointment.patient_email,
      instructions: emailProvider === 'console'
        ? 'Email was logged to console (no email service configured). Check server logs for email content.'
        : `Check your email inbox at ${appointment.patient_email} for the confirmation email.`
    });

  } catch (error) {
    console.error('❌ Test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test UHC FHIR connection
app.get('/api/test/uhc-fhir/connection', async (req, res) => {
  try {
    const UHCFHIRService = require('./services/uhc-fhir-service');
    const useSandbox = req.query.sandbox !== 'false';
    const result = await UHCFHIRService.testConnection(useSandbox);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test UHC FHIR provider directory
app.get('/api/test/uhc-fhir/providers', async (req, res) => {
  try {
    const UHCFHIRService = require('./services/uhc-fhir-service');
    const result = await UHCFHIRService.pullProviderDirectory({
      useSandbox: req.query.sandbox !== 'false',
      zipCode: req.query.zip || null,
      specialty: req.query.specialty || null,
      limit: parseInt(req.query.limit) || 50
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test UHC FHIR patient clinical data
app.get('/api/test/uhc-fhir/patient/:patientId/clinical', async (req, res) => {
  try {
    const UHCFHIRService = require('./services/uhc-fhir-service');
    const result = await UHCFHIRService.pullPatientClinicalData(req.params.patientId, {
      useSandbox: req.query.sandbox !== 'false'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test UHC FHIR coverage data
app.get('/api/test/uhc-fhir/patient/:patientId/coverage', async (req, res) => {
  try {
    const UHCFHIRService = require('./services/uhc-fhir-service');
    const result = await UHCFHIRService.pullCoverageData(req.params.patientId, {
      useSandbox: req.query.sandbox !== 'false'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test UHC FHIR claims data
app.get('/api/test/uhc-fhir/patient/:patientId/claims', async (req, res) => {
  try {
    const UHCFHIRService = require('./services/uhc-fhir-service');
    const result = await UHCFHIRService.pullClaimsData(req.params.patientId, {
      useSandbox: req.query.sandbox !== 'false'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test UHC FHIR - pull ALL data
app.get('/api/test/uhc-fhir/patient/:patientId/all', async (req, res) => {
  try {
    const UHCFHIRService = require('./services/uhc-fhir-service');
    const result = await UHCFHIRService.pullAllPatientData(req.params.patientId, {
      useSandbox: req.query.sandbox !== 'false'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// 404 — unmatched routes (must run after every app.get/app.use route)
// ============================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    suggestion: 'Try /health for service status, /docs for API documentation, or /api for API endpoints'
  });
});

// ============================================
// GLOBAL ERROR HANDLER (Comprehensive)
// ============================================
// Use comprehensive error handler - must be last middleware
app.use(errorHandler);

// Azure App Service requires binding to 0.0.0.0, not localhost
const HOST = process.env.WEBSITE_SITE_NAME ? '0.0.0.0' : '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 MIDDLEWARE PLATFORM - PRODUCTION READY');
  console.log('='.repeat(60));
  console.log(`\n📍 Server running on: http://${HOST}:${PORT}`);
  // Cache warming (Section 24)
  try {
    _runCheckoutPreparedBackfillOnce();
  } catch (_) {}
  try {
    _runCheckoutContextBackfillOnce();
  } catch (_) {}
  try {
    _runCheckoutStaleInFlightRecoveryOnce();
    setInterval(_runCheckoutStaleInFlightRecoveryOnce, 60 * 1000);
  } catch (_) {}
  try {
    const cacheService = require('./services/cache-service');
    if (typeof cacheService.warm === 'function') cacheService.warm();
  } catch (e) { console.warn('⚠️  Cache warm skipped:', e.message); }
  // gap16: SpecialistResolver cache cleanup on startup + every 60 min
  try {
    const SpecialistResolverService = require('./services/specialist-resolver-service');
    if (SpecialistResolverService.cleanupCache) {
      SpecialistResolverService.cleanupCache();
      setInterval(() => SpecialistResolverService.cleanupCache(), 60 * 60 * 1000);
    }
  } catch (e) { console.warn('⚠️  Resolver cache cleanup skipped:', e.message); }
  console.log('\n📊 Available Endpoints:');
  console.log('\n📞 Voice (Custom Telephony with SIP):');
  console.log(`   POST   http://localhost:${PORT}/voice/incoming`);
  console.log('\n🎤 Voice Commerce (USING ORCHESTRATOR):');
  console.log(`   POST   http://localhost:${PORT}/voice/products/search`);
  console.log(`   POST   http://localhost:${PORT}/voice/checkout/create ⭐ FIXED`);
  console.log(`   GET    http://localhost:${PORT}/payment/:token`);
  console.log(`   POST   http://localhost:${PORT}/process-payment`);
  console.log('\n📅 Appointment Booking (Voice Agent):');
  console.log(`   POST   http://localhost:${PORT}/voice/appointments/schedule`);
  console.log(`   POST   http://localhost:${PORT}/voice/appointments/confirm`);
  console.log(`   POST   http://localhost:${PORT}/voice/appointments/cancel`);
  console.log(`   POST   http://localhost:${PORT}/voice/appointments/available-slots`);
  console.log(`   POST   http://localhost:${PORT}/voice/appointments/search`);
  console.log('\n🏥 Insurance & Billing (Stedi Integration):');
  console.log(`   POST   http://localhost:${PORT}/voice/insurance/collect ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/voice/insurance/check-eligibility`);
  console.log(`   POST   http://localhost:${PORT}/voice/insurance/submit-claim`);
  console.log(`   POST   http://localhost:${PORT}/voice/insurance/check-claim-status`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/insurance/claims`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/insurance/payers`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/insurance/payers/stats`);
  console.log(`   POST   http://localhost:${PORT}/api/admin/insurance/cache/refresh ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/metrics ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/admin/insurance/sync-payers`);
  console.log('\n📦 Products & Orders (Merged from merchant-shop):');
  console.log(`   GET    http://localhost:${PORT}/api/products`);
  console.log(`   GET    http://localhost:${PORT}/api/products/:id`);
  console.log(`   GET    http://localhost:${PORT}/api/products/search?q=query`);
  console.log(`   POST   http://localhost:${PORT}/api/products`);
  console.log(`   PUT    http://localhost:${PORT}/api/products/:id`);
  console.log(`   DELETE http://localhost:${PORT}/api/products/:id`);
  console.log(`   GET    http://localhost:${PORT}/api/orders`);
  console.log(`   GET    http://localhost:${PORT}/api/orders/:id`);
  console.log(`   POST   http://localhost:${PORT}/api/orders`);
  console.log(`   PUT    http://localhost:${PORT}/api/orders/:id/status`);
  console.log('\n📊 Dashboard API:');
  console.log(`   POST   http://localhost:${PORT}/api/auth/login`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/stats`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/transactions`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/customers`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/patients/:id/insurance ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/patients/:id/eligibility ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/customers/:phone`);
  console.log('\n🏥 EHR Integration (1upHealth Aggregator):');
  console.log(`   GET    http://localhost:${PORT}/api/ehr/connect ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/ehr/oauth/callback ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/ehr/sync/encounters ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/ehr/sync/appointment/:id ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/ehr/connections ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/appointments/:id/ehr-summary ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/patients/:id/ehr-summary ⭐ NEW`);
  console.log('\n💰 Circle Payment Integration:');
  console.log(`   POST   http://localhost:${PORT}/api/circle/wallets ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/circle/wallets/:walletId/balance ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/circle/accounts/:entityType/:entityId ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/claims/:claimId/submit-payment ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/claims/:claimId/approve-payment ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/circle/webhook ⭐ NEW`);
  console.log('\n🏥 Epic FHIR Direct Integration:');
  console.log(`   GET    http://localhost:${PORT}/api/ehr/epic/connect ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/ehr/epic/callback ⭐ NEW`);
  console.log(`   POST   http://localhost:${PORT}/api/ehr/epic/sync ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/ehr/epic/status ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/agent/stats`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/appointments`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/appointments/upcoming`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/billing`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/billing/eob ⭐ NEW`);
  console.log(`   GET    http://localhost:${PORT}/api/admin/patients/:id/eob ⭐ NEW`);
  console.log('\n🔔 Webhooks:');
  console.log(`   WS     ws://localhost:${PORT}/webhook/retell/llm ⭐ NEW (Retell LLM)`);
  console.log(`   POST   http://localhost:${PORT}/webhook/retell/events`);
  console.log(`   POST   http://localhost:${PORT}/webhook/retell/end-of-call`);
  console.log(`   POST   http://localhost:${PORT}/webhooks/stripe`);
  console.log('\n🏥 Health:');
  console.log(`   GET    http://localhost:${PORT}/health`);
  console.log('\n' + '='.repeat(60));
  console.log('✅ Ready to accept requests!');
  console.log('='.repeat(60) + '\n');

  // Start reminder scheduler (with error handling)
  try {
    ReminderScheduler.start();
    ReminderScheduler.startScheduledActivities(); // Start email follow-up scheduler
    const caseReportTimeoutWorker = require('./services/case-report-timeout-worker');
    caseReportTimeoutWorker.start();
  } catch (error) {
    console.error('⚠️  Failed to start reminder scheduler:', error.message);
    console.log('   Reminders will be disabled, but server will continue');
  }

  // mvp-74: Start durable notification queue worker (retries + dead-letter)
  try {
    const NotificationQueue = require('./services/notification-queue');
    const enabled = (process.env.NOTIFICATION_QUEUE_ENABLED === '1' || process.env.NOTIFICATION_QUEUE_ENABLED === 'true') || isProd;
    if (enabled) {
      NotificationQueue.start();
      console.log('✅ Notification queue worker started');
    } else {
      console.log('ℹ️  Notification queue worker disabled (NOTIFICATION_QUEUE_ENABLED)');
    }
  } catch (e) {
    console.warn('⚠️  Failed to start notification queue worker:', e.message);
  }

  // Start EHR sync service (with error handling)
  try {
    EHRSyncService.start();
    EhrSyncJobWorker.start();
  } catch (error) {
    console.error('⚠️  Failed to start EHR sync service:', error.message);
    console.log('   EHR sync will be disabled, but server will continue');
  }

  // Start Postgres sync retry worker (Section 2.2)
  try {
    PostgresSyncWorker.start();
    ToolCallDlqWorker.start();
  } catch (error) {
    console.error('⚠️  Failed to start background workers:', error.message);
    console.log('   Retry queue will not process, but server will continue');
  }

  // Idempotency keys cleanup (Section 22 - 24h TTL)
  try {
    if (db.cleanupIdempotencyKeys) {
      const deleted = db.cleanupIdempotencyKeys();
      if (deleted > 0) console.log(`🧹 Idempotency cleanup: removed ${deleted} expired keys`);
      setInterval(() => {
        const n = db.cleanupIdempotencyKeys();
        if (n > 0) console.log(`🧹 Idempotency cleanup: removed ${n} expired keys`);
      }, 24 * 60 * 60 * 1000);
    }
  } catch (e) { /* ignore */ }

  // Expired commerce quote sessions (checkout_sessions)
  try {
    if (db.purgeExpiredCheckoutSessions) {
      const purged = db.purgeExpiredCheckoutSessions();
      if (purged > 0) console.log(`🧹 checkout_sessions purge: removed ${purged} expired row(s)`);
      setInterval(() => {
        const n = db.purgeExpiredCheckoutSessions();
        if (n > 0) console.log(`🧹 checkout_sessions purge: removed ${n} expired row(s)`);
      }, 6 * 60 * 60 * 1000);
    }
  } catch (e) {
    console.warn('⚠️  checkout_sessions purge disabled:', e.message);
  }

  // Phase 1: Auto-cancel unpaid appointment checkouts (webhook-safe)
  try {
    const BookingService = require('./services/booking-service');
    const ttlMinutes = parseInt(process.env.APPOINTMENT_PAYMENT_TTL_MINUTES || '30', 10);
    const pollMs = parseInt(process.env.APPOINTMENT_PAYMENT_TTL_POLL_MS || '60000', 10);

    async function runAppointmentPaymentTtlSweep() {
      if (!ttlMinutes || ttlMinutes <= 0) return;
      const cutoffIso = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString();
      let rows = [];
      try {
        rows = db.db.prepare(`
          SELECT * FROM voice_checkouts
          WHERE product_id = 'APPOINTMENT'
            AND status = 'pending'
            AND deleted_at IS NULL
            AND created_at < ?
          ORDER BY created_at ASC
          LIMIT 50
        `).all(cutoffIso);
      } catch (_) {
        return;
      }

      for (const co of rows) {
        try {
          // If Stripe session exists and is still open, do not cancel (webhook-safe)
          if (stripe && co.stripe_checkout_session_id) {
            try {
              const sess = await stripe.checkout.sessions.retrieve(co.stripe_checkout_session_id);
              if (sess && sess.status === 'open') {
                continue;
              }
              if (sess && sess.status === 'complete') {
                continue;
              }
            } catch (_) {
              // If we can't retrieve, fall back to expiry timestamp if present
              if (co.stripe_session_expires_at) {
                const exp = new Date(co.stripe_session_expires_at);
                if (!isNaN(exp.getTime()) && exp.getTime() > Date.now()) {
                  continue;
                }
              }
            }
          }

          // Cancel appointment if still scheduled/confirmed
          const apptId = co.appointment_id;
          if (!apptId) {
            await db.updateVoiceCheckout(co.id, { status: 'canceled' });
            continue;
          }
          const appt = await db.getAppointment(apptId);
          if (appt && ['scheduled', 'confirmed'].includes(appt.status)) {
            await BookingService.cancelAppointment(apptId, 'Auto-canceled (payment not completed in time)', co.clinic_id || appt.clinic_id || null);
          }
          await db.updateVoiceCheckout(co.id, { status: 'canceled' });
          try { db.incrementOpsCounter && db.incrementOpsCounter('appointment_payment_ttl_canceled'); } catch (_) {}
        } catch (e) {
          try { db.incrementOpsCounter && db.incrementOpsCounter('appointment_payment_ttl_error'); } catch (_) {}
        }
      }
    }

    // jittered start
    setTimeout(() => {
      runAppointmentPaymentTtlSweep();
      setInterval(runAppointmentPaymentTtlSweep, pollMs);
    }, 2000);
  } catch (e) {
    console.warn('⚠️  Appointment payment TTL sweep disabled:', e.message);
  }

  // Phase 3.3: Grace-period cleanup — abandon case records with no activity for 48h
  try {
    if (db.abandonStaleCaseRecords && db.db) {
      const runCaseRecordCleanup = () => {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const n = db.abandonStaleCaseRecords(cutoff);
        if (n > 0) console.log(`🧹 Case record cleanup: abandoned ${n} stale draft(s)`);
      };
      runCaseRecordCleanup();
      setInterval(runCaseRecordCleanup, 60 * 60 * 1000);
    }
  } catch (e) {
    console.warn('⚠️  Case record cleanup disabled:', e.message);
  }

  console.log('⚙️  Configuration Status:');
  console.log(`   Database:      ✅ Using database.js module`);
  console.log(`   Stripe:        ${process.env.STRIPE_SECRET_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   Twilio:        ${process.env.TWILIO_ACCOUNT_SID ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   Twilio Verify: ${process.env.TWILIO_VERIFY_SERVICE_SID ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   Twilio Phone:  ${process.env.TWILIO_PHONE_NUMBER ? '✅ ' + process.env.TWILIO_PHONE_NUMBER : '❌ Missing'}`);
  console.log(`   Retell:        ${process.env.RETELL_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   Retell Agent:  ${process.env.RETELL_AGENT_ID ? '✅ ' + process.env.RETELL_AGENT_ID : '⚠️  Using default'}`);
  console.log(`   Google Cal:    ${process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_CLIENT_ID ? '✅ Configured' : '⚠️  Optional (for bookings)'}`);
  console.log('\n📝 ARCHITECTURE:');
  console.log('   ✅ Using PaymentOrchestrator service layer');
  console.log('   ✅ Using BookingService for appointment management');
  console.log('   ✅ Using SMSService for phone normalization');
  console.log('   ✅ Using database.js module for all DB operations');
  console.log('   ✅ Transforms Retell format → PaymentRequest format');
  console.log('   ✅ SIP Endpoint: sip:{call_id}@5t4n6j0wnrl.sip.livekit.cloud');
  console.log('   ✅ Retell LLM WebSocket: ws://localhost:' + PORT + '/webhook/retell/llm');
  console.log('\n' + '='.repeat(60) + '\n');
});

// Handle WebSocket upgrades for Retell LLM
server.on('upgrade', (request, socket, head) => {
  const host = request.headers.host;
  const url = request.url;
  let pathname;

  try {
    pathname = new URL(url, `http://${host}`).pathname;
  } catch (e) {
    console.error('❌ WS upgrade URL parse error:', e.message, { url, host });
    socket.destroy();
    return;
  }

  console.log('🔌 WS upgrade requested', { url, host, pathname });

  // Retell may connect using either:
  // - /webhook/retell/llm
  // - /webhook/retell/llm/<call_id>
  const isRetellLlmPath =
    pathname === '/webhook/retell/llm' || pathname.startsWith('/webhook/retell/llm/');

  if (isRetellLlmPath) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log('✅ WS upgrade accepted for Retell LLM');
      wss.emit('connection', ws, request);
    });
  } else {
    console.warn('⚠️ WS upgrade rejected: invalid path', { pathname });
    socket.destroy();
  }
});

// Bug 8: Removed duplicate inline SIGINT/SIGTERM handlers — they called process.exit(0)
// immediately and preempted the proper gracefulShutdown below (db close, server.close).

// ============================================
// CRASH PREVENTION & RELIABILITY
// ============================================

// Improved uncaught exception handler - don't crash immediately
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION - Critical Error:', error);
  console.error('Stack:', error.stack);

  // Log to database
  logErrorHandler(error, null, {
    type: 'uncaughtException',
    fatal: true
  });

  // Give time for error to be logged, then exit
  // In production, Azure will restart the app
  setTimeout(() => {
    console.error('💥 Process exiting due to uncaught exception');
    process.exit(1);
  }, 5000);
});

// Improved unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);

  // Log to database
  if (reason instanceof Error) {
    logErrorHandler(reason, null, {
      type: 'unhandledRejection',
      fatal: false
    });
  } else {
    console.error('Rejection reason (non-Error):', reason);
  }

  // Don't exit on unhandled rejection - log and continue
  // This prevents crashes from async operations
});

// Memory monitoring and leak prevention
if (process.env.NODE_ENV === 'production') {
  const { checkMemoryUsage } = require('./middleware/error-handler');

  // Check memory every 5 minutes
  setInterval(() => {
    const mem = checkMemoryUsage();
    if (mem.heapUsedMB > 800) {
      console.warn('🚨 HIGH MEMORY USAGE - Consider restart:', mem);
    }
  }, 5 * 60 * 1000);

  // Force GC if available (run with --expose-gc flag)
  if (global.gc) {
    setInterval(() => {
      const mem = process.memoryUsage();
      if (mem.heapUsed > 400 * 1024 * 1024) { // 400MB
        console.log('🧹 Running garbage collection...');
        global.gc();
      }
    }, 10 * 60 * 1000); // Every 10 minutes
  }
}

// Graceful shutdown with cleanup
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('⚠️  Already shutting down, forcing exit...');
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal} - Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('✅ HTTP server closed');

    // Close database connections
    try {
      if (db && db.db) {
        db.db.close();
        console.log('✅ Database connections closed');
      }
    } catch (err) {
      console.error('⚠️  Error closing database:', err.message);
    }

    // Close WebSocket server
    try {
      if (wss) {
        wss.close();
        console.log('✅ WebSocket server closed');
      }
    } catch (err) {
      console.error('⚠️  Error closing WebSocket:', err.message);
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⚠️  Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));