'use strict';

const express = require('express');
const { requireCustomerPmsAuth } = require('../middleware/pms-tenant-auth');
const { pilotRateLimit } = require('../middleware/pilot-rate-limit');
const { CSV_TEMPLATE, importRosterCsv } = require('../services/tenant-roster-service');
const { matchPatient, createPatientForClinic } = require('../services/patient-match-service');
const db = require('../database');

const router = express.Router();
router.use(requireCustomerPmsAuth);

router.get('/template', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="roster-template.csv"');
  res.send(CSV_TEMPLATE);
});

router.get('/stats', (req, res) => {
  const clinicId = req.pmsClinicId;
  if (!db.db) return res.status(503).json({ success: false, error: 'db unavailable' });
  const count =
    db.db
      .prepare(`SELECT COUNT(*) AS c FROM fhir_patients WHERE clinic_id = ? AND is_deleted = 0`)
      .get(clinicId)?.c || 0;
  return res.json({ success: true, clinic_id: clinicId, roster_count: count });
});

router.get('/list', (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    if (!db.db) return res.status(503).json({ success: false, error: 'db unavailable' });
    const rows = db.db
      .prepare(
        `
        SELECT resource_id AS fhir_id, name, phone, email, external_ids_json, updated_at
        FROM fhir_patients
        WHERE clinic_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT ?
      `
      )
      .all(clinicId, limit);
    return res.json({ success: true, clinic_id: clinicId, patients: rows, count: rows.length });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/import', pilotRateLimit('roster_import'), (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const csv = req.body?.csv || req.body?.text || '';
    if (!csv || String(csv).trim().length < 10) {
      return res.status(400).json({ success: false, error: 'csv body required' });
    }
    const merchantId = req.pmsClinic?.merchant_id || req.body?.merchant_id || null;
    const summary = importRosterCsv(clinicId, merchantId, csv);
    return res.json({ success: true, ...summary });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/match', (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const result = matchPatient({
      clinicId,
      phone: req.body?.phone,
      dob: req.body?.date_of_birth || req.body?.dob,
      name: req.body?.name || req.body?.full_name
    });
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/create', (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const result = createPatientForClinic({
      clinicId,
      merchantId: req.pmsClinic?.merchant_id || req.body?.merchant_id,
      name: req.body?.full_name || req.body?.name,
      phone: req.body?.phone,
      dob: req.body?.date_of_birth || req.body?.dob,
      externalId: req.body?.external_id
    });
    if (result.ambiguous) {
      return res.status(409).json({ success: false, error: 'ambiguous_match', candidates: result.candidates });
    }
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
