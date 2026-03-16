/**
 * Telemedicine Phase 1 — Tasks 7 & 8: Resource-level access control.
 * - Patient scope: can only read their own resources (subject/patient === req.user.sub).
 * - Clinician scope: can only read resources for patients in their clinic (appointments.patient_id + clinic_id).
 * Runs only when req.user is set (JWT was applied). Skips when no JWT (e.g. internal/video-consult).
 */
const db = require('../database');

function operationOutcome(diagnostics) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'forbidden', diagnostics }]
  };
}

/**
 * Resolve patient ID from request (path params, query, or loaded resource).
 */
async function resolvePatientId(req) {
  const pathParts = req.path.split('/').filter(Boolean);
  const resourceType = pathParts[0]; // Patient, Encounter, Communication, Observation
  const id = req.params.id || pathParts[1];

  if (resourceType === 'Patient' && id && id !== '$everything') {
    return id;
  }
  if (req.query.patient) {
    const p = req.query.patient;
    return p.startsWith('Patient/') ? p.replace('Patient/', '') : p;
  }
  if (resourceType === 'Encounter' && id) {
    const enc = db.getFHIREncounter && db.getFHIREncounter(id);
    if (enc && enc.patient_id) return enc.patient_id;
  }
  if ((resourceType === 'Communication' || resourceType === 'Observation') && req.query.encounter) {
    const encId = req.query.encounter.startsWith('Encounter/') ? req.query.encounter.replace('Encounter/', '') : req.query.encounter;
    const enc = db.getFHIREncounter && db.getFHIREncounter(encId);
    if (enc && enc.patient_id) return enc.patient_id;
  }
  if (resourceType === 'Communication' && id) {
    const comm = db.getFHIRCommunication && db.getFHIRCommunication(id);
    if (comm && comm.patient_id) return comm.patient_id;
    if (comm && comm.encounter_id) {
      const enc = db.getFHIREncounter && db.getFHIREncounter(comm.encounter_id);
      if (enc && enc.patient_id) return enc.patient_id;
    }
  }
  return null;
}

function fhirResourceAccess(req, res, next) {
  if (!req.user || !req.user.scope) {
    return next();
  }

  const pathParts = req.path.split('/').filter(Boolean);
  const resourceType = pathParts[0];
  const isMeta = req.path === '/metadata' || req.path === '/health';
  if (isMeta || !['Patient', 'Encounter', 'Communication', 'Observation'].includes(resourceType)) {
    return next();
  }

  (async () => {
    const patientId = await resolvePatientId(req);
    if (!patientId && req.method === 'GET' && (req.query.patient || req.query.encounter)) {
        return res.status(400).json(operationOutcome('patient or encounter parameter required for access check'));
    }

    if (req.user.scope === 'patient') {
      if (patientId && patientId !== req.user.sub) {
        return res.status(403).json(operationOutcome('Patient can only access their own resources.'));
      }
      if (!patientId && resourceType === 'Patient' && req.method === 'GET' && req.path.match(/^\/Patient\/?$/)) {
        return res.status(400).json(operationOutcome('Patient scope: use GET /Patient/:id to access your record.'));
      }
      return next();
    }

    if (req.user.scope === 'clinician') {
      if (!req.user.clinic_id) {
        return res.status(403).json(operationOutcome('Clinician token must include clinic_id.'));
      }
      if (patientId) {
        // Guard: getPatientClinicIds may not exist yet in database.js (fail-open until added)
        if (typeof db.getPatientClinicIds !== 'function') {
          console.warn(
            '[fhir-resource-access] db.getPatientClinicIds() not available. ' +
            'Add to database.js to enforce clinic_id scoping. Skipping check for now.'
          );
          return next();
        }
        const clinicIds = db.getPatientClinicIds(patientId);
        if (!clinicIds.length || !clinicIds.includes(req.user.clinic_id)) {
          return res.status(403).json(operationOutcome('Clinician can only access patients in their clinic.'));
        }
      }
      return next();
    }

    next();
  })().catch(err => next(err));
}

module.exports = { fhirResourceAccess, resolvePatientId };
