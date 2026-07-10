'use strict';

/**
 * Deterministic admin visit-type → service code resolver (no RAG, no LLM).
 * Used when triage_policy === disabled (dental / front-desk tenants).
 */

const { resolveDentalCdtFromReason, isDentalCdt } = require('../utils/cpt-helper');

/** Default ICD-10 for routine dental administrative eligibility (encounter for dental exam). */
const DEFAULT_DENTAL_ICD10 = 'Z01.20';
const DEFAULT_CLINIC_ICD10 = 'Z00.00';

const CLINIC_TRIGGER_MAP = [
  { patterns: [/\bnew patient\b/i, /\bfirst time\b/i, /\bfirst visit\b/i], code: '99203' },
  { patterns: [/\bfollow.?up\b/i, /\bestablished\b/i, /\breturning\b/i], code: '99213' },
  { patterns: [/\bphysical\b/i, /\bwellness\b/i, /\bannual\b/i, /\bcheckup\b/i, /\bwell visit\b/i], code: '99395' },
  { patterns: [/\burgent\b/i, /\bsick visit\b/i, /\bnot feeling well\b/i], code: '99213' },
  { patterns: [/\bgeneral\b/i, /\bconsult\b/i, /\boffice visit\b/i, /\bappointment\b/i], code: '99213' }
];

function isClinicAdminUseCase(tenantSpecialty) {
  const s = String(tenantSpecialty || '').trim().toLowerCase();
  return (
    s === 'healthcare_clinic' ||
    s === 'small_business' ||
    s === 'primary care' ||
    s === 'primarycare' ||
    s === 'general practice'
  );
}

function isSupportedAdminServiceCode(code) {
  const c = String(code || '').trim();
  if (!c) return false;
  if (isDentalCdt(c) || /^D\d{4}$/.test(c)) return true;
  if (/^99[0-9]{3}$/.test(c)) return true;
  if (/^90471$/.test(c)) return true;
  return false;
}

const TRIGGER_MAP = [
  { patterns: [/\bcleaning\b/i, /\bprophylaxis\b/i, /\bhygiene\b/i, /\blimpieza\b/i], code: 'D1110', childCode: 'D1120' },
  { patterns: [/\bcopay\b/i, /\bcopago\b/i, /\bcoverage\b/i, /\bcost\b/i, /\bcuánto\b/i, /\bcuanto\b/i], code: 'D1110' },
  { patterns: [/\bnew patient\b/i, /\bfirst time\b/i, /\bfirst visit\b/i], code: 'D0150' },
  { patterns: [/\bcheckup\b/i, /\bcheck.?up\b/i, /\bexam\b/i, /\broutine\b/i], code: 'D0120' },
  { patterns: [/\btooth\s*pain\b/i, /\bsomething.?s wrong\b/i, /\bproblem\b/i, /\bhurts\b/i], code: 'D0140' },
  { patterns: [/\bx.?ray\b/i, /\bxray\b/i, /\bbitewing\b/i], code: 'D0274' },
  { patterns: [/\bfilling\b/i, /\bcavity\b/i], code: 'D2391' },
  { patterns: [/\broot canal\b/i], code: 'D3310' },
  { patterns: [/\bdeep cleaning\b/i, /\bscaling\b/i, /\bperio\b/i, /\bperiodontal\b/i], code: 'D4341' },
  { patterns: [/\bcrown\b/i, /\bcap\b/i], code: 'D2740' },
  { patterns: [/\bimplant\b/i], code: 'D6010' },
  { patterns: [/\bortho\b/i, /\bbraces\b/i, /\binvisalign\b/i], code: 'D8080' },
  { patterns: [/\bextraction\b/i, /\bpull\b/i, /\btooth pulled\b/i], code: 'D7140' },
  { patterns: [/\bemergency\b/i, /\bin pain\b/i, /\bsevere pain\b/i], code: 'D9110' }
];

function normalizeReason(text) {
  return String(text || '').trim().toLowerCase();
}

function isChildVisit(opts = {}) {
  if (opts.isChild === true || opts.patient_is_child === true) return true;
  const age = Number(opts.patient_age || opts.age);
  if (!Number.isNaN(age) && age > 0 && age < 13) return true;
  const reason = normalizeReason(opts.visitReasonText || opts.visit_reason);
  return /\b(child|kid|son|daughter|pediatric)\b/i.test(reason);
}

/**
 * @param {string} visitReasonText
 * @param {string} [tenantSpecialty] - e.g. Dental
 * @param {object} [opts]
 * @returns {{ ok: boolean, primary_cpt?: string, primary_icd10?: string, code_source?: string, message?: string }}
 */
function resolveAdminVisitCodes(visitReasonText, tenantSpecialty = 'Dental', opts = {}) {
  const specialty = String(tenantSpecialty || 'Dental').trim();
  const reason = normalizeReason(visitReasonText || opts.visit_reason);

  if (!reason) {
    return {
      ok: false,
      status: 'VISIT_REASON_REQUIRED',
      error_code: 'VISIT_REASON_REQUIRED',
      message: 'Please tell me the reason for your visit so we can verify the right procedure code.'
    };
  }

  if (/^dental$/i.test(specialty) || specialty === 'Dental') {
    const dental = resolveDentalCdtFromReason(reason, { isChild: isChildVisit(opts) });
    if (dental.code) {
      return {
        ok: true,
        status: 'OK',
        primary_cpt: dental.code,
        primary_icd10: opts.primary_icd10 || DEFAULT_DENTAL_ICD10,
        code_source: 'admin_dental',
        target_specialty: 'Dental',
        match_phrase: dental.matched_phrase || null
      };
    }
  }

  if (isClinicAdminUseCase(specialty)) {
    for (const entry of CLINIC_TRIGGER_MAP) {
      if (entry.patterns.some((re) => re.test(reason))) {
        return {
          ok: true,
          status: 'OK',
          primary_cpt: entry.code,
          primary_icd10: opts.primary_icd10 || DEFAULT_CLINIC_ICD10,
          code_source: 'admin_clinic_em',
          target_specialty: specialty,
          match_phrase: entry.patterns.find((re) => re.test(reason))?.source || null
        };
      }
    }
  }

  for (const entry of TRIGGER_MAP) {
    if (entry.patterns.some((re) => re.test(reason))) {
      const code = isChildVisit(opts) && entry.childCode ? entry.childCode : entry.code;
      return {
        ok: true,
        status: 'OK',
        primary_cpt: code,
        primary_icd10: opts.primary_icd10 || DEFAULT_DENTAL_ICD10,
        code_source: 'admin_phrase_map',
        target_specialty: specialty,
        match_phrase: entry.patterns.find((re) => re.test(reason))?.source || null
      };
    }
  }

  return {
    ok: false,
    status: 'CODE_NOT_IN_STARTER_SET',
    error_code: 'CODE_NOT_IN_STARTER_SET',
    message:
      'For that procedure our office will call you back with exact pricing. I can still help schedule or answer general questions.'
  };
}

function emitCodingStarterSetMiss(opts = {}) {
  try {
    const crypto = require('crypto');
    const db = require('../database');
    const reasonHash = crypto
      .createHash('sha256')
      .update(String(opts.visitReason || opts.visit_reason || ''))
      .digest('hex')
      .slice(0, 16);
    db.insertKellyCallEvent?.({
      session_id: opts.sessionId || null,
      call_id: opts.callId || opts.sessionId || null,
      event_type: 'coding_starter_set_miss',
      payload_json: {
        clinic_id: opts.clinicId || null,
        visit_reason_hash: reasonHash,
        channel: opts.channel || 'voice',
        error_code: 'CODE_NOT_IN_STARTER_SET',
        tenant_specialty: opts.tenantSpecialty || 'Dental'
      },
      clinic_id: opts.clinicId || null
    });
  } catch (_) {}
}

function resolveAdminInsuranceCodes(opts = {}) {
  const {
    visit_reason: visitReason = null,
    visitReasonText = null,
    tenantSpecialty = 'Dental',
    isNewPatient = false,
    patient_age: patientAge = null
  } = opts;

  const resolved = resolveAdminVisitCodes(visitReasonText || visitReason, tenantSpecialty, {
    ...opts,
    isNewPatient
  });

  if (!resolved.ok) return resolved;

  const serviceCode = resolved.primary_cpt;
  if (!isSupportedAdminServiceCode(serviceCode)) {
    return {
      ok: false,
      status: 'UNSUPPORTED_ADMIN_CODE',
      error_code: 'UNSUPPORTED_ADMIN_CODE',
      message: resolved.message
    };
  }

  return {
    ok: true,
    status: 'OK',
    primary_icd10: resolved.primary_icd10,
    primary_cpt: serviceCode,
    code_source: resolved.code_source,
    fallback_reason: null,
    rag_confidence: 1,
    code_pair_valid: true,
    target_specialty: resolved.target_specialty || tenantSpecialty,
    admin_path: true
  };
}

module.exports = {
  resolveAdminVisitCodes,
  resolveAdminInsuranceCodes,
  emitCodingStarterSetMiss,
  DEFAULT_DENTAL_ICD10,
  DEFAULT_CLINIC_ICD10,
  CLINIC_TRIGGER_MAP,
  isClinicAdminUseCase,
  isSupportedAdminServiceCode,
  TRIGGER_MAP
};
