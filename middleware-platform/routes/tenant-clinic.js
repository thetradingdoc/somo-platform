'use strict';

const express = require('express');
const db = require('../database');
const { requireCustomerPmsAuth } = require('../middleware/pms-tenant-auth');
const { updateTenantFlags } = require('../services/tenant-flags-service');

const router = express.Router();
router.use(requireCustomerPmsAuth);

router.get('/', (req, res) => {
  try {
    const clinic = db.getClinicById?.(req.pmsClinicId);
    if (!clinic) return res.status(404).json({ success: false, error: 'clinic_not_found' });
    return res.json({
      success: true,
      clinic: {
        clinic_id: clinic.clinic_id,
        name: clinic.name,
        email: clinic.email,
        phone_number: clinic.phone_number,
        transfer_number: clinic.transfer_number,
        npi: clinic.npi || null,
        tax_id: clinic.tax_id || null,
        practice_address: clinic.practice_address || null,
        payer_list_json: clinic.payer_list_json || null,
        office_type: clinic.office_type || null,
        shadow_week_active: clinic.shadow_week_active === 1,
        pilot_live_at: clinic.pilot_live_at || null,
        eligibility_configured: Boolean(process.env.STEDI_API_KEY || process.env.STEDI_TEST_API_KEY)
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/', (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const body = req.body || {};
    const patch = {};
    for (const key of [
      'transfer_number',
      'npi',
      'tax_id',
      'practice_address',
      'payer_list_json',
      'name',
      'email',
      'phone_number',
      'shadow_week_active',
      'pilot_live_at'
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.payer_list && !patch.payer_list_json) {
      patch.payer_list_json = JSON.stringify(body.payer_list);
    }
    if (Object.keys(patch).length) {
      db.updateClinic(clinicId, patch);
    }
    const flags = updateTenantFlags(clinicId, {
      office_type: body.office_type,
      language_pack: body.language_pack,
      coverage_mode: body.coverage_mode,
      language_mode: body.language_mode,
      supported_languages: body.supported_languages
    });
    const clinic = db.getClinicById(clinicId);
    return res.json({ success: true, clinic, flags });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
