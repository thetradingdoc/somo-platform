'use strict';

const db = require('../database');
const orchestrator = require('./rcm-journey-orchestrator');

function safeJson(v) {
  if (v == null) return null;
  try {
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (_) {
    return null;
  }
}

function getCodingQueue(clinicId, journeyId) {
  const journey = orchestrator.getJourney(clinicId, journeyId);
  if (!journey) return null;
  const intake = safeJson(journey.intake_json) || {};
  const stored = intake.coding_queue || [];

  if (stored.length) return { journey_id: journeyId, codes: stored };

  let codes = [];
  if (journey.claim_id) {
    try {
      const claim = db.db.prepare(`SELECT * FROM insurance_claims WHERE id = ?`).get(journey.claim_id);
      const response = safeJson(claim?.response_data) || {};
      const extracted = response.extracted_codes || response.codes || [];
      codes = (Array.isArray(extracted) ? extracted : []).map((c, i) => ({
        code: c.code || c.cpt || c,
        type: c.type || 'CPT',
        description: c.description || '',
        confidence: c.confidence ?? 0.85 - i * 0.05,
        rationale: c.rationale || 'Suggested from claim/scan extraction',
        status: c.status || 'pending',
      }));
    } catch (_) {}
  }

  if (!codes.length) {
    codes = [
      {
        code: '99213',
        type: 'CPT',
        description: 'Office visit, established patient, low complexity',
        confidence: 0.88,
        rationale: 'Default visit level from appointment type',
        status: 'pending',
      },
    ];
  }
  return { journey_id: journeyId, codes };
}

function updateCodingQueue(clinicId, journeyId, codes) {
  const journey = orchestrator.getJourney(clinicId, journeyId);
  if (!journey) throw new Error('Journey not found');
  const intake = safeJson(journey.intake_json) || {};
  intake.coding_queue = codes;
  orchestrator.patchJourney(clinicId, journeyId, { intake_json: intake });
  const allApproved = codes.length > 0 && codes.every((c) => c.status === 'approved');
  return { codes, all_approved: allApproved };
}

function getCdiChecklist(clinicId, journeyId) {
  const queue = getCodingQueue(clinicId, journeyId);
  if (!queue) return null;
  const intake = safeJson(orchestrator.getJourney(clinicId, journeyId)?.intake_json) || {};
  const resolved = intake.cdi_resolved || {};

  const gaps = [];
  for (const c of queue.codes) {
    if (c.code === '99215' && !resolved['99215_note']) {
      gaps.push({
        id: '99215_note',
        severity: 'high',
        message: 'Code 99215 requires high-complexity decision-making — no supporting note found.',
        actions: ['add_note', 'provider_attestation', 'downcode'],
      });
    }
    if (String(c.type).toUpperCase() === 'CPT' && !resolved[`dx_${c.code}`]) {
      gaps.push({
        id: `dx_${c.code}`,
        severity: 'medium',
        message: `Supporting diagnosis documentation recommended for ${c.code}.`,
        actions: ['add_note', 'downcode'],
      });
    }
  }

  const allGreen = gaps.every((g) => resolved[g.id]);
  return {
    journey_id: journeyId,
    gaps: gaps.map((g) => ({ ...g, resolved: !!resolved[g.id] })),
    all_green: gaps.length === 0 || allGreen,
    resolved_keys: Object.keys(resolved),
  };
}

function resolveCdiGap(clinicId, journeyId, gapId) {
  const journey = orchestrator.getJourney(clinicId, journeyId);
  if (!journey) throw new Error('Journey not found');
  const intake = safeJson(journey.intake_json) || {};
  intake.cdi_resolved = intake.cdi_resolved || {};
  intake.cdi_resolved[gapId] = true;
  orchestrator.patchJourney(clinicId, journeyId, { intake_json: intake });
  return getCdiChecklist(clinicId, journeyId);
}

function assertJourneyReadyForClaimSubmit(clinicId, claimId) {
  const errors = [];
  const journey = db.db
    .prepare(
      `SELECT * FROM rcm_journeys WHERE clinic_id = ? AND claim_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`
    )
    .get(String(clinicId), String(claimId));
  if (!journey) {
    return { ok: true, errors: [], skipped: true };
  }
  const queue = getCodingQueue(clinicId, journey.id);
  if (queue?.codes?.length) {
    const pending = queue.codes.filter((c) => c.status !== 'approved');
    if (pending.length) {
      errors.push(`Medical coding: ${pending.length} code(s) not approved (${pending.map((c) => c.code).join(', ')})`);
    }
  }
  const cdi = getCdiChecklist(clinicId, journey.id);
  if (cdi && !cdi.all_green) {
    const open = (cdi.gaps || []).filter((g) => !g.resolved);
    errors.push(`CDI: ${open.length} documentation gap(s) must be resolved before submit`);
  }
  return { ok: errors.length === 0, errors, journey_id: journey.id };
}

module.exports = {
  getCodingQueue,
  updateCodingQueue,
  getCdiChecklist,
  resolveCdiGap,
  assertJourneyReadyForClaimSubmit,
};
