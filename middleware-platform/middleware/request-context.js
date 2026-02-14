/**
 * Request Context & Correlation ID (Section 1 - Observability)
 *
 * Generates x-request-id per request; attaches to req.id.
 * Use in structured logs for traceability.
 */

const crypto = require('crypto');

function correlationIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  req.id = incoming || crypto.randomBytes(16).toString('hex');
  res.setHeader('x-request-id', req.id);
  next();
}

module.exports = { correlationIdMiddleware };
