// server.js - FIXED WITH PAYMENT ORCHESTRATOR AND PROPER DATABASE
// Load environment variables from .env if dotenv is available.
// In Azure, env vars are provided by App Settings, so dotenv may not be installed.
try {
  require('dotenv').config();
} catch (e) {
  console.warn('⚠️  dotenv not found - skipping .env loading (Azure App Settings will be used instead)');
}

// SECURITY: Validate environment variables on startup
const { validateAndExitIfInvalid } = require('./utils/env-validator');
validateAndExitIfInvalid();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
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
const SMSService = require('./services/sms-service');
const FHIRService = require('./services/fhir-service');
const FHIRAdapter = require('./adapters/fhir-adapter');
const BookingService = require('./services/booking-service');
const ReminderScheduler = require('./services/reminder-scheduler');
const InsuranceService = require('./services/insurance-service');
const PayerCacheService = require('./services/payer-cache-service');
const Metrics = require('./services/metrics');
const ProviderService = require('./services/provider-service');
const PatientPortalService = require('./services/patient-portal-service');
const EHRAggregatorService = require('./services/ehr-aggregator-service');
const EHRSyncService = require('./services/ehr-sync-service');
const EpicAdapter = require('./services/epic-adapter');
const RetellService = require('./services/retell-service');

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

// Trust proxy - required for Azure App Service and express-rate-limit
// This allows Express to correctly identify client IPs behind proxies
app.set('trust proxy', true);

// Import WebSocket for Retell LLM
const WebSocket = require('ws');
const RetellWebSocketHandler = require('./webhooks/retell-websocket');

// Import middleware
const { securityHeaders, sanitizeInput, requestLogger } = require('./middleware/security');
const { apiLimiter, authLimiter, paymentLimiter, voiceLimiter } = require('./middleware/rate-limiter');
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

// Security middleware (must be first)
app.use(securityHeaders);

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

    // Block everything else
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));
// Handle preflight for all routes
app.options('*', cors(corsOptions));

// Cookie parser
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (console)
app.use(requestLogger);

// Enhanced usage logging (database) - for API endpoints
app.use('/api/', usageLogger);

// Input sanitization
app.use(sanitizeInput);

// Global rate limiting
app.use('/api/', apiLimiter);

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

// Helper function to get hostname
function getHostname(req) {
  return req.headers.host?.split(':')[0] || req.headers.host;
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

  // Localhost - serve voice agent marketing landing page (same as doclittle.site)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const landingPath = path.join(__dirname, 'public', 'landing.html');
    if (require('fs').existsSync(landingPath)) {
      return res.sendFile(landingPath);
    }
    // Fallback to admin if landing page doesn't exist
    return res.redirect('/admin');
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

  // Root domain - serve voice agent marketing landing page (same as localhost)
  if (hostname === 'doclittle.site' || hostname === 'www.doclittle.site' || hostname === 'doclittle.azurewebsites.net') {
    const landingPath = path.join(__dirname, 'public', 'landing.html');
    if (require('fs').existsSync(landingPath)) {
      return res.sendFile(landingPath);
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
  // Only serve API signup page if we're on API subdomain or unknown domain
  console.log('[ROOT ROUTE] Serving API signup page as default fallback');
  res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
});

// ============================================
// Unified Dashboard Routes (doclittle.site frontend)
// ============================================

// Serve unified-dashboard static assets
app.use('/assets', express.static(getUnifiedDashboardPath('assets'), {
  maxAge: '1d' // Cache static assets for 1 day
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

  // Check for localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    console.log('[LOGIN ROUTE] ✅ Localhost detected - serving API signup page');
    return res.sendFile(path.join(__dirname, 'public', 'signup', 'index.html'));
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
  res.sendFile(getUnifiedDashboardPath('index.html'));
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

// Clinic Invoice Routes (Patient Billing)
// ============================================
const clinicInvoiceRoutes = require('./routes/invoices-clinic');
app.use('/api/invoices', clinicInvoiceRoutes);

// Products and Orders routes (merged from merchant-shop)
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

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
app.use('/api/payment', paymentRoutes);

// Customer wallet routes
const customerWalletRoutes = require('./routes/customer-wallet');
app.use('/api/customer/wallet', customerWalletRoutes);

// Public products (read-only)
const publicProductsRoutes = require('./routes/public-products');
app.use('/api/public/products', publicProductsRoutes);

// Public checkout (unauthenticated ensure customer)
const publicCheckoutRoutes = require('./routes/public-checkout');
app.use('/api/public/checkout', publicCheckoutRoutes);

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
// FHIR API Routes
// ============================================
const fhirRoutes = require('./routes/fhir');
app.use('/fhir', fhirRoutes);

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

  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');

  // If it's 10 digits (US number without country code), add +1
  if (digitsOnly.length === 10) {
    return '+1' + digitsOnly;
  }

  // If it's 11 digits starting with 1, add +
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return '+' + digitsOnly;
  }

  // If it already has +, return as is
  if (phone.startsWith('+')) {
    return phone;
  }

  // Otherwise, assume US and add +1
  return '+1' + digitsOnly;
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
app.post('/voice/incoming', voiceLimiter, async (req, res) => {
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
    let merchantId = metadata.merchant_id;
    if (!merchantId && customerId) {
      // Try to get merchant from customer's clinic
      const customer = db.getCustomer(customerId);
      if (customer && customer.merchant_id) {
        merchantId = customer.merchant_id;
      }
    }
    if (!merchantId && clinicId) {
      // Try to get merchant from clinic
      const clinic = await db.getClinicById(clinicId);
      if (clinic && clinic.merchant_id) {
        merchantId = clinic.merchant_id;
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
          console.log(`✅ Resolved merchant_id from explicit agent mapping: ${merchantId} (${mappedMerchant.name || 'unknown'}) for subdomain ${mappedSubdomain}`);
        }
      }
      
      // Method 1: Find merchant directly by agent_id (if merchants table has retell_agent_id column)
      if (!merchantId) {
        try {
          const merchantByAgent = db.db.prepare('SELECT id FROM merchants WHERE retell_agent_id = ? LIMIT 1').get(retellAgentId);
          if (merchantByAgent && merchantByAgent.id) {
            merchantId = merchantByAgent.id;
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
          const merchant = db.getMerchant(merchantId);
          console.log(`✅ Resolved merchant_id from customer agent_id: ${merchantId} (${merchant?.name || 'unknown'})`);
        }
      }
      
      // Method 3: Find clinic by agent_id (legacy clinics have agent_id)
      if (!merchantId) {
        const clinicWithAgent = db.db.prepare('SELECT merchant_id FROM clinics WHERE retell_agent_id = ? AND merchant_id IS NOT NULL LIMIT 1').get(retellAgentId);
        if (clinicWithAgent && clinicWithAgent.merchant_id) {
          merchantId = clinicWithAgent.merchant_id;
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
          console.log(`✅ Resolved merchant_id from default tenant (${defaultSubdomain}): ${merchantId} (${defaultMerchant.name || 'unknown'})`);
        } else {
          console.error(`❌ CRITICAL: Default tenant (${defaultSubdomain}) not found in database!`);
        }
      }
    }

    if (!merchantId) {
      console.warn(`⚠️  No merchant_id found for customer ${customerId || 'unknown'} / clinic ${clinicId || 'unknown'}. Voice product/order functions may not work.`);
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
            await db.logVoiceCall({
              id: `call-${callId}`,
              customer_id: customerId || clinicId, // Use customer_id if available, fallback to clinic_id
              call_id: callId,
              twilio_call_sid: req.body.CallSid, // Store Twilio CallSid for cost tracking
              call_duration_seconds: null, // Will update when call ends
              function_calls_count: 0,
              status: 'active'
            });
            console.log(`📝 Logged call to database for ${customerId ? 'customer' : 'clinic'}: ${customerId || clinicId}`);
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
      if (retellError.response) {
        console.error('   Status:', retellError.response.status);
        console.error('   Data:', JSON.stringify(retellError.response.data));
      } else if (retellError.request) {
        console.error('   No response received from Retell (request sent).');
      }
      // If Retell fails, return error TwiML immediately
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, we're experiencing technical difficulties. Please try again in a moment.</Say>
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
app.post('/voice/appointments/checkout', voiceLimiter, async (req, res) => {
  try {
    console.log('\n💳 VOICE: Create Appointment Checkout');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const args = req.body.args || req.body;
    let clinicId = resolveClinicIdFromRequest(req, args);

    // Calculate amount based on insurance coverage if available
    // Default: fixed price per appointment if no insurance info
    let amount = args.amount || 39.99; // Use provided amount or default

    // Build a minimal checkout record tied to the appointment
    const checkoutId = require('uuid').v4();

    // Ensure customer_phone is provided (required field)
    const customerPhone = args.customer_phone || args.patient_phone || '0000000000';

    // Try to find appointment by ID, phone, or email
    let appointmentId = args.appointment_id || null;
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
          if (!scopedClinic) {
            throw new Error('Missing clinic context for appointment lookup');
          }

          const searchResult = await BookingService.searchAppointments(searchTerm, scopedClinic);
          if (searchResult.success && searchResult.appointments && searchResult.appointments.length > 0) {
            // Get the most recent scheduled/confirmed appointment
            const recentAppt = searchResult.appointments
              .filter(a => ['scheduled', 'confirmed'].includes(a.status))
              .sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time))[0];
            if (recentAppt) {
              appointmentId = recentAppt.id;
              console.log(`📋 Linked checkout to appointment: ${appointmentId}`);
            }
          }
        } catch (searchError) {
          console.warn('⚠️  Could not find appointment for checkout:', searchError.message);
        }
      }
    }

    // If appointment_id is available, calculate patient responsibility based on insurance
    if (appointmentId && !args.amount) {
      try {
        const appointment = await db.getAppointment(appointmentId, clinicId || null);
        if (appointment && !clinicId) {
          clinicId = appointment.clinic_id || clinicId;
        }
        if (appointment && appointment.patient_id) {
          // Try to get latest eligibility for this patient
          const eligibilityChecks = db.db.prepare(`
            SELECT * FROM eligibility_checks 
            WHERE patient_id = ? 
            ORDER BY created_at DESC LIMIT 1
          `).all(appointment.patient_id);

          if (eligibilityChecks && eligibilityChecks.length > 0) {
            const latestEligibility = eligibilityChecks[0];
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

    // Resolve merchant_id from clinic_id or args
    let merchantId = args.merchant_id;
    if (!merchantId && clinicId) {
      const clinic = await db.getClinicById(clinicId);
      if (clinic && clinic.merchant_id) {
        merchantId = clinic.merchant_id;
      }
    }
    if (!merchantId && appointmentId) {
      // Try to get from appointment
      const appointment = await db.getAppointment(appointmentId);
      if (appointment && appointment.clinic_id) {
        const clinic = await db.getClinicById(appointment.clinic_id);
        if (clinic && clinic.merchant_id) {
          merchantId = clinic.merchant_id;
        }
      }
    }

    // If still no merchant_id, return error instead of creating default
    if (!merchantId) {
      console.error('❌ ERROR: Could not determine merchant_id for appointment booking');
      return {
        success: false,
        error: 'Merchant not found. Please ensure clinic is properly configured with a merchant.',
        appointment_id: null
      };
    }

    // Verify merchant exists
    const existingMerchant = db.getMerchant(merchantId);
    if (!existingMerchant) {
      console.error(`❌ ERROR: Merchant ${merchantId} not found in database`);
      return {
        success: false,
        error: `Merchant ${merchantId} not found. Please ensure merchant is configured.`,
        appointment_id: null
      };
    }

    if (!clinicId && appointmentId) {
      const appointmentRecord = await db.getAppointment(appointmentId);
      clinicId = appointmentRecord?.clinic_id || clinicId;
    }

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to create a voice checkout'
      });
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
      clinic_id: clinicId
    };

    // Store checkout
    await db.createVoiceCheckout(checkout);

    // Create Stripe card on-demand if patient has insurance and copay is due
    if (amount > 0 && appointmentId) {
      try {
        const appointment = await db.getAppointment(appointmentId, clinicId);
        if (appointment && appointment.patient_id) {
          const FHIRService = require('./services/fhir-service');
          // Check if this is a copay (amount matches copay from eligibility)
          const isCopay = eligibilityChecks && eligibilityChecks.length > 0 &&
            eligibilityChecks[0].copay_amount === amount;

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

    // Email the code
    let emailResult = { success: false };
    let billingEmailResult = { success: false };

    if (checkout.customer_email) {
      try {
        const EmailService = require('./services/email-service');

        // Send checkout verification code email
        emailResult = await EmailService.sendCheckoutVerificationCode(checkout.customer_email, verificationCode);

        // Send patient billing email
        if (appointmentId) {
          const appointment = await db.getAppointment(appointmentId, clinicId);
          if (appointment) {
            const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
            const paymentLink = `${baseUrl}/payment/${paymentToken}`;

            billingEmailResult = await EmailService.sendPatientBillingEmail(checkout.customer_email, {
              patientName: checkout.customer_name || appointment.patient_name,
              appointmentDate: appointment.date,
              serviceName: appointment.appointment_type || 'Therapy Session',
              totalAmount: amount + (amount * 0.1), // Total including insurance portion
              insuranceAmount: amount * 0.1, // Estimated insurance coverage
              copayAmount: amount,
              amountDue: amount,
              paymentLink: paymentLink
            });

            console.log(`📧 Patient billing email sent to: ${checkout.customer_email}`);
          }
        }
      } catch (emailError) {
        console.error('⚠️  Email service error:', emailError.message);
        emailResult = { success: false, error: emailError.message };
      }
    }

    return res.json({
      success: true,
      checkout_id: checkoutId,
      amount: amount,
      currency: 'USD',
      payment_token: paymentToken,
      requires_verification: true,
      email_sent: !!emailResult.success,
      billing_email_sent: !!billingEmailResult.success,
      message: emailResult.success ? 'Verification code emailed' : 'Verification code generated (email not sent)'
    });
  } catch (error) {
    console.error('❌ Error creating appointment checkout:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const args = req.body.args || req.body;
    const token = args.payment_token || args.token;
    const code = args.code || args.verification_code;

    if (!token || !code) {
      return res.status(400).json({ success: false, error: 'payment_token and code are required' });
    }

    const tokenRecord = db.getPaymentToken(token);
    if (!tokenRecord) {
      return res.status(404).json({ success: false, error: 'Invalid token' });
    }

    // Check expiration
    if (tokenRecord.verification_code_expires) {
      const now = new Date();
      const exp = new Date(tokenRecord.verification_code_expires);
      if (now > exp) {
        return res.status(400).json({ success: false, error: 'Verification code expired' });
      }
    }

    // Check code match
    if ((tokenRecord.verification_code || '').trim() !== String(code).trim()) {
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
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

    let emailResult = { success: false, error: 'Missing customer email' };
    if (checkout.customer_email) {
      try {
        const EmailService = require('./services/email-service');
        emailResult = await EmailService.sendPaymentLinkEmail(checkout.customer_email, paymentLink, {
          product_name: checkout.product_name,
          amount: checkout.amount,
          wallet_balance: walletInfo?.balance,
          can_pay_from_wallet: walletInfo?.sufficient_balance
        });
      } catch (emailError) {
        console.error('⚠️  Email service error:', emailError.message);
        emailResult = { success: false, error: emailError.message };
      }
    }

    // Mark token as verified
    db.updatePaymentToken(token, { status: 'verified' });

    return res.json({
      success: true,
      message: emailResult.success ? 'Payment link emailed successfully' : (emailResult.error || 'Email not sent'),
      payment_token: token,
      checkout_id: checkout.id,
      wallet: walletInfo // Include wallet info in response
    });
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
app.post('/voice/checkout/create', async (req, res) => {
  try {
    console.log('\n💳 VOICE: Creating Checkout via Orchestrator');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Raw Retell data:', JSON.stringify(req.body, null, 2));

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

    console.log('Extracted args:', JSON.stringify(args, null, 2));

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

// Payment page
app.get('/payment/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Get token and checkout
    const tokenRecord = db.getPaymentToken(token);
    if (!tokenRecord) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Not Found</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #e53e3e; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Payment Link Invalid</h1>
            <p>This payment link is invalid or has expired.</p>
          </div>
        </body>
        </html>
      `);
    }

    const checkout = await db.getVoiceCheckout(tokenRecord.checkout_id);
    if (!checkout) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Checkout Not Found</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #e53e3e; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Checkout Not Found</h1>
            <p>This checkout session could not be found.</p>
          </div>
        </body>
        </html>
      `);
    }

    if (checkout.status === 'completed') {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Already Paid</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            h1 { color: #48bb78; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Already Paid</h1>
            <p>This order has already been completed.</p>
            <p><strong>Order ID:</strong> ${checkout.id}</p>
          </div>
        </body>
        </html>
      `);
    }

    // Render payment page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Complete Payment</title>
        <script src="https://js.stripe.com/v3/"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
          .container { max-width: 500px; margin: 40px auto; }
          #payment-form { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
          .header { text-align: center; margin-bottom: 32px; }
          .header h1 { font-size: 28px; color: #2d3748; margin-bottom: 8px; }
          .header p { color: #718096; font-size: 14px; }
          .order-summary { background: #f7fafc; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
          .order-item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
          .order-item:last-child { border-bottom: none; }
          .order-label { color: #718096; font-size: 14px; }
          .order-value { color: #2d3748; font-weight: 600; }
          .order-value.total { color: #667eea; font-size: 20px; }
          #card-element { border: 2px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 8px; }
          #card-errors { color: #e53e3e; font-size: 14px; margin-bottom: 16px; min-height: 20px; }
          .btn { width: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 16px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.2s; }
          .btn:hover { transform: translateY(-2px); }
          .btn:disabled { opacity: 0.6; cursor: not-allowed; }
          .hidden { display: none; }
          .success-message { text-align: center; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
          .success-icon { font-size: 64px; margin-bottom: 16px; }
          .success-title { font-size: 24px; color: #48bb78; margin-bottom: 12px; }
          .success-text { color: #718096; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="container">
          <div id="payment-form">
            <div class="header">
              <h1>💳 Complete Payment</h1>
              <p>Secure checkout powered by Stripe</p>
            </div>

            <div class="order-summary">
              <div class="order-item">
                <span class="order-label">Product:</span>
                <span class="order-value">${checkout.product_name}</span>
              </div>
              <div class="order-item">
                <span class="order-label">Quantity:</span>
                <span class="order-value">${checkout.quantity}</span>
              </div>
              <div class="order-item">
                <span class="order-label">Customer:</span>
                <span class="order-value">${checkout.customer_name || 'Guest'}</span>
              </div>
              <div class="order-item">
                <span class="order-label">Total:</span>
                <span class="order-value total">$${checkout.amount.toFixed(2)}</span>
              </div>
            </div>

            <div id="card-element"></div>
            <div id="card-errors"></div>

            <button id="submit-button" class="btn">
              Pay $${checkout.amount.toFixed(2)}
            </button>

            <p style="text-align: center; color: #a0aec0; font-size: 12px; margin-top: 16px;">
              Test card: 4242 4242 4242 4242
            </p>
          </div>

          <div id="success-message" class="hidden">
            <div class="success-message">
              <div class="success-icon">✅</div>
              <h2 class="success-title">Payment Successful!</h2>
              <p class="success-text">
                Your order has been confirmed.<br>
                Order ID: <strong>${checkout.id}</strong>
              </p>
            </div>
          </div>
        </div>

        <script>
          const stripe = Stripe('${process.env.STRIPE_PUBLISHABLE_KEY}');
          const elements = stripe.elements();
          const cardElement = elements.create('card', {
            style: {
              base: {
                fontSize: '16px',
                color: '#2d3748',
                '::placeholder': {
                  color: '#a0aec0'
                }
              }
            }
          });

          cardElement.mount('#card-element');

          cardElement.on('change', (event) => {
            const displayError = document.getElementById('card-errors');
            if (event.error) {
              displayError.textContent = event.error.message;
            } else {
              displayError.textContent = '';
            }
          });

          const form = document.getElementById('payment-form');
          const submitButton = document.getElementById('submit-button');

          submitButton.addEventListener('click', async (e) => {
            e.preventDefault();
            submitButton.disabled = true;
            submitButton.textContent = 'Processing...';

            const { paymentMethod, error } = await stripe.createPaymentMethod({
              type: 'card',
              card: cardElement,
              billing_details: {
                name: '${checkout.customer_name || 'Guest'}',
                phone: '${checkout.customer_phone}',
                email: '${checkout.customer_email || ''}'
              }
            });

            if (error) {
              document.getElementById('card-errors').textContent = error.message;
              submitButton.disabled = false;
              submitButton.textContent = 'Pay $${checkout.amount.toFixed(2)}';
            } else {
              const response = await fetch('/process-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  payment_method_id: paymentMethod.id,
                  checkout_id: '${checkout.id}',
                  amount: ${checkout.amount}
                })
              });

              const result = await response.json();

              if (result.success) {
                document.getElementById('payment-form').classList.add('hidden');
                document.getElementById('success-message').classList.remove('hidden');
              } else {
                document.getElementById('card-errors').textContent = result.error || 'Payment failed';
                submitButton.disabled = false;
                submitButton.textContent = 'Pay $${checkout.amount.toFixed(2)}';
              }
            }
          });
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Error rendering payment page:', error);
    res.status(500).send('Error loading payment page');
  }
});

// Process payment
app.post('/process-payment', paymentLimiter, async (req, res) => {
  try {
    const { payment_method_id, checkout_id, amount, payment_method = 'stripe' } = req.body;

    console.log(`\n💳 Processing payment for checkout: ${checkout_id}`);
    console.log(`   Method: ${payment_method}`);
    console.log(`   Amount: $${amount}`);

    // Get checkout to check for linked appointment and patient
    const checkout = await db.getVoiceCheckout(checkout_id);
    if (!checkout) {
      throw new Error('Checkout not found');
    }

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
          return res.status(400).json({
            success: false,
            error: 'Patient not found. Cannot process wallet payment.'
          });
        }

        // Check if CircleService is available
        if (!CircleService || !CircleService.isAvailable()) {
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
          return res.status(400).json({
            success: false,
            error: 'Patient wallet not found. Please use a card payment instead.'
          });
        }

        // Check wallet balance
        const balanceResult = await CircleService.getWalletBalance(walletResult.account.circle_wallet_id);

        if (!balanceResult.success) {
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

        if (walletBalance < amount) {
          return res.status(400).json({
            success: false,
            error: `Insufficient wallet balance. Available: $${walletBalance.toFixed(2)}, Required: $${amount.toFixed(2)}`
          });
        }

        // Transfer from patient wallet to provider wallet
        // Get provider wallet (system wallet or merchant wallet)
        const providerWalletId = process.env.CIRCLE_PROVIDER_WALLET_ID || process.env.CIRCLE_SYSTEM_WALLET_ID;

        if (!providerWalletId) {
          return res.status(500).json({
            success: false,
            error: 'Provider wallet not configured. Cannot process wallet payment.'
          });
        }

        // Create transfer from patient to provider
        const transferResult = await CircleService.createTransfer({
          fromWalletId: walletResult.account.circle_wallet_id,
          toWalletId: providerWalletId,
          amount: amount,
          currency: 'USDC',
          claimId: checkout.appointment_id || checkout.id,
          description: `Payment for ${checkout.product_name || 'appointment'} - Checkout ${checkout_id}`
        });

        if (!transferResult.success) {
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
          amount,
          'USDC',
          transferResult.transferId || transferResult.id,
          'completed',
          new Date().toISOString(),
          new Date().toISOString()
        );

        console.log(`✅ Wallet payment successful: ${transferResult.transferId}`);
        console.log(`   From: ${walletResult.account.circle_wallet_id}`);
        console.log(`   To: ${providerWalletId}`);
        console.log(`   Amount: $${amount} USDC`);

        // Update checkout status
        await db.updateVoiceCheckout(checkout_id, {
          status: 'completed',
          payment_method: 'wallet',
          payment_intent_id: transferResult.transferId || transferResult.id
        });

        console.log(`✅ Checkout ${checkout_id} marked as completed`);

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

        return res.json({
          success: true,
          payment_method: 'wallet',
          transfer_id: transferResult.transferId || transferResult.id,
          checkout_id: checkout_id,
          appointment_confirmed: checkout.appointment_id ? true : false,
          wallet_balance_after: walletBalance - amount
        });

      } catch (walletError) {
        console.error('❌ Wallet payment error:', walletError);
        return res.status(500).json({
          success: false,
          error: walletError.message || 'Wallet payment failed'
        });
      }
    }

    // Handle Stripe payment (default)
    if (!payment_method_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required for card payments'
      });
    }

    // Create Stripe payment intent
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
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    });

    console.log(`✅ Stripe payment successful: ${paymentIntent.id}`);

    // Update checkout status
    await db.updateVoiceCheckout(checkout_id, {
      status: 'completed',
      payment_intent_id: paymentIntent.id
    });

    console.log(`✅ Checkout ${checkout_id} marked as completed`);

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
        // Don't fail the payment if confirmation fails
      }
    }

    res.json({
      success: true,
      payment_method: 'stripe',
      payment_intent_id: paymentIntent.id,
      checkout_id: checkout_id,
      appointment_confirmed: checkout.appointment_id ? true : false
    });

  } catch (error) {
    console.error('❌ Payment processing error:', error);
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

// Seed test patients endpoint (public for initial setup)
app.post('/api/admin/patients/seed-test', async (req, res) => {
  // Only allow in development/staging environments
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod') {
    return res.status(403).json({
      success: false,
      error: 'Test patient seeding is not allowed in production environment'
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
            '90834',
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

  const merchantId = createMerchantForClinic(clinic.name || clinic.clinic_id);
  db.updateClinic(clinic.clinic_id, { merchant_id: merchantId });
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

function resolveClinicIdFromRequest(req, args = {}) {
  const directClinicId =
    args?.clinic_id ||
    req.headers['x-clinic-id'] ||
    req.query?.clinic_id ||
    req.body?.clinic_id ||
    null;

  if (directClinicId) {
    return directClinicId;
  }

  if (FALLBACK_CLINIC_ID) {
    console.warn('⚠️  Using fallback clinic_id from DEFAULT_CLINIC_ID');
    return FALLBACK_CLINIC_ID;
  }

  return null;
}

const FALLBACK_CLINIC_ID = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || null;

// Schedule new appointment (for voice agent)
app.post('/voice/appointments/schedule', async (req, res) => {
  try {
    console.log('\n📅 VOICE: Schedule Appointment');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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
        // For legacy clinics, we might not have customer_id
        console.warn(`⚠️  No customer_id found for clinic ${clinicId}. Appointment will be created without tenant isolation.`);
      }
    }

    const appointmentData = {
      patient_name: args.patient_name,
      patient_phone: args.patient_phone,
      patient_email: args.patient_email,
      appointment_type: args.appointment_type || 'Mental Health Consultation',
      date: args.date,  // YYYY-MM-DD
      time: args.time,  // HH:MM or "2:00 PM"
      duration_minutes: args.duration_minutes || 50,
      provider: args.provider,
      notes: args.notes,
      timezone: args.timezone || 'America/New_York',
      clinic_id: clinicId,
      customer_id: customerId // Add customer_id for tenant isolation
    };

    const result = await BookingService.scheduleAppointment(appointmentData);

    res.json(result);
  } catch (error) {
    console.error('❌ Error scheduling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Confirm appointment (for voice agent)
app.post('/voice/appointments/confirm', async (req, res) => {
  try {
    console.log('\n✅ VOICE: Confirm Appointment');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const args = req.body.args || req.body;
    const appointmentId = args.appointment_id || args.confirmation_number;
    const newDate = args.new_date || args.date;
    const newTime = args.new_time || args.time;
    const reason = args.reason || null;
    const timezone = args.timezone || null;
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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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
app.post('/voice/appointments/available-slots', async (req, res) => {
  try {
    console.log('\n🕐 VOICE: Get Available Slots');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const args = req.body.args || req.body;
    const date = args.date;  // YYYY-MM-DD
    const provider = args.provider || null;
    const appointmentType = args.appointment_type || null;
    const timezone = args.timezone || null;
    const clinicId = resolveClinicIdFromRequest(req, args);
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required to check availability'
      });
    }

    const result = await BookingService.getAvailableSlots(date, provider, appointmentType, timezone, clinicId);

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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    const args = req.body.args || req.body;

    // Required: member_id
    if (!args.member_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: member_id'
      });
    }

    // Optional: patient_id to link insurance to patient
    const patientId = args.patient_id || args.patientId || null;
    const patientPhone = args.patient_phone || args.phone || null;
    const patientName = args.patient_name || args.customer_name || null;
    const patientEmail = args.patient_email || args.customer_email || null;

    // ==========================================
    // FRAUD DETECTION: Name Validation
    // ==========================================
    const callId = args.call_id || null;
    const initialName = args.initial_name || null;

    // Get initial name from retellHandler if call_id is provided but initial_name is not
    let storedInitialName = initialName;
    if (callId && !storedInitialName && retellHandler) {
      try {
        storedInitialName = retellHandler.getInitialName(callId);
      } catch (error) {
        console.warn('⚠️  Could not get initial name from call:', error.message);
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
      // No initial name stored yet - store it now (first time name is provided)
      if (retellHandler) {
        try {
          retellHandler.storeCustomerName(callId, patientName);
          console.log(`✅ Stored initial name from insurance collection: ${patientName}`);
        } catch (error) {
          console.warn('⚠️  Could not store initial name:', error.message);
        }
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
            duplicates: patientResult.duplicates || [],
            provided_name: patientResult.provided_name,
            provided_phone: patientResult.provided_phone,
            message: 'I found a patient with a similar name in our system. To verify your identity, please confirm your phone number. This helps ensure we have the correct patient record.',
            voice_agent_instruction: 'Ask the caller to confirm their phone number. If the phone number matches an existing patient, use that patient. If not, ask the caller to verify their information.'
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

        const eligibilityData = {
          patientId: finalPatientId, // Always include patient_id (may be null if no patient found)
          patientName: finalPatientName,
          dateOfBirth: dateOfBirth,
          memberId: args.member_id,
          payerId: payerId,
          serviceCode: args.service_code || '90834', // Default CPT code for therapy
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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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
    let serviceCode = args.service_code;
    let dateOfService = args.date_of_service;

    if (args.appointment_id) {
      const appointment = await db.getAppointment(args.appointment_id);
      if (appointment) {
        serviceCode = serviceCode || InsuranceService.mapAppointmentTypeToCPT(appointment.appointment_type);
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
      serviceCode: serviceCode || '90834', // Default CPT code
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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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

    const claimData = {
      appointmentId: args.appointment_id,
      patientId: patientId,
      patientName: patientName || appointment.patient_name,
      dateOfBirth: dateOfBirth || '1990-01-01',
      memberId: args.member_id,
      payerId: args.payer_id,
      serviceCode: args.service_code || InsuranceService.mapAppointmentTypeToCPT(appointment.appointment_type),
      diagnosisCode: args.diagnosis_code || InsuranceService.mapAppointmentTypeToICD10(appointment.appointment_type),
      totalAmount: parseFloat(args.total_amount),
      copayPaid: parseFloat(args.copay_paid || 0),
      dateOfService: args.date_of_service || appointment.date,
      blockchainProof: args.blockchain_proof || null,
      providerId: args.provider_id || null,
      npi: args.npi || null
    };

    const result = await InsuranceService.submitClaim(claimData);

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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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

    // Calculate totals
    const totalAmountBilled = cptCodes.reduce((sum, item) => sum + (parseFloat(item.charge || item.amount || item.billed_amount) || 0), 0);
    const totalAllowedAmount = cptCodes.reduce((sum, item) => sum + (parseFloat(item.allowed_amount) || 0), 0);

    // Create claim ID
    const claimId = `claim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Prepare claim data
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
          // Create a basic EOB with claim total
          eobCalculation.totals = eobCalculation.totals || {};
          eobCalculation.totals.amountBilled = claim.total_amount;
          eobCalculation.totals.allowedAmount = claimDetails.allowed_amount || claim.total_amount * 0.85;
          eobCalculation.totals.whatYouOwe = claim.total_amount;
        }
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
        circleTransfer
      },
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

    // Try to create Circle transfer if wallets exist (optional)
    let transferId = null;
    let circleTransferId = null;
    const providerAccount = db.getCircleAccountByEntity('provider', 'default');
    const insurerAccount = db.getCircleAccountByEntity('insurer', claim.payer_id);

    if (providerAccount && insurerAccount) {
      try {
        const CircleService = require('./services/circle-service');
        const transferResult = await CircleService.createTransfer({
          fromWalletId: insurerAccount.circle_wallet_id,
          toWalletId: providerAccount.circle_wallet_id,
          amount: paymentAmount,
          currency: 'USDC',
          claimId: claimId,
          description: `Payment for claim ${claimId}`
        });

        if (transferResult.success) {
          transferId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          circleTransferId = transferResult.transferId;

          db.createCircleTransfer({
            id: transferId,
            claim_id: claimId,
            from_wallet_id: insurerAccount.circle_wallet_id,
            to_wallet_id: providerAccount.circle_wallet_id,
            amount: paymentAmount,
            currency: 'USDC',
            circle_transfer_id: transferResult.transferId,
            status: transferResult.status || 'pending'
          });
          console.log(`💰 Circle transfer created: ${transferResult.transferId}`);
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

    res.json({
      success: true,
      claimId: claimId,
      transferId: circleTransferId,
      amount: paymentAmount,
      deductibleUsed: deductibleUsed,
      status: 'approved',
      paymentStatus: 'paid',
      message: 'Claim approved and payment processed'
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

// Metrics endpoint (basic observability)
app.get('/api/admin/metrics', async (req, res) => {
  try {
    return res.json({ success: true, metrics: Metrics.getAll() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
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
    const rows = db.getEligibilityChecksByPatient(patientId) || [];
    // Provide a compact view
    const elig = rows.map(r => ({
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
      member_id: r.member_id,
      service_code: r.service_code,
      created_at: r.created_at
    }));
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

// Dashboard: Get all appointments
app.get('/api/admin/appointments', async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      date: req.query.date,
      provider: req.query.provider
    };

    const appointments = db.getAllAppointments(filters);

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
    const appointments = db.getUpcomingAppointments(limit);

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

// Provider: Get all providers
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

// ============================================
// PATIENT PORTAL ENDPOINTS
// ============================================

// Patient: Send verification code
app.post('/api/patient/verify/send', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address required'
      });
    }

    const result = await PatientPortalService.sendVerificationCode(email);

    if (result.success) {
      res.json({
        success: true,
        session_id: result.session_id,
        message: result.message || 'Verification code sent to your email'
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error sending verification code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Verify code and login
app.post('/api/patient/verify/confirm', async (req, res) => {
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
      res.json({
        success: true,
        session_id: result.session_id,
        patient_id: result.patient_id,
        email: result.email
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error verifying code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Get my appointments (requires session)
app.get('/api/patient/appointments', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session ID required'
      });
    }

    const result = PatientPortalService.getPatientAppointments(sessionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('❌ Error getting patient appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Get benefits data (for patient dashboard)
app.get('/api/patient/benefits', async (req, res) => {
  try {
    const { patientName, patientPhone, patientId, memberId } = req.query;

    console.log('\n🏥 PATIENT BENEFITS: Fetching benefits data');
    console.log('   Query params:', { patientName, patientPhone, patientId, memberId });

    let patient = null;

    // Find patient by ID, phone, name, or member_id (insurance number)
    if (patientId) {
      console.log('   Searching by patient ID:', patientId);
      patient = db.getFHIRPatient(patientId);
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

// Patient: Reschedule appointment
app.put('/api/patient/appointments/:id/reschedule', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.body.session_id;
    const appointmentId = req.params.id;
    const { new_date, new_time } = req.body;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session ID required'
      });
    }

    // Validate session
    const session = PatientPortalService.validateSession(sessionId);
    if (!session.valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
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

    if (result.success) {
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

// Patient: Cancel appointment
app.delete('/api/patient/appointments/:id', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    const appointmentId = req.params.id;
    const { reason } = req.body;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session ID required'
      });
    }

    // Validate session
    const session = PatientPortalService.validateSession(sessionId);
    if (!session.valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    const clinicId = appointment.clinic_id || null;

    // Use existing cancel endpoint logic
    const result = await BookingService.cancelAppointment(appointmentId, reason, clinicId);

    if (result.success) {
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
app.get('/api/patient/profile', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || req.query.session_id;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session ID required'
      });
    }

    const result = PatientPortalService.getPatientProfile(sessionId);

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

// Dashboard: Billing summary by patient (derived from appointments)
app.get('/api/admin/billing', async (req, res) => {
  try {
    const PRICE_PER_APPOINTMENT = 39.99; // cash price per appointment

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

      // Every appointment is billed as cash at the fixed price
      record.total_amount = Number((record.total_appointments * PRICE_PER_APPOINTMENT).toFixed(2));
      record.week_amount = Number((record.week_appointments * PRICE_PER_APPOINTMENT).toFixed(2));

      if (!record.last_appointment_at || (apptDate && apptDate > new Date(record.last_appointment_at))) {
        record.last_appointment_at = apptDate ? apptDate.toISOString() : record.last_appointment_at;
      }
    });

    const results = Array.from(byPatient.values()).sort((a, b) => (b.last_appointment_at || '').localeCompare(a.last_appointment_at || ''));

    res.json({
      success: true,
      price_per_appointment: PRICE_PER_APPOINTMENT,
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
    console.log('🔍 Request Headers:');
    console.log(JSON.stringify(req.headers, null, 2));
    console.log('\n🔍 Request Body:');
    console.log(JSON.stringify(req.body, null, 2));
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
          const durationSeconds = body.duration_seconds || body.call?.duration_seconds || null;

          // Update voice call log (for customer calls)
          const existingCall = db.prepare('SELECT * FROM voice_call_log WHERE call_id = ?').get(callId);
          if (existingCall) {
            // Get function call count for this call
            const functionCalls = db.prepare('SELECT COUNT(*) as count FROM function_call_log WHERE call_id = ?').get(callId);
            const functionCallCount = functionCalls ? functionCalls.count : 0;

            // Update call log
            db.prepare(`
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
          const leadCall = db.prepare('SELECT * FROM lead_calls WHERE call_id = ?').get(callId);
          if (leadCall) {
            const callCost = durationSeconds ? (durationSeconds / 60) * 0.05 : null;

            db.prepare(`
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

// Retell end-of-call webhook
app.post('/webhook/retell/end-of-call', async (req, res) => {
  try {
    console.log('\n📞 ========================================');
    console.log('📞 RETELL: End of call webhook');
    console.log('📞 ========================================');
    console.log('Webhook body:', JSON.stringify(req.body, null, 2));
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

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('❌ Error processing Stripe webhook:', error);
    console.error('   Event type:', event?.type);
    console.error('   Payment Intent:', event?.data?.object?.id);
    console.error('   Stack:', error.stack);

    // CRITICAL: Always return 200 to Stripe to prevent retries
    // We log errors for manual review instead of retrying
    // This prevents infinite retry loops if there's a persistent issue
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
    console.log('Query params:', JSON.stringify(req.query, null, 2));
    console.log('Full URL:', req.url);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));

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
        stripe: `${baseUrl}/webhook/stripe`
      }
    },
    documentation: `${baseUrl}/docs`,
    signup: `${baseUrl}/`
  });
});

// ============================================
// ERROR HANDLERS
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
app.get('/api/patient/cards/:cardId', async (req, res) => {
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
    console.log('Request body:', JSON.stringify(req.body, null, 2));

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
  console.log(`   POST   http://localhost:${PORT}/webhook/stripe`);
  console.log('\n🏥 Health:');
  console.log(`   GET    http://localhost:${PORT}/health`);
  console.log('\n' + '='.repeat(60));
  console.log('✅ Ready to accept requests!');
  console.log('='.repeat(60) + '\n');

  // Start reminder scheduler (with error handling)
  try {
    ReminderScheduler.start();
    ReminderScheduler.startScheduledActivities(); // Start email follow-up scheduler
  } catch (error) {
    console.error('⚠️  Failed to start reminder scheduler:', error.message);
    console.log('   Reminders will be disabled, but server will continue');
  }

  // Start EHR sync service (with error handling)
  try {
    EHRSyncService.start();
  } catch (error) {
    console.error('⚠️  Failed to start EHR sync service:', error.message);
    console.log('   EHR sync will be disabled, but server will continue');
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
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === '/webhook/retell/llm') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  console.log('✅ Server closed');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  console.log('✅ Server closed');
  process.exit(0);
});

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