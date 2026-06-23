/**
 * Stedi 271 Response Parser
 * Deep parsing of X12 271 eligibility response from Stedi API.
 * Extracts structured benefit data for EOB and settlement.
 */

const DEFAULTS = {
  eligible: false,
  copay: 0,
  allowedAmount: 0,
  insurancePays: 0,
  deductibleTotal: null,
  deductibleRemaining: null,
  coinsurancePercent: null,
  oopMax: null,
  oopMet: null,
  planSummary: null,
  priorAuthIndicator: null, // 'Y' | 'N' | 'U' | null
  priorAuthNotes: [],
  message: null,
  aaaCodes: [],
  aaaMessages: [],
  rawParsed: null
};

/**
 * Parse Stedi API response from 270-to-edi or 271 translation.
 * Handles multiple response shapes from Stedi (direct JSON, nested data, EDI-derived).
 *
 * @param {Object} stediResponse - Raw response from Stedi API (e.g. response.data)
 * @returns {Object} Normalized eligibility object
 */
function parse271Response(stediResponse) {
  if (!stediResponse || typeof stediResponse !== 'object') {
    return { ...DEFAULTS };
  }

  // Unwrap axios-style response (response.data may be the payload)
  const payload = stediResponse.data || stediResponse;

  if (Array.isArray(payload.benefitsInformation) && payload.benefitsInformation.length > 0) {
    return parseFromBenefitsInformation(payload);
  }

  // Direct format (Stedi Sandbox docs)
  if (hasDirectEligibilityFields(payload)) {
    return normalizeFromDirect(payload);
  }

  // Nested in 'eligibility' or 'benefits'
  const nested = payload.eligibility || payload.benefits || payload.result;
  if (nested && typeof nested === 'object') {
    if (hasDirectEligibilityFields(nested)) {
      return normalizeFromDirect(nested);
    }
  }

  // X12 271 common segment patterns (if Stedi returns parsed segments)
  const segments = payload.segments || payload.Loop2000 || payload.EB;
  if (segments && Array.isArray(segments)) {
    return parseFromSegments(segments);
  }

  // EDI-derived: some APIs return { output: { ... } } or { translation: { ... } }
  const derived = payload.output || payload.translation || payload.response;
  if (derived && typeof derived === 'object') {
    const parsed = parse271Response(derived);
    if (parsed.rawParsed !== null) return parsed;
  }

  const aaa = extractAaaErrors(payload);
  return {
    ...DEFAULTS,
    eligible: false,
    message: aaa.messages[0] || 'Eligibility check failed',
    aaaCodes: aaa.codes,
    aaaMessages: aaa.messages,
    rawParsed: payload,
  };
}

/**
 * Extract AAA reject codes from Stedi eligibility v3 payload.
 * @param {object} payload
 * @returns {{ codes: string[], messages: string[] }}
 */
function extractAaaErrors(payload) {
  const codes = [];
  const messages = [];
  if (!payload || typeof payload !== 'object') return { codes, messages };

  const push = (code, msg) => {
    const c = code != null ? String(code).trim() : '';
    const m = msg != null ? String(msg).trim() : '';
    if (c && !codes.includes(c)) codes.push(c);
    if (m && !messages.includes(m)) messages.push(m);
  };

  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  for (const e of errors) {
    if (!e || typeof e !== 'object') continue;
    push(e.code || e.rejectReasonCode, e.description || e.message || e.field);
  }

  const aaaList = payload.aaaErrors || payload.aaa_errors || payload.AAAErrors;
  if (Array.isArray(aaaList)) {
    for (const a of aaaList) {
      if (!a || typeof a !== 'object') continue;
      push(
        a.code || a.rejectReasonCode || a.aaaCode,
        a.description || a.message || a.rejectReason
      );
    }
  }

  const subscriber = payload.subscriber || payload.dependents?.[0];
  if (subscriber?.aaaErrors && Array.isArray(subscriber.aaaErrors)) {
    for (const a of subscriber.aaaErrors) {
      push(a.code || a.rejectReasonCode, a.description || a.message);
    }
  }

  return { codes, messages };
}

function hasDirectEligibilityFields(obj) {
  return (
    obj &&
    (typeof obj.eligible === 'boolean' ||
      obj.copay != null ||
      obj.allowedAmount != null ||
      obj.insurancePays != null ||
      (obj.eligibility && obj.eligibility.eligible === true))
  );
}

function normalizeFromDirect(obj) {
  const copay = parseAmount(obj.copay ?? obj.copay_amount ?? obj.copayAmount);
  const allowedAmount = parseAmount(obj.allowedAmount ?? obj.allowed_amount);
  const insurancePays = parseAmount(obj.insurancePays ?? obj.insurance_pays ?? obj.planPaid);
  const deductibleTotal = parseAmount(obj.deductibleTotal ?? obj.deductible_total);
  const deductibleRemaining = parseAmount(obj.deductibleRemaining ?? obj.deductible_remaining);
  const coinsurancePercent = parseAmount(obj.coinsurancePercent ?? obj.coinsurance_percent);
  const oopMax = parseAmount(obj.oopMax ?? obj.oop_max ?? obj.outOfPocketMax ?? obj.out_of_pocket_max);
  const oopMet = parseAmount(obj.oopMet ?? obj.oop_met ?? obj.outOfPocketMet ?? obj.out_of_pocket_met);

  const pa = extractPriorAuth(obj.benefitsInformation);

  return {
    eligible: Boolean(obj.eligible ?? obj.isEligible ?? true),
    copay,
    allowedAmount,
    insurancePays,
    deductibleTotal: deductibleTotal ?? null,
    deductibleRemaining: deductibleRemaining ?? deductibleTotal ?? null,
    coinsurancePercent: coinsurancePercent ?? null,
    oopMax: oopMax ?? null,
    oopMet: oopMet ?? 0,
    planSummary: obj.planSummary ?? obj.plan_summary ?? obj.summary ?? null,
    priorAuthIndicator: pa.indicator,
    priorAuthNotes: pa.notes,
    message: obj.message ?? obj.status_message ?? null,
    rawParsed: obj
  };
}

function parseAmount(val) {
  if (val == null) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Parse from X12 271-style segment array (EB, HSD, etc.)
 * EB = Benefit - contains service type, coverage level, amounts
 */
function parseFromSegments(segments) {
  const out = { ...DEFAULTS };
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue;
    const code = seg.ServiceTypeCode || seg.EB01 || seg.serviceTypeCode;
    const amount = parseAmount(seg.Amount ?? seg.EB07 ?? seg.amount);
    const percent = parseAmount(seg.Percent ?? seg.EB09 ?? seg.percent);

    if (code === '30' || code === 'B' || code === 'health_benefit_plan') {
      if (amount != null) out.allowedAmount = amount;
      if (percent != null) out.coinsurancePercent = percent;
    }
    if (code === '1' || code === 'medical_care') {
      if (amount != null && out.copay === 0) out.copay = amount;
    }
    // X12 271: OOP max / OOP met in benefit segments (varies by implementation)
    if (code === '47' || code === 'out_of_pocket_maximum' || seg.BenefitAmountQualifierCode === '48') {
      if (amount != null) out.oopMax = amount;
    }
  }
  out.eligible = out.allowedAmount > 0 || out.copay >= 0;
  out.rawParsed = segments;
  return out;
}

/**
 * Parse Stedi Healthcare eligibility v3 `benefitsInformation[]` array.
 */
function parseFromBenefitsInformation(payload) {
  const benefits = payload.benefitsInformation || [];
  const pa = extractPriorAuth(benefits);
  let copay = 0;
  let allowedAmount = 0;
  let insurancePays = 0;
  let deductibleTotal = null;
  let deductibleRemaining = null;
  let coinsurancePercent = null;

  for (const item of benefits) {
    if (!item || typeof item !== 'object') continue;
    const amt = parseAmount(
      item.benefitAmount ??
        item.amount ??
        item.patientResponsibilityAmount ??
        item.monetaryAmount
    );
    const code = String(item.code || item.name || item.serviceTypeCode || '').toLowerCase();
    if (code.includes('copay') || item.coverageLevelCode === 'B') {
      if (amt != null) copay = amt;
    }
    if (code.includes('deductible')) {
      if (amt != null) {
        deductibleTotal = amt;
        deductibleRemaining = parseAmount(item.remainingAmount) ?? amt;
      }
    }
    if (code.includes('coinsurance') && item.percent != null) {
      coinsurancePercent = parseAmount(item.percent);
    }
    if (amt != null && !code.includes('copay') && !code.includes('deductible')) {
      allowedAmount = Math.max(allowedAmount, amt);
    }
  }

  insurancePays = allowedAmount > copay ? allowedAmount - copay : 0;
  const planStatus = payload.planStatus || payload.subscriber?.planStatus;
  const eligible =
    planStatus === 'active' ||
    planStatus === '1' ||
    benefits.length > 0 ||
    allowedAmount > 0 ||
    copay > 0;

  const aaa = extractAaaErrors(payload);
  let message = eligible ? `Eligible - Copay $${copay}` : 'Benefits returned — review plan status';
  if (!eligible && aaa.messages.length) {
    message = aaa.messages.join('; ');
  }

  return {
    eligible,
    copay,
    allowedAmount,
    insurancePays,
    deductibleTotal,
    deductibleRemaining,
    coinsurancePercent,
    oopMax: null,
    oopMet: 0,
    planSummary: payload.planSummary || null,
    priorAuthIndicator: pa.indicator,
    priorAuthNotes: pa.notes,
    message,
    aaaCodes: aaa.codes,
    aaaMessages: aaa.messages,
    rawParsed: payload,
  };
}

function extractPriorAuth(benefitsInformation) {
  const notes = [];
  if (!Array.isArray(benefitsInformation)) return { indicator: null, notes };

  let sawY = false;
  let sawU = false;
  let sawN = false;

  for (const item of benefitsInformation) {
    if (!item || typeof item !== 'object') continue;

    const ind = (item.authOrCertIndicator ?? item.auth_or_cert_indicator ?? '').toString().trim().toUpperCase();
    if (ind === 'Y') sawY = true;
    else if (ind === 'U') sawU = true;
    else if (ind === 'N') sawN = true;

    const additional = Array.isArray(item.additionalInformation) ? item.additionalInformation : [];
    for (const a of additional) {
      const desc = (a && typeof a === 'object' ? a.description : a) ?? null;
      if (!desc) continue;
      const s = String(desc).trim();
      if (!s) continue;
      if (/(prior\s*auth|pre\s*auth|precert|certification\s*required)/i.test(s)) {
        notes.push(s);
      }
    }
  }

  const indicator = sawY ? 'Y' : (sawU ? 'U' : (sawN ? 'N' : null));
  return { indicator, notes: Array.from(new Set(notes)).slice(0, 10) };
}

/**
 * Check if parsed result has meaningful data (not just defaults)
 */
function hasMeaningfulData(parsed) {
  return (
    parsed.eligible === true ||
    (parsed.copay != null && parsed.copay > 0) ||
    (parsed.allowedAmount != null && parsed.allowedAmount > 0) ||
    (parsed.insurancePays != null && parsed.insurancePays > 0) ||
    (Array.isArray(parsed.rawParsed?.benefitsInformation) && parsed.rawParsed.benefitsInformation.length > 0)
  );
}

module.exports = {
  parse271Response,
  hasMeaningfulData,
  extractAaaErrors,
};
