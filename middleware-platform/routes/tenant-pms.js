'use strict';

const express = require('express');
const {
  PmsHub,
  getClinicPmsSettings,
  updateClinicPms,
  encryptPmsConfig,
  maskPmsConfigForApi
} = require('../services/pms');
const { requireCustomerPmsAuth } = require('../middleware/pms-tenant-auth');

const router = express.Router();

router.use(requireCustomerPmsAuth);

/**
 * GET /api/tenant/pms/status
 */
router.get('/status', async (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const settings = getClinicPmsSettings(clinicId);
    if (!settings) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }
    const hub = PmsHub.tryForClinic(clinicId);
    const health = hub ? await hub.healthCheck() : { ok: false, message: 'PMS disabled' };
    return res.json({
      success: true,
      clinic_id: clinicId,
      pms_type: settings.pms_type,
      pms_enabled: settings.pms_enabled,
      pms_connected_at: settings.pms_connected_at,
      pms_last_sync_at: settings.pms_last_sync_at,
      pms_last_error: settings.pms_last_error,
      config: maskPmsConfigForApi(settings.pms_config),
      health
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/tenant/pms/connect
 */
router.post('/connect', async (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const pmsType = (req.body?.pms_type || 'somo').toLowerCase();
    const config = req.body?.config || {};

    const allowed = ['somo', 'athena', 'dentrix', 'eaglesoft'];
    if (!allowed.includes(pmsType)) {
      return res.status(400).json({ success: false, error: 'invalid pms_type' });
    }

    if (['athena', 'dentrix', 'eaglesoft'].includes(pmsType)) {
      const hasCreds = config.client_id || config.api_key || config.practice_id;
      if (!hasCreds && pmsType !== 'somo') {
        return res.status(400).json({
          success: false,
          error: `${pmsType} requires API credentials (Phase 3B). Use somo until approved.`
        });
      }
    }

    updateClinicPms(clinicId, {
      pms_type: pmsType,
      pms_enabled: 1,
      pms_config: encryptPmsConfig(config),
      pms_connected_at: new Date().toISOString(),
      pms_last_error: null
    });

    const hub = PmsHub.tryForClinic(clinicId);
    const health = hub ? await hub.healthCheck() : null;

    return res.json({
      success: true,
      clinic_id: clinicId,
      pms_type: pmsType,
      health
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/tenant/pms/test
 */
router.post('/test', async (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    const hub = PmsHub.tryForClinic(clinicId);
    if (!hub) {
      return res.status(400).json({ success: false, error: 'PMS not configured' });
    }
    const health = await hub.healthCheck();
    let scheduleSample = null;
    if (health.ok && (hub.pmsType === 'somo' || hub.pmsType === 'athena')) {
      const future = new Date();
      future.setDate(future.getDate() + 14);
      while (future.getDay() === 0 || future.getDay() === 6) future.setDate(future.getDate() + 1);
      const date = future.toISOString().slice(0, 10);
      scheduleSample = await hub.getSchedule({ date, appointment_type: 'General Consult' });
    }
    return res.json({ success: health.ok, health, schedule_sample: scheduleSample });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/tenant/pms/disconnect
 */
router.delete('/disconnect', async (req, res) => {
  try {
    const clinicId = req.pmsClinicId;
    updateClinicPms(clinicId, {
      pms_type: 'none',
      pms_enabled: 0,
      pms_config: null,
      pms_last_error: null
    });
    return res.json({ success: true, clinic_id: clinicId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/sync-status', async (req, res) => {
  try {
    const { getSyncStatus } = require('../services/e10-interim-service');
    const status = getSyncStatus(req.pmsClinicId);
    return res.json({ success: true, ...status });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/sync-errors', async (req, res) => {
  try {
    const { listPmsSyncErrors } = require('../services/integrations-status-service');
    const limit = parseInt(req.query.limit, 10) || 50;
    const errors = listPmsSyncErrors(db, req.pmsClinicId, { limit });
    return res.json({ success: true, errors, clinic_id: req.pmsClinicId });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/digest', async (req, res) => {
  try {
    const { sendDigestEmail } = require('../services/e10-interim-service');
    const result = await sendDigestEmail(req.pmsClinicId, { to: req.body?.to, sinceIso: req.body?.since });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/tenant-flags', async (req, res) => {
  try {
    const { getTenantFlags } = require('../services/tenant-flags-service');
    const flags = getTenantFlags(req.pmsClinicId);
    return res.json({ success: true, flags });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.patch('/tenant-flags', async (req, res) => {
  try {
    const { updateTenantFlags } = require('../services/tenant-flags-service');
    const flags = updateTenantFlags(req.pmsClinicId, req.body || {});
    return res.json({ success: true, flags });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
