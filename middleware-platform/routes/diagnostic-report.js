/**
 * Phase 8 — FHIR DiagnosticReport API.
 * Task 58: GET /api/encounters/:encounter_id/diagnostic-report (clinician JWT, clinic-scoped, audit).
 * Task 59: GET /api/patients/:patient_id/diagnostic-reports (clinician JWT, list by date desc).
 * Task 60: GET /api/patients/:patient_id/my-records (patient JWT, own records only; HIPAA right of access).
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const { jwtFhirAuth } = require('../middleware/jwt-fhir-auth');

function operationOutcome(diagnostics) {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'forbidden', diagnostics }]
  };
}

function audit(req, action, resourceType, resourceId, result) {
  try {
    if (db.auditLog) {
      const actorType = req.user?.scope === 'patient' ? 'patient' : req.user?.scope === 'clinician' ? 'clinician' : 'system';
      db.auditLog(actorType, req.user?.sub || 'anonymous', action, resourceType, resourceId, req.ip, req.get('User-Agent') || '', result);
    }
  } catch (_) {}
}

/**
 * Task 58: GET /api/encounters/:encounter_id/diagnostic-report
 * Auth: clinician JWT scoped to clinic_id. Returns DiagnosticReport + case_report_text. Audit logged.
 */
router.get('/encounters/:encounter_id/diagnostic-report', jwtFhirAuth, (req, res) => {
  if (!req.user || req.user.scope !== 'clinician') {
    return res.status(401).json(operationOutcome('Clinician JWT required.'));
  }
  if (!req.user.clinic_id) {
    return res.status(403).json(operationOutcome('Clinician token must include clinic_id.'));
  }
  const { encounter_id } = req.params;
  const enc = db.getFHIREncounter && db.getFHIREncounter(encounter_id);
  if (!enc) {
    return res.status(404).json(operationOutcome('Encounter not found.'));
  }
  const patientId = enc.patient_id;
  const clinicIds = db.getPatientClinicIds ? db.getPatientClinicIds(patientId) : [];
  if (!clinicIds.length || !clinicIds.includes(req.user.clinic_id)) {
    audit(req, 'READ', 'DiagnosticReport', null, '403');
    return res.status(403).json(operationOutcome('Clinician can only access encounters for patients in their clinic.'));
  }
  const row = db.getDiagnosticReportByEncounterId && db.getDiagnosticReportByEncounterId(encounter_id);
  if (!row) {
    audit(req, 'READ', 'DiagnosticReport', null, '404');
    return res.status(404).json(operationOutcome('No diagnostic report found for this encounter.'));
  }
  audit(req, 'READ', 'DiagnosticReport', row.resource_id || row.id, '200');
  const resource = row.resource_data || {};
  return res.json({
    resourceType: 'DiagnosticReport',
    ...resource,
    id: resource.id || row.resource_id,
    case_report_text: row.case_report_text || null
  });
});

/**
 * Task 59: GET /api/patients/:patient_id/diagnostic-reports
 * Auth: clinician JWT. Returns list of DiagnosticReports for patient, ordered by date desc.
 */
router.get('/patients/:patient_id/diagnostic-reports', jwtFhirAuth, (req, res) => {
  if (!req.user || req.user.scope !== 'clinician') {
    return res.status(401).json(operationOutcome('Clinician JWT required.'));
  }
  if (!req.user.clinic_id) {
    return res.status(403).json(operationOutcome('Clinician token must include clinic_id.'));
  }
  const patientId = req.params.patient_id;
  const clinicIds = db.getPatientClinicIds ? db.getPatientClinicIds(patientId) : [];
  if (!clinicIds.length || !clinicIds.includes(req.user.clinic_id)) {
    return res.status(403).json(operationOutcome('Clinician can only access patients in their clinic.'));
  }
  const rows = db.getDiagnosticReportsByPatientId ? db.getDiagnosticReportsByPatientId(patientId) : [];
  audit(req, 'READ', 'DiagnosticReport', patientId, '200');
  const reports = rows.map(row => ({
    resourceType: 'DiagnosticReport',
    ...(row.resource_data || {}),
    id: (row.resource_data && row.resource_data.id) || row.resource_id,
    case_report_text: row.case_report_text || null,
    created_at: row.created_at
  }));
  return res.json({ resourceType: 'Bundle', type: 'searchset', total: reports.length, entry: reports.map(r => ({ resource: r })) });
});

/**
 * Task 60: GET /api/patients/:patient_id/my-records
 * Auth: patient JWT (own records only). Returns DiagnosticReports for that patient. HIPAA right of access.
 */
router.get('/patients/:patient_id/my-records', jwtFhirAuth, (req, res) => {
  if (!req.user || req.user.scope !== 'patient') {
    return res.status(401).json(operationOutcome('Patient JWT required.'));
  }
  const patientId = req.params.patient_id;
  if (patientId !== req.user.sub) {
    return res.status(403).json(operationOutcome('Patient can only access their own records.'));
  }
  const rows = db.getDiagnosticReportsByPatientId ? db.getDiagnosticReportsByPatientId(patientId) : [];
  audit(req, 'READ', 'DiagnosticReport', patientId, '200');
  const reports = rows.map(row => ({
    resourceType: 'DiagnosticReport',
    ...(row.resource_data || {}),
    id: (row.resource_data && row.resource_data.id) || row.resource_id,
    case_report_text: row.case_report_text || null,
    created_at: row.created_at
  }));
  return res.json({ resourceType: 'Bundle', type: 'document', total: reports.length, entry: reports.map(r => ({ resource: r })) });
});

module.exports = router;
