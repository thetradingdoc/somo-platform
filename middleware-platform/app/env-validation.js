'use strict';

/**
 * Production env gates extracted from server.js (Phase 4).
 */
function validateProductionEnv() {
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  if (!isProd) return;

  const requireJwtForFhir = process.env.REQUIRE_JWT_FOR_FHIR === '1' || process.env.REQUIRE_JWT_FOR_FHIR === 'true';
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!requireJwtForFhir) {
    console.error('❌ REQUIRE_JWT_FOR_FHIR must be set to "1" in production. Refusing to start.');
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

module.exports = { validateProductionEnv };
