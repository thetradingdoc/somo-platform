/**
 * Settlement Rules Service
 * Evaluates claims against configurable rules for auto-approve vs manual review.
 * Enables logic-based settlement release for autonomous financial infrastructure.
 */

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/settlement-rules.json');
let rulesConfig = null;

function loadRules() {
  if (rulesConfig) return rulesConfig;
  try {
    if (fs.existsSync(RULES_PATH)) {
      rulesConfig = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
      return rulesConfig;
    }
  } catch (error) {
    console.warn('⚠️  Failed to load settlement rules:', error.message);
  }
  rulesConfig = { defaultAction: 'manual_review', rules: [] };
  return rulesConfig;
}

/**
 * Evaluate a claim against settlement rules.
 *
 * @param {Object} params
 * @param {Object} params.claim - Claim from database
 * @param {Object} params.claimDetails - Parsed response_data (coding, pricing)
 * @param {Object} params.eobCalculation - EOB result (totals, lineItems)
 * @param {Object} params.eligibility - Eligibility check (optional)
 * @returns {Object} { action: 'auto_approve'|'manual_review', reason, matchedRuleId }
 */
function evaluateSettlementRules({ claim, claimDetails = {}, eobCalculation = {}, eligibility = {} }) {
  const config = loadRules();
  const amount = parseFloat(claim?.total_amount || eobCalculation?.totals?.amountBilled || 0);
  const planPaid = parseFloat(eobCalculation?.totals?.planPaid || claim?.insurance_amount || 0);
  const payerId = (claim?.payer_id || '').toUpperCase();
  const codingBand = claimDetails?.coding?.band || null;
  const codingConfidence =
    claimDetails?.coding?.codingConfidence ??
    claimDetails?.pricing?.codingConfidence ??
    null;

  // Build context for rule evaluation
  const ctx = {
    amount,
    planPaid,
    payerId,
    codingBand,
    codingConfidence: codingConfidence != null ? parseFloat(codingConfidence) : null,
    claim
  };

  // Evaluate rules in order; first match wins
  for (const rule of config.rules || []) {
    if (matchesRule(rule, ctx)) {
      return {
        action: rule.action || config.defaultAction,
        reason: rule.description || `Matched rule: ${rule.id}`,
        matchedRuleId: rule.id
      };
    }
  }

  return {
    action: config.defaultAction || 'manual_review',
    reason: 'No rules matched - using default',
    matchedRuleId: null
  };
}

function matchesRule(rule, ctx) {
  const cond = rule.conditions || {};
  if (!cond || Object.keys(cond).length === 0) return false;

  // codingConfidence: { min, max }
  if (cond.codingConfidence) {
    const c = ctx.codingConfidence;
    if (c == null) return false;
    if (cond.codingConfidence.min != null && c < cond.codingConfidence.min) return false;
    if (cond.codingConfidence.max != null && c > cond.codingConfidence.max) return false;
  }

  // amount: { min, max }
  if (cond.amount) {
    const a = ctx.amount;
    if (cond.amount.min != null && a < cond.amount.min) return false;
    if (cond.amount.max != null && a > cond.amount.max) return false;
  }

  // payerWhitelist: array of payer IDs
  if (cond.payerWhitelist && Array.isArray(cond.payerWhitelist)) {
    const allowed = cond.payerWhitelist.map(p => (p || '').toUpperCase());
    if (!allowed.includes(ctx.payerId)) return false;
  }

  // codingBand: exact match
  if (cond.codingBand && cond.codingBand !== ctx.codingBand) return false;

  return true;
}

/**
 * Check if settlement should proceed (for strict mode).
 * When SETTLEMENT_STRICT_AUTO=1, approval is only allowed when rules say auto_approve.
 *
 * @param {Object} evaluation - Result from evaluateSettlementRules
 * @returns {boolean}
 */
function shouldAllowApproval(evaluation) {
  const strict = process.env.SETTLEMENT_STRICT_AUTO === '1' || process.env.SETTLEMENT_STRICT_AUTO === 'true';
  if (!strict) return true;
  return evaluation.action === 'auto_approve';
}

module.exports = {
  evaluateSettlementRules,
  shouldAllowApproval,
  loadRules
};
