'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');

const DEFAULT_POLICY = {
  version: 'v1',
  weights: {
    npi_exact: 0.4,
    payer_id_exact: 0.3,
    fuzzy_agreement: 0.2
  },
  penalties: {
    state_mismatch: 0.1
  },
  thresholds: {
    auto_merge_min: 0.9,
    merge_review_min: 0.7,
    review_min: 0.4
  }
};

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n || 0)));
}

function normalizePolicy(raw) {
  const base = raw || DEFAULT_POLICY;
  return {
    version: base.version || 'v1',
    weights: {
      npi_exact: Number(base?.weights?.npi_exact ?? 0.4),
      payer_id_exact: Number(base?.weights?.payer_id_exact ?? 0.3),
      fuzzy_agreement: Number(base?.weights?.fuzzy_agreement ?? 0.2)
    },
    penalties: {
      state_mismatch: Number(base?.penalties?.state_mismatch ?? 0.1)
    },
    thresholds: {
      auto_merge_min: Number(base?.thresholds?.auto_merge_min ?? 0.9),
      merge_review_min: Number(base?.thresholds?.merge_review_min ?? 0.7),
      review_min: Number(base?.thresholds?.review_min ?? 0.4)
    }
  };
}

function ensureActivePolicy(policy = DEFAULT_POLICY) {
  const requested = normalizePolicy(policy);
  const existing = db.getActivePayorResolutionPolicy();
  if (existing && existing.version === requested.version) {
    try {
      return normalizePolicy({ version: existing.version, ...JSON.parse(existing.policy_json || '{}') });
    } catch (_) {
      return normalizePolicy({ version: existing.version });
    }
  }

  // Promote requested policy version to active (supports intentional policy tuning runs).
  db.upsertPayorResolutionPolicy({
    version: requested.version,
    policy_json: requested,
    active: 1
  });
  db.activatePayorResolutionPolicy(requested.version);
  return requested;
}

function computeDecision(row, policy) {
  const reasons = [];
  const npiExact = !!(row.left_raw_npi && row.right_raw_npi && String(row.left_raw_npi) === String(row.right_raw_npi));
  const payerIdExact = !!(row.left_raw_payer_id && row.right_raw_payer_id && String(row.left_raw_payer_id) === String(row.right_raw_payer_id));
  const fuzzyAgreement = clamp01(
    (Number(row.jaro_winkler || 0) + Number(row.token_sort_ratio || 0) + Number(row.token_set_ratio || 0)) / 3
  );

  let score = 0;
  if (npiExact) {
    score += policy.weights.npi_exact;
    reasons.push('npi_exact');
  }
  if (payerIdExact) {
    score += policy.weights.payer_id_exact;
    reasons.push('payer_id_exact');
  }
  score += (fuzzyAgreement * policy.weights.fuzzy_agreement);
  reasons.push(`fuzzy=${Number(fuzzyAgreement.toFixed(3))}`);

  const leftState = String(row.left_state || '').trim().toUpperCase();
  const rightState = String(row.right_state || '').trim().toUpperCase();
  if (leftState && rightState && leftState !== rightState) {
    score -= policy.penalties.state_mismatch;
    reasons.push('penalty_state_mismatch');
  }

  score = Number(clamp01(score).toFixed(6));
  let decision = 'review_candidate';
  let autoResolved = false;
  if (score >= policy.thresholds.auto_merge_min) {
    decision = 'auto_merge';
    autoResolved = true;
  } else if (score >= policy.thresholds.merge_review_min) {
    decision = 'merge_review_flag';
  } else if (score < policy.thresholds.review_min) {
    decision = 'distinct';
  }
  return {
    final_score: Number(score.toFixed(6)),
    decision,
    reason_codes_json: reasons,
    auto_resolved: autoResolved
  };
}

function runCompositeScoring({
  batchId = null,
  scorerVersion = 'v1',
  policy = DEFAULT_POLICY,
  limit = 50000,
  offset = 0
} = {}) {
  const activePolicy = ensureActivePolicy(policy);
  const rows = db.getPayorCandidatesWithScores({ batchId, scorerVersion, limit, offset });
  const decisions = rows.map((row) => {
    const out = computeDecision(row, activePolicy);
    return {
      id: `payor_dec_${uuidv4()}`,
      candidate_id: row.candidate_id,
      final_score: out.final_score,
      decision: out.decision,
      reason_codes_json: out.reason_codes_json,
      policy_version: activePolicy.version,
      auto_resolved: out.auto_resolved
    };
  });
  const upserted = db.upsertPayorResolutionDecisions(decisions);
  return {
    batch_id: batchId,
    scorer_version: scorerVersion,
    policy_version: activePolicy.version,
    candidates_scanned: rows.length,
    decisions_upserted: upserted
  };
}

module.exports = {
  DEFAULT_POLICY,
  ensureActivePolicy,
  computeDecision,
  runCompositeScoring
};

