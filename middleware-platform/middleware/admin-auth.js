const crypto = require('crypto');
const db = require('../database');
const EmailService = require('../services/email-service');
const { isOperatorCustomer } = require('../services/customer-capabilities');
const { getSessionCookieOptions } = require('../routes/lib/signup-shared');

const COOKIE_NAME = 'admin_session';
const ADMIN_CODE_PREFIX = 'admin:';
const SESSION_TTL_MS = parseInt(process.env.ADMIN_SESSION_TTL_MS || '3600000', 10);
let warnedAboutMissingSecret = false;

function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, chunk) => {
    const [key, value] = chunk.split('=');
    if (key && value) {
      acc[key.trim()] = decodeURIComponent(value.trim());
    }
    return acc;
  }, {});
}

function getTokenFromRequest(req) {
  const headerToken = req.headers['x-admin-session'] || req.headers['x-admin-token'];
  if (headerToken) return headerToken;
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME];
}

function createSessionRecord(req) {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const record = {
    id: token,
    issued_at: new Date().toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    ip: req.ip,
    user_agent: req.headers['user-agent'] || 'unknown',
    expiresAt
  };
  // Persist session so it survives restarts (Azure)
  db.createAdminSession({
    id: record.id,
    issued_at: record.issued_at,
    expires_at: record.expires_at,
    ip: record.ip,
    user_agent: record.user_agent,
    last_seen_at: record.issued_at
  });
  return record;
}

function validateSessionToken(token) {
  if (!token) return null;
  // Cleanup expired sessions opportunistically
  try { db.deleteExpiredAdminSessions(); } catch (_) {}

  const record = db.getAdminSession(token);
  if (!record) return null;
  const expiresAt = new Date(record.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    db.deleteAdminSession(token);
    return null;
  }
  // Touch last seen for basic auditability
  try { db.touchAdminSession(token); } catch (_) {}
  return {
    ...record,
    expiresAt: expiresAt
  };
}

function destroySessionToken(token) {
  if (token) {
    db.deleteAdminSession(token);
  }
}

function requireAdminAuth(req, res, next) {
  const adminSecret = process.env.ADMIN_PORTAL_SECRET;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  
  // SECURITY: In production, admin secret is REQUIRED
  if (!adminSecret) {
    if (isProduction) {
      console.error('❌ SECURITY ERROR: ADMIN_PORTAL_SECRET is required in production');
      return res.status(500).json({
        success: false,
        error: 'Admin authentication is not configured. Server misconfiguration.'
      });
    }
    // Development: warn but allow (for local testing only)
    if (!warnedAboutMissingSecret) {
      console.warn('⚠️ ADMIN_PORTAL_SECRET not set. Admin endpoints are unprotected (DEVELOPMENT ONLY).');
      warnedAboutMissingSecret = true;
    }
    return next();
  }

  const token = getTokenFromRequest(req);
  const session = validateSessionToken(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required'
    });
  }

  req.adminSession = session;
  next();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function adminCodeEmail(email) {
  return `${ADMIN_CODE_PREFIX}${normalizeEmail(email)}`;
}

function getOwnerEmail() {
  return normalizeEmail(process.env.SOMO_OWNER_EMAIL || 'richard@callsomo.com');
}

async function verifyOperatorPassword(email, password) {
  const normalized = normalizeEmail(email);
  const ownerEmail = getOwnerEmail();
  if (!normalized || normalized !== ownerEmail) {
    return { ok: false, status: 401, error: 'Invalid email or password' };
  }

  const customer = db.getCustomerByEmail(normalized);
  if (!customer || !isOperatorCustomer(customer)) {
    return { ok: false, status: 401, error: 'Invalid email or password' };
  }
  if (!customer.password_hash) {
    return { ok: false, status: 403, error: 'Password not set', message: 'Admin password is not configured. Run setup-richard-admin.cjs.' };
  }
  if (!customer.email_verified) {
    return { ok: false, status: 403, error: 'Email not verified' };
  }
  if ((customer.status || 'active').toLowerCase() !== 'active') {
    return { ok: false, status: 403, error: 'Account suspended' };
  }

  let bcrypt;
  try {
    bcrypt = require('bcryptjs');
  } catch (_) {
    return { ok: false, status: 500, error: 'Password verification unavailable' };
  }

  const passwordMatch = await bcrypt.compare(String(password || ''), customer.password_hash);
  if (!passwordMatch) {
    return { ok: false, status: 401, error: 'Invalid email or password' };
  }

  return { ok: true, customer };
}

function issueAdminSession(req, res) {
  const session = createSessionRecord(req);
  const cookieOptions = {
    ...getSessionCookieOptions(req, SESSION_TTL_MS),
    path: '/'
  };

  res.cookie(COOKIE_NAME, session.id, cookieOptions);

  return res.json({
    success: true,
    session: {
      expires_at: session.expires_at
    }
  });
}

async function handleAdminLoginRequestCode(req, res) {
  try {
    const { email, password } = req.body || {};
    const auth = await verifyOperatorPassword(email, password);
    if (!auth.ok) {
      return res.status(auth.status).json({
        success: false,
        error: auth.error,
        message: auth.message
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    db.createEmailVerificationCode(adminCodeEmail(email), code, auth.customer.id);

    const emailResult = await EmailService.sendAdminLoginCode(email, code, auth.customer.name);
    if (!emailResult?.success) {
      console.error('❌ Failed to send admin login code:', emailResult?.error || 'unknown');
      return res.status(503).json({
        success: false,
        error: 'email_delivery_failed',
        message: 'Could not send admin verification code. Try again shortly.'
      });
    }

    return res.json({
      success: true,
      step: 'verify_code',
      message: 'Verification code sent to your email',
      email: normalizeEmail(email)
    });
  } catch (error) {
    console.error('❌ Admin login request-code error:', error);
    return res.status(500).json({ success: false, error: 'Failed to start admin login' });
  }
}

async function handleAdminLoginVerify(req, res) {
  try {
    const { email, password, code } = req.body || {};
    if (!email || !password || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and verification code are required'
      });
    }

    const auth = await verifyOperatorPassword(email, password);
    if (!auth.ok) {
      return res.status(auth.status).json({
        success: false,
        error: auth.error,
        message: auth.message
      });
    }

    const verification = db.verifyEmailCode(adminCodeEmail(email), String(code).trim());
    if (!verification) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired verification code'
      });
    }

    return issueAdminSession(req, res);
  } catch (error) {
    console.error('❌ Admin login verify error:', error);
    return res.status(500).json({ success: false, error: 'Failed to verify admin login' });
  }
}

function handleAdminLogin(req, res) {
  const { email, password, code, secret } = req.body || {};

  if (email && password) {
    // `code` omitted on request-code step; present (even empty) on verify step.
    const onVerifyStep = Object.prototype.hasOwnProperty.call(req.body || {}, 'code');
    if (onVerifyStep) {
      if (!String(code || '').trim()) {
        return res.status(400).json({
          success: false,
          error: 'Verification code is required'
        });
      }
      return handleAdminLoginVerify(req, res);
    }
    return handleAdminLoginRequestCode(req, res);
  }

  const adminSecret = process.env.ADMIN_PORTAL_SECRET;
  if (!adminSecret) {
    return res.status(500).json({
      success: false,
      error: 'ADMIN_PORTAL_SECRET is not configured on the server'
    });
  }

  if (!secret || secret !== adminSecret) {
    return res.status(401).json({
      success: false,
      error: 'Invalid admin credentials'
    });
  }

  return issueAdminSession(req, res);
}

function handleAdminLogout(req, res) {
  const token = getTokenFromRequest(req);
  destroySessionToken(token);

  const cookieOptions = {
    ...getSessionCookieOptions(req, 0),
    path: '/',
    expires: new Date(0)
  };
  delete cookieOptions.maxAge;

  res.cookie(COOKIE_NAME, '', cookieOptions);
  res.json({ success: true });
}

function adminSessionStatus(req, res) {
  const token = getTokenFromRequest(req);
  const session = validateSessionToken(token);
  if (!session) {
    return res.status(401).json({ success: false, authenticated: false });
  }
  res.json({
    success: true,
    authenticated: true,
    session: {
      issued_at: session.issued_at,
      expires_at: session.expires_at
    }
  });
}

function hasValidSession(req) {
  const token = getTokenFromRequest(req);
  return !!validateSessionToken(token);
}

/**
 * Accept admin portal session OR customer session with a platform capability.
 */
function requireAdminOrCapability(capability) {
  return (req, res, next) => {
    const adminSecret = process.env.ADMIN_PORTAL_SECRET;
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';

    // Development: when admin secret is not configured, allow access (matches requireAdminAuth)
    if (!adminSecret && !isProduction) {
      req.adminAuthenticated = true;
      return next();
    }

    const token = getTokenFromRequest(req);
    const adminSession = validateSessionToken(token);
    if (adminSession) {
      req.adminSession = adminSession;
      req.adminAuthenticated = true;
      return next();
    }

    const sessionId = req.cookies?.customer_session;
    if (sessionId) {
      const custSession = db.getCustomerSession(sessionId);
      if (custSession) {
        const customer = db.getCustomer(custSession.customer_id);
        if (customer) {
          const { hasCapability } = require('../services/customer-capabilities');
          if (hasCapability(customer, capability)) {
            req.customer = customer;
            return next();
          }
        }
      }
    }

    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: `Admin session or capability ${capability} required`
    });
  };
}

module.exports = {
  requireAdminAuth,
  requireAdminOrCapability,
  handleAdminLogin,
  handleAdminLoginRequestCode,
  handleAdminLoginVerify,
  handleAdminLogout,
  adminSessionStatus,
  hasValidSession
};

