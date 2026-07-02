'use strict';

const express = require('express');
const { PmsHub } = require('../services/pms/pms-hub');
const { requireAgentPmsAuth } = require('../middleware/pms-tenant-auth');

const router = express.Router();

/**
 * GET /api/agent/patient-context
 * Query: clinic_id, caller_phone, dob?, patient_id?, call_id?
 */
router.get('/patient-context', requireAgentPmsAuth, async (req, res) => {
  try {
    const clinicId = req.pmsClinicId || req.query.clinic_id || req.query.clinicId;
    const callerPhone = req.query.caller_phone || req.query.phone;
    const dob = req.query.dob || null;
    const patientId = req.query.patient_id || null;
    const callId = req.query.call_id || null;

    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id required' });
    }

    const hub = PmsHub.tryForClinic(clinicId);
    if (!hub) {
      return res.json({
        success: true,
        degraded: true,
        patient: null,
        pms_type: 'none',
        error: 'PMS not enabled'
      });
    }

    const ctx = await hub.getPatientContext({
      caller_phone: callerPhone,
      dob,
      patient_id: patientId,
      call_id: callId
    });

    return res.json({ success: true, ...ctx });
  } catch (error) {
    console.warn('[agent/patient-context]', error.message);
    return res.json({
      success: true,
      degraded: true,
      patient: null,
      error: error.message
    });
  }
});

module.exports = router;
