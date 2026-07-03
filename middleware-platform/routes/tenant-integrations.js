'use strict';

const express = require('express');
const db = require('../database');
const { requireCustomerPmsAuth } = require('../middleware/pms-tenant-auth');
const {
  resolveIntegrationsStatus,
  listPmsSyncErrors
} = require('../services/integrations-status-service');

const router = express.Router();
router.use(requireCustomerPmsAuth);

router.get('/status', (req, res) => {
  try {
    const status = resolveIntegrationsStatus(db, {
      customerId: req.customer?.id || null,
      clinicId: req.pmsClinicId,
      email: req.customer?.email
    });
    return res.json({ success: true, ...status });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
