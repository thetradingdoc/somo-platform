'use strict';

/**
 * Phase 2 — NYC dental payer plan_rules + fee_schedules seed.
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../database').db;

const DENTAL_PAYERS = [
  { id: 'DELTA_DENTAL_NY', name: 'Delta Dental of New York' },
  { id: 'CIGNA_DENTAL', name: 'Cigna Dental' },
  { id: 'AETNA_DENTAL', name: 'Aetna Dental' },
  { id: 'METLIFE_DENTAL', name: 'MetLife Dental' },
  { id: 'GUARDIAN_DENTAL', name: 'Guardian Dental' },
  { id: 'EMPIRE_BCBS_DENTAL', name: 'Empire BCBS Dental' }
];

const DENTAL_CDTS = ['D1110', 'D1120', 'D0120', 'D0150', 'D0140', 'D0274', 'D2391'];

function seed() {
  if (!db) throw new Error('DB not ready');
  const insertRule = db.prepare(`
    INSERT OR REPLACE INTO plan_rules (
      id, payer_id, plan_id, code_pattern, covered, copay_type, copay_value, requires_pa, rule_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFee = db.prepare(`
    INSERT OR REPLACE INTO fee_schedules (id, payer_id, cpt_code, allowed_amount, effective_date)
    VALUES (?, ?, ?, ?, date('now'))
  `);

  for (const payer of DENTAL_PAYERS) {
    for (const cdt of DENTAL_CDTS) {
      insertRule.run(
        uuidv4(),
        payer.id,
        'dental_ppo',
        cdt,
        1,
        'flat',
        cdt === 'D1110' || cdt === 'D1120' ? 0 : 35,
        0,
        '1'
      );
      insertFee.run(uuidv4(), payer.id, cdt, 120);
    }
    insertRule.run(uuidv4(), payer.id, 'dental_ppo', 'D*', 1, 'flat', 35, 0, '1');
  }
  console.log(`Seeded dental plan_rules for ${DENTAL_PAYERS.length} payers`);
}

if (require.main === module) {
  seed();
}

module.exports = { seed, DENTAL_PAYERS, DENTAL_CDTS };
