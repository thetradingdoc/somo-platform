/**
 * CPT code helper (W3-S4.3, M-S4.B)
 *
 * getCptCodeForVisit({ specialty, isNewPatient, urgency, isTelehealth })
 * - 99202-99205 new patient; 99211-99215 established
 * - 90791/90834/90837 Psychiatry
 * - 93000/93306 Cardiology procedural
 * - Emergent → 99285; Urgent → 99204/99205; Routine → 99203/99204
 *
 * Covers all specialties in DIFFERENTIAL_SPECIALTY_MAP.
 */

const CPT_TABLE = {
  // Psychiatry — 90791 (diagnostic), 90834 (45 min), 90837 (60 min)
  Psychiatry: {
    new: { routine: '90791', urgent: '90837', emergent: '90839' },
    established: { routine: '90834', urgent: '90834', emergent: '90839' }
  },
  // Primary/Office — 99202-99205 new, 99211-99215 established
  PrimaryCare: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Cardiology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Pulmonology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Gastroenterology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Endocrinology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  InfectiousDisease: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Orthopedics: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Neurology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Dermatology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Urology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Ophthalmology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  ENT: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  EmergencyMedicine: {
    new: { routine: '99285', urgent: '99285', emergent: '99285' },
    established: { routine: '99285', urgent: '99285', emergent: '99285' }
  },
  ObstetricsGynecology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Pediatrics: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  },
  Oncology: {
    new: { routine: '99203', urgent: '99204', emergent: '99285' },
    established: { routine: '99213', urgent: '99214', emergent: '99285' }
  }
};

/**
 * Get CPT code for a visit based on specialty, patient status, urgency.
 *
 * @param {Object} opts
 * @param {string} opts.specialty - e.g. Psychiatry, Cardiology, PrimaryCare
 * @param {boolean} [opts.isNewPatient=true] - New vs established patient
 * @param {string} [opts.urgency='routine'] - routine | urgent | emergent
 * @param {boolean} [opts.isTelehealth=false] - Telehealth visits (same codes for now; modifier could be added later)
 * @returns {string} CPT code
 */
function getCptCodeForVisit(opts = {}) {
  const specialty = opts.specialty || 'PrimaryCare';
  const isNewPatient = opts.isNewPatient !== false;
  const urgency = (opts.urgency || 'routine').toLowerCase();
  const tier = urgency === 'emergent' ? 'emergent' : urgency === 'urgent' ? 'urgent' : 'routine';
  const patientTier = isNewPatient ? 'new' : 'established';

  const table = CPT_TABLE[specialty] || CPT_TABLE.PrimaryCare;
  const row = table[patientTier];
  const code = row ? row[tier] : null;

  return code || CPT_TABLE.PrimaryCare[patientTier][tier] || '99213';
}

/**
 * Session 3: prefer spine primary_cpt; fallback to static table with logged reason.
 */
const { CODING_CONFIDENCE_THRESHOLD } = require('../config/coding-thresholds');

function codingSpineOnly() {
  return process.env.CODING_SPINE_ONLY === '1'
    || String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function resolveCptForVisit(opts = {}) {
  const threshold = opts.confidenceThreshold ?? CODING_CONFIDENCE_THRESHOLD;
  const spineCpt = opts.spineCpt || opts.primary_cpt || null;
  const confidence = opts.confidence ?? 0;
  const specialty = opts.specialty || 'PrimaryCare';
  const isNewPatient = opts.isNewPatient !== false;
  const urgency = opts.urgency || 'routine';

  if (spineCpt && confidence >= threshold) {
    return { code: spineCpt, code_source: 'spine', fallback_reason: null };
  }

  if (codingSpineOnly()) {
    let fallback_reason = 'no_spine_cpt';
    if (spineCpt && confidence < threshold) fallback_reason = 'low_confidence';
    return { code: null, code_source: 'hitl_required', fallback_reason };
  }

  const code = getCptCodeForVisit({ specialty, isNewPatient, urgency });
  let fallback_reason = 'no_spine_cpt';
  if (spineCpt && confidence < threshold) fallback_reason = 'low_confidence';
  if (process.env.CPT_FALLBACK_LOG !== '0') {
    console.log('[cpt-helper] fallback CPT selected', {
      code_source: 'fallback',
      fallback_reason,
      spineCpt,
      confidence,
      threshold,
      selected: code
    });
  }
  return { code, code_source: 'fallback', fallback_reason };
}

module.exports.codingSpineOnly = codingSpineOnly;

/**
 * W3-S4.5: Map appointment type display names to specialty for getCptCodeForVisit.
 * Replaces hardcoded 90834 with resolved CPT per specialty/urgency.
 */
const APPOINTMENT_TYPE_TO_SPECIALTY = {
  'Mental Health Consultation': 'Psychiatry',
  'Crisis Intervention': 'Psychiatry',
  'Follow-up Session': 'Psychiatry',
  'Initial Assessment': 'Psychiatry',
  'Group Therapy': 'Psychiatry',
  'Medication Review': 'Psychiatry',
  'Cardiology Consultation': 'Cardiology',
  'Pulmonology Consultation': 'Pulmonology',
  'Gastroenterology Consultation': 'Gastroenterology',
  'Endocrinology Consultation': 'Endocrinology',
  'General Consult': 'PrimaryCare'
};

/** Dental CDT phrase → code (admin front-desk path). */
const DENTAL_CDT_TRIGGERS = [
  { patterns: [/\bcleaning\b/i, /\bprophylaxis\b/i, /\bhygiene\b/i], adult: 'D1110', child: 'D1120' },
  { patterns: [/\bnew patient\b/i, /\bfirst time\b/i], code: 'D0150' },
  { patterns: [/\bcheckup\b/i, /\bcheck.?up\b/i, /\bperiodic\b/i], code: 'D0120' },
  { patterns: [/\btooth\s*pain\b/i, /\bproblem\b/i, /\bhurts\b/i], code: 'D0140' },
  { patterns: [/\bfull.+x.?ray\b/i, /\bpanoramic\b/i, /\bpanorex\b/i], code: 'D0330' },
  { patterns: [/\bbitewing\b/i], code: 'D0274' },
  { patterns: [/\bfilling\b/i, /\bcavity\b/i], code: 'D2391' },
  { patterns: [/\broot canal\b/i], code: 'D3310' },
  { patterns: [/\bdeep cleaning\b/i], code: 'D4341' },
  { patterns: [/\bperio\b/i, /\bperiodontal\b/i, /\bperio maintenance\b/i], code: 'D4910' },
  { patterns: [/\bcrown\b/i, /\bcap\b/i], code: 'D2740' },
  { patterns: [/\bimplant\b/i, /\bimplant consult\b/i], code: 'D6010' },
  { patterns: [/\bortho\b/i, /\bbraces\b/i, /\binvisalign\b/i], code: 'D8080' },
  { patterns: [/\bextraction\b/i, /\bpull.+tooth\b/i], code: 'D7140' },
  { patterns: [/\bemergency\b/i, /\bin pain\b/i], code: 'D9110' },
  { patterns: [/\bfluoride\b/i], code: 'D1206' },
  { patterns: [/\bsealant\b/i], code: 'D1351' }
];

const DENTAL_CDT_TABLE = {
  Dental: {
    new: { routine: 'D0150', urgent: 'D0140', emergent: 'D9110' },
    established: { routine: 'D0120', urgent: 'D0140', emergent: 'D9110' }
  }
};

function isDentalCdt(code) {
  return /^D\d{4}$/i.test(String(code || '').trim());
}

function resolveDentalCdtFromReason(reasonText, opts = {}) {
  const reason = String(reasonText || '').trim().toLowerCase();
  const isChild = opts.isChild === true;
  for (const entry of DENTAL_CDT_TRIGGERS) {
    if (!entry.patterns.some((re) => re.test(reason))) continue;
    const code = entry.adult
      ? (isChild ? entry.child || entry.adult : entry.adult)
      : entry.code;
    return { code, matched_phrase: reason };
  }
  return { code: null, matched_phrase: null };
}

function getDentalCdtForVisit(opts = {}) {
  const isNewPatient = opts.isNewPatient !== false;
  const urgency = (opts.urgency || 'routine').toLowerCase();
  const tier = urgency === 'emergent' ? 'emergent' : urgency === 'urgent' ? 'urgent' : 'routine';
  const patientTier = isNewPatient ? 'new' : 'established';
  const table = DENTAL_CDT_TABLE.Dental;
  return table[patientTier]?.[tier] || 'D0120';
}

module.exports = {
  getCptCodeForVisit,
  resolveCptForVisit,
  CPT_TABLE,
  APPOINTMENT_TYPE_TO_SPECIALTY,
  DENTAL_CDT_TRIGGERS,
  DENTAL_CDT_TABLE,
  isDentalCdt,
  resolveDentalCdtFromReason,
  getDentalCdtForVisit
};
