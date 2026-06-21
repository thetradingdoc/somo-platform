'use strict';

/**
 * Phase 1 D1 — pilot payer + fee schedule seed (canonical BCBS_PILOT).
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../database').db;

/** Canonical payer id shared by plan_rules and fee_schedules */
const PILOT_PAYER = 'BCBS_PILOT';

const PLANS = [
  { id: 'plan_x', name: 'Pilot Plan X (E/M copays)' },
  { id: 'plan_y', name: 'Pilot Plan Y ($0 E/M copay)' }
];

const EM_NEW = ['99202', '99203', '99204', '99205'];
const EM_EST = ['99211', '99212', '99213', '99214', '99215'];
const MH_EVAL = ['90791', '90792'];
const MH_THERAPY = ['90834', '90837'];
const WELLNESS = ['G0438', 'G0439'];
const PREVENTIVE_NEW = ['99385', '99386', '99387'];
const PREVENTIVE_EST = ['99395', '99396', '99397'];

function buildRules() {
  const rules = [];
  for (const cpt of EM_NEW) {
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_x', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 40, requires_pa: 0 });
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_y', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0 });
  }
  for (const cpt of EM_EST) {
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_x', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 35, requires_pa: 0 });
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_y', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0 });
  }
  for (const cpt of MH_EVAL) {
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_x', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 50, requires_pa: 0 });
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_y', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0 });
  }
  for (const cpt of MH_THERAPY) {
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_x', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 30, requires_pa: 0 });
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_y', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0 });
  }
  for (const cpt of [...WELLNESS, ...PREVENTIVE_NEW, ...PREVENTIVE_EST]) {
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_x', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0 });
    rules.push({ payer_id: PILOT_PAYER, plan_id: 'plan_y', code_pattern: cpt, covered: 1, copay_type: 'flat', copay_value: 0, requires_pa: 0 });
  }
  return rules;
}

const SAMPLE_RATES = {
  99213: 95, 99214: 140, 99215: 195, 99203: 135, 99204: 230, 99205: 300,
  99202: 120, 99211: 45, 99212: 75,
  90791: 220, 90792: 250, 90834: 165, 90837: 210,
  G0438: 185, G0439: 165,
  99385: 200, 99386: 220, 99387: 240, 99395: 180, 99396: 195, 99397: 210
};

function main() {
  const rules = buildRules();
  const insertRule = db.prepare(`
    INSERT OR REPLACE INTO plan_rules (
      id, payer_id, plan_id, code_pattern, covered, copay_type, copay_value, requires_pa, effective_date, rule_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'), '1')
  `);
  for (const rule of rules) {
    insertRule.run(uuidv4(), rule.payer_id, rule.plan_id, rule.code_pattern, rule.covered, rule.copay_type, rule.copay_value, rule.requires_pa);
  }

  if (typeof db.upsertFeeSchedule === 'function') {
    for (const [cpt, amount] of Object.entries(SAMPLE_RATES)) {
      db.upsertFeeSchedule({
        payer_id: PILOT_PAYER,
        cpt_code: cpt,
        allowed_amount: amount,
        in_network: true,
        source: 'pilot_seed'
      });
    }
  } else {
    const ins = db.prepare(`
      INSERT OR REPLACE INTO fee_schedules (payer_id, cpt_code, allowed_amount, in_network, source, effective_date)
      VALUES (?, ?, ?, 1, 'pilot_seed', date('now'))
    `);
    for (const [cpt, amount] of Object.entries(SAMPLE_RATES)) {
      ins.run(PILOT_PAYER, cpt, amount);
    }
  }

  console.log(JSON.stringify({
    seeded_rules: rules.length,
    payer_id: PILOT_PAYER,
    plans: PLANS.map((p) => p.id)
  }, null, 2));
}

main();
