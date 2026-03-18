/**
 * Telemedicine Phase 1 — Task 6: JWT auth middleware for FHIR endpoints.
 * Verifies Bearer JWT and attaches req.user = { sub, scope, clinic_id }.
 * Enable with REQUIRE_JWT_FOR_FHIR=1 and JWT_SECRET set; when disabled, all FHIR routes remain open for existing callers.
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const REQUIRE_JWT_FOR_FHIR = process.env.REQUIRE_JWT_FOR_FHIR === '1' || process.env.REQUIRE_JWT_FOR_FHIR === 'true';

function jwtFhirAuth(req, res, next) {
  if (!REQUIRE_JWT_FOR_FHIR || !JWT_SECRET) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'login', diagnostics: 'Missing or invalid Authorization header. JWT required for FHIR access.' }]
    });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      sub: decoded.sub,
      scope: decoded.scope,
      clinic_id: decoded.clinic_id,
      scopes: decoded.scopes || decoded.scope_list || decoded.scp || null,
      exp: decoded.exp
    };
    return next();
  } catch (err) {
    return res.status(401).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'login', diagnostics: err.message || 'Invalid or expired token.' }]
    });
  }
}

module.exports = { jwtFhirAuth, REQUIRE_JWT_FOR_FHIR, JWT_SECRET };
