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

const { getDentalPhraseEntries } = require('../services/dental-phrase-map');

const DENTAL_CDT_TABLE = {
  Dental: {
    new: { routine: 'D0150', urgent: 'D0140', emergent: 'D9110' },
    established: { routine: 'D0120', urgent: 'D0140', emergent: 'D9110' }
  }
};

function isDentalCdt(code) {
  return /^D\d{4}$/i.test(String(code || '').trim());
}

function scoreCdtCodebookConfidence(reason, description) {
  const tokens = String(reason || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const desc = String(description || '').toLowerCase();
  const matched = tokens.filter((t) => desc.includes(t)).length;
  return matched / tokens.length;
}

function resolveDentalCdtFromReason(reasonText, opts = {}) {
  const reason = String(reasonText || '').trim().toLowerCase();
  const isChild = opts.isChild === true;
  const threshold = opts.confidenceThreshold ?? CODING_CONFIDENCE_THRESHOLD;

  for (const entry of getDentalPhraseEntries()) {
    if (!entry.compiled.some((re) => re.test(reason))) continue;
    const code = entry.childCode
      ? (isChild ? entry.childCode : entry.code)
      : entry.code;
    return {
      code,
      matched_phrase: reason,
      code_source: 'phrase_map',
      confidence: 1
    };
  }

  // Full codebook lookup (Phase 7.7) — phrase map is fast-path only
  try {
    const db = require('../database');
    const hits = db.searchCdtCodes?.(reason, 5) || [];
    if (hits.length > 0) {
      const tokens = reason.split(/\s+/).filter((t) => t.length > 2);
      let best = null;
      let bestConfidence = 0;
      for (const row of hits) {
        if (row.code && reason.includes(String(row.code).toLowerCase())) {
          return {
            code: row.code,
            matched_phrase: reason,
            code_source: 'cdt_codebook',
            confidence: 1,
            description: row.description
          };
        }
        if (tokens.length === 0) continue;
        const confidence = scoreCdtCodebookConfidence(reason, row.description);
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          best = row;
        }
      }
      if (best?.code && bestConfidence >= threshold) {
        return {
          code: best.code,
          matched_phrase: reason,
          code_source: 'cdt_codebook',
          confidence: bestConfidence,
          description: best.description
        };
      }
      if (best?.code) {
        return {
          code: null,
          matched_phrase: reason,
          code_source: 'cdt_codebook_below_threshold',
          confidence: bestConfidence,
          suggested_code: best.code,
          description: best.description,
          hitl_required: true
        };
      }
    }
  } catch (_) {}

  return { code: null, matched_phrase: null, code_source: null, confidence: 0 };
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
  DENTAL_CDT_TABLE,
  isDentalCdt,
  resolveDentalCdtFromReason,
  getDentalCdtForVisit
};
