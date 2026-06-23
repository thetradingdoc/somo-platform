#!/usr/bin/env node
/**
 * Seed sample fee schedules for common payers (BCBS, Aetna, UHC).
 * Illustrative amounts only - replace with real contracted rates.
 *
 * Usage: node scripts/data/seed-fee-schedules.js (from middleware-platform)
 */

const db = require('../../database');

const PAYERS = ['BCBS', 'AETNA', 'UHC'];

// Sample allowed amounts (illustrative; replace with real contracted rates)
const SAMPLE_RATES = {
  '99213': 95,    // Office visit, established, low
  '99214': 140,   // Office visit, established, moderate
  '99215': 195,   // Office visit, established, high
  '99203': 135,   // Office visit, new, low
  '99204': 230,   // Office visit, new, moderate
  '99205': 300,   // Office visit, new, high
  '99385': 185,   // Preventive, new patient, 18-39
  '99395': 165,   // Preventive, established, 18-39
  '99391': 145,   // Well child, established
  '36415': 25,    // Venipuncture
  '80053': 18,    // Comprehensive metabolic panel
  '85025': 12,    // CBC with diff
};

function seed() {
  const items = [];
  for (const payer of PAYERS) {
    for (const [cpt, amount] of Object.entries(SAMPLE_RATES)) {
      items.push({
        payer_id: payer,
        cpt_code: cpt,
        allowed_amount: amount,
        in_network: true,
        source: 'seed'
      });
    }
  }

  const result = db.bulkUpsertFeeSchedules(items);
  console.log(`Seeded ${result.inserted} fee schedule rows for ${PAYERS.join(', ')}`);
}

seed();
