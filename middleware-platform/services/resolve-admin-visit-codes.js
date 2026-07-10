'use strict';

/**
 * Deterministic admin visit-type → service code resolver (no RAG, no LLM).
 * Used when triage_policy === disabled (dental / front-desk tenants).
 */

const { resolveDentalCdtFromReason, isDentalCdt } = require('../utils/cpt-helper');
const knowledgeService = require('./knowledge-service');
const path = require('path');
const fs = require('fs');

function loadDeferralCopy() {
  try {
    const p = path.resolve(__dirname, '../../Knowledge/rules/coding-deferral-copy.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return {};
  }
}

const DEFERRAL_COPY = loadDeferralCopy();

/** Default ICD-10 for routine dental administrative eligibility (encounter for dental exam). */
const DEFAULT_DENTAL_ICD10 = 'Z01.20';
const DEFAULT_CLINIC_ICD10 = 'Z00.00';

const CLINIC_TRIGGER_MAP = [
  { patterns: [/\bpsychiatry\b/i, /\bpsych eval\b/i, /\b90791\b/i], code: '90791' },
  { patterns: [/\btherapy\b/i, /\bcounseling\b/i, /\bpsychotherapy\b/i, /\b90834\b/i], code: '90834' },
  { patterns: [/\bmental health\b/i, /\bdepression\b/i, /\banxiety\b/i, /\b90837\b/i], code: '90837' },
  { patterns: [/\bimmunization\b/i, /\bvaccine\b/i, /\bflu shot\b/i, /\b90471\b/i], code: '90471' },
  { patterns: [/\btelehealth\b/i, /\bvideo visit\b/i, /\bvirtual visit\b/i], code: '99213' },
  { patterns: [/\burgent care\b/i, /\bwalk.?in\b/i, /\bacute visit\b/i], code: '99213' },
  { patterns: [/\bnew patient\b/i, /\bfirst time\b/i, /\bfirst visit\b/i], code: '99203' },
  { patterns: [/\bfollow.?up\b/i, /\bestablished patient\b/i, /\breturning patient\b/i], code: '99213' },
  { patterns: [/\bphysical\b/i, /\bwellness\b/i, /\bannual\b/i, /\bcheckup\b/i, /\bwell visit\b/i], code: '99395' },
  { patterns: [/\bmedicare wellness\b/i, /\bawv\b/i, /\bg0438\b/i], code: 'G0438' },
  { patterns: [/\bsick visit\b/i, /\bnot feeling well\b/i, /\bcold symptoms\b/i], code: '99213' },
  { patterns: [/\burgent\b/i, /\bsame day\b/i], code: '99213' },
  { patterns: [/\boffice visit\b/i, /\bgeneral visit\b/i, /\bappointment\b/i], code: '99213' },
  { patterns: [/\bconsult\b/i, /\bspecialist consult\b/i], code: '99243' },
  { patterns: [/\b99214\b/i, /\bmoderate complexity\b/i], code: '99214' },
  { patterns: [/\b99215\b/i, /\bhigh complexity\b/i], code: '99215' },
  { patterns: [/\b99204\b/i], code: '99204' },
  { patterns: [/\b99205\b/i], code: '99205' },
  { patterns: [/\b99212\b/i], code: '99212' },
  { patterns: [/\b99202\b/i], code: '99202' },
  { patterns: [/\b99386\b/i, /\badolescent physical\b/i], code: '99386' },
  { patterns: [/\b99387\b/i], code: '99387' },
  { patterns: [/\b99396\b/i], code: '99396' },
  { patterns: [/\b99397\b/i], code: '99397' },
  { patterns: [/\bdiabetes follow up\b/i, /\bdiabetes check\b/i], code: '99214' },
  { patterns: [/\bhypertension follow up\b/i, /\bblood pressure check\b/i], code: '99213' },
  { patterns: [/\bcough\b/i, /\bsore throat\b/i, /\buri\b/i], code: '99213' },
  { patterns: [/\bback pain\b/i, /\bjoint pain\b/i], code: '99213' },
  { patterns: [/\bskin rash\b/i, /\bdermatology referral\b/i], code: '99213' },
  { patterns: [/\blab work\b/i, /\bblood draw\b/i], code: '99211' },
  { patterns: [/\bpre.?op\b/i, /\bpreoperative\b/i], code: '99213' },
  { patterns: [/\bpost.?op\b/i, /\bfollow up surgery\b/i], code: '99213' },
  { patterns: [/\bweight management\b/i, /\bobesity\b/i], code: '99213' },
  { patterns: [/\bsmoking cessation\b/i], code: '99406' },
  { patterns: [/\bcolonoscopy consult\b/i], code: '99213' },
  { patterns: [/\bvision exam\b/i, /\beye exam\b/i], code: '92004' },
  { patterns: [/\ballergy shot\b/i], code: '95115' },
  { patterns: [/\bhearing test\b/i], code: '92557' },
  { patterns: [/\bphysical therapy eval\b/i], code: '97161' },
  { patterns: [/\boccupational therapy\b/i], code: '97165' },
  { patterns: [/\bdermatology\b/i, /\bmole check\b/i], code: '99213' },
  { patterns: [/\bpediatric visit\b/i, /\bchild checkup\b/i], code: '99391' },
  { patterns: [/\bsports physical\b/i], code: '99395' },
  { patterns: [/\binjection\b/i, /\bsteroid shot\b/i], code: '96372' },
  { patterns: [/\bsti screening\b/i, /\bstd test\b/i], code: '99213' },
  { patterns: [/\bmedication refill\b/i, /\bprescription refill\b/i], code: '99211' },
  { patterns: [/\btravel clinic\b/i, /\btravel vaccines\b/i], code: '99213' },
  { patterns: [/\bworkers comp\b/i, /\bwork injury\b/i], code: '99214' },
  { patterns: [/\bdiabetic eye exam\b/i], code: '92002' },
  { patterns: [/\babnormal labs\b/i, /\blab results review\b/i], code: '99213' }
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
  if (/^G0[0-9]{3}$/.test(c)) return true;
  if (/^9[0-9]{4}$/.test(c)) return true;
  return false;
}

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
        code_source: dental.code_source === 'phrase_map' ? 'admin_dental' : 'admin_dental_codebook',
        target_specialty: 'Dental',
        match_phrase: dental.matched_phrase || null,
        confidence: dental.confidence ?? 1
      };
    }
    return {
      ok: false,
      status: 'CODE_NOT_IN_STARTER_SET',
      error_code: dental.hitl_required ? 'CDT_HITL_REQUIRED' : 'CODE_NOT_IN_STARTER_SET',
      message:
        DEFERRAL_COPY.CODE_NOT_IN_STARTER_SET ||
        'For that procedure our office will call you back with exact pricing. I can still help schedule or answer general questions.',
      confidence: dental.confidence ?? 0,
      suggested_code: dental.suggested_code || null
    };
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
  const primaryIcd10 = resolved.primary_icd10;
  if (!isSupportedAdminServiceCode(serviceCode)) {
    return {
      ok: false,
      status: 'UNSUPPORTED_ADMIN_CODE',
      error_code: 'UNSUPPORTED_ADMIN_CODE',
      message: resolved.message
    };
  }

  const codeValidation = knowledgeService.validateCodesExist(
    { icd10: [primaryIcd10], cpt: [serviceCode] },
    isDentalCdt(serviceCode) ? { trustFormattedCodes: true } : {}
  );
  if (!codeValidation.valid) {
    return {
      ok: false,
      status: 'INVALID_CODES',
      error_code: 'INVALID_CODES',
      message: 'Admin path codes could not be verified against the codebook.',
      invalid_codes: codeValidation.invalid
    };
  }

  const pairCheck = knowledgeService.validateCodePair(primaryIcd10, serviceCode);
  if (!pairCheck.valid) {
    return {
      ok: false,
      status: 'CODING_REVIEW_REQUIRED',
      error_code: 'CODING_REVIEW_REQUIRED',
      message: 'Diagnosis and procedure codes are incompatible. A clinical reviewer must confirm before insurance verification.',
      code_pair_valid: false,
      pair_reason: pairCheck.reason
    };
  }

  return {
    ok: true,
    status: 'OK',
    primary_icd10: primaryIcd10,
    primary_cpt: serviceCode,
    code_source: resolved.code_source,
    fallback_reason: null,
    rag_confidence: resolved.confidence ?? 1,
    code_pair_valid: true,
    target_specialty: resolved.target_specialty || tenantSpecialty,
    admin_path: true,
    coding_provenance: {
      code_source: resolved.code_source || 'admin',
      primary_icd10: primaryIcd10,
      primary_cpt: serviceCode,
      admin_path: true
    }
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
  isSupportedAdminServiceCode
};
