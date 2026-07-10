'use strict';

const express = require('express');
const db = require('../database');
const { requireCustomerPmsAuth } = require('../middleware/pms-tenant-auth');

const router = express.Router();
router.use(requireCustomerPmsAuth);

function patientInClinic(fhirId, clinicId) {
  if (!fhirId || !clinicId || !db.db) return false;
  const row = db.db
    .prepare(`SELECT resource_id FROM fhir_patients WHERE resource_id = ? AND clinic_id = ? AND is_deleted = 0 LIMIT 1`)
    .get(fhirId, clinicId);
  return !!row;
}

router.get('/:fhirId/eligibility', (req, res) => {
  try {
    const fhirId = req.params.fhirId;
    const clinicId = req.pmsClinicId;
    if (!patientInClinic(fhirId, clinicId)) {
      return res.status(404).json({ success: false, error: 'patient_not_found' });
    }
    if (typeof db.logHipaaAccess === 'function') {
      db.logHipaaAccess({
        user_id: req.pmsUserId || req.auth?.userId || 'provider',
        resource_type: 'eligibility',
        resource_id: fhirId,
        patient_id: fhirId,
        action: 'read',
        ip_address: req.ip || req.headers['x-forwarded-for'] || null
      });
    }
    let rows = db.getEligibilityChecksByPatient?.(fhirId) || [];
    if (!rows.length) {
      const insuranceList = db.getAllPatientInsurance?.(fhirId) || [];
      const primary = insuranceList.find((i) => i.is_primary) || insuranceList[0];
      if (primary) {
        const payer = primary.payer_id ? db.getPayerByPayerId?.(primary.payer_id) : null;
        rows = [
          {
            eligible: true,
            copay_amount: null,
            payer_id: primary.payer_id,
            payer_name: payer?.payer_name || primary.payer_name || primary.payer_id,
            member_id: primary.member_id,
            plan_summary: primary.plan_name || 'Insurance on file'
          }
        ];
      }
    }
    const eligibility = rows.map((r) => {
      const payer = r.payer_id ? db.getPayerByPayerId?.(r.payer_id) : null;
      return {
        id: r.id || null,
        eligible: !!r.eligible,
        copay_amount: r.copay_amount,
        payer_name: r.payer_name || payer?.payer_name || r.payer_id,
        member_id: r.member_id,
        plan_summary: r.plan_summary,
        date_of_service: r.date_of_service,
        created_at: r.created_at
      };
    });
    return res.json({ success: true, eligibility, patient_id: fhirId, clinic_id: clinicId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:fhirId/summary', (req, res) => {
  try {
    const fhirId = req.params.fhirId;
    const clinicId = req.pmsClinicId;
    if (!patientInClinic(fhirId, clinicId)) {
      return res.status(404).json({ success: false, error: 'patient_not_found' });
    }
    const patient = db.getFHIRPatient?.(fhirId);
    const insurance = db.getAllPatientInsurance?.(fhirId) || [];
    const appts =
      db.db
        ?.prepare(
          `
          SELECT id, date, time, status, appointment_type, pms_sync_status
          FROM appointments WHERE patient_id = ? AND clinic_id = ?
          ORDER BY datetime(created_at) DESC LIMIT 5
        `
        )
        .all(fhirId, clinicId) || [];
    return res.json({
      success: true,
      patient: {
        id: fhirId,
        name: patient?.name || patient?.display_name || null,
        phone: patient?.phone || null,
        email: patient?.email || null
      },
      insurance,
      recent_appointments: appts
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
