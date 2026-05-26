const knowledgeService = require('./knowledge-service');
const { generateCodingSuggestion } = require('./medical-coding-service');
const FeeScheduleService = require('./fee-schedule-service');
const CodeAcceptanceService = require('./code-acceptance-service');

const MIN_CONFIDENCE = parseFloat(process.env.MIN_CODING_CONFIDENCE || '0.7');

function classifyEncounter(encounter) {
  const simpleMatch = knowledgeService.matchSimpleRule({
    appointmentType: encounter.appointmentType,
    durationMinutes: encounter.durationMinutes,
    clinicalNote: encounter.clinicalNote
  });

  if (simpleMatch) {
    return { band: 'SIMPLE', match: simpleMatch };
  }

  const keywordCount = knowledgeService.extractKeywords(encounter.clinicalNote || '', 30).length;
  if (keywordCount <= 12) {
    return { band: 'MODERATE', match: null };
  }

  return { band: 'COMPLEX', match: null };
}

/**
 * Add confidence to codes (ensures { code, description, confidence, quantity } format)
 * Tiba spec: q_i default 1
 */
function withConfidence(codes, confidence = 1.0) {
  return (codes || []).map(c => {
    const base = typeof c === 'object' ? { ...c } : { code: c, description: '' };
    base.confidence = typeof base.confidence === 'number' ? base.confidence : confidence;
    base.quantity = typeof base.quantity === 'number' && base.quantity >= 1 ? base.quantity : 1;
    base.modifiers = Array.isArray(base.modifiers) ? base.modifiers : [];
    return base;
  });
}

/**
 * Apply rule-based confidence (φ^rule_i) and min(NLP, rule) per Tiba spec.
 */
function applyRuleConfidence(icd10, cpt, fromSimpleRule) {
  const primaryIcd = (icd10 && icd10[0]) ? (icd10[0].code || icd10[0]) : null;
  return (cpt || []).map(c => {
    const cptCode = c.code || c;
    const nlpConf = typeof c.confidence === 'number' ? c.confidence : 0.8;
    const ruleConf = knowledgeService.computeRuleConfidence(primaryIcd, cptCode, fromSimpleRule);
    const finalConf = Math.min(nlpConf, ruleConf);
    return { ...c, code: cptCode, confidence: finalConf };
  });
}

/**
 * Apply historical confidence (φ^historical_i) when payerId provided.
 */
function applyHistoricalConfidence(cpt, payerId) {
  if (!payerId || !cpt || cpt.length === 0) return cpt;
  return (cpt || []).map(c => {
    const cptCode = (c.code || c).toString().trim();
    const histConf = CodeAcceptanceService.getHistoricalConfidence(payerId, cptCode);
    const curr = typeof c.confidence === 'number' ? c.confidence : 0.8;
    const finalConf = Math.min(curr, histConf);
    return { ...c, code: cptCode, confidence: finalConf };
  });
}

/**
 * Apply modifier confidence (φ^modifier_i). Missing required modifier → 0.60.
 */
function applyModifierConfidence(cpt, options = {}) {
  if (!cpt || cpt.length === 0) return cpt;
  const required = knowledgeService.getRequiredModifiers(cpt);
  const billingEnvelope = require('./billing-claim-envelope-service');
  const teleMods = billingEnvelope.resolveTelehealthModifiers({
    place_of_service: options.place_of_service,
    visit_mode: options.visit_mode,
    payer_id: options.payer_id
  });
  return cpt.map(c => {
    const cptCode = (c.code || c).toString().trim();
    let mods = Array.isArray(c.modifiers) ? c.modifiers.map(m => String(m).trim()) : [];
    if (teleMods.length) {
      const merged = new Set([...mods.map((m) => m.toUpperCase()), ...teleMods]);
      mods = Array.from(merged);
    }
    const need = required.get(cptCode) || [];
    const missing = need.filter(m => !mods.includes(m));
    const curr = typeof c.confidence === 'number' ? c.confidence : 0.8;
    const phiMod = missing.length > 0 ? (knowledgeService.loadModifierRules().phi_modifier_cap ?? 0.6) : 1.0;
    const finalConf = Math.min(curr, phiMod);
    return { ...c, code: cptCode, modifiers: mods.length ? mods : (c.modifiers || []), confidence: finalConf };
  });
}

/**
 * Apply time-based confidence (φ^time_i). Duration below CPT min → phi_time_cap (0.6).
 */
function applyTimeConfidence(cpt, durationMinutes) {
  if (!cpt || cpt.length === 0 || durationMinutes == null || durationMinutes < 0) return cpt;
  const phiTimeCap = knowledgeService.getPhiTimeCap();
  return cpt.map(c => {
    const cptCode = (c.code || c).toString().trim();
    const v = knowledgeService.validateCptDuration(cptCode, durationMinutes);
    const curr = typeof c.confidence === 'number' ? c.confidence : 0.8;
    const finalConf = v.valid ? curr : Math.min(curr, phiTimeCap);
    return { ...c, code: cptCode, confidence: finalConf };
  });
}

/**
 * Apply prior-auth cap (φ_auth_cap) when auth required but not on file.
 */
function applyPriorAuthCap(cpt, authOnFile = false) {
  if (!cpt || cpt.length === 0) return cpt;
  const phiAuthCap = knowledgeService.getPhiAuthCap();
  return (cpt || []).map(c => {
    const cptCode = (c.code || c).toString().trim();
    const curr = typeof c.confidence === 'number' ? c.confidence : 0.8;
    let finalConf = curr;
    if (knowledgeService.requiresPriorAuth(cptCode) && !authOnFile) {
      finalConf = Math.min(curr, phiAuthCap);
    }
    return { ...c, code: cptCode, confidence: finalConf };
  });
}

/**
 * Attach payer allowed amount (f^P_i) and in-network (n_i) per CPT when payerId provided.
 */
function attachPayerPricing(cpt, payerId, dateOfService, billedAmounts = {}) {
  if (!payerId || !cpt || cpt.length === 0) return cpt;
  const codes = cpt.map(c => (c.code || c).toString().trim()).filter(Boolean);
  const billedMap = {};
  cpt.forEach(c => {
    const k = (c.code || c).toString().trim();
    if (c.price != null || c.charge != null) billedMap[k] = c.price ?? c.charge ?? 0;
  });
  const pricing = FeeScheduleService.getAllowedAmountsAndNetworkForCodes(
    payerId, codes, dateOfService, Object.keys(billedMap).length ? billedMap : billedAmounts
  );
  return cpt.map(c => {
    const k = (c.code || c).toString().trim();
    const info = pricing[k];
    const out = { ...c };
    if (info) {
      if (info.allowedAmount != null) out.allowed_amount = info.allowedAmount;
      out.in_network = info.inNetwork;
    }
    return out;
  });
}

function resolveDurationMinutes(encounter, options) {
  if (typeof options.durationMinutes === 'number' && options.durationMinutes >= 0) return options.durationMinutes;
  if (typeof encounter.durationMinutes === 'number' && encounter.durationMinutes >= 0) return encounter.durationMinutes;
  const start = encounter.encounter_start_time || encounter.start_time;
  const end = encounter.encounter_end_time || encounter.end_time;
  if (start && end) {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (!isNaN(s) && !isNaN(e) && e > s) return Math.round((e - s) / 60000);
  }
  return null;
}

async function runCodingPipeline(encounter, options = {}) {
  const durationMinutes = resolveDurationMinutes(encounter, options);
  const classification = classifyEncounter(encounter);

  if (classification.band === 'SIMPLE' && classification.match) {
    const match = classification.match;
    const icd10 = withConfidence(match.icd10, 1.0);
    let cpt = withConfidence(match.cpt, 1.0);
    cpt = applyRuleConfidence(icd10, cpt, true);
    cpt = applyHistoricalConfidence(cpt, options.payerId);
    cpt = applyPriorAuthCap(cpt, options.authOnFile);
    cpt = applyModifierConfidence(cpt);
    cpt = applyTimeConfidence(cpt, durationMinutes);
    cpt = attachPayerPricing(cpt, options.payerId, options.dateOfService, {});

    return {
      band: 'SIMPLE',
      icd10,
      cpt,
      rationale: match.rationale,
      codingConfidence: 1.0,
      details: { rule_id: match.id }
    };
  }

  if (classification.band === 'MODERATE') {
    const modCandidates = encounter.perceptualState
      ? await knowledgeService.getCandidatesForCoding(encounter.clinicalNote, { perceptualState: encounter.perceptualState, limitCpt: 5, limitIcd10: 3 })
      : { cpt: knowledgeService.getCandidateCptCodes(encounter.clinicalNote, { limit: 5 }), icd10: knowledgeService.getReferenceIcdCodes(3, 0.8) };
    const cptCandidates = modCandidates.cpt;
    const icd10 = modCandidates.icd10;
    let cpt = (cptCandidates.slice(0, 1) || []).map(c => ({
      ...c,
      confidence: typeof c.confidence === 'number' ? c.confidence : 0.85,
      quantity: 1
    }));
    cpt = applyRuleConfidence(icd10, cpt, false);
    cpt = applyHistoricalConfidence(cpt, options.payerId);
    cpt = applyPriorAuthCap(cpt, options.authOnFile);
    cpt = applyModifierConfidence(cpt);
    cpt = applyTimeConfidence(cpt, durationMinutes);
    cpt = attachPayerPricing(cpt, options.payerId, options.dateOfService, {});

    const conf = computeOverallConfidence(icd10, cpt);
    return {
      band: 'MODERATE',
      icd10,
      cpt,
      rationale: 'Selected highest-ranked CPT candidate with reference ICD-10 list.',
      codingConfidence: conf,
      status: conf >= MIN_CONFIDENCE ? 'accepted' : 'low_confidence',
      ...(conf < MIN_CONFIDENCE && { action: 'route_to_manual_review' }),
      details: { keywords: knowledgeService.extractKeywords(encounter.clinicalNote, 10) }
    };
  }

  const llmResult = await generateCodingSuggestion({
    clinicalNote: encounter.clinicalNote,
    encounterType: encounter.appointmentType,
    patientContext: encounter.patientContext,
    perceptualState: encounter.perceptualState,
    retrievedGuidelines: encounter.retrievedGuidelines
  });

  const icd10 = (llmResult.icd10 || []).map(c => ({ ...c, quantity: c.quantity ?? 1 }));
  let cpt = (llmResult.cpt || []).map(c => ({ ...c, quantity: c.quantity ?? 1 }));
  cpt = applyRuleConfidence(icd10, cpt, false);
  cpt = applyHistoricalConfidence(cpt, options.payerId);
  cpt = applyPriorAuthCap(cpt, options.authOnFile);
  cpt = applyModifierConfidence(cpt);
  cpt = applyTimeConfidence(cpt, durationMinutes);
  cpt = attachPayerPricing(cpt, options.payerId, options.dateOfService, {});

  const codingConfidence = llmResult.codingConfidence ?? computeOverallConfidence(icd10, cpt);
  const status = codingConfidence >= MIN_CONFIDENCE ? 'accepted' : 'low_confidence';
  const action = codingConfidence >= MIN_CONFIDENCE ? undefined : 'route_to_manual_review';

  return {
    band: 'COMPLEX',
    icd10,
    cpt,
    rationale: llmResult.rationale,
    evidenceTrace: llmResult.evidenceTrace,
    codingConfidence,
    status,
    ...(action && { action }),
    details: { model: llmResult.model }
  };
}

function computeOverallConfidence(icd10 = [], cpt = []) {
  const all = [...(icd10 || []), ...(cpt || [])];
  if (all.length === 0) return 0.5;
  const confidences = all.map(c => knowledgeService.ensureCodeConfidence(c, 0.8));
  return Math.min(...confidences);
}

module.exports = {
  classifyEncounter,
  runCodingPipeline
};
