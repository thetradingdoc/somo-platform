// server.js - FIXED WITH PAYMENT ORCHESTRATOR AND PROPER DATABASE
//
// POLICY: No new inline route handlers — add routes/*.js and mount via routes/index.js.
// POLICY: No new health/commerce logic here — use services/ and bootstrap/.
// Load environment variables from .env if dotenv is available.
// In Azure, env vars are provided by App Settings, so dotenv may not be installed.
try {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isProduction = nodeEnv === 'production' || nodeEnv === 'prod';
  // In local/dev test runs, prefer .env values over inherited shell exports.
  const dotenvPath = process.env.AUDIT_MIDDLEWARE === '1' ? '.env.audit' : undefined;
  require('dotenv').config({ path: dotenvPath, override: !isProduction });
} catch (e) {
  console.warn('⚠️  dotenv not found - skipping .env loading (Azure App Settings will be used instead)');
}

// Local dev default: health MVP at http://localhost:4000/ (set LOCAL_DEV_ROOT=login in .env for provider portal)
{
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isProductionEnv = nodeEnv === 'production' || nodeEnv === 'prod';
  if (!isProductionEnv && !String(process.env.LOCAL_DEV_ROOT || '').trim()) {
    process.env.LOCAL_DEV_ROOT = 'health';
  }
}

const bootDebug = ['1', 'true', 'yes'].includes(String(process.env.CLOUDRUN_BOOT_DEBUG || '').toLowerCase());
function bootLog(msg) {
  if (!bootDebug) return;
  try {
    console.error(`[boot] ${new Date().toISOString()} ${msg}`);
  } catch (_) {}
}
bootLog(`server.js loaded pid=${process.pid} node=${process.version}`);

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
      '⚠️  PRODUCTION: REQUIRE_TRIAGE_FOR_VOICE is not enabled. Voice /voice/... routes may skip DB triage when session_id/call_id is omitted. Set REQUIRE_TRIAGE_FOR_VOICE=1 (see docs/middleware-platform/README.md#voice-triage-parity).'
    );
  }
}

// LangSmith: route traces to Somo middleware project (LANGCHAIN_PROJECT)
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
const { spawn } = require('child_process');
const {
  getHostname,
  isSomoMarketingHostname,
  isLocalDevRootHost,
} = require('./lib/static-hosting-paths');
const { registerEarlySomoLandingStatic } = require('./bootstrap/static-hosting');
const { registerHealthUi } = require('./bootstrap/health-ui');
const { mountHealthSpine, mountCommerceLegacy } = require('./routes/index');
const { isCommerceLegacyEnabled } = require('./lib/commerce-legacy-flag');
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
const fhirIds = require('./lib/fhir-brand-identifiers');
const { fieldsFromSqlAggRow } = require('./lib/billing-calendar-agg');
const { fetchBillingAggregatesByDay } = require('./lib/patient-calendar-billing-query');
const { ensureRoutineTables } = require('./lib/patient-routine-db');
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
const { resolvePayerSearchResult } = require('./services/payor-resolution-utils');
const PayorRegistryResolverService = require('./services/payor-registry-resolver-service');
const { resolveProviderPayorNetworkPrecheck } = require('./services/provider-network-precheck-service');
const { listProviderSearchResults } = require('./services/provider-search-service');
const Metrics = require('./services/metrics');
const { adaptIncomingEvent } = require('./services/channel-adapter');
const ProviderService = require('./services/provider-service');
const PatientPortalService = require('./services/patient-portal-service');
const PatientIntakeService = require('./services/patient-intake-service');
const IngredientEnrichmentService = require('./services/ingredient-enrichment-service');
const {
  upsertCustomerProductScan
} = require('./services/landing-session-claim-service');
const EHRAggregatorService = require('./services/ehr-aggregator-service');
const EHRSyncService = require('./services/ehr-sync-service');
const EpicAdapter = require('./services/epic-adapter');
const RetellService = require('./services/retell-service');
const { twilioSignatureRequired, replayGuard } = require('./middleware/webhook-security');
const {
  evaluateAndRecord,
  enqueueFraudReview,
  listFraudReviews,
  assignFraudReview,
  resolveFraudReview,
  listOverdueFraudReviews,
  markFraudReviewAlerted
} = require('./services/anti-sybil-service');
const livekitTokenRoutes = require('./routes/livekit');
const authTokenRoutes = require('./routes/auth-tokens');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/jwt-fhir-auth');

function isUnifiedChannelAdapterEnabled() {
  const v = String(process.env.UNIFIED_CHANNEL_ADAPTER_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isUnifiedChannelAdapterShadowEnabled() {
  const v = String(process.env.UNIFIED_CHANNEL_ADAPTER_SHADOW_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isPayorCanonicalResolverEnabled() {
  const v = String(process.env.PAYOR_CANONICAL_RESOLVER_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isPayorCanonicalResolverShadowEnabled() {
  const v = String(process.env.PAYOR_CANONICAL_RESOLVER_SHADOW || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function resolveRuntimePayor(args = {}) {
  return PayorRegistryResolverService.resolvePayor({
    payerText: args.payer_name || args.payerName || null,
    payerId: args.payer_id || args.payerId || null,
    npi: args.npi || args.payer_npi || null,
    ein: args.ein || args.payer_ein || null,
    stateHint: args.state || args.state_hint || null
  });
}

function isProviderNetworkPrecheckEnabled() {
  const v = String(process.env.PROVIDER_NETWORK_PRECHECK_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isProviderNetworkPrecheckShadowEnabled() {
  const v = String(process.env.PROVIDER_NETWORK_PRECHECK_SHADOW || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

function isTruthyFlag(value, defaultValue = false) {
  if (value == null || String(value).trim() === '') return Boolean(defaultValue);
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function buildCatalogMasterKpi(inMemory = {}, catalogStats = {}) {
  const obfHit = Number(inMemory['obf.index_cache.hit.count'] || 0);
  const offHit = Number(inMemory['off.index_cache.hit.count'] || 0);
  const obfMiss = Number(inMemory['obf.index_cache.miss.count'] || 0);
  const offMiss = Number(inMemory['off.index_cache.miss.count'] || 0);
  const obfFallback = Number(inMemory['obf.index_cache.fallback_to_live.count'] || 0);
  const offFallback = Number(inMemory['off.index_cache.fallback_to_live.count'] || 0);
  const scanRequests = obfHit + offHit + obfMiss + offMiss;
  const servedFromMaster = obfHit + offHit;
  const fallbackLive = obfFallback + offFallback;
  const servedFromMasterRate = scanRequests > 0 ? Number((servedFromMaster / scanRequests).toFixed(4)) : 1;
  const fallbackRate = scanRequests > 0 ? Number((fallbackLive / scanRequests).toFixed(4)) : 0;
  const minRate = Number(process.env.CATALOG_MASTER_MIN_RATE || 0.85);
  const status = servedFromMasterRate >= minRate ? 'ok' : 'warning';
  return {
    status,
    min_master_served_rate: minRate,
    scan_requests: scanRequests,
    served_from_master: servedFromMaster,
    served_from_master_rate: servedFromMasterRate,
    fallback_to_live: fallbackLive,
    fallback_rate: fallbackRate,
    catalog_size: Number(catalogStats?.total_count || 0),
    obf_catalog_size: Number(catalogStats?.obf_count || 0),
    off_catalog_size: Number(catalogStats?.off_count || 0),
    latest_obf_ingestion_run: catalogStats?.latest_obf_ingestion_run || null,
    latest_obf_delta_applied: catalogStats?.latest_obf_delta_applied || null
  };
}

function antiSybilGuard(scope, identityBuilder, amountBuilder = null) {
  return (req, res, next) => {
    try {
      const result = evaluateAndRecord({
        scope,
        identityKey: identityBuilder ? identityBuilder(req) : '',
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        userAgent: req.headers['user-agent'] || '',
        amountCents: amountBuilder ? Number(amountBuilder(req) || 0) : 0
      });
      if (result.decision === 'block') {
        let review = null;
        try {
          review = enqueueFraudReview({
            antiSybilEventId: result.eventId,
            scope,
            priority: result.score >= 85 ? 'critical' : 'high',
            slaMinutes: result.score >= 85 ? 30 : 120
          });
        } catch (_) {}
        return res.status(429).json({
          success: false,
          error: 'Request blocked for risk review',
          error_code: 'ANTI_SYBIL_BLOCKED',
          risk_score: result.score,
          fraud_review_id: review?.id || null
        });
      }
    } catch (_) {}
    return next();
  };
}

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
bootLog(`express initialized; PORT=${PORT}`);

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
// Patient portal authz helpers (mvp-27) — see middleware/patient-session.js
// ============================================
const {
  requirePatientSession,
  resolvePatientIdFromSession,
  recordPatientPortalEvent,
  issueCsrfCookie,
  requireCsrfForCookieAuth,
  rotatePatientSessionIfNeeded,
} = require('./middleware/patient-session');

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
    documentation: 'docs/architecture/README.md#commerce-agentic-checkout-file-map (booking/checkout ownership)',
    runbook: 'docs/middleware-platform/README.md#voice-triage-parity',
    hint: 'Set LEGACY_APPOINTMENTS_API_DISABLED=0 only for a short migration window.'
  });
  return true;
}

// Patient: Support config (mvp-60)


// Patient: "me" bootstrap (mvp-fhir-13)
// Minimal safe identity for the patient UI; FHIR-first pages should use this instead of calling /fhir/* directly.


// ============================================
// Patient intake (web + voice canonical schema)
// ============================================





// Patient identity bundle for record-matching (no PHI beyond demographics)


// Customer catalog search routes registered after apiLimiter import (see below).

app.post('/api/customer/onboarding/step3', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const products = Array.isArray(body.products) ? body.products : [];
    const skipStep3 = !!body.skip_step3;
    if (!skipStep3 && products.length === 0) {
      return res.status(400).json({ success: false, error_code: 'PRODUCTS_REQUIRED', message: 'Add at least one product or skip step 3.' });
    }

    db.db.exec(`
      CREATE TABLE IF NOT EXISTS patient_onboarding_step3_products (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        patient_id TEXT,
        selection_mode TEXT NOT NULL,
        catalog_product_id TEXT,
        custom_product_name TEXT,
        custom_brand TEXT,
        custom_pending_enrichment INTEGER DEFAULT 0,
        fallback_reason TEXT,
        category TEXT NOT NULL,
        usage_time TEXT NOT NULL,
        frequency_rule TEXT,
        days_of_week_json TEXT,
        goal TEXT NOT NULL,
        flags_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_step3_products_session ON patient_onboarding_step3_products(session_id);
      CREATE TABLE IF NOT EXISTS patient_onboarding_step3_state (
        session_id TEXT PRIMARY KEY,
        patient_id TEXT,
        onboarding_version TEXT,
        step3_completed INTEGER DEFAULT 0,
        reason TEXT,
        products_saved INTEGER DEFAULT 0,
        custom_pending_enrichment INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS patient_onboarding_enrichment_queue (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        patient_id TEXT,
        custom_product_name TEXT NOT NULL,
        custom_brand TEXT,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const sessionId = req.patientSessionId;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    db.db.prepare(`DELETE FROM patient_onboarding_step3_products WHERE session_id = ?`).run(sessionId);

    const runInsert = db.db.prepare(`
      INSERT INTO patient_onboarding_step3_products (
        id, session_id, patient_id, selection_mode, catalog_product_id, custom_product_name, custom_brand,
        custom_pending_enrichment, fallback_reason, category, usage_time, frequency_rule, days_of_week_json, goal, flags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const queueInsert = db.db.prepare(`
      INSERT INTO patient_onboarding_enrichment_queue (
        id, session_id, patient_id, custom_product_name, custom_brand, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `);

    let customPending = 0;
    const now = Date.now();
    const seenDedup = new Set();
    products.forEach((p, idx) => {
      const selectionMode = String(p.selection_mode || '').trim();
      const category = String(p.category || '').trim();
      const usageTime = String(p.usage_time || '').trim();
      const goal = String(p.goal || '').trim();
      if (!category || !usageTime || !goal) throw new Error(`Product ${idx + 1} missing required fields (category/usage_time/goal).`);
      if (selectionMode !== 'catalog' && selectionMode !== 'custom') throw new Error(`Product ${idx + 1} has invalid selection_mode.`);

      const flags = p.flags && typeof p.flags === 'object' ? p.flags : {};
      const days = Array.isArray(p.days_of_week) ? p.days_of_week : [];
      const frequencyRule = p.frequency_rule ? String(p.frequency_rule) : null;

      let catalogProductId = null;
      let customName = null;
      let customBrand = null;
      let customPendingEnrichment = 0;
      let fallbackReason = null;

      if (selectionMode === 'catalog') {
        catalogProductId = String(p.catalog_product_id || '').trim();
        if (!catalogProductId) throw new Error(`Product ${idx + 1} requires catalog_product_id for catalog mode.`);
      } else {
        customName = String(p.custom_product?.name || '').trim();
        customBrand = String(p.custom_product?.brand || '').trim() || null;
        if (!customName) throw new Error(`Product ${idx + 1} requires custom product name for custom mode.`);
        customPendingEnrichment = 1;
        customPending += 1;
        fallbackReason = String(p.fallback_reason || 'user_override');
      }

      const dedupKey = `${selectionMode}|${catalogProductId || customName}|${usageTime}|${goal}`;
      if (seenDedup.has(dedupKey)) return;
      seenDedup.add(dedupKey);

      const id = `step3prod_${now}_${idx}_${Math.random().toString(36).slice(2, 8)}`;
      runInsert.run(
        id,
        sessionId,
        patientId || null,
        selectionMode,
        catalogProductId,
        customName,
        customBrand,
        customPendingEnrichment,
        fallbackReason,
        category,
        usageTime,
        frequencyRule,
        JSON.stringify(days),
        goal,
        JSON.stringify(flags)
      );

      if (customPendingEnrichment) {
        getCustomerCatalogSearchMetrics().custom_fallback += 1;
        queueInsert.run(
          `enrich_${id}`,
          sessionId,
          patientId || null,
          customName,
          customBrand,
          JSON.stringify({ fallback_reason: fallbackReason })
        );
      } else {
        getCustomerCatalogSearchMetrics().catalog_selected += 1;
      }
    });

    db.db.prepare(`
      INSERT INTO patient_onboarding_step3_state (
        session_id, patient_id, onboarding_version, step3_completed, reason, products_saved, custom_pending_enrichment, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        patient_id = excluded.patient_id,
        onboarding_version = excluded.onboarding_version,
        step3_completed = excluded.step3_completed,
        reason = excluded.reason,
        products_saved = excluded.products_saved,
        custom_pending_enrichment = excluded.custom_pending_enrichment,
        updated_at = datetime('now')
    `).run(
      sessionId,
      patientId || null,
      String(body.onboarding_version || 'journal_v1'),
      1,
      skipStep3 ? 'explicit_skip' : 'products_added',
      skipStep3 ? 0 : seenDedup.size,
      customPending
    );

    // Fire-and-forget enrichment and merge pass for custom products.
    setTimeout(() => {
      tryEnrichCustomStep3Products(sessionId, db);
    }, 0);

    return res.json({
      success: true,
      step3: {
        completed: true,
        reason: skipStep3 ? 'explicit_skip' : 'products_added',
        products_saved: skipStep3 ? 0 : seenDedup.size,
        custom_pending_enrichment: customPending
      },
      next_route: '/patients/patient-dashboard.html'
    });
  } catch (e) {
    return res.status(400).json({ success: false, error_code: 'VALIDATION_ERROR', message: e.message });
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



function getPatientStep3Status({ sessionId = null, patientId = null } = {}) {
  try {
    const tableRow = db.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='patient_onboarding_step3_state'
      LIMIT 1
    `).get();
    if (!tableRow) return { completed: false, reason: null };

    let row = null;
    if (patientId) {
      row = db.db.prepare(`
        SELECT step3_completed, reason, updated_at
        FROM patient_onboarding_step3_state
        WHERE patient_id = ?
        ORDER BY datetime(updated_at) DESC
        LIMIT 1
      `).get(patientId);
    }
    if (!row && sessionId) {
      row = db.db.prepare(`
        SELECT step3_completed, reason, updated_at
        FROM patient_onboarding_step3_state
        WHERE session_id = ?
        LIMIT 1
      `).get(sessionId);
    }
    if (!row) return { completed: false, reason: null };
    const completed = Number(row.step3_completed) === 1;
    const reason = (row.reason || '').toString().trim() || null;
    const explicitSkip = reason === 'explicit_skip';
    return { completed: completed || explicitSkip, reason };
  } catch (_) {
    return { completed: false, reason: null };
  }
}

function ensureBillingTables() {
  db.ensureBillingTables();
}

function ensureProductsPhase2Tables() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS patient_product_lists (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      list_type TEXT NOT NULL,
      list_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_type, owner_id, list_type, list_name)
    );
    CREATE INDEX IF NOT EXISTS idx_patient_product_lists_owner
      ON patient_product_lists(owner_type, owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS patient_product_list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      product_ref TEXT NOT NULL,
      note TEXT,
      concern_tags_json TEXT,
      source_scan_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(list_id, product_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_patient_product_list_items_list
      ON patient_product_list_items(list_id, updated_at DESC);
  `);
}

function ensurePatientPortalEventsTable() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS patient_portal_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      event_name TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_portal_events_session ON patient_portal_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_portal_events_name ON patient_portal_events(event_name);
  `);
}

function parseBooleanFlag(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isPatientWalletEnabled() {
  return parseBooleanFlag(process.env.FEATURE_PATIENT_WALLET_ENABLED, false);
}

function isPatientChatEnabled() {
  return parseBooleanFlag(process.env.FEATURE_PATIENT_CHAT_ENABLED, false);
}

function blockWalletWhenDisabled(req, res, next) {
  if (isPatientWalletEnabled()) return next();
  recordPatientPortalEvent(req, 'wallet_access_blocked', {
    path: req.path || null,
    method: req.method || null
  });
  return res.status(503).json({
    success: false,
    error: 'Wallet is temporarily disabled'
  });
}

function blockChatWhenDisabled(req, res, next) {
  if (isPatientChatEnabled()) return next();
  recordPatientPortalEvent(req, 'chat_access_blocked', {
    path: req.path || null,
    method: req.method || null
  });
  return res.status(503).json({
    success: false,
    error: 'Chat is temporarily disabled'
  });
}

function safeParseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function isIsoDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function localDateFromIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoFromLocalDate(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekdayKeyForIsoLocal(iso) {
  const d = localDateFromIso(iso);
  if (!d) return 'mon';
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
}

function enumerateIsoDates(startIso, endIso) {
  const out = [];
  const start = localDateFromIso(startIso);
  const end = localDateFromIso(endIso);
  if (!start || !end || start > end) return out;
  const cur = new Date(start.getTime());
  while (cur <= end) {
    out.push(isoFromLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function issuePatientDocumentDownloadUrl(req, patientId, docId) {
  try {
    if (!db.createPatientDocumentDownloadToken) return null;
    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
    const created = db.createPatientDocumentDownloadToken({
      token,
      doc_id: docId,
      patient_id: patientId,
      expires_at: expiresAtIso
    });
    if (!created || !created.success) return null;
    return `${req.protocol}://${req.get('host')}/api/patient/documents/download/${token}`;
  } catch (_) {
    return null;
  }
}

function ensurePatientShelfInventoryColumns() {
  const addCol = (sql) => {
    try {
      db.db.prepare(sql).run();
    } catch (_) {}
  };
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN opened_date TEXT');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN expiry_date TEXT');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN pao_months INTEGER');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN inventory_status TEXT DEFAULT \'stock\'');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN price_usd REAL');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN key_ingredients TEXT');
  addCol('ALTER TABLE patient_onboarding_step3_products ADD COLUMN display_color TEXT');
}

function computeProductInitials(productName) {
  const s = String(productName || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0][0] || '?').toUpperCase();
  const b = parts.length > 1 ? (parts[1][0] || '').toUpperCase() : String(parts[0][1] || '').toUpperCase();
  const out = (a + b).replace(/[^A-Z0-9]/g, '');
  return out.slice(0, 2) || 'P';
}

function computeShelfBadgeColor(seed) {
  const s = String(seed || 'x');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 48%, 40%)`;
}

function formatShelfProductApiRow(r) {
  const product_name = r.selection_mode === 'catalog'
    ? String(r.catalog_product_id || '').trim() || 'Catalog product'
    : String(r.custom_product_name || '').trim();
  const product_brand = r.custom_brand || null;
  const dc = r.display_color ? String(r.display_color).trim() : '';
  const colorOk = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(dc) || /^hsl\(/i.test(dc);
  const badge_color = colorOk ? dc : computeShelfBadgeColor(String(r.id || '') + product_name);
  return {
    shelf_product_id: r.id,
    product_name,
    product_brand,
    category: r.category || null,
    usage_time: r.usage_time || null,
    frequency_rule: r.frequency_rule || null,
    days_of_week: safeParseJsonArray(r.days_of_week_json),
    goal: r.goal || null,
    opened_date: r.opened_date || null,
    expiry_date: r.expiry_date || null,
    pao_months: r.pao_months != null && r.pao_months !== '' ? Number(r.pao_months) : null,
    inventory_status: String(r.inventory_status || 'stock').toLowerCase(),
    price_usd: r.price_usd != null && r.price_usd !== '' ? Number(r.price_usd) : null,
    key_ingredients: r.key_ingredients || null,
    display_color: dc || null,
    badge_initials: computeProductInitials(product_name),
    badge_color
  };
}

function loadPatientShelfProductRows(sessionId) {
  return db.db.prepare(`
      SELECT id, selection_mode, catalog_product_id, custom_product_name, custom_brand, category, usage_time,
        frequency_rule, days_of_week_json, goal, opened_date, expiry_date, pao_months, inventory_status,
        price_usd, key_ingredients, display_color, updated_at
      FROM patient_onboarding_step3_products
      WHERE session_id = ?
      ORDER BY datetime(updated_at) DESC
    `).all(sessionId);
}


function parseJsonSafe(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '[]');
    return parsed != null ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function parseProductRef(productRef) {
  const raw = String(productRef || '').trim();
  const m = raw.match(/^(obf|off):(.+)$/i);
  if (!m) return null;
  return { catalog: m[1].toLowerCase(), code: String(m[2] || '').trim() };
}

function getIndexedProductByRef(productRef) {
  const ref = parseProductRef(productRef);
  if (!ref || !ref.code) return null;
  const row = ref.catalog === 'off'
    ? db.getOffIndexProductByCode(ref.code)
    : db.getObfIndexProductByCode(ref.code);
  if (!row) return null;
  return {
    id: `${ref.catalog}:${row.code}`,
    catalog: ref.catalog,
    barcode: row.code,
    product_name: row.product_name || null,
    brands: row.brands || null,
    image_url: row.image_url || null,
    ingredients_text: row.ingredients_text || null,
    ingredients_tags: Array.isArray(row.ingredients_tags) ? row.ingredients_tags : [],
    ingredients_analysis_tags: Array.isArray(row.ingredients_analysis_tags) ? row.ingredients_analysis_tags : [],
    categories_tags: Array.isArray(row.categories_tags) ? row.categories_tags : [],
    categories_hierarchy: Array.isArray(row.categories_hierarchy) ? row.categories_hierarchy : []
  };
}

function mergePatientProductListsIfNeeded(patientId, sessionId) {
  if (!patientId || !sessionId) return;
  ensureProductsPhase2Tables();
  const sessionLists = db.db.prepare(`
    SELECT id, list_type, list_name
    FROM patient_product_lists
    WHERE owner_type = 'session' AND owner_id = ?
  `).all(sessionId);
  const findPatientList = db.db.prepare(`
    SELECT id FROM patient_product_lists
    WHERE owner_type = 'patient' AND owner_id = ? AND list_type = ? AND list_name = ?
    LIMIT 1
  `);
  const insertPatientList = db.db.prepare(`
    INSERT INTO patient_product_lists (id, owner_type, owner_id, list_type, list_name, created_at, updated_at)
    VALUES (?, 'patient', ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const listItems = db.db.prepare(`
    SELECT product_ref, note, concern_tags_json, source_scan_id
    FROM patient_product_list_items
    WHERE list_id = ?
  `);
  const upsertItem = db.db.prepare(`
    INSERT INTO patient_product_list_items (
      id, list_id, product_ref, note, concern_tags_json, source_scan_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(list_id, product_ref) DO UPDATE SET
      note = COALESCE(excluded.note, patient_product_list_items.note),
      concern_tags_json = COALESCE(excluded.concern_tags_json, patient_product_list_items.concern_tags_json),
      source_scan_id = COALESCE(excluded.source_scan_id, patient_product_list_items.source_scan_id),
      updated_at = datetime('now')
  `);
  const deleteSessionListItems = db.db.prepare(`DELETE FROM patient_product_list_items WHERE list_id = ?`);
  const deleteSessionList = db.db.prepare(`DELETE FROM patient_product_lists WHERE id = ?`);

  const tx = db.db.transaction(() => {
    for (const sList of sessionLists) {
      let patientList = findPatientList.get(patientId, sList.list_type, sList.list_name);
      if (!patientList) {
        const createdId = `ppl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        insertPatientList.run(createdId, patientId, sList.list_type, sList.list_name);
        patientList = { id: createdId };
      }
      const items = listItems.all(sList.id);
      for (const it of items) {
        upsertItem.run(
          `ppli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          patientList.id,
          it.product_ref,
          it.note || null,
          it.concern_tags_json || null,
          it.source_scan_id || null
        );
      }
      deleteSessionListItems.run(sList.id);
      deleteSessionList.run(sList.id);
    }
  });
  tx();
}

function listCatalogFromIndex({ q, catalog, limit, offset }) {
  const lim = Math.max(1, Math.min(50, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  const query = String(q || '').trim().toLowerCase();
  const withQ = query ? `WHERE lower(COALESCE(product_name,'')) LIKE ? OR lower(COALESCE(brands,'')) LIKE ?` : '';
  const params = query ? [`%${query}%`, `%${query}%`, lim, off] : [lim, off];
  const sqlObf = `
    SELECT 'obf' AS catalog, code, product_name, brands, image_url, ingredients_text,
           categories_tags_json, ingredients_tags_json, ingredients_analysis_tags_json, updated_at,
           CASE WHEN trim(COALESCE(ingredients_text,'')) <> '' THEN 1 ELSE 0 END AS has_ingredient_text
    FROM products_obf_index
    ${withQ}
    ORDER BY has_ingredient_text DESC, datetime(updated_at) DESC
    LIMIT ? OFFSET ?
  `;
  const sqlOff = `
    SELECT 'off' AS catalog, code, product_name, brands, image_url, ingredients_text,
           categories_tags_json, ingredients_tags_json, ingredients_analysis_tags_json, updated_at,
           CASE WHEN trim(COALESCE(ingredients_text,'')) <> '' THEN 1 ELSE 0 END AS has_ingredient_text
    FROM products_off_index
    ${withQ}
    ORDER BY has_ingredient_text DESC, datetime(updated_at) DESC
    LIMIT ? OFFSET ?
  `;
  let rows = [];
  try {
    if (catalog === 'obf') rows = db.db.prepare(sqlObf).all(...params);
    else if (catalog === 'off') rows = db.db.prepare(sqlOff).all(...params);
    else {
      rows = [
        ...db.db.prepare(sqlObf).all(...params),
        ...db.db.prepare(sqlOff).all(...params)
      ].sort((a, b) => {
        const ia = Number(a?.has_ingredient_text || 0);
        const ib = Number(b?.has_ingredient_text || 0);
        if (ib !== ia) return ib - ia;
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
      }).slice(0, lim);
    }
  } catch (_) {
    rows = [];
  }
  return rows.map((r) => ({
    id: `${r.catalog}:${r.code}`,
    catalog: r.catalog,
    barcode: r.code,
    product_name: r.product_name || null,
    brands: r.brands || null,
    image_url: r.image_url || null,
    ingredients_text: r.ingredients_text || null,
    has_ingredient_data: Number(r.has_ingredient_text || 0) === 1,
    categories_tags: parseJsonSafe(r.categories_tags_json, []),
    ingredients_tags: parseJsonSafe(r.ingredients_tags_json, []),
    ingredients_analysis_tags: parseJsonSafe(r.ingredients_analysis_tags_json, [])
  }));
}





// Billing-first scaffolding and entitlement-aware patient billing APIs.
function billingOk(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function billingErr(res, status, errorCode, message, extra = {}) {
  return res.status(status).json({ success: false, error_code: errorCode, error: message, ...extra });
}

function normalizeBillingMetadata(value) {
  try {
    return JSON.stringify(value && typeof value === 'object' ? value : {});
  } catch (_) {
    return '{}';
  }
}

function parseBillingMetadata(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(decryptBillingField(String(value)));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getBillingCipherKey() {
  const raw = String(process.env.BILLING_DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-billing-key');
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptBillingField(value) {
  if (value == null) return null;
  const plain = String(value);
  if (!plain) return plain;
  if (plain.startsWith('enc:v1:')) return plain;
  try {
    const iv = crypto.randomBytes(12);
    const key = getBillingCipherKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  } catch (_) {
    return plain;
  }
}

function decryptBillingField(value) {
  if (value == null) return value;
  const raw = String(value);
  if (!raw.startsWith('enc:v1:')) return raw;
  try {
    const [, , ivB64, tagB64, dataB64] = raw.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const key = getBillingCipherKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return plain;
  } catch (_) {
    return raw;
  }
}

function resolveBillingPricingPolicy() {
  const { resolveCareProgramPricing } = require('./services/care-program-billing-service');
  return {
    currency: 'USD',
    free: { monthly_scan_limit: Math.max(1, Number(process.env.BILLING_FREE_SCAN_LIMIT || 15)) },
    plus: {
      monthly_price_cents: 999,
      annual_price_cents: 9999,
      trial_days: 14,
      unlimited_scans: true
    },
    care_program: resolveCareProgramPricing()
  };
}

function normalizeExtractedDocumentFields(doc = {}) {
  const sourceName = String(doc.file_name || '').trim();
  const providerName = sourceName ? sourceName.replace(/\.[a-z0-9]+$/i, '').slice(0, 160) : null;
  const documentType = String(doc.mime_type || '').toLowerCase().includes('pdf') ? 'eob' : 'receipt';
  return {
    provider_name: providerName,
    service_date: null,
    amount_cents: null,
    document_type: documentType,
    confidence_score: 0.18,
    status: 'needs_review'
  };
}

const ALLOWED_SYNCED_BILLING_STATUS = new Set(['needs_review', 'tracked', 'due', 'paid', 'disputed', 'pending']);

function applyDocumentExtractionToLinkedEvents(documentId, extraction) {
  if (!documentId || !extraction || typeof extraction !== 'object') return 0;
  const links = db.db
    .prepare(
      `
    SELECT billing_event_id FROM patient_billing_event_documents
    WHERE billing_document_id = ?
  `
    )
    .all(String(documentId));
  let updated = 0;
  for (const row of links) {
    const eventId = row.billing_event_id;
    const patches = [];
    const vals = [];
    if (extraction.provider_name != null && String(extraction.provider_name).trim()) {
      const p = String(extraction.provider_name).trim().slice(0, 200);
      patches.push('provider_name = ?');
      vals.push(p);
      patches.push('title = ?');
      vals.push(p);
    }
    if (extraction.service_date != null && isIsoDateOnly(String(extraction.service_date).trim())) {
      patches.push('service_date = ?');
      vals.push(String(extraction.service_date).trim().slice(0, 10));
    }
    if (extraction.amount_cents != null && Number.isFinite(Number(extraction.amount_cents))) {
      patches.push('amount_cents = ?');
      vals.push(Math.round(Number(extraction.amount_cents)));
    }
    if (extraction.status != null) {
      const st = String(extraction.status).trim().toLowerCase();
      if (ALLOWED_SYNCED_BILLING_STATUS.has(st)) {
        patches.push('status = ?');
        vals.push(st);
      }
    }
    if (extraction.confidence_score != null && Number.isFinite(Number(extraction.confidence_score))) {
      patches.push('confidence_score = ?');
      vals.push(Math.max(0, Math.min(1, Number(extraction.confidence_score))));
    }
    if (patches.length) {
      vals.push(eventId);
      db.db
        .prepare(`UPDATE patient_billing_events SET ${patches.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...vals);
      updated += 1;
    }
  }
  return updated;
}

function maybeLinkBillingEventToEpisode({ eventId, sessionId, patientId, providerName, serviceDate }) {
  const providerKey = String(providerName || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
  const monthKey = String(serviceDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const episodeKey = `${providerKey}:${monthKey}`;
  const title = `${String(providerName || 'Provider').slice(0, 80)} episode`;
  let episode = db.db.prepare(`
    SELECT id
    FROM patient_billing_care_episodes
    WHERE session_id = ? AND episode_key = ?
    LIMIT 1
  `).get(sessionId, episodeKey);
  if (!episode) {
    const episodeId = `bep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_billing_care_episodes (
        id, session_id, patient_id, episode_key, title, status, start_date, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, '{}', datetime('now'), datetime('now'))
    `).run(episodeId, sessionId, patientId || null, episodeKey, title, String(serviceDate || '').slice(0, 10) || null);
    episode = { id: episodeId };
  }
  db.db.prepare(`
    INSERT OR IGNORE INTO patient_billing_episode_events (id, episode_id, billing_event_id, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(`bee_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, episode.id, eventId);
  return episode.id;
}

function resolveBillingSubscription(req) {
  ensureBillingTables();
  const sessionId = req.patientSessionId;
  const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
  const whereSql = patientId
    ? `WHERE status = 'active' AND (patient_id = ? OR session_id = ?)`
    : `WHERE status = 'active' AND session_id = ?`;
  const params = patientId ? [patientId, sessionId] : [sessionId];
  const row = db.db.prepare(`
    SELECT tier, status, current_period_start, current_period_end, metadata_json, updated_at
    FROM patient_billing_subscriptions
    ${whereSql}
    ORDER BY datetime(updated_at) DESC
    LIMIT 1
  `).get(...params);
  const tierRaw = String(row?.tier || 'free').toLowerCase();
  const tier = tierRaw === 'plus' ? 'plus' : tierRaw === 'care_program' ? 'care_program' : 'free';
  return { tier, status: row?.status || 'active', patientId, sessionId };
}

function requireCareProgramSubscription(req, res, next) {
  const sub = resolveBillingSubscription(req);
  if (sub.tier === 'care_program' && String(sub.status || 'active') === 'active') {
    req.billingSubscription = sub;
    return next();
  }
  return res.status(402).json({
    success: false,
    error_code: 'ENTITLEMENT_CARE_PROGRAM_REQUIRED',
    error: 'Care program subscription required to start your regimen.',
    upgrade_required: true,
    tier: sub.tier
  });
}

function requirePlusForBillingFeature(featureName) {
  return (req, res, next) => {
    const sub = resolveBillingSubscription(req);
    if (sub.tier === 'plus') {
      req.billingSubscription = sub;
      return next();
    }
    return billingErr(res, 402, 'ENTITLEMENT_PLUS_REQUIRED', `${featureName} requires Plus subscription.`, {
      tier: sub.tier,
      upgrade_required: true
    });
  };
}

function validateBillingDocumentPayload(body = {}) {
  const sourceTypeRaw = String(body.source_type || body.source || 'upload').trim().toLowerCase();
  const sourceType = ['scan', 'upload', 'manual'].includes(sourceTypeRaw) ? sourceTypeRaw : 'upload';
  const fileName = String(body.file_name || '').trim();
  const mimeType = String(body.mime_type || '').trim() || null;
  const storageRef = String(body.storage_ref || body.local_uri || '').trim() || null;
  const parseStatusRaw = String(body.parse_status || 'queued').trim().toLowerCase();
  const parseStatus = ['queued', 'processing', 'ready', 'failed', 'needs_review'].includes(parseStatusRaw) ? parseStatusRaw : 'queued';
  const confidenceScoreRaw = body.confidence_score == null ? null : Number(body.confidence_score);
  const confidenceScore = Number.isFinite(confidenceScoreRaw) ? Math.max(0, Math.min(1, confidenceScoreRaw)) : null;
  const notes = body.notes == null ? null : String(body.notes).slice(0, 1000);
  const errors = [];
  if (!fileName && !storageRef) errors.push('file_name or storage_ref is required');
  return { valid: errors.length === 0, errors, normalized: { sourceType, fileName: fileName || null, mimeType, storageRef, parseStatus, confidenceScore, notes } };
}

function parseBillingDocumentMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseBillingDocumentUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) return next();
  let multer;
  try {
    multer = require('multer');
  } catch (_) {
    return billingErr(res, 500, 'UPLOAD_BACKEND_UNAVAILABLE', 'File upload backend not configured.');
  }
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024, files: 1 },
    fileFilter: (_req2, file, cb) => {
      if (!allowed.has(String(file.mimetype || '').toLowerCase())) return cb(new Error('Unsupported file type'));
      return cb(null, true);
    }
  }).single('file');
  upload(req, res, (err) => {
    if (err) return billingErr(res, 400, 'UPLOAD_FAILED', err.message || 'Upload failed.');
    return next();
  });
}

function validateBillingEventPayload(body = {}) {
  const maxAmountCents = Math.max(100, Number(process.env.BILLING_MAX_AMOUNT_CENTS || 10000000));
  const eventTypeRaw = String(body.event_type || 'bill').trim().toLowerCase();
  const eventType = ['bill', 'payment', 'eob', 'reimbursement', 'visit'].includes(eventTypeRaw) ? eventTypeRaw : 'bill';
  const title = String(body.title || '').trim();
  const providerName = body.provider_name == null ? null : String(body.provider_name).trim().slice(0, 200);
  const serviceDateRaw = body.service_date == null ? '' : String(body.service_date).trim();
  const serviceDate = serviceDateRaw ? (isIsoDateOnly(serviceDateRaw) ? serviceDateRaw : null) : null;
  const statusRaw = String(body.status || 'needs_review').trim().toLowerCase();
  const status = ['needs_review', 'tracked', 'due', 'paid', 'disputed', 'pending'].includes(statusRaw) ? statusRaw : 'needs_review';
  const amountInput = body.amount_cents != null ? Number(body.amount_cents) : (body.amount != null ? Number(body.amount) * 100 : null);
  const amountCents = Number.isFinite(amountInput) ? Math.max(0, Math.round(amountInput)) : null;
  const currency = String(body.currency || 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
  const confidenceScoreRaw = body.confidence_score == null ? null : Number(body.confidence_score);
  const confidenceScore = Number.isFinite(confidenceScoreRaw) ? Math.max(0, Math.min(1, confidenceScoreRaw)) : null;
  const errors = [];
  if (!title) errors.push('title is required');
  if (serviceDateRaw && !serviceDate) errors.push('service_date must be YYYY-MM-DD');
  if (amountCents != null && amountCents > maxAmountCents) errors.push(`amount_cents exceeds limit ${maxAmountCents}`);
  return { valid: errors.length === 0, errors, normalized: { eventType, title, providerName, serviceDate, status, amountCents, currency, confidenceScore } };
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
    resource.extension.push({ url: fhirIds.extensionUrlCanonical('appointment-status'), valueString: appt.status || 'unknown' });
    if (appt.payment_status) resource.extension.push({ url: fhirIds.extensionUrlCanonical('payment-status'), valueString: appt.payment_status });

    if (!existing && db.createFHIREncounter) db.createFHIREncounter(resource);
    if (existing && db.updateFHIREncounter) db.updateFHIREncounter(encId, resource);
  } catch (_) {}
}

// Patient: Export documents metadata + signed download URLs (mvp-70)


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
  publicDiagnosticsLimiter,
  publicCommerceLimiter,
  authLimiter,
  paymentLimiter,
  voiceLimiter,
  scheduleCheckoutLimiter
} = require('./middleware/rate-limiter');

// OTP abuse protection (must be defined before patient portal route registration)
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

const {
  registerCustomerCatalogRoutes,
  tryEnrichCustomStep3Products,
  getCustomerCatalogSearchMetrics
} = require('./routes/customer-catalog');
registerCustomerCatalogRoutes(app, { apiLimiter, requirePatientSession, db });
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
  'https://callsomo.com',
  'https://www.callsomo.com',
  'https://api.callsomo.com',
  'http://localhost:4000',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5199',
  'http://localhost:8080',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5199',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
  'http://localhost:5180',
  'http://127.0.0.1:5180'
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

    if (/^https?:\/\/([a-z0-9-]+\.)*callsomo\.com$/i.test(origin)) {
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
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'x-session-id',
    'x-journey-id',
    'idempotency-key',
    'ngrok-skip-browser-warning'
  ],
  exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));
// Handle preflight for all routes
app.options('*', cors(corsOptions));

registerEarlySomoLandingStatic(app, { express, rootDir: __dirname });

const { correlationIdMiddleware } = require('./middleware/request-context');
app.use(correlationIdMiddleware);

// Cookie parser
app.use(cookieParser());

// Stripe webhook — MUST be before express.json() (raw body required for signature verification)
const { stripeWebhookRouter } = require('./routes/stripe-webhook-handler');
app.use('/webhooks/stripe', stripeWebhookRouter);
const { stediWebhookRouter } = require('./routes/stedi-webhooks');
app.use('/webhooks/stedi', stediWebhookRouter);

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
// Diagnostics endpoints get their own larger bucket to keep ops visibility available.
app.use('/api/public/plans/meta', publicDiagnosticsLimiter);
app.use('/api/public/geo/options', publicDiagnosticsLimiter);
app.use('/api/public/geo/health', publicDiagnosticsLimiter);

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

// Admin Portal - REMOVED: Admin portal should be on callsomo.com/admin, not api.callsomo.com/admin

// ============================================
// Domain-based Routing
// Serve frontend for callsomo.com, API for api.callsomo.com
// ============================================

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
  // e.g., "tenant.callsomo.com" -> "tenant"
  // e.g., "tenant.doclittle.azurewebsites.net" -> "tenant"
  if (parts.length >= 3) {
    // Check if it's a known domain
    const knownDomains = ['callsomo.com'];
    const domain = parts.slice(-2).join('.');

    if (knownDomains.includes(domain)) {
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

function redirectMarketingRoot(res) {
  return res.redirect(302, '/business/trial-activation.html');
}

function getHealthVideoSpaDir() {
  const candidates = [
    path.join(__dirname, '..', 'unified-dashboard', 'health-video-landing', 'dist'),
    path.join(__dirname, 'unified-dashboard', 'health-video-landing', 'dist')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function redirectHealthVideoEntry(res) {
  if (getHealthVideoSpaDir()) return res.redirect(302, '/health-video/');
  return res.redirect(302, '/health-video.html');
}

/** Legacy /index.html — health dev root or B2B trial (replaces undefined LittleLab handler). */
function trySendHealthOrB2BLanding(res) {
  if (process.env.LOCAL_DEV_ROOT === 'health') {
    redirectHealthVideoEntry(res);
    return true;
  }
  res.redirect(302, '/business/trial-activation.html');
  return true;
}

function redirectLegacyLandingPath(req, res) {
  if (process.env.LOCAL_DEV_ROOT === 'health') {
    return redirectHealthVideoEntry(res);
  }
  return res.redirect(302, '/business/trial-activation.html');
}

/** Production API hostnames (split-domain). */
function isProductionApiHostname(hostname) {
  return String(hostname || '').toLowerCase() === 'api.callsomo.com';
}

// Root endpoint - route based on domain
app.get('/', (req, res) => {
  const hostname = getHostname(req);
  const subdomain = getSubdomain(hostname);

  // Tenant subdomain routing (e.g., tenant.callsomo.com)
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

  // Local / dev — Somo landing on :4000 (override with LOCAL_DEV_ROOT=login|stub|signup)
  if (isLocalDevRootHost(hostname)) {
    if (process.env.LOCAL_DEV_ROOT === 'login') {
      return res.redirect(302, '/login');
    }
    if (process.env.LOCAL_DEV_ROOT === 'signup') {
      return res.redirect(302, '/signup');
    }
    if (process.env.LOCAL_DEV_ROOT === 'stub') {
      return res.type('text/html').send(
        '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">' +
        '<p>Middleware API is running.</p>' +
        '<p><a href="/">Somo landing</a></p>' +
        '</body></html>'
      );
    }
    if (process.env.LOCAL_DEV_ROOT === 'health') {
      return redirectHealthVideoEntry(res);
    }
    return redirectMarketingRoot(res);
  }

  if (isSomoMarketingHostname(hostname)) {
    return redirectMarketingRoot(res);
  }

  // API subdomain - check if user is already logged in
  if (isProductionApiHostname(hostname)) {
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
            return res.redirect('/terms?customer_type=api&redirect=/docs');
          }
        }
      }
    }
    // No valid session or not fully authenticated - show signup page
    return res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
  }

  // Default fallback - tenant subdomains without merchant → login
  if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
    console.log(`[ROOT ROUTE] Tenant subdomain "${subdomain}" but merchant not found - redirecting to login`);
    return res.redirect('/login');
  }

  // Never leave GET / unanswered (avoids hung sockets and accidental catch-all 404 for edge Host values)
  redirectMarketingRoot(res);
});

// Legacy LittleLab marketing paths → health entry or B2B trial
const LEGACY_LANDING_PATHS = [
  '/how-it-works',
  '/landing',
  '/landing.html',
  '/skin-care',
  '/start',
  '/find-provider',
  '/about',
  '/shop',
  '/products',
  '/cart',
  '/checkout',
  '/coverage',
];
for (const legacyPath of LEGACY_LANDING_PATHS) {
  app.get(legacyPath, (req, res) => redirectLegacyLandingPath(req, res));
}

// Funnel signup / join CTAs → patient web login (email + 6-digit code), not the legacy Expo bridge.
function redirectToPatientAuth(req, res, defaultIntent = 'signup') {
  const params = new URLSearchParams(req.query);
  if (!params.get('intent')) params.set('intent', defaultIntent);
  const qs = params.toString();
  return res.redirect(302, `/patients/patient-login.html${qs ? `?${qs}` : ''}`);
}
app.get(['/app', '/join'], (req, res) => redirectToPatientAuth(req, res, 'signup'));

const { registerStaticHosting } = require('./bootstrap/static-hosting');
registerStaticHosting(app, {
  express,
  rootDir: __dirname,
});

// ============================================
// Unified Dashboard Routes (callsomo.com frontend) — host-based HTML routes below
// ============================================

// Segment page for Team Kelly campaign traffic → Somo landing.
app.get('/team-kelly', (_req, res) => {
  return res.redirect(302, '/');
});

// Public waitlist gateway for non-invited users.
app.get('/waitlist', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  // Local dev bridge: landing "Get The App" should continue into patient auth.
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return res.redirect(302, '/patients/patient-login.html');
  }
  return res.sendFile(getUnifiedDashboardPath('waitlist.html'));
});

// Invite links route approved users directly to login.
app.get('/invite', (req, res) => {
  const code = String(req.query?.code || '').trim();
  if (code) {
    return res.redirect(`/login?invite_code=${encodeURIComponent(code)}`);
  }
  return res.redirect('/login?access=invite');
});

app.get('/invite/:code', (req, res) => {
  const code = String(req.params?.code || '').trim();
  if (!code) return res.redirect('/invite');
  return res.redirect(`/login?invite_code=${encodeURIComponent(code)}`);
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
  if (isProductionApiHostname(hostname)) {
    console.log('[LOGIN ROUTE] ✅ API subdomain detected - serving API signup page (code-based)');
    return res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
  }

  // Check for localhost - serve business dashboard login (password-based) for SaaS customers
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    console.log('[LOGIN ROUTE] ✅ Localhost detected - serving business dashboard login');
    const loginPath = getUnifiedDashboardPath('login.html');
    const fs = require('fs');
    if (fs.existsSync(loginPath)) {
      return fs.readFile(loginPath, (readErr, buf) => {
        if (readErr) {
          console.error('[LOGIN ROUTE] readFile failed:', readErr.message);
          return res.status(500).send('Login page unavailable');
        }
        res.type('html').send(buf);
      });
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
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  return redirectLegacyLandingPath(req, res);
});

// Reset password page
app.get('/reset-password', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  res.sendFile(getUnifiedDashboardPath('reset-password.html'));
});

// Signup complete page
app.get('/signup-complete', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  res.sendFile(getUnifiedDashboardPath('signup-complete.html'));
});

/** Canonical SaaS portal entry after signup (not business-dashboard stub). */
const SAAS_PROVIDER_PORTAL_HOME = '/business/today.html';

function clearCustomerSessionCookie(res, req) {
  const isSecure =
    process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https';
  const opts = { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/' };
  const cookieHost = (req.headers.host || '').toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    if (cookieHost.includes('callsomo.com')) opts.domain = '.callsomo.com';
  }
  res.clearCookie('customer_session', opts);
}

// Signup page (provider intake) — only on root / marketing host
app.get('/signup', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.redirect('/');
  }

  const signupHtml = getUnifiedDashboardPath('signup.html');

  if (req.query.fresh === '1' || req.query.new === '1') {
    clearCustomerSessionCookie(res, req);
    return res.sendFile(signupHtml);
  }

  const sessionId = req.cookies?.customer_session;
  if (sessionId) {
    const session = db.getCustomerSession(sessionId);
    if (session) {
      const customer = db.getCustomer(session.customer_id);
      if (customer?.email_verified) {
        const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
        if (!termsAccepted) {
          const termsRedirect = encodeURIComponent(SAAS_PROVIDER_PORTAL_HOME);
          return res.redirect(
            `/terms?customer_type=saas&redirect=${termsRedirect}`
          );
        }
        const customerType = customer.customer_type || 'saas';
        const redirectUrl = customerType === 'saas' ? SAAS_PROVIDER_PORTAL_HOME : '/docs';
        return res.redirect(redirectUrl);
      }
    }
  }

  return res.sendFile(signupHtml);
});

app.get('/signup/saas', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  // SaaS Platform - serve login.html
  res.sendFile(getUnifiedDashboardPath('login.html'));
});

app.get('/signup/form', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.redirect('/');
  }

  // Check if this is for SaaS platform
  const plan = req.query.plan;
  if (plan === 'saas') {
    // SaaS Platform signup/login - serve login.html
    res.sendFile(getUnifiedDashboardPath('login.html'));
  } else {
    // API Integration signup - should redirect to api.callsomo.com
    res.redirect('https://api.callsomo.com');
  }
});

app.get('/index.html', (req, res) => {
  const hostname = getHostname(req);
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({ error: 'Not found on API subdomain' });
  }
  if (trySendHealthOrB2BLanding(res)) return;
  return res.status(404).type('text/plain').send('Not found');
});

const healthUiHelpers = registerHealthUi(app, { express, getUnifiedDashboardPath, rootDir: __dirname });
void healthUiHelpers;

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
  if (isProductionApiHostname(hostname)) {
    return res.status(404).json({
      error: 'Admin portal not available on API subdomain',
      message: 'Please access admin portal at https://callsomo.com/admin'
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

const adminScrapeRoutes = require('./routes/admin-scrape');
app.use('/api/admin/scrape', adminScrapeRoutes);

const adminEnrichRoutes = require('./routes/admin-enrich');
app.use('/api/admin/enrich', adminEnrichRoutes);

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

mountHealthSpine(app);

const { registerFaceReadPublicRoute } = require('./routes/public-face-read');
registerFaceReadPublicRoute(app, { apiLimiter });

const { registerPublicRoutineRoutes } = require('./routes/public-routines');
registerPublicRoutineRoutes(app, { apiLimiter });

const { registerPublicFunnelMatchRoutes } = require('./routes/public-funnel-match');
registerPublicFunnelMatchRoutes(app, { apiLimiter });
const { registerPublicFunnelIntakeRoutes } = require('./routes/public-funnel-intake');
registerPublicFunnelIntakeRoutes(app, { apiLimiter });

const { registerPublicFunnelSpecialistRoutes } = require('./routes/public-funnel-specialists');
registerPublicFunnelSpecialistRoutes(app, { apiLimiter });

const { registerPatientFunnelBridgeRoutes } = require('./routes/patient-funnel-bridge');
registerPatientFunnelBridgeRoutes(app, { apiLimiter, requirePatientSession, recordPatientPortalEvent });

// Legacy consumer paths — redirect to health entry or B2B trial (LittleLab funnel retired)
app.get(/^\/consumer(\/.*)?$/, (req, res) => {
  const sub = String(req.path || '').replace(/^\/consumer\/?/, '');
  if (sub.includes('get-app') || sub.includes('join')) {
    return res.redirect(302, '/patients/patient-login.html?intent=signup');
  }
  if (process.env.LOCAL_DEV_ROOT === 'health') {
    return redirectHealthVideoEntry(res);
  }
  return res.redirect(302, '/business/trial-activation.html');
});

const { registerPatientCareProgramBillingRoutes } = require('./routes/patient-care-program-billing');
registerPatientCareProgramBillingRoutes(app, {
  apiLimiter,
  express,
  requirePatientSession,
  ensureBillingTables,
  resolvePatientIdFromSession,
  resolveBillingSubscription,
  billingOk,
  billingErr,
  db,
});

const shelfApi = require('./lib/patient-shelf-api');
const { registerPatientRoutineRoutes } = require('./routes/patient-routine');
const { registerPatientShelfRoutes } = require('./routes/patient-shelf');
const { registerPatientProductsRoutes } = require('./routes/patient-products');
const { registerPatientBillingPortalRoutes } = require('./routes/patient-billing-portal');
const { registerPatientBookingRoutes } = require('./routes/patient-booking');
const { registerPublicLandingAssistantRoutes } = require('./routes/public-landing-assistant');
const { registerPublicProductScanRoutes } = require('./routes/public-product-scan');
const { registerPatientCheckoutChatRoutes } = require('./routes/patient-checkout-chat');
const { registerPatientProfileRoutes } = require('./routes/patient-profile');
const { registerPatientAuthRoutes } = require('./routes/patient-auth');
const { registerPatientDocumentsRoutes } = require('./routes/patient-documents');
const { registerPatientWalletRoutes } = require('./routes/patient-wallet');
const { registerPatientRcmRoutes } = require('./routes/patient-rcm');
const { registerPatientInsuranceRoutes } = require('./routes/patient-insurance');
const { registerPriorAuthRoutes } = require('./routes/prior-auth');
const { FALLBACK_CLINIC_ID, resolveClinicIdFromRequest } = require('./lib/resolve-clinic-id');

const patientRouteDeps = {
  apiLimiter,
  express,
  db,
  requirePatientSession,
  resolvePatientIdFromSession,
  recordPatientPortalEvent,
  ensureRoutineTables,
  ensureBillingTables,
  ensurePatientShelfInventoryColumns: shelfApi.ensurePatientShelfInventoryColumns,
  loadPatientShelfProductRows: shelfApi.loadPatientShelfProductRows,
  formatShelfProductApiRow: shelfApi.formatShelfProductApiRow,
  parseBillingDocumentUpload,
  safeParseJsonArray,
  isIsoDateOnly,
  localDateFromIso,
  isoFromLocalDate,
  weekdayKeyForIsoLocal,
  enumerateIsoDates,
  issuePatientDocumentDownloadUrl,
  fetchBillingAggregatesByDay,
  fieldsFromSqlAggRow,
  PatientPortalService,
  billingOk,
  billingErr,
  resolveBillingSubscription,
  requirePlusForBillingFeature,
  getPatientStep3Status,
  ensureProductsPhase2Tables,
  blockWalletWhenDisabled,
  blockChatWhenDisabled,
  isPatientWalletEnabled,
  isPatientChatEnabled,
  parseBooleanFlag,
  withIdempotency,
  assertPatientOwnsAppointmentOrThrow,
  requireCsrfForCookieAuth,
  rotatePatientSessionIfNeeded,
  resolveClinicIdFromRequest,
  FALLBACK_CLINIC_ID,
  botGuard,
  authLimiter,
  listCatalogFromIndex,
  parseProductRef,
};
registerPublicProductScanRoutes(app, { apiLimiter });
if (isCommerceLegacyEnabled()) {
  registerPatientCheckoutChatRoutes(app, {
    apiLimiter,
    express,
    requirePatientSession,
    requireCsrfForCookieAuth,
    validatePatientCheckoutChatBody,
    rotatePatientSessionIfNeeded,
    blockChatWhenDisabled,
    db,
  });
}
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

// Kelly lifecycle/status APIs (provider-facing shell)
const kellyRoutes = require('./routes/kelly');
app.use('/api/kelly', kellyRoutes);

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

// Public plans search (consumer MA lookup)
const publicPlanSearchRoutes = require('./routes/public-plan-search');
app.use('/api/public/plans', publicCatalogReadLimiter, publicPlanSearchRoutes);
const publicGeoRoutes = require('./routes/public-geo');
app.use('/api/public/geo', publicCatalogReadLimiter, publicGeoRoutes);
const publicProviderSearchRoutes = require('./routes/public-provider-search');
app.use('/api/public/providers', publicCatalogReadLimiter, publicProviderSearchRoutes);

// Public checkout (unauthenticated ensure customer)
const publicCheckoutRoutes = require('./routes/public-checkout');
app.use('/api/public/checkout', publicCheckoutRoutes);

mountCommerceLegacy(app, { publicCommerceLimiter, isCommerceLegacyEnabled });

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
const voiceBillingRoutes = require('./routes/voice-billing');
app.use('/api/voice-billing', voiceBillingRoutes);

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
const rcmPublicRoutes = require('./routes/rcm-public');
app.use('/api/public/rcm', rcmPublicRoutes);
const internalServiceOpsRoutes = require('./routes/internal-service-ops');
app.use('/api/internal/service-ops', internalServiceOpsRoutes);
const impactPublicRoutes = require('./routes/impact-public');
app.use('/api/public/impact', impactPublicRoutes);

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

  const hostname = getHostname(req);
  const termsFile = isProductionApiHostname(hostname) ? 'terms-api.html' : 'terms.html';
  res.sendFile(path.join(__dirname, 'public', 'signup', termsFile));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup', 'privacy.html'));
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

// Favicon: browsers still request /favicon.ico — serve Somo landing favicon when built.
app.get('/favicon.ico', (req, res) => {
  const fs = require('fs');
  const fromAssets = getUnifiedDashboardPath('assets', 'images', 'somo-icon.png');
  if (fs.existsSync(fromAssets)) {
    res.type('image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(fromAssets);
  }
  const svgFavicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">S</text></svg>';
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
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
    !isProductionApiHostname(hostname) &&
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
  (process.env.NODE_ENV === 'production' ? 'https://callsomo.com' : `http://localhost:${PORT}`);

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
const { registerVoiceIncomingRoute } = require('./routes/voice-incoming');
registerVoiceIncomingRoute(app, {
  express,
  voiceLimiter,
  twilioSignatureRequired,
  replayGuard,
  db,
  normalizePhoneNumber,
  clinicRateLimitCheck
});


// ============================================
// TWILIO SMS INCOMING (Call deflection P2)
// ============================================
// Configure Twilio Phone Number SMS webhook: https://yoursite.com/sms/incoming
app.post(
  '/sms/incoming',
  express.urlencoded({ extended: true }),
  twilioSignatureRequired,
  replayGuard({
    source: 'twilio_sms_incoming',
    ttlMinutes: 30,
    keyBuilder: (req) => `${req.body?.SmsSid || ''}:${req.body?.From || ''}:${req.body?.To || ''}:${req.body?.Body || ''}`
  }),
  async (req, res) => {
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
app.post(
  '/voice/status-callback',
  voiceLimiter,
  express.urlencoded({ extended: true }),
  twilioSignatureRequired,
  replayGuard({
    source: 'twilio_voice_status',
    ttlMinutes: 60,
    keyBuilder: (req) => `${req.body?.CallSid || ''}:${req.body?.CallStatus || ''}:${req.body?.SequenceNumber || ''}`
  }),
  async (req, res) => {
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

              if (voiceCall.customer_id && callStatus === 'completed' && callDurationMinutes > 0) {
                try {
                  const { applyUsage } = require('./services/apply-usage');
                  const _twilioDir = String(req.body?.Direction || '').toLowerCase();
                  const _callDirection =
                    voiceCall.direction ||
                    (_twilioDir === 'outbound-api' ? 'outbound' : null) ||
                    'inbound';
                  const usageResult = applyUsage(db, {
                    customerId: voiceCall.customer_id,
                    callId: voiceCall.call_id,
                    callSid,
                    durationMinutes: callDurationMinutes,
                    source: 'twilio_status',
                    direction: _callDirection,
                    channel: 'voice'
                  });
                  const applied = usageResult.minutes_applied ?? 0;
                  db.db.prepare(`
                    UPDATE voice_call_log 
                    SET credits_deducted = ?
                    WHERE id = ?
                  `).run(applied, voiceCall.id);
                  console.log(`   ✅ applyUsage ${applied} min for customer ${voiceCall.customer_id}`);
                } catch (creditError) {
                  console.error(`   ❌ applyUsage failed:`, creditError.message);
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


// ============================================
// VOICE COMMERCE ENDPOINTS
// ============================================
// NOTE: Voice routes are now handled by routes/voice.js (mounted above)
// This section kept for reference but duplicate route removed

// Get order tracking for voice agent


// Create checkout for voice purchase - FIXED WITH ORCHESTRATOR


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

    // Duplicate-charge guardrail: block if checkout already completed/has payment intent.
    try {
      const existingCheckout = db.getVoiceCheckout ? await db.getVoiceCheckout(resolvedCheckoutId) : null;
      const alreadyPaid =
        existingCheckout &&
        (String(existingCheckout.status || '').toLowerCase() === 'completed' || !!existingCheckout.payment_intent_id);
      if (alreadyPaid) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate payment attempt blocked',
          error_code: 'DUPLICATE_PAYMENT_ATTEMPT',
          checkout_id: resolvedCheckoutId,
          payment_intent_id: existingCheckout.payment_intent_id || null
        });
      }
    } catch (_) {}

    // Anti-sybil baseline for payment processing path.
    try {
      const antiSybil = evaluateAndRecord({
        scope: 'process_payment',
        identityKey: checkout.customer_email || checkout.customer_phone || resolvedCheckoutId,
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        userAgent: req.headers['user-agent'] || '',
        amountCents: Math.round((parseFloat(checkout.amount || 0) || 0) * 100)
      });
      if (antiSybil.decision === 'block') {
        let review = null;
        try {
          review = enqueueFraudReview({
            antiSybilEventId: antiSybil.eventId,
            scope: 'process_payment',
            priority: antiSybil.score >= 85 ? 'critical' : 'high',
            slaMinutes: antiSybil.score >= 85 ? 30 : 120
          });
        } catch (_) {}
        if (db.releaseIdempotencyKey) db.releaseIdempotencyKey(idemKey, claimOpType);
        return res.status(429).json({
          success: false,
          error: 'Payment attempt blocked for risk review',
          error_code: 'ANTI_SYBIL_BLOCKED',
          risk_score: antiSybil.score,
          fraud_review_id: review?.id || null
        });
      }
    } catch (_) {}

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
          const { findFHIRPatientForVoice } = require('./services/fhir-voice-lookup');
          fhirPatient = findFHIRPatientForVoice(db, {
            phone: checkout.customer_phone,
            clinicId: checkout.clinic_id,
            customerId: checkout.customer_id,
            requireClinicScope: !!checkout.clinic_id
          });
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
  // W4-07b: legacy users-table signup → Somo wizard (set ALLOW_LEGACY_USERS_SIGNUP=1 to restore)
  if (process.env.ALLOW_LEGACY_USERS_SIGNUP !== '1') {
    return res.status(410).json({
      success: false,
      error: 'deprecated',
      message: 'Provider signup has moved to /signup',
      redirect: '/signup'
    });
  }

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

    const { productionCookieDomain, shouldSetProductionCookieDomain } = require('./utils/brand-domains');
    if (shouldSetProductionCookieDomain(req)) {
      cookieOptions.domain = productionCookieDomain(req);
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
      : 'https://callsomo.com/business/settings.html');

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



const { registerAdminPlatformRoutes } = require('./routes/admin-platform');
registerAdminPlatformRoutes(app, {
  apiLimiter,
  express,
  db,
  requireAdminAuth,
  pricingRoutes,
});
app.use('/api/admin', requireAdminAuth);
const impactAdminRoutes = require('./routes/impact-admin');
app.use('/api/admin/impact', impactAdminRoutes);

const paymentOpsRoutes = require('./routes/payment-ops');
app.use('/api/admin/payment-ops', paymentOpsRoutes);

const adminKellyCallsRoutes = require('./routes/admin-kelly-calls');
app.use('/api/admin/kelly', adminKellyCallsRoutes);

const adminVoiceOnboardingRoutes = require('./routes/admin-voice-onboarding');
app.use('/api/admin/voice-onboarding', adminVoiceOnboardingRoutes);

// Visit pricing admin (Task 16)


// Get single client/clinic


// Create new client/clinic


// Update client/clinic


// Get comprehensive dashboard stats


// Get performance metrics


// Get cost analytics


// Get usage metrics


// Get error logs


// Get per-client analytics











// Get all transactions


// Get customers


// Get single customer


// Get agent stats


/**
 * GET /api/admin/api-keys
 * List all API keys (admin only)
 */


/**
 * GET /api/admin/api-keys/:keyId/recover
 * Recover (decrypt) an API key (admin only)
 */


/**
 * GET /api/admin/feature-requests
 * List all feature requests (admin only)
 */


/**
 * POST /api/admin/feature-requests/:requestId/update
 * Update feature request status (approve/reject)
 */


// ============================================
// BOOKING/APPOINTMENT ENDPOINTS
// ============================================

// Clinic resolution: lib/resolve-clinic-id.js (FALLBACK_CLINIC_ID + resolveClinicIdFromRequest imported near patient routes)

const { registerVoiceAppointmentRoutes } = require('./routes/voice-appointments');

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

registerVoiceAppointmentRoutes(app, {
  apiLimiter,
  express,
  db,
  scheduleCheckoutLimiter,
  voiceLimiter,
  withIdempotency,
  resolveClinicIdFromRequest,
  FALLBACK_CLINIC_ID,
  ensureSlotBundles,
  safeLogRequestBody,
});

// Voice triage guards: ./services/voice-triage-guards.js (resolveVoiceSessionIdForGuard, requireVoiceSessionIdForTriageParity, enforceVoiceTriageGuardrailsForSession)

// Schedule new appointment (for voice agent)


// Voice: Upsert patient intake (shared canonical schema)
// Allows the voice agent to capture DOB/location/etc after initial booking.


// Voice: Check patient onboarding status (DOB/country/city missing fields)


// Confirm appointment (for voice agent)


// Reschedule appointment (for voice agent)


// Cancel appointment (for voice agent)


// Get available slots (for voice agent)
// Uses SpecialistResolver + specialist-slot-service when appointment_type is a specialty and provider_profiles exist


// Search appointments (for voice agent)


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



/**
 * Check insurance eligibility
 * POST /voice/insurance/check-eligibility
 */


/**
 * Submit insurance claim
 * POST /voice/insurance/submit-claim
 */


/**
 * Check claim status
 * POST /voice/insurance/check-claim-status
 */


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
 * List claims for a patient or appointment (provider portal helper).
 * GET /api/claims?patient_id=<FHIR Patient resource_id>
 * GET /api/claims?appointment_id=<appointment_id>
 */
app.get('/api/claims', async (req, res) => {
  try {
    const patientId = req.query.patient_id || req.query.patientId || null;
    const appointmentId = req.query.appointment_id || req.query.appointmentId || null;

    if (!patientId && !appointmentId) {
      return res.status(400).json({
        success: false,
        error: 'Provide either patient_id or appointment_id'
      });
    }

    let claims = [];
    if (appointmentId) {
      claims = db.getClaimsByAppointment?.(appointmentId) || [];
    } else {
      claims = db.getClaimsByPatient?.(patientId) || [];
    }

    const claimsOut = (claims || []).map(c => ({
      id: c.id,
      appointment_id: c.appointment_id || null,
      patient_id: c.patient_id || patientId || null,
      status: c.status || null,
      submitted_at: c.submitted_at || null,
      payer_id: c.payer_id || null,
      member_id: c.member_id || null,
      total_amount: c.total_amount || 0,
      copay_amount: c.copay_amount || 0,
      insurance_amount: c.insurance_amount || 0
    }));

    const latestClaimId = claimsOut[0]?.id || null;
    res.json({
      success: true,
      latest_claim_id: latestClaimId,
      claims: claimsOut,
      count: claimsOut.length
    });
  } catch (error) {
    console.error('❌ Error listing claims:', error);
    res.status(500).json({ success: false, error: error.message });
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


/**
 * Get HSA wallet config for client (Privy/Magic init)
 * GET /api/patient/hsa-wallet/config
 */


/**
 * Patient Wallet - Deposit money (test/sandbox)
 * POST /api/patient/wallet/deposit
 */


/**
 * Patient Wallet - Get transaction history
 * GET /api/patient/wallet/transactions
 */


/**
 * Patient Wallet - Pay claim using wallet balance
 * POST /api/patient/wallet/pay-claim
 */


/**
 * Refresh a claim's status by querying the payer via STEDI (276/277).
 * POST /api/claims/:claimId/refresh-status
 */
app.post('/api/claims/:claimId/refresh-status', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const result = await InsuranceService.checkClaimStatus(claimId);
    if (!result?.success) {
      return res.status(400).json({ success: false, error: result?.error || 'Failed to refresh claim status' });
    }

    const updatedClaim = db.getClaimById(claimId);
    res.json({
      success: true,
      claimId,
      status: result.status,
      paymentAmount: result.paymentAmount,
      paymentDate: result.paymentDate,
      message: result.message,
      claim: updatedClaim
    });
  } catch (error) {
    console.error('❌ Error refreshing claim status:', error);
    res.status(500).json({ success: false, error: error.message });
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
    const currentStatus = (claim.status || '').toString().trim().toLowerCase();
    if (['submitted', 'approved', 'paid'].includes(currentStatus)) {
      let parsed = {};
      try {
        if (claim.response_data) {
          parsed = typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data;
        }
      } catch (_) {}
      return res.json({
        success: true,
        claimId: claimId,
        message: `Claim is already ${claim.status}; no-op.`,
        status: claim.status || currentStatus,
        x12ClaimId: claim.x12_claim_id || parsed.claimId || null,
        stediTranslateOk: parsed.stedi_translate_ok ?? null,
        healthcareSubmitted: parsed.healthcare_submitted ?? null,
        stediFallback: Boolean(parsed.stediFallback ?? parsed.stedi_fallback ?? false),
        manualReview: Boolean(parsed.stediFallback ?? parsed.stedi_fallback ?? false),
        eligibilityReverified: false,
        eligibilityWarning: null,
        idempotent: true
      });
    }

    const InsuranceService = require('./services/insurance-service');
    try {
      const codingCdi = require('./services/rcm-coding-cdi');
      let clinicIdForGate = process.env.DEFAULT_CLINIC_ID || 'clinic-default';
      if (claim.appointment_id) {
        const appt = db.db.prepare(`SELECT clinic_id FROM appointments WHERE id = ?`).get(claim.appointment_id);
        if (appt?.clinic_id) clinicIdForGate = appt.clinic_id;
      }
      const gate = codingCdi.assertJourneyReadyForClaimSubmit(clinicIdForGate, claimId);
      if (!gate.ok) {
        return res.status(422).json({
          success: false,
          code: 'rcm_gate_failed',
          errors: gate.errors,
          journey_id: gate.journey_id,
        });
      }
      const result = await InsuranceService.submitExistingClaim(claimId);
      return res.json({
        success: true,
        claimId: claimId,
        message: result.healthcareSubmitted
          ? 'Claim submitted to Stedi clearinghouse.'
          : 'Claim marked submitted; manual Stedi review may be required.',
        status: 'submitted',
        x12ClaimId: result.x12ClaimId || null,
        stediTranslateOk: result.stediTranslateOk,
        healthcareSubmitted: result.healthcareSubmitted,
        stediFallback: result.stediFallback,
        manualReview: result.manualReview,
        eligibilityReverified: result.eligibilityReverified,
        eligibilityWarning: result.eligibilityWarning || null,
        stedi: result
      });
    } catch (e) {
      if (e && e.code === 'PRIOR_AUTH_REQUIRED') {
        return res.status(409).json({
          success: false,
          error: e.message,
          code: e.code
        });
      }
      throw e;
    }
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


/**
 * Recover All Stuck Escrows (Admin/Scheduled Job Endpoint)
 * POST /api/admin/recover-all-stuck-escrows
 * 
 * Finds all stuck escrows (Transfer 1 completed, Transfer 2 not completed, older than 1 hour)
 * and attempts recovery for each.
 * 
 * Query params: ?olderThanHours=1 (default: 1)
 */


/**
 * Task 45: Escrow timeout check and provider notification
 * POST /api/admin/escrow-timeout-notify
 * Call from cron when ESCROW_NOTIFY_ON_TIMEOUT=1
 */


/**
 * Get Fee Schedule Freshness (Admin Endpoint)
 * GET /api/admin/fee-schedules/freshness?payerId=BCBS
 * 
 * Returns freshness summary for a payer's fee schedule.
 * Shows total rates, stale rates, oldest/newest update dates.
 */


/**
 * Get Stale Fee Schedules (Admin Endpoint)
 * GET /api/admin/fee-schedules/stale?payerId=BCBS&olderThanDays=90
 * 
 * Lists all stale fee schedule rates (older than threshold).
 */


/**
 * Mark Fee Schedule Refreshed (Admin Endpoint)
 * POST /api/admin/fee-schedules/mark-refreshed
 * 
 * Updates updated_at timestamp for fee schedule rates after refresh.
 * Body: { payerId: "BCBS", cptCodes: ["90837", "90834"] } (cptCodes optional)
 */


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


/**
 * Task 47: Claim resubmission after rejection
 * POST /api/admin/claims/:claimId/resubmit
 */


/**
 * Circle webhook handler
 * POST /api/circle/webhook
 */
app.post('/api/circle/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-circle-signature'] || req.headers['circle-signature'];
    const payload = req.body.toString();

    // Verify webhook signature
    const isValid = CircleService.verifyWebhookSignature(signature, payload);
    if (!isValid) {
      console.warn('⚠️  Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(payload);
    console.log('🔔 Circle webhook received:', event.type);

    // Replay defense for Circle webhook events.
    const replayWindowSec = parseInt(process.env.CIRCLE_WEBHOOK_REPLAY_WINDOW_SEC || '900', 10);
    const createdEpoch = Number(event?.notification?.createDate || event?.createDate || event?.created || 0);
    if (Number.isFinite(replayWindowSec) && replayWindowSec > 0 && Number.isFinite(createdEpoch) && createdEpoch > 0) {
      const normalizedCreated = createdEpoch > 1e12 ? Math.floor(createdEpoch / 1000) : Math.floor(createdEpoch);
      const ageSec = Math.floor(Date.now() / 1000) - normalizedCreated;
      if (ageSec > replayWindowSec) {
        return res.status(200).json({ received: true, stale: true });
      }
    }
    const replayOp = 'replay:circle_webhook';
    const replayEventId = String(
      event?.notification?.notificationId ||
      event?.notificationId ||
      event?.id ||
      event?.data?.id ||
      ''
    ).trim();
    const replayKey = replayEventId ? `circle:${replayEventId}` : `circlehash:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    const replayState = db.reserveIdempotencyKey ? db.reserveIdempotencyKey(replayKey, replayOp) : 'reserved';
    if (replayState === 'completed' || replayState === 'in_progress') {
      return res.status(200).json({ received: true, replay_skipped: true });
    }

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
        try {
          const FinancialIntegrityService = require('./services/financial-integrity-service');
          FinancialIntegrityService.recordCircleTransferReconciliation(transfer, event.type);
        } catch (e) {
          console.warn('[CircleWebhook] financial integrity ingest (non-fatal):', e.message);
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
        try {
          const FinancialIntegrityService = require('./services/financial-integrity-service');
          FinancialIntegrityService.recordCircleTransferReconciliation(transfer, event.type);
        } catch (e) {
          console.warn('[CircleWebhook] financial integrity ingest (non-fatal):', e.message);
        }
      }
    }

    if (db.completeIdempotentResult) {
      try { db.completeIdempotentResult(replayKey, replayOp, { received: true }); } catch (_) {}
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


/**
 * Fetch insurance payers from Stedi
 * GET /api/admin/insurance/payers?search=xxx&limit=100
 */


/**
 * Search for a specific payer (uses cache service)
 * GET /api/admin/insurance/payers/search?q=blue+cross
 */


/**
 * Sync payer list from Stedi (background job)
 * POST /api/admin/insurance/sync-payers?limit=1000
 */


/**
 * Get payer cache statistics
 * GET /api/admin/insurance/payers/stats
 */


/**
 * Fee schedule API – list by payer
 * GET /api/admin/fee-schedules?payerId=BCBS
 */


/**
 * Fee schedule API – add/upsert single
 * POST /api/admin/fee-schedules
 * Body: { payer_id, cpt_code, allowed_amount [, in_network, effective_date, end_date, source ] }
 */


/**
 * Fee schedule API – bulk upload
 * POST /api/admin/fee-schedules/bulk
 * Body: { items: [ { payer_id, cpt_code, allowed_amount [, in_network, effective_date, source ] }, ... ] }
 */


// Metrics endpoint (basic observability + LLM aggregates)




// Call dashboard (Section 1 - call volume, state transitions, tool usage, error rates)


// DLQ tool calls list (for audit/retry)


// Cache stats for medical coding lookups (Phase 3.3)


// Clear medical coding cache (e.g. after fee schedule or rule updates)


// Feature flags (Section 15) - list and toggle



// Patient merge events review


// Payor review queue (Step 7)










// Get patient insurance records


// Get recent eligibility checks for a patient


// Restore Stedi patient data from eligibility_checks


// Sync patients from Stedi (alternative endpoint)
/**
 * Update patient name
 * PUT /api/admin/patients/:patientId/name
 */




// Patient-facing: Get all insurance cards for a patient


// Provider registry specialty search with pagination.
app.get('/api/provider-registry/search', apiLimiter, async (req, res) => {
  try {
    const out = listProviderSearchResults({
      taxonomyCode: req.query?.taxonomy_code || req.query?.taxonomy || null,
      latitude: req.query?.lat || null,
      longitude: req.query?.lon || null,
      radiusMiles: req.query?.radius_miles || req.query?.radius || null,
      payorEntityId: req.query?.payor_entity_id || null,
      page: req.query?.page || 1,
      pageSize: req.query?.page_size || 25
    });
    return res.json({ success: true, ...out });
  } catch (error) {
    console.error('Error searching provider registry:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Patient: Update insurance (onboarding)


// Get EOB (Explanation of Benefits) data for a patient


// Get all patients with billing summary (EOB list view)


/**
 * Refresh payer cache (by search term or sync chunk)
 * POST /api/admin/insurance/cache/refresh?search=...&limit=...
 */


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

// Clinical prep PHI gate: middleware-platform/lib/clinical-phi-access.js (admin-platform route)

// Dashboard: merged clinical prep payload for provider drawer


// Dashboard: Get all appointments


// Dashboard: Get upcoming appointments


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


// Dashboard: replace appointment to-do list items


// Dashboard: Search known patients by name/phone/email for create-appointment modal.


// External EHR IDs for patient crosswalk (Athena/Epic/etc)




// Send video link via SMS to patient for telehealth appointment
// Create appointment manually (for provider/admin UI)




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

    let caseSummary = null;
    if (appointment?.id) {
      try {
        const csRow = db.db
          .prepare('SELECT summary_json, session_id FROM case_summaries WHERE appointment_id = ? LIMIT 1')
          .get(appointment.id);
        if (csRow?.summary_json) {
          caseSummary =
            typeof csRow.summary_json === 'string' ? JSON.parse(csRow.summary_json) : csRow.summary_json;
          if (!caseRecord?.session_id && csRow.session_id) {
            caseRecord = caseRecord || {};
            caseRecord.session_id = csRow.session_id;
          }
        }
      } catch (_) {}
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

    let opqrst = caseRecord?.opqrst
      ? typeof caseRecord.opqrst === 'string'
        ? caseRecord.opqrst
        : JSON.stringify(caseRecord.opqrst)
      : '';
    if (!opqrst && caseSummary?.opqrst) {
      opqrst =
        typeof caseSummary.opqrst === 'string' ? caseSummary.opqrst : JSON.stringify(caseSummary.opqrst);
    }
    if (!opqrst && caseSummary?.chief_complaint) {
      opqrst = String(caseSummary.chief_complaint);
    }
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
        suggested_icd10: suggestedIcd10,
        case_summary: caseSummary || null,
        triage_session_id: caseRecord?.session_id || caseSummary?.session_id || null
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

// Patient: Send verification code


// Admin: revoke patient sessions by email or patient_id (basic security/admin tool)


// Patient: Verify code and login
// Use authLimiter to protect against brute-force code guessing


// Patient: Logout (invalidate session)


// Patient: Get documents list


// Patient: Request a signed download URL for a document (mvp-39, mvp-61)


// Patient: Consume signed URL token and stream document (mvp-39, mvp-61)


// Patient: Upload documents (multipart)


// AUTH TOKEN ENDPOINTS (patient / clinician JWT issuers)
app.use('/api/auth', authTokenRoutes);

// LiveKit video token routes (used by patient video-call.html and provider HUD)
app.use('/api/livekit', livekitTokenRoutes);

// Patient: Get my appointments (requires session)
// Protected by general API rate limiter

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

Object.assign(patientRouteDeps, {
  validatePatientAvailableSlotsQuery,
  validatePatientBookingScheduleBody,
  validatePatientTriageBody,
  auditBookingEvent,
  otpSendLimiter,
  otpConfirmLimiter,
});
registerPatientRoutineRoutes(app, patientRouteDeps);
registerPatientShelfRoutes(app, patientRouteDeps);
registerPatientProductsRoutes(app, patientRouteDeps);
registerPatientBillingPortalRoutes(app, patientRouteDeps);
registerPatientBookingRoutes(app, patientRouteDeps);
registerPublicLandingAssistantRoutes(app, {
  apiLimiter,
  express,
  validatePatientTriageBody,
  db,
  upsertCustomerProductScan,
  antiSybilGuard,
  requireAdminAuth,
});

const patientPortalDeps = {
  ...patientRouteDeps,
  requireAdminAuth,
  sendUploadLinkHandler,
  botGuard,
  authLimiter,
  otpSendLimiter,
  otpConfirmLimiter,
};
registerPatientProfileRoutes(app, patientPortalDeps);
registerPatientAuthRoutes(app, patientPortalDeps);
registerPatientDocumentsRoutes(app, patientPortalDeps);
registerPatientWalletRoutes(app, patientPortalDeps);
registerPatientRcmRoutes(app, patientPortalDeps);
registerPatientInsuranceRoutes(app, patientPortalDeps);
registerPriorAuthRoutes(app, { apiLimiter, express, db });

// GET /api/patient/triage/history — Fetch conversation history for resume (orch-5)

// Patient: Get profile


// Patient: Update profile (onboarding)


// Dashboard: Billing summary by patient (derived from appointments)


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

            try {
              const orchestrator = require('./services/rcm-journey-orchestrator');
              const clinicForRcm =
                existingCall.clinic_id ||
                process.env.DEFAULT_CLINIC_ID ||
                process.env.PRIMARY_CLINIC_ID ||
                'clinic-default';
              const { parseIntakeFromCallPayload } = require('./services/rcm-intake-parser');
              const rawIntake = {
                duration_seconds: durationSeconds,
                function_calls_count: functionCallCount,
                call_analysis: body.call_analysis || body.call?.call_analysis || null,
                transcript_summary: body.transcript || body.call?.transcript || null,
                transcript: body.transcript || body.call?.transcript || null,
              };
              const parsed = parseIntakeFromCallPayload(rawIntake);
              orchestrator.captureIntakeFromCall({
                clinicId: clinicForRcm,
                callId,
                intakePayload: { ...rawIntake, ...parsed },
              });
            } catch (rcmIntakeErr) {
              console.warn('⚠️  RCM intake capture on call end:', rcmIntakeErr.message);
            }
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


// M-Doc.3: POST /api/patient/records/query — Ask about uploaded records (labs, visit notes, etc.)


// Patient: Get receipts (mvp-24)


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
      const { findFHIRPatientForVoice } = require('./services/fhir-voice-lookup');
      patient = findFHIRPatientForVoice(db, {
        phone: sessionValidation.phone,
        clinicId: sessionValidation.clinic_id || null,
        requireClinicScope: !!sessionValidation.clinic_id
      });
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




// ============================================
// Ops / reliability dashboard (mvp-78)
// ============================================


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

        if (
          checkoutSession.mode === 'subscription' &&
          checkoutSession.metadata &&
          String(checkoutSession.metadata.type || '') === 'care_program'
        ) {
          try {
            ensureBillingTables();
            const { activateCareProgramSubscription } = require('./services/care-program-billing-service');
            activateCareProgramSubscription(db, {
              sessionId: checkoutSession.metadata.patient_session_id,
              patientId: checkoutSession.metadata.patient_id || null,
              concernId: checkoutSession.metadata.concern_id || null,
              stripeCustomerId: checkoutSession.customer,
              stripeSubscriptionId: checkoutSession.subscription,
            });
            console.log('[StripeWebhook] care_program subscription activated for session', checkoutSession.metadata.patient_session_id);
          } catch (careProgErr) {
            console.error('[StripeWebhook] care_program activation failed:', careProgErr.message);
          }
        }

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


// Debug/ops: inspect EHR sync queue (latest first)


// Get EHR summary for appointment


// Get EHR summary for patient


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

      // Find matching Somo patient by Epic patient ID
      // First, try to find by resource_id matching Epic patient ID
      let platformPatient = db.db.prepare(`
        SELECT * FROM fhir_patients WHERE resource_id = ?
      `).get(encPatientId);

      // If not found, use the first patient or create a link
      if (!platformPatient && epicPatientId) {
        // For now, we'll use the connection's patient_id if available
        platformPatient = db.db.prepare(`
          SELECT * FROM fhir_patients WHERE resource_id = ?
        `).get(epicPatientId);
      }

      if (!platformPatient) {
        console.warn(`   ⚠️  Patient ${encPatientId} not found in Somo, skipping encounter ${encounter.id}`);
        continue;
      }

      const patientId = platformPatient.resource_id;
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
app.get('/health/voice-operator', async (req, res) => {
  try {
    const { assessVoiceOperatorReadiness } = require('./services/voice-operator-readiness');
    const assessment = assessVoiceOperatorReadiness(db);
    const ok = assessment.ready;
    return res.status(ok ? 200 : 503).json({
      success: ok,
      ...assessment,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health/email', (req, res) => {
  try {
    const EmailService = require('./services/email-service');
    const health = EmailService.getEmailHealth();
    const ok = health.provider_configured !== 'none';
    return res.status(ok ? 200 : 503).json({
      success: ok,
      ...health,
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
    service: 'Skin & Care Middleware Platform',
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


// Create card for patient


// Get card details (including PAN and CVC for virtual cards)


// Update card spending controls


// Cancel card


// Get card transactions


// Get patient transactions (all cards)


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

function assertProdPayorReadinessOrExit() {
  const isProdRuntime = ['production', 'prod'].includes(String(process.env.NODE_ENV || '').toLowerCase());
  const strict = ['1', 'true', 'yes'].includes(String(process.env.PROD_DB_READY_REQUIRED || '').toLowerCase());
  if (!isProdRuntime || !strict) return;
  const requiredTables = [
    'payor_plan_service_areas',
    'payor_plan_premiums',
    'payor_plan_benefits',
    'zip_county_crosswalk',
    'geo_zip',
    'geo_county',
    'geo_zip_county_map',
  ];
  try {
    const missing = requiredTables.filter((name) =>
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)
    );
    if (missing.length) {
      console.error(
        '[startup-readiness] refusing to boot in strict production mode; missing tables:',
        missing.join(', ')
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('[startup-readiness] readiness validation failed:', err.message);
    process.exit(1);
  }
}

assertProdPayorReadinessOrExit();

const { assertVoiceOperatorReadinessOrExit } = require('./services/voice-operator-readiness');
assertVoiceOperatorReadinessOrExit(db);

bootLog(`calling app.listen host=${HOST} port=${PORT}`);
function onServerListening() {
  bootLog('app.listen callback reached');
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'prod' &&
    process.env.FACE_READ_AUTO_START !== '0'
  ) {
    console.log('[face-read] Checking teamkelly inference (FACE_READ_AUTO_START=0 to disable)...');
    const { ensureFaceReadInference } = require('./scripts/ensure-face-read-inference.cjs');
    ensureFaceReadInference().catch((err) => {
      console.warn('[face-read] Auto-start failed:', err?.message || err);
    });
  }
  console.log('\n' + '='.repeat(60));
  console.log('🚀 MIDDLEWARE PLATFORM - PRODUCTION READY');
  console.log('='.repeat(60));
  console.log(`\n📍 Server running on: http://${HOST}:${PORT}`);
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'prod') {
    console.log(`🏥 LOCAL_DEV_ROOT=${process.env.LOCAL_DEV_ROOT || '(unset)'} — http://localhost:${PORT}/ → ${
      process.env.LOCAL_DEV_ROOT === 'health' ? (getHealthVideoSpaDir() ? '/health-video/' : '/health-video.html') :
      process.env.LOCAL_DEV_ROOT === 'login' ? '/login' :
      '/business/trial-activation.html'
    }`);
  }
  console.log('✅ Ready to accept requests (background startup tasks may still be running)\n');
  console.log(
    isCommerceLegacyEnabled()
      ? '🛒 COMMERCE_LEGACY_ENABLED=true — public commerce + checkout-chat routes mounted'
      : '🏥 COMMERCE_LEGACY_ENABLED=false — health session is default; commerce routes not mounted'
  );

  if (process.env.DEV_LIGHT_START === '1') {
    console.log('ℹ️  DEV_LIGHT_START=1 — skipping post-listen background workers (local dev only)\n');
    return;
  }

  // Defer heavy sync work so HTTP handlers are not blocked during long listen-callback work.
  setImmediate(() => {
  if (isCommerceLegacyEnabled()) {
    try {
      const checkoutSvc = require('./services/patient-checkout-chat-service');
      if (typeof checkoutSvc._runCheckoutPreparedBackfillOnce === 'function') {
        checkoutSvc._runCheckoutPreparedBackfillOnce().catch(() => {});
      }
      if (typeof checkoutSvc._runCheckoutContextBackfillOnce === 'function') {
        checkoutSvc._runCheckoutContextBackfillOnce().catch(() => {});
      }
      if (typeof checkoutSvc._runCheckoutStaleInFlightRecoveryOnce === 'function') {
        checkoutSvc._runCheckoutStaleInFlightRecoveryOnce();
        setInterval(() => checkoutSvc._runCheckoutStaleInFlightRecoveryOnce(), 60 * 1000);
      }
    } catch (_) {}
  }
  try {
    const cacheService = require('./services/cache-service');
    if (typeof cacheService.warm === 'function') cacheService.warm();
  } catch (e) { console.warn('⚠️  Cache warm skipped:', e.message); }
  try {
    const SpecialistResolverService = require('./services/specialist-resolver-service');
    if (SpecialistResolverService.cleanupCache) {
      SpecialistResolverService.cleanupCache();
      setInterval(() => SpecialistResolverService.cleanupCache(), 60 * 60 * 1000);
    }
  } catch (e) { console.warn('⚠️  Resolver cache cleanup skipped:', e.message); }
  });

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

  // Canonical catalog sync: keep master OBF index updated daily (GCS + delta apply).
  try {
    const syncEnabled =
      !isTruthyFlag(process.env.RCM_E2E_RUN) &&
      isTruthyFlag(process.env.CATALOG_MASTER_SYNC_ENABLED, process.env.NODE_ENV === 'production');
    if (syncEnabled) {
      const intervalMs = Math.max(
        60 * 60 * 1000,
        parseInt(process.env.CATALOG_MASTER_SYNC_INTERVAL_MS || `${24 * 60 * 60 * 1000}`, 10) || 24 * 60 * 60 * 1000
      );
      const baselineOnEmpty = isTruthyFlag(process.env.CATALOG_MASTER_BOOTSTRAP_BASELINE_ON_EMPTY, false);
      let running = false;
      const runCatalogSync = (reason = 'scheduled') => {
        if (running) {
          console.log(`[CatalogMasterSync] skip (${reason}) - previous run still in progress`);
          return;
        }
        running = true;
        const stats = typeof db.getMasterCatalogStats === 'function' ? db.getMasterCatalogStats() : { obf_count: 0 };
        const scriptRel = baselineOnEmpty && Number(stats?.obf_count || 0) === 0
          ? './scripts/obf-baseline-csv-to-gcs-and-index.cjs'
          : './scripts/obf-sync-delta-and-apply.cjs';
        const child = spawn(process.execPath, [scriptRel], {
          cwd: __dirname,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.on('data', (d) => console.log(`[CatalogMasterSync][out] ${String(d).trimEnd()}`));
        child.stderr.on('data', (d) => console.warn(`[CatalogMasterSync][err] ${String(d).trimEnd()}`));
        child.on('close', (code) => {
          running = false;
          if (code === 0) {
            try { Metrics.increment('catalog.master.sync.success.count', 1); } catch (_) {}
            console.log(`[CatalogMasterSync] completed (${reason})`);
          } else {
            try { Metrics.increment('catalog.master.sync.failed.count', 1); } catch (_) {}
            console.warn(`[CatalogMasterSync] failed (${reason}) exit_code=${code}`);
          }
        });
      };
      setTimeout(() => runCatalogSync('startup'), 15000);
      setInterval(() => runCatalogSync('interval'), intervalMs);
      console.log(
        `✅ Catalog master sync worker started (interval=${intervalMs}ms baseline_on_empty=${baselineOnEmpty ? 'on' : 'off'})`
      );
    } else {
      console.log('ℹ️  Catalog master sync worker disabled (CATALOG_MASTER_SYNC_ENABLED)');
    }
  } catch (e) {
    console.warn('⚠️  Catalog master sync worker disabled:', e.message);
  }

  // Start EHR sync service (with error handling)
  try {
    const ehrSyncEnabled = process.env.EHR_SYNC_ENABLED !== '0';
    if (ehrSyncEnabled) {
      EHRSyncService.start();
      EhrSyncJobWorker.start();
    } else {
      console.log('ℹ️  EHR sync disabled (EHR_SYNC_ENABLED=0)');
    }
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

  // Fraud review SLA breach monitor
  try {
    const pollMs = Math.max(
      15 * 1000,
      parseInt(process.env.FRAUD_REVIEW_SLA_ALERT_INTERVAL_MS || '60000', 10) || 60000
    );
    const maxPerRun = Math.max(
      1,
      Math.min(200, parseInt(process.env.FRAUD_REVIEW_SLA_ALERT_BATCH || '50', 10) || 50)
    );
    const runFraudReviewSlaMonitor = () => {
      try {
        const overdue = listOverdueFraudReviews({ limit: maxPerRun });
        if (!Array.isArray(overdue) || overdue.length === 0) return;
        for (const item of overdue) {
          const marked = markFraudReviewAlerted(item.id);
          if (!marked) continue;
          try { db.incrementOpsCounter && db.incrementOpsCounter('fraud_review_sla_breach'); } catch (_) {}
          console.warn('[FraudReview][SLA_BREACH]', JSON.stringify({
            review_id: item.id,
            scope: item.scope || null,
            priority: item.priority || null,
            assigned_to: item.assigned_to || null,
            status: item.status || null,
            sla_due_at: item.sla_due_at || null
          }));
        }
      } catch (e) {
        console.warn('[FraudReview] SLA monitor error:', e.message);
      }
    };
    runFraudReviewSlaMonitor();
    setInterval(runFraudReviewSlaMonitor, pollMs);
    console.log(`✅ Fraud review SLA monitor started (interval ${pollMs}ms, batch ${maxPerRun})`);
  } catch (e) {
    console.warn('⚠️  Fraud review SLA monitor disabled:', e.message);
  }

  // Expired commerce quote sessions (checkout_sessions) — legacy commerce only
  if (isCommerceLegacyEnabled()) {
    try {
      if (db.purgeExpiredCheckoutSessions) {
        const purged = db.purgeExpiredCheckoutSessions();
        if (purged > 0) console.log(`🧹 checkout_sessions purge: removed ${purged} expired row(s)`);
        setInterval(() => {
          const n = db.purgeExpiredCheckoutSessions();
          if (n > 0) console.log(`🧹 checkout_sessions purge: removed ${n} expired row(s)`);
        }, 6 * 60 * 60 * 1000);
      }
      if (db.purgeOrphanedCommerceFlowSessions) {
        const orphaned = db.purgeOrphanedCommerceFlowSessions(30);
        if (orphaned > 0) console.log(`🧹 commerce_flow purge: removed ${orphaned} stale row(s)`);
      }
    } catch (e) {
      console.warn('⚠️  checkout_sessions purge disabled:', e.message);
    }
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

  // Phase 0: Financial integrity deterministic reconciliation + daily close
  try {
    const FinancialIntegrityService = require('./services/financial-integrity-service');
    const enabled = process.env.FINANCIAL_INTEGRITY_JOBS_ENABLED !== '0';
    if (enabled) {
      const reconMs = Math.max(
        5 * 60 * 1000,
        parseInt(process.env.RECONCILIATION_JOB_INTERVAL_MS || `${6 * 60 * 60 * 1000}`, 10) || 6 * 60 * 60 * 1000
      );
      const closeMs = Math.max(
        60 * 60 * 1000,
        parseInt(process.env.FINANCIAL_CLOSE_INTERVAL_MS || `${24 * 60 * 60 * 1000}`, 10) || 24 * 60 * 60 * 1000
      );
      const runReconciliation = () => {
        try {
          const now = new Date();
          const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const { run, exceptions } = FinancialIntegrityService.runDeterministicReconciliation({
            windowStart: start.toISOString(),
            windowEnd: now.toISOString()
          });
          console.log(
            `✅ Reconciliation job completed: run=${run.id} mismatches=${exceptions.length} delta=${run.total_delta}`
          );
        } catch (e) {
          console.warn('⚠️  Reconciliation job failed:', e.message);
        }
      };
      const runDailyClose = () => {
        try {
          const report = FinancialIntegrityService.generateDailyFinancialCloseReport();
          console.log(
            `✅ Financial close generated: date=${report.close_date} unresolved=${report.unexplained_delta_count}`
          );
        } catch (e) {
          console.warn('⚠️  Financial close generation failed:', e.message);
        }
      };
      const kickoffFinancialJobs = () => {
        runReconciliation();
        runDailyClose();
      };
      const isProdEnv = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
      const devLightStart = process.env.DEV_LIGHT_START === '1';
      if (isProdEnv) {
        kickoffFinancialJobs();
      } else if (!devLightStart) {
        setImmediate(kickoffFinancialJobs);
      } else {
        console.log('ℹ️  DEV_LIGHT_START=1 — skipping financial integrity kickoff on startup');
      }
      setInterval(runReconciliation, reconMs);
      setInterval(runDailyClose, closeMs);
      console.log(
        `✅ Financial integrity workers started (reconciliation=${reconMs}ms close=${closeMs}ms)`
      );
    } else {
      console.log('ℹ️  Financial integrity workers disabled (FINANCIAL_INTEGRITY_JOBS_ENABLED=0)');
    }
  } catch (e) {
    console.warn('⚠️  Financial integrity workers disabled:', e.message);
  }

  // Phase 0 §3: failed instant-settlement retries (exponential backoff + dead-letter)
  try {
    const settlementRetryEnabled = process.env.SETTLEMENT_RETRY_JOB_ENABLED !== '0';
    if (settlementRetryEnabled) {
      const SettlementRetryService = require('./services/settlement-retry-service');
      const retryMs = Math.max(
        60 * 1000,
        parseInt(process.env.SETTLEMENT_RETRY_JOB_INTERVAL_MS || `${5 * 60 * 1000}`, 10) || 5 * 60 * 1000
      );
      const tick = async () => {
        try {
          const summary = await SettlementRetryService.processDueRetries();
          if (
            summary.processed > 0 ||
            summary.dead_lettered > 0 ||
            summary.errors.length > 0
          ) {
            console.log('[SettlementRetry] tick', summary);
          }
        } catch (e) {
          console.warn('⚠️  Settlement retry job failed:', e.message);
        }
      };
      tick();
      setInterval(tick, retryMs);
      console.log(`✅ Settlement retry worker started (interval=${retryMs}ms)`);
    } else {
      console.log('ℹ️  Settlement retry worker disabled (SETTLEMENT_RETRY_JOB_ENABLED=0)');
    }
  } catch (e) {
    console.warn('⚠️  Settlement retry worker disabled:', e.message);
  }

  // Phase 0 §4: payment reliability monitor (alerts for webhooks, reconciliation, error spikes)
  try {
    const reliabilityEnabled = process.env.PAYMENT_RELIABILITY_MONITOR_ENABLED !== '0';
    if (reliabilityEnabled) {
      const PaymentReliabilityMonitor = require('./services/payment-reliability-monitor');
      const intervalMs = Math.max(
        60 * 1000,
        parseInt(process.env.PAYMENT_RELIABILITY_MONITOR_INTERVAL_MS || `${5 * 60 * 1000}`, 10) || 5 * 60 * 1000
      );
      const tick = () => {
        try {
          const report = PaymentReliabilityMonitor.computeAlerts();
          if (report.alerts && report.alerts.length) {
            console.warn('[PaymentReliability] alerts', report.alerts);
            try {
              const db = require('./database');
              if (db.incrementOpsCounter) db.incrementOpsCounter('payment_reliability_alerts_emitted');
            } catch (_) {}
          }
        } catch (e) {
          console.warn('⚠️  Payment reliability monitor failed:', e.message);
        }
      };
      tick();
      setInterval(tick, intervalMs);
      console.log(`✅ Payment reliability monitor started (interval=${intervalMs}ms)`);
    } else {
      console.log('ℹ️  Payment reliability monitor disabled (PAYMENT_RELIABILITY_MONITOR_ENABLED=0)');
    }
  } catch (e) {
    console.warn('⚠️  Payment reliability monitor disabled:', e.message);
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
}

const server = app.listen(PORT, HOST, () => {
  console.log(`\n📍 HTTP listening on http://localhost:${PORT}`);
  setImmediate(onServerListening);
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
