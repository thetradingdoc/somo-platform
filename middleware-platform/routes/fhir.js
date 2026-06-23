/**
 * FHIR API Routes - Somo Telehealth Platform
 *
 * RESTful FHIR R4 compliant API endpoints
 * Implements standard FHIR operations: Create, Read, Update, Search
 */

const express = require('express');
const router = express.Router();
const FHIRService = require('../services/shared/fhir-service');
const FHIRAdapter = require('../adapters/fhir-adapter');
const db = require('../database');
const { jwtFhirAuth } = require('../middleware/jwt-fhir-auth');
const { fhirResourceAccess } = require('../middleware/fhir-resource-access');
const { fhirScopeEnforcer } = require('../middleware/fhir-scopes');
const FHIRResources = require('../models/fhir-resources');

/**
 * Middleware to log FHIR API requests (avoid noisy PHI logs in prod)
 */
router.use((req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  if (!isProd && (process.env.LOG_LEVEL || '').toLowerCase() !== 'warn') {
    console.log(`[FHIR API] ${req.method} ${req.path}`);
  }
  next();
});

/**
 * Telemedicine Phase 1 — Task 13: Compliance audit_log (table from task 5) for every FHIR read/write/delete.
 */
router.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path === '/metadata' || req.path === '/health') return;
    const pathParts = req.path.split('/').filter(Boolean);
    const resourceType = pathParts[0];
    if (!['Patient', 'Encounter', 'Communication', 'Observation', 'DiagnosticReport', 'DocumentReference', 'Binary'].includes(resourceType)) return;
    const action = { GET: 'READ', POST: 'CREATE', PUT: 'UPDATE', DELETE: 'DELETE' }[req.method] || req.method;
    const resourceId = req.params.id || (pathParts[1] && pathParts[1] !== '$everything' ? pathParts[1] : null);
    const actorId = req.user?.sub || 'system';
    const actorType = req.user?.scope === 'patient' ? 'patient' : req.user?.scope === 'clinician' ? 'clinician' : 'system';
    try {
      db.auditLog(actorType, actorId, action, resourceType, resourceId, req.ip, req.get('User-Agent'), String(res.statusCode));
    } catch (e) {
      console.warn('[FHIR] compliance audit log failed:', e.message);
    }
  });
  next();
});

/**
 * Middleware to set FHIR-compliant response headers
 */
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/fhir+json');
  next();
});

// Telemedicine Phase 1 — Tasks 6–8: JWT auth + resource-level access control.
router.use(jwtFhirAuth);
router.use(fhirScopeEnforcer);
router.use(fhirResourceAccess);

// ==========================================
// PATIENT ENDPOINTS
// ==========================================

// ==========================================
// $validate (FHIR validation hook)
// ==========================================

router.post('/$validate', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const resource = req.body;
    if (!resource || !resource.resourceType) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Body must be a FHIR resource with resourceType' }]
      });
    }
    const result = FHIRResources.validate(resource);
    if (result.valid) {
      return res.status(200).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'information', code: 'informational', diagnostics: 'Resource is valid' }]
      });
    }
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: (result.errors || []).map(e => ({
        severity: 'error',
        code: 'invalid',
        diagnostics: String(e)
      }))
    });
  } catch (error) {
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

/**
 * POST /fhir/Patient
 * Create a new patient
 */
router.post('/Patient', async (req, res) => {
  try {
    const patientResult = await FHIRService.getOrCreatePatient(req.body, true);

    // Check if duplicate was detected
    if (patientResult.duplicate && patientResult.requiresPhoneConfirmation) {
      return res.status(409).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'duplicate',
          diagnostics: patientResult.message || 'Duplicate patient found. Phone number confirmation required.'
        }],
        duplicate: true,
        requiresPhoneConfirmation: true,
        duplicates: patientResult.duplicates || [],
        provided_name: patientResult.provided_name,
        provided_phone: patientResult.provided_phone
      });
    }

    // Patient was found or created successfully
    const patient = patientResult.patient;
    if (!patient) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'invalid',
          diagnostics: 'Failed to create or find patient'
        }]
      });
    }

    res.status(201).json(patient);
  } catch (error) {
    console.error('[FHIR API] Error creating patient:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Patient/:id
 * Get patient by ID
 */
router.get('/Patient/:id', async (req, res) => {
  try {
    const patient = await FHIRService.getPatient(req.params.id);

    res.json(patient);
  } catch (error) {
    console.error('[FHIR API] Error getting patient:', error);
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Patient
 * Search patients
 * Query params: name, phone, email, _count
 */
router.get('/Patient', async (req, res) => {
  try {
    const searchParams = FHIRAdapter.parseSearchParams(req.query);
    if (req.user && req.user.scope === 'clinician' && req.user.clinic_id) {
      searchParams.clinic_id = req.user.clinic_id;
    }
    const patients = await FHIRService.searchPatients(searchParams);

    const count = Math.max(1, Math.min(parseInt(req.query._count || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(req.query._getpagesoffset || req.query._offset || '0', 10) || 0);
    const page = patients.slice(offset, offset + count);
    const bundle = FHIRAdapter.createBundle(page, 'searchset');
    bundle.total = patients.length;
    res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error searching patients:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Patient/:id/$everything
 * Get all resources for a patient
 */
router.get('/Patient/:id/$everything', async (req, res) => {
  try {
    const bundle = await FHIRService.getPatientEverything(req.params.id);

    res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error getting patient everything:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

// ==========================================
// ENCOUNTER ENDPOINTS
// ==========================================

/**
 * POST /fhir/Encounter
 * Create a new encounter
 */
router.post('/Encounter', async (req, res) => {
  try {
    const encounter = await FHIRService.createEncounter(req.body);

    res.status(201).json(encounter);
  } catch (error) {
    console.error('[FHIR API] Error creating encounter:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Encounter/:id
 * Get encounter by ID
 */
router.get('/Encounter/:id', async (req, res) => {
  try {
    const encounter = await FHIRService.getEncounter(req.params.id);

    res.json(encounter);
  } catch (error) {
    console.error('[FHIR API] Error getting encounter:', error);
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * PUT /fhir/Encounter/:id
 * Update an encounter
 */
router.put('/Encounter/:id', async (req, res) => {
  try {
    const encounter = await FHIRService.updateEncounter(req.params.id, req.body);

    res.json(encounter);
  } catch (error) {
    console.error('[FHIR API] Error updating encounter:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Encounter
 * Search encounters
 * Query params: patient, date, _count
 */
router.get('/Encounter', async (req, res) => {
  try {
    if (!req.query.patient) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'required',
          diagnostics: 'patient parameter is required'
        }]
      });
    }

    const count = Math.max(1, Math.min(parseInt(req.query._count || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(req.query._getpagesoffset || req.query._offset || '0', 10) || 0);
    const encounters = await FHIRService.getPatientEncounters(req.query.patient, 500);

    const page = encounters.slice(offset, offset + count);
    const bundle = FHIRAdapter.createBundle(page, 'searchset');
    bundle.total = encounters.length;
    res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error searching encounters:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

// ==========================================
// COMMUNICATION ENDPOINTS (Transcripts)
// ==========================================

/**
 * POST /fhir/Communication
 * Store a transcript
 */
router.post('/Communication', async (req, res) => {
  try {
    const communication = await FHIRService.storeTranscript(req.body);

    res.status(201).json(communication);
  } catch (error) {
    console.error('[FHIR API] Error creating communication:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Communication/:id
 * Get communication by ID
 */
router.get('/Communication/:id', async (req, res) => {
  try {
    const communication = await FHIRService.getEncounterTranscript(req.params.id);

    res.json(communication);
  } catch (error) {
    console.error('[FHIR API] Error getting communication:', error);
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'not-found',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Communication
 * Search communications
 * Query params: encounter, patient
 */
router.get('/Communication', async (req, res) => {
  try {
    if (!req.query.encounter) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'required',
          diagnostics: 'encounter parameter is required'
        }]
      });
    }

    const communications = await FHIRService.getEncounterTranscript(req.query.encounter);

    const count = Math.max(1, Math.min(parseInt(req.query._count || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(req.query._getpagesoffset || req.query._offset || '0', 10) || 0);
    const page = (communications || []).slice(offset, offset + count);
    const bundle = FHIRAdapter.createBundle(page, 'searchset');
    bundle.total = (communications || []).length;
    res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error searching communications:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

// ==========================================
// OBSERVATION ENDPOINTS (Assessments)
// ==========================================

/**
 * POST /fhir/Observation
 * Create an observation (assessment)
 */
router.post('/Observation', async (req, res) => {
  try {
    const observation = await FHIRService.createObservation(req.body);

    res.status(201).json(observation);
  } catch (error) {
    console.error('[FHIR API] Error creating observation:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

/**
 * GET /fhir/Observation
 * Search observations
 * Query params: patient, encounter, _count
 */
router.get('/Observation', async (req, res) => {
  try {
    if (!req.query.patient) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{
          severity: 'error',
          code: 'required',
          diagnostics: 'patient parameter is required'
        }]
      });
    }

    const count = Math.max(1, Math.min(parseInt(req.query._count || '50', 10) || 50, 100));
    const offset = Math.max(0, parseInt(req.query._getpagesoffset || req.query._offset || '0', 10) || 0);
    const observations = await FHIRService.getPatientObservations(req.query.patient, 500);

    const page = (observations || []).slice(offset, offset + count);
    const bundle = FHIRAdapter.createBundle(page, 'searchset');
    bundle.total = (observations || []).length;
    res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error searching observations:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: error.message
      }]
    });
  }
});

// ==========================================
// DIAGNOSTICREPORT ENDPOINTS (visit summaries)
// ==========================================

router.post('/DiagnosticReport', async (req, res) => {
  try {
    const report = await FHIRService.createDiagnosticReport(req.body, { persist: true });
    res.status(201).json(report);
  } catch (error) {
    console.error('[FHIR API] Error creating DiagnosticReport:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

router.get('/DiagnosticReport/:id', async (req, res) => {
  try {
    const row = db.getDiagnosticReportById ? db.getDiagnosticReportById(req.params.id) : null;
    if (!row || !row.resource_data) {
      return res.status(404).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: 'DiagnosticReport not found' }]
      });
    }
    return res.json(row.resource_data);
  } catch (error) {
    console.error('[FHIR API] Error getting DiagnosticReport:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

router.get('/DiagnosticReport', async (req, res) => {
  try {
    const patient = req.query.patient;
    const encounter = req.query.encounter;
    const count = Math.max(1, Math.min(parseInt(req.query._count || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(req.query._getpagesoffset || req.query._offset || '0', 10) || 0);

    let reports = [];
    if (encounter) {
      const encId = String(encounter).replace(/^Encounter\//, '');
      const row = db.getDiagnosticReportByEncounterId ? db.getDiagnosticReportByEncounterId(encId) : null;
      reports = row && row.resource_data ? [row.resource_data] : [];
    } else if (patient) {
      const pid = String(patient).replace(/^Patient\//, '');
      const rows = db.getDiagnosticReportsByPatientId ? db.getDiagnosticReportsByPatientId(pid, 500) : [];
      reports = rows.map(r => r.resource_data).filter(Boolean);
    } else {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'required', diagnostics: 'patient or encounter parameter is required' }]
      });
    }

    const page = reports.slice(offset, offset + count);
    const bundle = FHIRAdapter.createBundle(page, 'searchset');
    bundle.total = reports.length;
    return res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error searching DiagnosticReport:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

// ==========================================
// DOCUMENTREFERENCE + BINARY (portal documents)
// ==========================================

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

router.get('/DocumentReference/:id', async (req, res) => {
  try {
    const fromFhir = db.getFHIRDocumentReference ? db.getFHIRDocumentReference(req.params.id) : null;
    if (fromFhir && fromFhir.resource_data) return res.json(fromFhir.resource_data);

    // Migration bridge: derive from patient_documents, then persist as FHIR DocumentReference.
    const doc = db.getPatientDocumentById ? db.getPatientDocumentById(req.params.id) : null;
    if (!doc) {
      return res.status(404).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: 'DocumentReference not found' }]
      });
    }
    const dr = buildDocumentReferenceFromPatientDocRow(doc, req);
    try { db.createFHIRDocumentReference && db.createFHIRDocumentReference(dr); } catch (_) {}
    return res.json(dr);
  } catch (error) {
    console.error('[FHIR API] Error getting DocumentReference:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

router.get('/DocumentReference', async (req, res) => {
  try {
    if (!req.query.patient) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'required', diagnostics: 'patient parameter is required' }]
      });
    }
    const pid = String(req.query.patient).replace(/^Patient\//, '');
    const count = Math.max(1, Math.min(parseInt(req.query._count || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(req.query._getpagesoffset || req.query._offset || '0', 10) || 0);

    let refs = [];
    const fhirRows = db.getFHIRDocumentReferencesByPatientId ? db.getFHIRDocumentReferencesByPatientId(pid, 500) : [];
    refs = fhirRows.map(r => r.resource_data).filter(Boolean);

    // Migration bridge: if no FHIR rows exist yet, derive from patient_documents and persist.
    if (refs.length === 0) {
      const rows = db.getPatientDocuments ? db.getPatientDocuments(pid) : [];
      for (const r of rows) {
        const dr = buildDocumentReferenceFromPatientDocRow(r, req);
        refs.push(dr);
        try { db.createFHIRDocumentReference && db.createFHIRDocumentReference(dr); } catch (_) {}
      }
    }
    const page = refs.slice(offset, offset + count);
    const bundle = FHIRAdapter.createBundle(page, 'searchset');
    bundle.total = refs.length;
    return res.json(bundle);
  } catch (error) {
    console.error('[FHIR API] Error searching DocumentReference:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

router.get('/Binary/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = db.getPatientDocumentById ? db.getPatientDocumentById(docId) : null;
    if (!doc) {
      return res.status(404).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: 'Binary not found' }]
      });
    }

    // Issue a one-time token then redirect to token-consumption endpoint.
    // This keeps URLs short-lived and avoids raw storage paths.
    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);
    const token = require('crypto').randomBytes(24).toString('hex');
    const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
    if (db.createPatientDocumentDownloadToken) {
      const created = db.createPatientDocumentDownloadToken({
        token,
        doc_id: docId,
        patient_id: doc.patient_id,
        expires_at: expiresAtIso
      });
      if (!created.success) {
        return res.status(500).json({
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'exception', diagnostics: 'Failed to issue download token' }]
        });
      }
    }

    try {
      db.auditLog && db.auditLog(req.user?.scope || 'system', req.user?.sub || 'system', 'DOWNLOAD', 'Binary', docId, req.ip, req.get('User-Agent'), '302');
    } catch (_) {}

    return res.redirect(`${req.protocol}://${req.get('host')}/api/patient/documents/download/${token}`);
  } catch (error) {
    console.error('[FHIR API] Error getting Binary:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

// ==========================================
// PROVENANCE + CONSENT
// ==========================================

router.post('/Provenance', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const prov = req.body || {};
    if (prov.resourceType !== 'Provenance') {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'invalid', diagnostics: 'resourceType must be Provenance' }]
      });
    }
    if (!prov.id) prov.id = `provenance-${Date.now()}`;
    db.createFHIRProvenance && db.createFHIRProvenance(prov);
    return res.status(201).json(prov);
  } catch (error) {
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

router.post('/Consent', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const consent = req.body || {};
    if (consent.resourceType !== 'Consent') {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'invalid', diagnostics: 'resourceType must be Consent' }]
      });
    }
    if (!consent.id) consent.id = `consent-${Date.now()}`;
    db.createFHIRConsent && db.createFHIRConsent(consent);
    return res.status(201).json(consent);
  } catch (error) {
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

// ==========================================
// Bulk Data $export (minimal patient-compartment implementation)
// ==========================================

router.get('/$export', async (req, res) => {
  try {
    const isPatient = req.user?.scope === 'patient';
    const patientId = isPatient ? req.user.sub : (req.query.patient ? String(req.query.patient).replace(/^Patient\//, '') : null);
    if (!patientId) {
      return res.status(400).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'required', diagnostics: 'patient parameter is required (or patient-scoped token)' }]
      });
    }

    const { v4: uuidv4 } = require('uuid');
    const jobId = uuidv4();
    const base = `${req.protocol}://${req.get('host')}`;
    db.createFhirBulkExportJob && db.createFhirBulkExportJob({
      id: jobId,
      requester_scope: req.user?.scope || null,
      requester_sub: req.user?.sub || null,
      patient_id: patientId,
      status: 'completed',
      output_base_url: `${base}/fhir/bulkfiles/${jobId}`,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });

    res.setHeader('Content-Location', `${base}/fhir/bulkstatus/${jobId}`);
    return res.status(202).send('');
  } catch (error) {
    return res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'exception', diagnostics: error.message }]
    });
  }
});

router.get('/bulkstatus/:jobId', async (req, res) => {
  try {
    const job = db.getFhirBulkExportJob ? db.getFhirBulkExportJob(req.params.jobId) : null;
    if (!job) return res.status(404).send('');
    if (job.status !== 'completed') return res.status(202).send('');
    const base = `${req.protocol}://${req.get('host')}`;
    return res.status(200).json({
      transactionTime: new Date().toISOString(),
      request: `${base}/fhir/$export`,
      requiresAccessToken: true,
      output: [
        { type: 'Patient', url: `${base}/fhir/bulkfiles/${job.id}/Patient.ndjson` },
        { type: 'Encounter', url: `${base}/fhir/bulkfiles/${job.id}/Encounter.ndjson` },
        { type: 'DiagnosticReport', url: `${base}/fhir/bulkfiles/${job.id}/DiagnosticReport.ndjson` },
        { type: 'DocumentReference', url: `${base}/fhir/bulkfiles/${job.id}/DocumentReference.ndjson` }
      ],
      error: []
    });
  } catch (_) {
    return res.status(500).send('');
  }
});

router.get('/bulkfiles/:jobId/:file', async (req, res) => {
  try {
    const job = db.getFhirBulkExportJob ? db.getFhirBulkExportJob(req.params.jobId) : null;
    if (!job || job.status !== 'completed') return res.status(404).send('');
    const patientId = job.patient_id;
    const file = req.params.file || '';
    res.setHeader('Content-Type', 'application/fhir+ndjson');
    const writeLine = (obj) => res.write(`${JSON.stringify(obj)}\n`);

    if (file === 'Patient.ndjson') {
      const row = db.getFHIRPatient ? db.getFHIRPatient(patientId) : null;
      if (row && row.resource_data) writeLine(typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data);
      return res.end();
    }
    if (file === 'Encounter.ndjson') {
      const rows = db.getPatientEncounters ? db.getPatientEncounters(patientId, 500) : [];
      for (const r of rows) writeLine(r.resource_data);
      return res.end();
    }
    if (file === 'DiagnosticReport.ndjson') {
      const rows = db.getDiagnosticReportsByPatientId ? db.getDiagnosticReportsByPatientId(patientId, 500) : [];
      for (const r of rows) if (r.resource_data) writeLine(r.resource_data);
      return res.end();
    }
    if (file === 'DocumentReference.ndjson') {
      const rows = db.getFHIRDocumentReferencesByPatientId ? db.getFHIRDocumentReferencesByPatientId(patientId, 500) : [];
      for (const r of rows) if (r.resource_data) writeLine(r.resource_data);
      return res.end();
    }
    return res.status(404).end();
  } catch (e) {
    return res.status(500).end();
  }
});

// ==========================================
// UTILITY ENDPOINTS
// ==========================================

/**
 * GET /fhir/metadata
 * Get FHIR capability statement
 */
router.get('/metadata', (req, res) => {
  res.json({
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    kind: 'instance',
    software: {
      name: 'Somo Telehealth Platform',
      version: '1.0.0'
    },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    rest: [{
      mode: 'server',
      resource: [
        {
          type: 'Patient',
          interaction: [
            { code: 'create' },
            { code: 'read' },
            { code: 'search-type' }
          ],
          searchParam: [
            { name: 'name', type: 'string' },
            { name: 'phone', type: 'string' },
            { name: 'email', type: 'string' }
          ]
        },
        {
          type: 'DocumentReference',
          interaction: [
            { code: 'read' },
            { code: 'search-type' }
          ],
          searchParam: [
            { name: 'patient', type: 'reference' }
          ]
        },
        {
          type: 'Binary',
          interaction: [
            { code: 'read' }
          ]
        },
        {
          type: 'Encounter',
          interaction: [
            { code: 'create' },
            { code: 'read' },
            { code: 'update' },
            { code: 'search-type' }
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'date', type: 'date' }
          ]
        },
        {
          type: 'DiagnosticReport',
          interaction: [
            { code: 'create' },
            { code: 'read' },
            { code: 'search-type' }
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'encounter', type: 'reference' }
          ]
        },
        {
          type: 'Communication',
          interaction: [
            { code: 'create' },
            { code: 'read' },
            { code: 'search-type' }
          ],
          searchParam: [
            { name: 'encounter', type: 'reference' },
            { name: 'patient', type: 'reference' }
          ]
        },
        {
          type: 'Observation',
          interaction: [
            { code: 'create' },
            { code: 'search-type' }
          ],
          searchParam: [
            { name: 'patient', type: 'reference' },
            { name: 'encounter', type: 'reference' }
          ]
        }
      ]
    }]
  });
});

/**
 * GET /fhir/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'FHIR API',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
