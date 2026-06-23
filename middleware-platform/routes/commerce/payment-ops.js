'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../database');
const PaymentDisputeService = require('../../services/commerce/payment-dispute-service');
const SettlementRetryService = require('../../services/platform/settlement-retry-service');
const { getPaymentExceptionOwners } = require('../../services/commerce/payment-exception-ownership');
const PaymentReliabilityMonitor = require('../../services/commerce/payment-reliability-monitor');
const SecretManager = require('../../services/platform/secret-manager');
const Phase0ValidationGatesService = require('../../services/platform/phase0-validation-gates-service');

router.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    try {
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'admin',
        actor_id: req.admin?.id || req.admin?.email || null,
        patient_id: null,
        resource_type: 'payment_ops',
        resource_id: req.path,
        action: `payment_ops_${req.method.toLowerCase()}`,
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

router.get('/refunds/audit', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const checkout_id = (req.query.checkout_id || '').toString().trim() || null;
    const items = db.listPaymentRefundAudit({
      limit,
      checkout_id: checkout_id || undefined
    });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] refunds/audit:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/disputes', (req, res) => {
  try {
    const workflow_status = (req.query.workflow_status || '').toString().trim() || null;
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const items = PaymentDisputeService.listDisputes({
      workflow_status: workflow_status || undefined,
      limit
    });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] disputes:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/disputes/:id', (req, res) => {
  try {
    const { owner, backup_owner, workflow_status } = req.body || {};
    const row = db.getPaymentDispute(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Dispute not found' });
    }
    const updated = db.updatePaymentDispute(req.params.id, {
      owner,
      backup_owner,
      workflow_status
    });
    return res.json({ success: true, dispute: updated });
  } catch (err) {
    console.error('[payment-ops] disputes patch:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/disputes/:id/evidence', async (req, res) => {
  try {
    const { evidence = {}, submit = false } = req.body || {};
    const dispute = await PaymentDisputeService.submitDisputeEvidence(req.params.id, {
      evidence,
      submit
    });
    return res.json({ success: true, dispute });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: err.message });
    }
    console.error('[payment-ops] disputes evidence:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/settlement/dead-letter', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const items = db.listSettlementDeadLetter({ limit });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] settlement dead-letter:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/settlement/retry-policy', (req, res) => {
  return res.json({
    success: true,
    policy: SettlementRetryService.getSettlementRetryPolicy()
  });
});

router.post('/settlement/retry-once', async (req, res) => {
  try {
    const summary = await SettlementRetryService.processDueRetries();
    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[payment-ops] settlement retry-once:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/exception-owners', (req, res) => {
  try {
    const owners = getPaymentExceptionOwners();
    const stored = db.getPaymentExceptionQueueRoles('default');
    return res.json({
      success: true,
      effective: owners,
      stored
    });
  } catch (err) {
    console.error('[payment-ops] exception-owners:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/exception-owners', (req, res) => {
  try {
    const { dri, backup, owner_pool } = req.body || {};
    const row = db.upsertPaymentExceptionQueueRoles({
      id: 'default',
      dri: dri != null ? String(dri) : null,
      backup: backup != null ? String(backup) : null,
      owner_pool: owner_pool != null ? String(owner_pool) : null
    });
    return res.json({ success: true, roles: row });
  } catch (err) {
    console.error('[payment-ops] exception-owners put:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/slo', (req, res) => {
  try {
    return res.json({
      success: true,
      targets: PaymentReliabilityMonitor.getSloTargets(),
      sli_snapshot: PaymentReliabilityMonitor.evaluateSliSnapshot()
    });
  } catch (err) {
    console.error('[payment-ops] slo:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/alerts', (req, res) => {
  try {
    const report = PaymentReliabilityMonitor.computeAlerts();
    return res.json({ success: true, ...report });
  } catch (err) {
    console.error('[payment-ops] alerts:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/secrets/audit', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const result = (req.query.result || '').toString().trim() || undefined;
    const secret_name = (req.query.secret_name || '').toString().trim() || undefined;
    const items = db.listSecretAccessAudit({ limit, result, secret_name });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] secrets/audit:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/secrets/abnormal-access', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const alerts = SecretManager.listAbnormalSecretAccess({ limit });
    return res.json({ success: true, total: alerts.length, alerts });
  } catch (err) {
    console.error('[payment-ops] secrets/abnormal-access:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/secrets/rotation', (req, res) => {
  try {
    const due_only = String(req.query.due_only || '').trim() === '1';
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 200);
    const items = db.listSecretRotationRegistry({ due_only, limit });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] secrets/rotation:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/secrets/rotation/:secret_name', (req, res) => {
  try {
    const secret_name = String(req.params.secret_name || '').trim();
    const { owner, rotation_interval_days, emergency_runbook_url, custody_notes } = req.body || {};
    const row = db.upsertSecretRotationRegistry({
      secret_name,
      owner: owner || null,
      rotation_interval_days: Number(rotation_interval_days || 90),
      emergency_runbook_url: emergency_runbook_url || null,
      custody_notes: custody_notes || null
    });
    return res.json({ success: true, item: row });
  } catch (err) {
    console.error('[payment-ops] secrets/rotation put:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/secrets/rotation/:secret_name/mark-rotated', (req, res) => {
  try {
    const secret_name = String(req.params.secret_name || '').trim();
    const actor = (req.body?.actor || 'admin').toString();
    const row = SecretManager.markSecretRotated(secret_name, { actor });
    return res.json({ success: true, item: row });
  } catch (err) {
    console.error('[payment-ops] secrets/rotation mark:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/service-credentials', (req, res) => {
  try {
    const status = (req.query.status || '').toString().trim() || undefined;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const items = db.listServiceCredentials({ status, limit }).map((row) => ({
      ...row,
      token_hash: row.token_hash ? `${String(row.token_hash).slice(0, 10)}...` : null
    }));
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] service-credentials list:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/service-credentials', (req, res) => {
  try {
    const { service_name, scopes = [], expires_at = null, created_by = 'admin' } = req.body || {};
    if (!service_name) {
      return res.status(400).json({ success: false, error: 'service_name_required' });
    }
    const rawToken = `svc_${crypto.randomBytes(24).toString('hex')}`;
    const row = db.createServiceCredential({
      service_name: String(service_name),
      token_hash: SecretManager.hashToken(rawToken),
      scopes: Array.isArray(scopes) ? scopes.map((s) => String(s)) : [],
      status: 'active',
      created_by: String(created_by || 'admin'),
      expires_at: expires_at || null
    });
    return res.json({
      success: true,
      credential: {
        id: row.id,
        service_name: row.service_name,
        scopes: (() => {
          try { return JSON.parse(row.scopes_json || '[]'); } catch (_) { return []; }
        })(),
        expires_at: row.expires_at
      },
      token: rawToken
    });
  } catch (err) {
    console.error('[payment-ops] service-credentials create:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/service-credentials/:id/revoke', (req, res) => {
  try {
    const row = db.revokeServiceCredential(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'credential_not_found' });
    return res.json({ success: true, credential: row });
  } catch (err) {
    console.error('[payment-ops] service-credentials revoke:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/phase0-validation-gates', (req, res) => {
  try {
    const report = Phase0ValidationGatesService.evaluatePhase0ValidationGates();
    return res.json({ success: true, ...report });
  } catch (err) {
    console.error('[payment-ops] phase0-validation-gates:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/phase0/incident-drill', (req, res) => {
  try {
    const row = db.insertIncidentDrill({
      drill_type: req.body?.drill_type || 'tabletop',
      scenario: req.body?.scenario || 'phase0_payment_security',
      outcome: req.body?.outcome || null,
      retro_closed: !!req.body?.retro_closed,
      evidence_url: req.body?.evidence_url || null,
      conducted_by: req.body?.conducted_by || (req.admin?.email || 'admin'),
      conducted_at: req.body?.conducted_at || new Date().toISOString()
    });
    return res.json({ success: true, drill: row });
  } catch (err) {
    console.error('[payment-ops] phase0 incident-drill:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/phase0/incident-drill', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const items = db.listIncidentDrills(limit);
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    console.error('[payment-ops] phase0 incident-drill list:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/phase0/signoff/:key', (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    const row = db.upsertComplianceSignoff({
      signoff_key: key,
      signed_by: req.body?.signed_by || req.admin?.email || 'admin',
      signed_at: req.body?.signed_at || new Date().toISOString(),
      notes: req.body?.notes || null,
      evidence_url: req.body?.evidence_url || null
    });
    return res.json({ success: true, signoff: row });
  } catch (err) {
    console.error('[payment-ops] phase0 signoff:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/phase0/signoff/:key', (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    const row = db.getComplianceSignoff(key);
    if (!row) return res.status(404).json({ success: false, error: 'signoff_not_found' });
    return res.json({ success: true, signoff: row });
  } catch (err) {
    console.error('[payment-ops] phase0 signoff get:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
