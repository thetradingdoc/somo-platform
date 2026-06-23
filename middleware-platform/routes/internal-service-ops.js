'use strict';

const express = require('express');
const router = express.Router();
const { requireServiceScope } = require('../middleware/service-auth');
const PaymentReliabilityMonitor = require('../services/commerce/payment-reliability-monitor');
const SecretManager = require('../services/platform/secret-manager');

// Service-to-service endpoint with scoped token enforcement.
router.get('/payment-alerts', requireServiceScope('payment:alerts:read'), (req, res) => {
  try {
    const report = PaymentReliabilityMonitor.computeAlerts();
    return res.json({
      success: true,
      service: req.serviceAuth?.service_name || null,
      report
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'internal_error' });
  }
});

router.get('/secret-alerts', requireServiceScope('secrets:audit:read'), (req, res) => {
  try {
    const abnormal = SecretManager.listAbnormalSecretAccess({ limit: 500 });
    return res.json({
      success: true,
      service: req.serviceAuth?.service_name || null,
      total: abnormal.length,
      alerts: abnormal
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'internal_error' });
  }
});

module.exports = router;

