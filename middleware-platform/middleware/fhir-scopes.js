/**
 * SMART-style scope enforcement for FHIR routes.
 *
 * Tokens may contain:
 * - req.user.scope: 'patient' | 'clinician' | 'system'
 * - req.user.scopes: string[]  (preferred)
 *
 * We enforce the minimum required scope per resource+verb.
 */
function normalizeScopes(req) {
  const raw = req.user?.scopes;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  return [];
}

function hasAnyScope(have, need) {
  const set = new Set(have);
  for (const n of need) {
    if (set.has(n)) return true;
    // wildcard patterns
    if (n.endsWith('/*.*')) {
      const prefix = n.slice(0, -4); // keep trailing /
      for (const s of set) {
        if (s.startsWith(prefix)) return true;
      }
    }
    if (n.endsWith('/*')) {
      const prefix = n.slice(0, -1);
      for (const s of set) {
        if (s.startsWith(prefix)) return true;
      }
    }
  }
  return false;
}

function operationOutcome(code, diagnostics) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: code || 'forbidden', diagnostics }]
  };
}

function requiredScopesFor(req) {
  const pathParts = (req.path || '').split('/').filter(Boolean);
  const resourceType = pathParts[0] || '';
  const isMeta = req.path === '/metadata' || req.path === '/health';
  if (isMeta) return [];
  if (resourceType === '$export') return ['system/*.*'];
  if (resourceType === '$validate') return ['user/*.*', 'patient/*.*'];

  const method = (req.method || 'GET').toUpperCase();
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  // Default policy: patients can only read their compartment; clinicians can read per-clinic.
  // Writes require elevated scope (clinician/system) unless explicitly allowed.
  const readNeeds = {
    Patient: ['patient/Patient.read', 'user/*.*'],
    Encounter: ['patient/Encounter.read', 'user/*.*'],
    Appointment: ['patient/Appointment.read', 'user/*.*'],
    DocumentReference: ['patient/DocumentReference.read', 'user/*.*'],
    DiagnosticReport: ['patient/DiagnosticReport.read', 'user/*.*'],
    Binary: ['patient/Binary.read', 'user/*.*'],
    Provenance: ['patient/Provenance.read', 'user/*.*'],
    Consent: ['patient/Consent.read', 'user/*.*']
  };

  const writeNeeds = {
    Patient: ['user/*.*'],
    Encounter: ['user/*.*'],
    Appointment: ['user/*.*'],
    DocumentReference: ['user/*.*'],
    DiagnosticReport: ['user/*.*'],
    Binary: ['user/*.*'],
    Provenance: ['user/*.*'],
    Consent: ['user/*.*']
  };

  const needs = write ? (writeNeeds[resourceType] || ['user/*.*']) : (readNeeds[resourceType] || []);
  return needs;
}

function fhirScopeEnforcer(req, res, next) {
  if (!req.user) return next();
  const needs = requiredScopesFor(req);
  if (!needs.length) return next();
  const have = normalizeScopes(req);
  // Back-compat: if no granular scopes are present, allow through (existing deployments),
  // and rely on compartment middleware to prevent cross-patient access.
  if (!have.length) return next();
  if (hasAnyScope(have, needs)) return next();
  return res.status(403).json(operationOutcome('forbidden', `Missing required scope for ${req.method} ${req.path}`));
}

module.exports = { fhirScopeEnforcer };

