'use strict';

const crypto = require('crypto');
const db = require('../../database');

function hashJson(v) {
  return crypto.createHash('sha256').update(JSON.stringify(v || {})).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

const VERIFIED_IMPACT_STANDARD = {
  required_evidence_fields: ['source', 'reference_id', 'attestation'],
  accepted_verification_methods: ['provider_attestation', 'partner_receipt', 'system_reconciliation', 'manual_audit'],
  rejection_reasons: ['missing_evidence', 'inconsistent_provenance', 'duplicate_claim', 'privacy_violation']
};

function evaluateEvidence(evidence = {}) {
  const missing = VERIFIED_IMPACT_STANDARD.required_evidence_fields.filter((k) => {
    const v = evidence[k];
    return v == null || String(v).trim() === '';
  });
  const method = String(evidence.verification_method || '').trim();
  const methodOk = VERIFIED_IMPACT_STANDARD.accepted_verification_methods.includes(method);
  return {
    ok: missing.length === 0 && methodOk,
    missing_fields: missing,
    verification_method_valid: methodOk
  };
}

function createImpactEvent(payload = {}) {
  const id = payload.id || `impact:${crypto.randomUUID()}`;
  const evidence = payload.evidence || {};
  const evidenceHash = hashJson(evidence);
  const prev = db.getLatestImpactEvidenceHash();
  const chainHash = hashJson({ previous_hash: prev || null, evidence_hash: evidenceHash, event_id: id });
  const inserted = db.insertImpactLedgerEvent({
    id,
    event_type: payload.event_type || 'community_action',
    subject_type: payload.subject_type || null,
    subject_id: payload.subject_id || null,
    provenance_source: payload.provenance_source || 'user_submission',
    verification_state: payload.verification_state || 'pending',
    privacy_classification: payload.privacy_classification || 'public_aggregate',
    quantity: Number(payload.quantity || 0),
    unit: payload.unit || null,
    evidence,
    evidence_hash: evidenceHash,
    previous_evidence_hash: prev || null,
    evidence_chain_hash: chainHash,
    metadata: payload.metadata || {},
    occurred_at: payload.occurred_at || nowIso()
  });
  return inserted;
}

function verifyImpactEvent(eventId, reviewer = 'system') {
  const row = db.listImpactLedgerEvents({ limit: 1000 }).find((r) => r.id === eventId);
  if (!row) throw new Error('impact_event_not_found');
  let evidence = {};
  try { evidence = JSON.parse(row.evidence_json || '{}'); } catch (_) {}
  const check = evaluateEvidence(evidence);
  const state = check.ok ? 'verified' : 'rejected';
  const updated = db.updateImpactLedgerEvent(eventId, {
    verification_state: state,
    metadata: {
      ...(row.metadata_json ? (() => { try { return JSON.parse(row.metadata_json); } catch (_) { return {}; } })() : {}),
      verification_reviewed_by: reviewer,
      verification_reviewed_at: nowIso(),
      verification_check: check
    }
  });
  return { updated, check };
}

function getDelayedAggregateDashboard() {
  const delayHours = Math.max(0, parseInt(process.env.IMPACT_DASHBOARD_DELAY_HOURS || '24', 10) || 24);
  const minSample = Math.max(1, parseInt(process.env.IMPACT_DASHBOARD_MIN_AGGREGATE || '5', 10) || 5);
  const cutoff = new Date(Date.now() - delayHours * 60 * 60 * 1000).toISOString();
  const rows = db.db.prepare(`
    SELECT event_type, COUNT(*) AS n, SUM(quantity) AS qty
    FROM impact_ledger_events
    WHERE verification_state = 'verified'
      AND privacy_classification = 'public_aggregate'
      AND datetime(occurred_at) <= datetime(?)
    GROUP BY event_type
  `).all(cutoff);
  const items = rows
    .map((r) => ({ event_type: r.event_type, count: Number(r.n || 0), quantity_total: Number(r.qty || 0) }))
    .filter((r) => r.count >= minSample);
  return {
    generated_at: nowIso(),
    delayed_by_hours: delayHours,
    min_aggregate_threshold: minSample,
    metrics: items
  };
}

module.exports = {
  VERIFIED_IMPACT_STANDARD,
  evaluateEvidence,
  createImpactEvent,
  verifyImpactEvent,
  getDelayedAggregateDashboard
};

