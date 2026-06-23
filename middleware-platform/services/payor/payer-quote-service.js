'use strict';

/**
 * Minimal payer quote model (Session 4).
 * compute_visit_quote(icd10, cpt, payer_id, plan_id, options)
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');

const VALID_STATUS = new Set(['hard_number', 'estimate', 'cannot_determine']);

function normalizeCpt(code) {
  return String(code || '').replace(/\./g, '').trim().toUpperCase();
}

function findMatchingRule(payerId, planId, cpt) {
  if (!db.db) return null;
  const cptNorm = normalizeCpt(cpt);
  const rows = db.db.prepare(`
    SELECT * FROM plan_rules
    WHERE payer_id = ? AND plan_id = ?
    ORDER BY LENGTH(code_pattern) DESC
  `).all(payerId, planId);
  for (const row of rows) {
    const pat = String(row.code_pattern || '').trim();
    if (!pat) continue;
    if (pat.endsWith('*')) {
      const prefix = pat.slice(0, -1);
      if (cptNorm.startsWith(prefix)) return row;
    } else if (normalizeCpt(pat) === cptNorm) {
      return row;
    }
  }
  return null;
}

function lookupAllowedAmount(cpt, payerId) {
  if (!db.db) return null;
  try {
    const params = [cpt, normalizeCpt(cpt)];
    let sql = `
      SELECT allowed_amount FROM fee_schedules
      WHERE (cpt_code = ? OR REPLACE(cpt_code, '.', '') = ?)
    `;
    if (payerId) {
      sql += ' AND payer_id = ?';
      params.push(payerId);
    }
    sql += ' ORDER BY effective_date DESC LIMIT 1';
    const row = db.db.prepare(sql).get(...params);
    return row?.allowed_amount != null ? Number(row.allowed_amount) : null;
  } catch (_) {
    return null;
  }
}

function writeQuoteAudit(payload) {
  if (!db.db) return null;
  const id = uuidv4();
  try {
    db.db.prepare(`
      INSERT INTO quote_audit (
        id, call_id, session_id, payer_id, plan_id,
        primary_icd10, primary_cpt, rule_version, inputs_json, result_json,
        status, copay_due_now, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      payload.call_id || null,
      payload.session_id || null,
      payload.payer_id || null,
      payload.plan_id || null,
      payload.primary_icd10 || null,
      payload.primary_cpt || null,
      payload.rule_version || '1',
      JSON.stringify(payload.inputs || {}),
      JSON.stringify(payload.result || {}),
      payload.status || null,
      payload.copay_due_now ?? null
    );
    return id;
  } catch (e) {
    console.warn('[payer-quote] audit write failed:', e.message);
    return null;
  }
}

/**
 * @returns {Promise<object>}
 */
async function computeVisitQuote({
  primary_icd10,
  primary_cpt,
  payer_id,
  plan_id,
  call_id,
  session_id,
  fee_schedule
} = {}) {
  const inputs = { primary_icd10, primary_cpt, payer_id, plan_id };
  const base = {
    copay_due_now: 0,
    covered: false,
    requires_pa: false,
    coverage_confidence: 0,
    status: 'cannot_determine',
    coverage_notes: 'We could not determine your coverage for this visit yet.'
  };

  if (!primary_icd10 || !primary_cpt) {
    const result = {
      ...base,
      coverage_notes: 'We need valid diagnosis and procedure codes before we can quote your visit.'
    };
    writeQuoteAudit({ ...inputs, call_id, session_id, inputs, result, status: result.status });
    return result;
  }

  if (!payer_id || !plan_id) {
    const result = {
      ...base,
      coverage_notes: 'We need your insurance plan on file before we can quote your visit.'
    };
    writeQuoteAudit({ ...inputs, call_id, session_id, inputs, result, status: result.status });
    return result;
  }

  const rule = findMatchingRule(payer_id, plan_id, primary_cpt);
  if (!rule) {
    const result = {
      ...base,
      coverage_notes: `We do not have coverage rules for procedure ${primary_cpt} on your plan yet.`
    };
    writeQuoteAudit({ ...inputs, call_id, session_id, inputs, result, status: result.status });
    return result;
  }

  const covered = rule.covered === 1 || rule.covered === true;
  const requires_pa = rule.requires_pa === 1 || rule.requires_pa === true;
  let copay_due_now = 0;
  if (covered && String(rule.copay_type || '').toLowerCase() === 'flat') {
    copay_due_now = Number(rule.copay_value) || 0;
  } else if (covered && String(rule.copay_type || '').toLowerCase() === 'pct') {
    const allowed = fee_schedule?.allowed_amount ?? lookupAllowedAmount(primary_cpt, payer_id);
    if (allowed != null) {
      copay_due_now = Math.round(allowed * (Number(rule.copay_value) || 0) * 100) / 100;
    }
  }

  const allowedAmount = fee_schedule?.allowed_amount ?? lookupAllowedAmount(primary_cpt, payer_id);
  const hasHardNumber = covered && (copay_due_now >= 0) && (allowedAmount != null || rule.copay_type === 'flat');
  const status = hasHardNumber ? 'hard_number' : (covered ? 'estimate' : 'cannot_determine');

  const coverage_notes = covered
    ? (requires_pa
      ? 'Your plan may cover this visit, but prior authorization may be required.'
      : (status === 'hard_number'
        ? `Your plan covers this visit. Your copay today is $${copay_due_now.toFixed(2)}.`
        : 'Your plan may cover this visit; we can give an estimate after we confirm allowed amounts.'))
    : 'This visit may not be covered under your current plan.';

  const result = {
    copay_due_now,
    covered,
    requires_pa,
    coverage_confidence: status === 'hard_number' ? 0.9 : (covered ? 0.6 : 0.2),
    status: VALID_STATUS.has(status) ? status : 'cannot_determine',
    coverage_notes,
    allowed_amount: allowedAmount,
    rule_id: rule.id,
    rule_version: rule.rule_version || '1'
  };

  writeQuoteAudit({
    call_id,
    session_id,
    payer_id,
    plan_id,
    primary_icd10,
    primary_cpt,
    rule_version: rule.rule_version,
    inputs,
    result,
    status: result.status,
    copay_due_now: result.copay_due_now
  });

  return result;
}

module.exports = {
  computeVisitQuote,
  findMatchingRule,
  writeQuoteAudit
};
