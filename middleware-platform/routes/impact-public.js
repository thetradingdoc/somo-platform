'use strict';

const express = require('express');
const router = express.Router();
const ImpactLedgerService = require('../services/impact-ledger-service');
const db = require('../database');

router.get('/dashboard', (req, res) => {
  try {
    const report = ImpactLedgerService.getDelayedAggregateDashboard();
    return res.json({ success: true, ...report });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'dashboard_failed' });
  }
});

router.get('/methodology', (req, res) => {
  try {
    const standard = ImpactLedgerService.VERIFIED_IMPACT_STANDARD;
    const verificationStats = db.getImpactVerificationStats(30);
    return res.json({
      success: true,
      standard,
      sampling_window_days: 30,
      verification_stats: verificationStats,
      notes: {
        privacy: 'Only delayed and thresholded aggregates are exposed.',
        limitations: 'Self-reported or partner-fed events may have provenance uncertainty until verified.'
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'methodology_failed' });
  }
});

module.exports = router;

