'use strict';

/**
 * Realistic NCCI PTP subset — common E/M + procedure and procedure + procedure pairs.
 * Sample data for BL-01 import (not full CMS NCCI bundle).
 */

const SOURCE_FILE = 'ncci-pairs-sample-2025';

/** @type {Array<{ column1_code: string, column2_code: string, modifier_indicator?: number, reason: string }>} */
const NCCI_SAMPLE_PAIRS = [
  // E/M + venipuncture / lab draw
  { column1_code: '99213', column2_code: '36415', modifier_indicator: 1, reason: 'E/M with venipuncture — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '36415', modifier_indicator: 1, reason: 'Moderate E/M with venipuncture — modifier 25 on E/M' },
  { column1_code: '99215', column2_code: '36415', modifier_indicator: 1, reason: 'High E/M with venipuncture — modifier 25 on E/M' },
  { column1_code: '99203', column2_code: '36415', modifier_indicator: 1, reason: 'New patient E/M with venipuncture — modifier 25 on E/M' },
  { column1_code: '99204', column2_code: '36415', modifier_indicator: 1, reason: 'New patient moderate E/M with venipuncture — modifier 25 on E/M' },
  // E/M + EKG
  { column1_code: '99213', column2_code: '93000', modifier_indicator: 1, reason: 'E/M with EKG — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '93000', modifier_indicator: 1, reason: 'Moderate E/M with EKG — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '93005', modifier_indicator: 1, reason: 'E/M with EKG tracing only — modifier 25 on E/M' },
  // E/M + injection / vaccine admin
  { column1_code: '99213', column2_code: '96372', modifier_indicator: 1, reason: 'E/M with therapeutic injection — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '96372', modifier_indicator: 1, reason: 'Moderate E/M with therapeutic injection — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '90471', modifier_indicator: 1, reason: 'E/M with immunization admin — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '90472', modifier_indicator: 1, reason: 'E/M with additional vaccine admin — modifier 25 on E/M' },
  // E/M + minor procedures
  { column1_code: '99213', column2_code: '69210', modifier_indicator: 1, reason: 'E/M with cerumen removal — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '11102', modifier_indicator: 1, reason: 'E/M with tangential biopsy — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '11104', modifier_indicator: 1, reason: 'E/M with punch biopsy — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '12001', modifier_indicator: 1, reason: 'E/M with simple laceration repair — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '12002', modifier_indicator: 1, reason: 'E/M with intermediate laceration repair — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '11730', modifier_indicator: 1, reason: 'E/M with nail avulsion — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '20610', modifier_indicator: 1, reason: 'E/M with major joint injection — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '20605', modifier_indicator: 1, reason: 'E/M with intermediate joint injection — modifier 25 on E/M' },
  // E/M + point-of-care tests
  { column1_code: '99213', column2_code: '87804', modifier_indicator: 1, reason: 'E/M with rapid influenza test — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '87880', modifier_indicator: 1, reason: 'E/M with rapid strep test — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '81002', modifier_indicator: 1, reason: 'E/M with urinalysis — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '83036', modifier_indicator: 1, reason: 'E/M with HbA1c — modifier 25 on E/M' },
  // E/M + dermatology
  { column1_code: '99213', column2_code: '17000', modifier_indicator: 1, reason: 'E/M with destruction premalignant lesion — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '17110', modifier_indicator: 1, reason: 'E/M with destruction benign lesions — modifier 25 on E/M' },
  // E/M + ENT / eye
  { column1_code: '99213', column2_code: '31575', modifier_indicator: 1, reason: 'E/M with laryngoscopy — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '65222', modifier_indicator: 1, reason: 'E/M with foreign body removal cornea — modifier 25 on E/M' },
  // E/M + pulmonary
  { column1_code: '99214', column2_code: '94640', modifier_indicator: 1, reason: 'E/M with nebulizer treatment — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '94010', modifier_indicator: 1, reason: 'E/M with spirometry — modifier 25 on E/M' },
  // Procedure + procedure (distinct service)
  { column1_code: '11102', column2_code: '11104', modifier_indicator: 1, reason: 'Biopsy bundles — modifier 59 on secondary' },
  { column1_code: '20610', column2_code: '20605', modifier_indicator: 1, reason: 'Multiple joint injections — modifier 59 on secondary' },
  { column1_code: '12001', column2_code: '12002', modifier_indicator: 1, reason: 'Multiple laceration repairs — modifier 59 on secondary' },
  { column1_code: '17000', column2_code: '17110', modifier_indicator: 1, reason: 'Multiple lesion destruction — modifier 59 on secondary' },
  { column1_code: '36415', column2_code: '80053', modifier_indicator: 0, reason: 'Venipuncture bundled into comprehensive metabolic panel' },
  { column1_code: '36415', column2_code: '85025', modifier_indicator: 0, reason: 'Venipuncture bundled into CBC panel' },
  { column1_code: '93000', column2_code: '93005', modifier_indicator: 0, reason: 'EKG global bundled into tracing component' },
  { column1_code: '90471', column2_code: '90472', modifier_indicator: 1, reason: 'Additional vaccine admin — modifier 59 on second' },
  { column1_code: '99213', column2_code: '99214', modifier_indicator: 0, reason: 'Same-day E/M level conflict' },
  { column1_code: '99214', column2_code: '99215', modifier_indicator: 0, reason: 'Same-day E/M level conflict' },
  { column1_code: '99203', column2_code: '99204', modifier_indicator: 0, reason: 'Same-day new patient E/M level conflict' },
  // Surgery + E/M (global period)
  { column1_code: '27447', column2_code: '99213', modifier_indicator: 1, reason: 'Post-op E/M during global — modifier 24 on E/M' },
  { column1_code: '66984', column2_code: '99213', modifier_indicator: 1, reason: 'Post-op E/M during global — modifier 24 on E/M' },
  { column1_code: '47562', column2_code: '99214', modifier_indicator: 1, reason: 'Post-op E/M during global — modifier 24 on E/M' },
  // Imaging + E/M (same day)
  { column1_code: '99214', column2_code: '71046', modifier_indicator: 1, reason: 'E/M with chest X-ray — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '71046', modifier_indicator: 1, reason: 'E/M with chest X-ray — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '76705', modifier_indicator: 1, reason: 'E/M with abdominal ultrasound — modifier 25 on E/M' },
  // Mental health E/M + psychotherapy
  { column1_code: '99213', column2_code: '90833', modifier_indicator: 1, reason: 'E/M with psychotherapy add-on — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '90833', modifier_indicator: 1, reason: 'Moderate E/M with psychotherapy add-on — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '90836', modifier_indicator: 1, reason: 'E/M with extended psychotherapy add-on — modifier 25 on E/M' },
  // GI
  { column1_code: '99214', column2_code: '43239', modifier_indicator: 1, reason: 'E/M with EGD biopsy — modifier 25 on E/M' },
  { column1_code: '99213', column2_code: '45378', modifier_indicator: 1, reason: 'E/M with colonoscopy — modifier 25 on E/M' },
  // OB/GYN
  { column1_code: '99213', column2_code: '57454', modifier_indicator: 1, reason: 'E/M with colposcopy — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '58100', modifier_indicator: 1, reason: 'E/M with endometrial biopsy — modifier 25 on E/M' },
  // Ortho
  { column1_code: '99213', column2_code: '29125', modifier_indicator: 1, reason: 'E/M with forearm splint — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '29540', modifier_indicator: 1, reason: 'E/M with strapping — modifier 25 on E/M' },
  // Urology
  { column1_code: '99213', column2_code: '51701', modifier_indicator: 1, reason: 'E/M with bladder catheter — modifier 25 on E/M' },
  { column1_code: '99214', column2_code: '52265', modifier_indicator: 1, reason: 'E/M with cystoscopy — modifier 25 on E/M' }
];

function normalizePairRow(row) {
  const column1 = String(row.column1_code || '').trim().toUpperCase();
  const column2 = String(row.column2_code || '').trim().toUpperCase();
  if (!column1 || !column2) return null;
  return {
    id: `ncci_${column1}_${column2}`,
    column1_code: column1,
    column2_code: column2,
    modifier_indicator: row.modifier_indicator != null ? Number(row.modifier_indicator) : 1,
    reason: String(row.reason || 'NCCI PTP edit').trim(),
    rule_type: 'ncci_ptp',
    effective_date: row.effective_date || '2025-01-01',
    source_file: row.source_file || SOURCE_FILE
  };
}

function buildNcciPairRows(pairs = NCCI_SAMPLE_PAIRS) {
  const byId = new Map();
  for (const row of pairs) {
    const normalized = normalizePairRow(row);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return Array.from(byId.values());
}

function countEmProcedurePairs(pairs = NCCI_SAMPLE_PAIRS) {
  const emRe = /^99[0-9]{3}$/;
  return pairs.filter((p) => emRe.test(String(p.column1_code)) && !emRe.test(String(p.column2_code))).length;
}

module.exports = {
  SOURCE_FILE,
  NCCI_SAMPLE_PAIRS,
  normalizePairRow,
  buildNcciPairRows,
  countEmProcedurePairs
};
