'use strict';

const db = require('../../database');

function isoDaysAgo(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

function get30DayReconciliationGate() {
  const cutoff = isoDaysAgo(30);
  const unresolved = db.db.prepare(`
    SELECT COUNT(1) AS n
    FROM reconciliation_exceptions
    WHERE status = 'open'
      AND sla_due_at IS NOT NULL
      AND datetime(sla_due_at) < datetime('now')
      AND datetime(created_at) >= datetime(?)
  `).get(cutoff);
  return {
    id: 'reconciliation_no_overdue_30d',
    pass: Number(unresolved?.n || 0) === 0,
    overdue_open_exceptions_30d: Number(unresolved?.n || 0)
  };
}

function getWebhookSignatureCoverageGate() {
  const required = ['stripe', 'circle', 'twilio'];
  const configured = {
    stripe: !!process.env.STRIPE_WEBHOOK_SECRET,
    circle: !!process.env.CIRCLE_WEBHOOK_SECRET,
    twilio: !!process.env.TWILIO_AUTH_TOKEN
  };
  const okCount = required.filter((k) => configured[k]).length;
  return {
    id: 'webhook_signature_coverage',
    pass: okCount === required.length,
    configured,
    required_total: required.length,
    configured_total: okCount
  };
}

function getIncidentDrillGate() {
  const drills = db.listIncidentDrills ? db.listIncidentDrills(200) : [];
  const completed = drills.filter((d) => Number(d.retro_closed || 0) === 1);
  return {
    id: 'incident_drill_completed',
    pass: completed.length > 0,
    drill_count: drills.length,
    retro_closed_count: completed.length
  };
}

function getPrivacyAccessReviewGate() {
  const inv = db.listDataInventory(2000);
  const hasSensitive = inv.filter((r) => Number(r.contains_phi || 0) === 1 || Number(r.contains_pii || 0) === 1);
  const hasRoles = hasSensitive.filter((r) => {
    try { return (JSON.parse(r.access_roles_json || '[]') || []).length > 0; } catch (_) { return false; }
  });
  const signoff = db.getComplianceSignoff ? db.getComplianceSignoff('privacy_access_control_review') : null;
  return {
    id: 'privacy_access_review',
    pass: hasSensitive.length > 0 && hasSensitive.length === hasRoles.length && !!signoff,
    sensitive_datasets: hasSensitive.length,
    with_access_roles: hasRoles.length,
    signed_off: !!signoff
  };
}

function getImpactVerificationSamplingGate() {
  const stats = db.getImpactVerificationStats(30);
  const target = Number(process.env.IMPACT_FP_RATE_TARGET || 0.05);
  const minSamples = Number(process.env.IMPACT_MIN_SAMPLES || 20);
  return {
    id: 'impact_verification_false_positive_rate',
    pass: stats.total_samples >= minSamples && stats.false_positive_rate <= target,
    total_samples: stats.total_samples,
    false_positive_rate: stats.false_positive_rate,
    target_rate: target,
    min_samples: minSamples
  };
}

function getPublicDashboardMethodologyGate() {
  const signoff = db.getComplianceSignoff ? db.getComplianceSignoff('public_dashboard_methodology_signoff') : null;
  return {
    id: 'public_dashboard_methodology_live',
    pass: !!signoff,
    endpoints: ['/api/public/impact/dashboard', '/api/public/impact/methodology'],
    signed_off: !!signoff
  };
}

function evaluatePhase0ValidationGates() {
  const gates = [
    get30DayReconciliationGate(),
    getWebhookSignatureCoverageGate(),
    getIncidentDrillGate(),
    getPrivacyAccessReviewGate(),
    getImpactVerificationSamplingGate(),
    getPublicDashboardMethodologyGate()
  ];
  return {
    generated_at: new Date().toISOString(),
    all_pass: gates.every((g) => !!g.pass),
    gates
  };
}

module.exports = {
  evaluatePhase0ValidationGates
};

