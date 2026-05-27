'use strict';

/**
 * Prior Auth Detection Service
 *
 * Merges multiple signals into a single “is prior auth required?” decision.
 *
 * Signals:
 * - Static CPT rules: Knowledge/rules/prior-auth-rules.json via knowledge-service.requiresPriorAuth()
 * - Payer eligibility hint: Stedi 271 JSON `benefitsInformation[].authOrCertIndicator` persisted on eligibility_checks
 *
 * Note: This detects *requirements*. It does not submit a PA request (278 is not supported by Stedi today).
 */

const knowledgeService = require('./knowledge-service');

/**
 * @param {object} db - database.js module
 * @param {object} args
 * @param {string|null} args.patientId
 * @param {string|null} args.memberId
 * @param {string|null} args.payerId
 * @param {string} args.cptCode
 * @param {string|null} [args.dateOfService]
 * @returns {{ required: boolean|'unknown', sources: string[], eligibility: object|null, ruleRequired: boolean, indicator: string|null }}
 */
function evaluatePriorAuthRequirement(db, args = {}) {
  const cptCode = String(args.cptCode || '').trim();
  const payerId = args.payerId ? String(args.payerId).trim() : null;
  const memberId = args.memberId ? String(args.memberId).trim() : null;

  const sources = [];
  const ruleRequired = cptCode ? !!knowledgeService.requiresPriorAuth(cptCode) : false;
  if (ruleRequired) sources.push('rules');

  let elig = null;
  let indicator = null; // 'Y' | 'N' | 'U'
  try {
    if (db?.getLatestEligibilityCheckForMember && payerId && memberId) {
      elig = db.getLatestEligibilityCheckForMember({ payer_id: payerId, member_id: memberId, service_code: cptCode }) || null;
      const raw = elig?.prior_auth_indicator || null;
      indicator = raw ? String(raw).trim().toUpperCase() : null;
      if (indicator === 'Y' || indicator === 'N' || indicator === 'U') sources.push('271');
    }
  } catch (_) {}

  // Merge logic (minimal, conservative):
  // - 'Y' => required
  // - 'U' => unknown unless rules already require it
  // - 'N' => not required, but if rules say required, flag as unknown (conflict)
  if (indicator === 'Y') return { required: true, sources, eligibility: elig, ruleRequired, indicator };
  if (indicator === 'U') return { required: ruleRequired ? true : 'unknown', sources, eligibility: elig, ruleRequired, indicator };
  if (indicator === 'N') {
    if (ruleRequired) return { required: 'unknown', sources: [...sources, 'rules_conflict'], eligibility: elig, ruleRequired, indicator };
    return { required: false, sources, eligibility: elig, ruleRequired, indicator };
  }

  return { required: ruleRequired ? true : 'unknown', sources, eligibility: elig, ruleRequired, indicator };
}

module.exports = {
  evaluatePriorAuthRequirement
};

