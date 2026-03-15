const crypto = require('crypto');
const db = require('../database');

const COOKIE_NAME = 'admin_session';
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

function handleAdminLogin(req, res) {
  const adminSecret = process.env.ADMIN_PORTAL_SECRET;
  if (!adminSecret) {
    return res.status(500).json({
      success: false,
      error: 'ADMIN_PORTAL_SECRET is not configured on the server'
    });
  }

  const providedSecret = req.body?.secret;

  if (!providedSecret || providedSecret !== adminSecret) {
    return res.status(401).json({
      success: false,
      error: 'Invalid admin credentials'
    });
  }

  const session = createSessionRecord(req);
  
  // SECURITY: Always use secure cookies if HTTPS is detected or in production
  // Check if request is over HTTPS (either directly or via proxy)
  const isSecure = req.secure || 
                   req.headers['x-forwarded-proto'] === 'https' ||
                   process.env.NODE_ENV === 'production' ||
                   process.env.NODE_ENV === 'prod';
  
  res.cookie(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure, // Use secure cookies when HTTPS is detected
    maxAge: SESSION_TTL_MS,
    path: '/'
  });

  res.json({
    success: true,
    session: {
      expires_at: session.expires_at
    }
  });
}

function handleAdminLogout(req, res) {
  const token = getTokenFromRequest(req);
  destroySessionToken(token);
  
  // SECURITY: Always use secure cookies if HTTPS is detected or in production
  const isSecure = req.secure || 
                   req.headers['x-forwarded-proto'] === 'https' ||
                   process.env.NODE_ENV === 'production' ||
                   process.env.NODE_ENV === 'prod';
  
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure,
    expires: new Date(0),
    path: '/'
  });
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

module.exports = {
  requireAdminAuth,
  handleAdminLogin,
  handleAdminLogout,
  adminSessionStatus,
  hasValidSession
};

