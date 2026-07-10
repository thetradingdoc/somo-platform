'use strict';

/**
 * Tenant integration status (Settings → Connected Accounts).
 * Uses requireCustomerAuth (not requireCustomerPmsAuth): status is clinic/customer-scoped
 * configuration metadata, not PHI — same session as provider settings pages.
 */
const express = require('express');
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const { resolveClinicForCustomer } = require('../services/tenant-voice-config');
const {
  resolveIntegrationsStatus,
  listPmsSyncErrors
} = require('../services/integrations-status-service');

const router = express.Router();

router.get('/status', requireCustomerAuth, (req, res) => {
  try {
    const clinicIdHint =
      req.query.clinic_id ||
      req.query.clinicId ||
      req.headers['x-clinic-id'] ||
      null;
    const clinic = resolveClinicForCustomer(db, req.customer?.id, clinicIdHint);
    const status = resolveIntegrationsStatus(db, {
      customerId: req.customer?.id || null,
      clinicId: clinic?.clinic_id || clinicIdHint,
      email: req.customer?.email
    });
    return res.json({ success: true, ...status });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
