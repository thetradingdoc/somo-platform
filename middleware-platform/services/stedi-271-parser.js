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

  return { ...DEFAULTS, rawParsed: payload };
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
    message: eligible ? `Eligible - Copay $${copay}` : 'Benefits returned — review plan status',
    rawParsed: payload
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
  hasMeaningfulData
};
