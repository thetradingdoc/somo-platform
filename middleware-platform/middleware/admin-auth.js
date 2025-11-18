const crypto = require('crypto');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = parseInt(process.env.ADMIN_SESSION_TTL_MS || '3600000', 10);
const sessions = new Map();
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
  sessions.set(token, record);
  return record;
}

function validateSessionToken(token) {
  if (!token) return null;
  const record = sessions.get(token);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return record;
}

function destroySessionToken(token) {
  if (token) {
    sessions.delete(token);
  }
}

function requireAdminAuth(req, res, next) {
  const adminSecret = process.env.ADMIN_PORTAL_SECRET;
  if (!adminSecret) {
    if (!warnedAboutMissingSecret) {
      console.warn('⚠️ ADMIN_PORTAL_SECRET not set. Admin endpoints are unprotected.');
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
  res.cookie(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
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
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
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

