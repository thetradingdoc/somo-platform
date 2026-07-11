'use strict';

/**
 * Minimal codebook rows for Jest :memory: DB — mirrors ci-coding-db-fixture.cjs codes.
 */
function seedMinimalCodebook(db) {
  if (!db) return;

  function ensureCode(table, code, description) {
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE code = ?`).get(code);
    if (exists) return;
    db.prepare(
      `INSERT INTO ${table} (code, description, created_at) VALUES (?, ?, datetime('now'))`
    ).run(code, description);
  }

  const codes = [
    ['icd10_codes', 'K29.70', 'Gastritis, unspecified, without bleeding'],
    ['icd10_codes', 'Z00.00', 'Encounter for general adult medical examination'],
    ['icd10_codes', 'Z01.20', 'Encounter for dental examination and cleaning'],
    ['icd10_codes', 'F32.9', 'Major depressive disorder, single episode, unspecified'],
    ['cpt_codes', '99213', 'Office outpatient visit est patient level 3'],
    ['cpt_codes', '99203', 'Office outpatient visit new patient level 3'],
    ['cpt_codes', '99214', 'Office outpatient visit est patient level 4'],
    ['cpt_codes', '90834', 'Psychotherapy 45 minutes'],
    ['cpt_codes', '90791', 'Psychiatric diagnostic evaluation'],
    ['cpt_codes', '99395', 'Periodic comprehensive preventive medicine'],
    ['cpt_codes', 'D1110', 'Prophylaxis adult'],
    ['hcpcs_codes', 'G0438', 'Annual wellness visit initial'],
    ['cdt_codes', 'D1110', 'Prophylaxis adult']
  ];

  for (const [table, code, desc] of codes) {
    try {
      ensureCode(table, code, desc);
    } catch (_) {
      /* table may not exist in partial test DB */
    }
  }
}

module.exports = { seedMinimalCodebook };
