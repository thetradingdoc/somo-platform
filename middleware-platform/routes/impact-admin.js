'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const ImpactLedgerService = require('../services/impact-ledger-service');
const PrivacyGovernanceService = require('../services/privacy-governance-service');

router.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    try {
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'admin',
        actor_id: req.admin?.id || req.admin?.email || null,
        patient_id: null,
        resource_type: 'impact_admin',
        resource_id: req.path,
        action: `impact_admin_${req.method.toLowerCase()}`,
        metadata: {
          status_code: res.statusCode,
          reason: req.body?.reason || req.query?.reason || null,
          duration_ms: Date.now() - started
        }
      });
    } catch (_) {}
  });
  next();
});

router.post('/events', (req, res) => {
  try {
    const event = ImpactLedgerService.createImpactEvent(req.body || {});
    return res.json({ success: true, event });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message || 'create_failed' });
  }
});

router.post('/events/:id/verify', (req, res) => {
  try {
    const reviewer = String(req.body?.reviewer || 'admin');
    const out = ImpactLedgerService.verifyImpactEvent(req.params.id, reviewer);
    return res.json({ success: true, ...out });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message || 'verify_failed' });
  }
});

router.get('/events', (req, res) => {
  try {
    const verification_state = (req.query.verification_state || '').toString().trim() || undefined;
    const event_type = (req.query.event_type || '').toString().trim() || undefined;
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
    const items = db.listImpactLedgerEvents({ verification_state, event_type, limit });
    return res.json({ success: true, total: items.length, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'list_failed' });
  }
});

router.post('/verification-samples', (req, res) => {
  try {
    const sample = db.insertImpactVerificationSample(req.body || {});
    if (!sample) return res.status(400).json({ success: false, error: 'sample_insert_failed' });
    return res.json({ success: true, sample });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message || 'sample_failed' });
  }
});

router.get('/verification-stats', (req, res) => {
  try {
    const window_days = Math.max(1, Math.min(365, parseInt(req.query.window_days || '30', 10) || 30));
    const stats = db.getImpactVerificationStats(window_days);
    return res.json({ success: true, window_days, stats });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'stats_failed' });
  }
});

router.post('/privacy/seed-inventory', (req, res) => {
  try {
    const items = PrivacyGovernanceService.seedDefaultDataInventory();
    return res.json({ success: true, total: items.length, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'seed_failed' });
  }
});

router.get('/privacy/inventory', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '500', 10) || 500, 2000);
    const items = db.listDataInventory(limit);
    return res.json({ success: true, total: items.length, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'inventory_failed' });
  }
});

router.post('/privacy/retention/run', (req, res) => {
  try {
    const summary = PrivacyGovernanceService.runRetentionSweep();
    return res.json({ success: true, summary });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'retention_failed' });
  }
});

module.exports = router;

