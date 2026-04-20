'use strict';

const SCHEMA_VERSION = '1';
const FeatureFlags = require('../config/feature-flags');
const Metrics = require('./metrics');
const SemanticRejectAudit = require('./semantic-reject-audit-service');
const SemanticContractRegistry = require('./semantic-contract-registry');
const SEMANTIC_CONTRACT_VERSION = SemanticContractRegistry.getLiveSemanticContractVersion();

const REASONING_ALLOWED_UPGRADE_FIELDS = [
  'tiles.skin_type',
  'verdict.good_for_me.summary',
  'verdict.good_for_me.detail',
  'verdict.harmful.flags',
  'verdict.harmful.top_evidence',
  'verdict.harmful.summary',
  'verdict.children_safe.summary',
  'verdict.children_safe.text',
  'verdict.side_effects.summary',
  'verdict.side_effects.text',
  'verdict.alternatives.candidates',
  'verdict.alternatives.footer'
];

const REASONING_MIN_CONFIDENCE = {
  'tiles.skin_type': 0.72,
  'verdict.good_for_me.summary': 0.72,
  'verdict.good_for_me.detail': 0.72,
  'verdict.harmful.flags': 0.8,
  'verdict.harmful.top_evidence': 0.8,
  'verdict.harmful.summary': 0.78,
  'verdict.children_safe.summary': 0.8,
  'verdict.children_safe.text': 0.8,
  'verdict.side_effects.summary': 0.8,
  'verdict.side_effects.text': 0.8,
  'verdict.alternatives.candidates': 0.76,
  'verdict.alternatives.footer': 0.7
};

const REASONING_MIN_CONFIDENCE_BY_ROUTE = {
  default: {},
  food: {
    'verdict.harmful.flags': 0.82,
    'verdict.harmful.top_evidence': 0.82,
    'verdict.good_for_me.summary': 0.76
  },
  supplement: {
    'verdict.harmful.flags': 0.82,
    'verdict.harmful.top_evidence': 0.82,
    'verdict.good_for_me.summary': 0.76
  },
  meds: {
    'verdict.harmful.flags': 0.85,
    'verdict.harmful.top_evidence': 0.85,
    'verdict.children_safe.summary': 0.84
  }
};

const REASONING_MIN_EVIDENCE_BY_ROUTE = {
  default: {
    'verdict.harmful.flags': 1,
    'verdict.harmful.top_evidence': 1
  },
  cosmetic: {
    'verdict.alternatives.candidates': 1
  },
  food: {
    'verdict.good_for_me.summary': 1
  },
  supplement: {
    'verdict.good_for_me.summary': 1
  }
};

const ACTIVE_DICTIONARY = [
  { key: 'niacinamide', label: 'Niacinamide', functionTags: ['blemish_control', 'oil_balance'] },
  { key: 'hyaluronic acid', label: 'Hyaluronic Acid', functionTags: ['hydration'] },
  { key: 'sodium hyaluronate', label: 'Hyaluronic Acid', functionTags: ['hydration'] },
  { key: 'salicylic acid', label: 'Salicylic Acid', functionTags: ['blemish_control', 'exfoliation'] },
  { key: 'retinol', label: 'Retinol', functionTags: ['anti_aging'] },
  { key: 'tretinoin', label: 'Tretinoin', functionTags: ['anti_aging', 'blemish_control'] },
  { key: 'azelaic acid', label: 'Azelaic Acid', functionTags: ['blemish_control', 'tone_evening'] },
  { key: 'vitamin c', label: 'Vitamin C', functionTags: ['tone_evening', 'antioxidant'] },
  { key: 'ascorbic acid', label: 'Vitamin C', functionTags: ['tone_evening', 'antioxidant'] },
  { key: 'glycerin', label: 'Glycerin', functionTags: ['hydration'] },
  { key: 'ceramide', label: 'Ceramides', functionTags: ['barrier_support'] },
  { key: 'zinc pca', label: 'Zinc PCA', functionTags: ['oil_balance', 'blemish_control'] }
];

function mkTile({ status, source, confidence = null, value = null, reason = null }) {
  return {
    status,
    source,
    confidence,
    value,
    reason_unavailable: reason
  };
}

function parseIngredients(ingredientsText) {
  return String(ingredientsText || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractConcentration(text) {
  const m = String(text || '').match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  return m ? `${m[1]}%` : null;
}

function extractKeyActives(ingredientsText) {
  const raw = parseIngredients(ingredientsText);
  const joined = raw.join(', ').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const entry of ACTIVE_DICTIONARY) {
    if (!joined.includes(entry.key)) continue;
    if (seen.has(entry.label)) continue;
    seen.add(entry.label);
    const near = raw.find((x) => x.toLowerCase().includes(entry.key)) || entry.key;
    const concentration = extractConcentration(near);
    out.push({
      name: entry.label,
      concentration,
      display: concentration ? `${entry.label} ${concentration}` : entry.label
    });
  }
  return out.slice(0, 6);
}

function classifyFormulation(ingredientsText) {
  const firstFew = parseIngredients(ingredientsText).slice(0, 5).map((x) => x.toLowerCase());
  if (!firstFew.length) return null;
  const joined = firstFew.join(' ');
  if (/\b(aqua|water)\b/.test(firstFew[0] || '')) return { label: 'Water-Based', confidence: 'medium' };
  if (/\b(oil|argania|jojoba|squalane)\b/.test(joined)) return { label: 'Oil-Based', confidence: 'low' };
  if (/\b(cetearyl|stearic|cetyl|emulsif)\b/.test(joined)) return { label: 'Emulsion/Cream', confidence: 'low' };
  return { label: 'Unknown', confidence: 'low' };
}

/** Food/supplement: avoid skincare “water-based” wording; still deterministic from first ingredients. */
function classifyFoodOrSupplementFormulation(ingredientsText) {
  const firstFew = parseIngredients(ingredientsText).slice(0, 5).map((x) => x.toLowerCase());
  if (!firstFew.length) return null;
  const joined = firstFew.join(' ');
  if (firstFew.length === 1 && /\b(100%|juice|water|milk|tea|coffee)\b/.test(firstFew[0] || '')) {
    return { label: 'Single-ingredient beverage', confidence: 'medium' };
  }
  if (/\b(aqua|water)\b/.test(firstFew[0] || '')) return { label: 'Liquid (water first)', confidence: 'low' };
  if (/\b(oil|fat|butter|cream|milk)\b/.test(joined)) return { label: 'Fat / oil-containing', confidence: 'low' };
  return { label: 'Mixed food / beverage', confidence: 'low' };
}

function mapFunctionFromActives(actives, categoryRoute) {
  if (!Array.isArray(actives) || !actives.length) return [];
  const f = new Set();
  const byName = new Map(ACTIVE_DICTIONARY.map((x) => [x.label, x.functionTags]));
  for (const a of actives) {
    const tags = byName.get(a.name) || [];
    tags.forEach((t) => f.add(t));
  }
  if (categoryRoute === 'hygiene') f.add('daily_cleansing');
  if (categoryRoute === 'supplement') f.add('nutrition_support');
  return [...f].slice(0, 5);
}

function describeProductFunction(categoryRoute, functionTags = []) {
  if (Array.isArray(functionTags) && functionTags.length) {
    return `Targets ${functionTags.slice(0, 2).map((x) => String(x).replace(/_/g, ' ')).join(' and ')}.`;
  }
  const byRoute = {
    cosmetic: 'Topical cosmetic care product.',
    hygiene: 'Daily hygiene and cleansing support.',
    food: 'Food/beverage item, not a topical skincare treatment.',
    supplement: 'Oral supplement support product.',
    non_food: 'Non-food household/personal care item.',
    unknown: 'Insufficient category detail yet.'
  };
  return byRoute[categoryRoute] || byRoute.unknown;
}

function formatTagLabel(tag) {
  return String(tag || '')
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildPendingReasoningState() {
  return {
    status: 'deferred',
    source: 'none',
    confidence: null,
    pending: true,
    reason_unavailable: 'reasoning_pending',
    pending_copy: 'Deeper analysis running - results will update shortly'
  };
}

function summarizeRoutineConflictFlags(routineConflicts = []) {
  return routineConflicts
    .slice(0, 4)
    .map((c) => String(c?.summary || c?.recommendation || c?.id || '').trim())
    .filter(Boolean);
}

function isCosmeticRoute(categoryRoute = 'unknown') {
  const route = String(categoryRoute || '').toLowerCase().trim();
  return route === 'cosmetic' || route === 'hygiene';
}

function summarizeWatchFlagsFromIngredients(ingredientsText = '', categoryRoute = 'unknown') {
  if (!isCosmeticRoute(categoryRoute)) return [];
  const t = String(ingredientsText || '').toLowerCase();
  const out = [];
  if (/\bphenoxyethanol\b/.test(t)) out.push('Phenoxyethanol preservative');
  if (/\bfragrance|parfum|limonene|linalool\b/.test(t)) out.push('Fragrance allergens present');
  else out.push('No fragrance allergens detected');
  if (/\bretinol|tretinoin|salicylic acid|glycolic acid|lactic acid|benzoyl peroxide\b/.test(t)) {
    out.push('High-activity exfoliant or retinoid present');
  }
  return out.slice(0, 4);
}

function detectConcernDyes(ingredientsText = '') {
  const t = String(ingredientsText || '').toLowerCase();
  const palette = [
    { key: /\bred\s*40\b/, label: 'Red 40' },
    { key: /\bblue\s*1\b/, label: 'Blue 1' },
    { key: /\byellow\s*5\b/, label: 'Yellow 5' },
    { key: /\byellow\s*6\b/, label: 'Yellow 6' },
    { key: /\bred\s*3\b/, label: 'Red 3' }
  ];
  return palette.filter((entry) => entry.key.test(t)).map((entry) => entry.label);
}

function summarizeFoodWatchFlagsFromIngredients(ingredientsText = '', categoryRoute = 'unknown') {
  const route = String(categoryRoute || '').toLowerCase().trim();
  if (route !== 'food' && route !== 'supplement') return [];
  const dyes = detectConcernDyes(ingredientsText);
  return dyes.length ? [`Artificial dye additives detected (${dyes.slice(0, 3).join(', ')})`] : [];
}

function buildChildrenSafeVerdict({ ingredientsText = '', harmfulSeverity = 'low', categoryRoute = 'unknown' }) {
  const route = String(categoryRoute || '').toLowerCase().trim();
  if (harmfulSeverity === 'high') {
    return {
      answer: 'caution',
      summary: 'Potential irritant/conflict signals detected. Use caution for children.',
      pending: false
    };
  }
  if (route === 'food' || route === 'supplement') {
    const concernDyes = detectConcernDyes(ingredientsText);
    return concernDyes.length
      ? {
          answer: 'caution',
          summary: `Contains artificial dyes (${concernDyes.slice(0, 3).join(', ')}) that may concern some caregivers.`,
          pending: false
        }
      : {
          answer: 'safe',
          summary: 'No strong child-safety signal from current deterministic additive/dye checks.',
          pending: false
        };
  }
  return {
    answer: 'insufficient_data',
    summary: 'No pediatric safety data available in the current deterministic catalog read.',
    pending: true
  };
}

function buildDeterministicSideEffects({
  ingredientsText = '',
  functionTags = [],
  harmfulSeverity = 'low',
  categoryRoute = 'unknown'
}) {
  const route = String(categoryRoute || 'unknown').toLowerCase();
  // Route guard: non-cosmetic contracts should never emit cosmetic adverse-effect copy.
  if (route !== 'cosmetic' && route !== 'hygiene') {
    return 'Not assessed in this scan.';
  }
  const t = String(ingredientsText || '').toLowerCase();
  if (/\bniacinamide\b/.test(t)) {
    return 'Potential flushing with high-dose niacinamide in sensitive individuals.';
  }
  if (/\bretinol|tretinoin\b/.test(t)) {
    return 'Dryness or irritation is possible while skin adjusts to retinoid activity.';
  }
  if (/\bsalicylic acid|glycolic acid|lactic acid|azelaic acid\b/.test(t)) {
    return 'Mild dryness, tingling, or irritation is possible with active acid formulas.';
  }
  if (harmfulSeverity === 'high') {
    return 'Potential irritation signals detected from current deterministic checks.';
  }
  if (Array.isArray(functionTags) && functionTags.includes('hydration')) {
    return 'Generally well tolerated from current deterministic checks.';
  }
  return 'Not assessed in this scan.';
}

function defaultAlternativesFooter(categoryRoute = 'unknown', withCandidates = false) {
  const route = String(categoryRoute || '').toLowerCase().trim();
  const foodLike = route === 'food' || route === 'supplement';
  if (foodLike) {
    return withCandidates
      ? 'Or ask Kelly for personalised food or supplement alternatives.'
      : 'Ask Kelly for personalised food or supplement alternatives.';
  }
  return withCandidates
    ? 'Or ask Kelly for personalised alternatives based on your routine.'
    : 'Ask Kelly for personalised alternatives based on your routine.';
}

function recordRouteRegressionSignals(summary = {}, categoryRoute = 'unknown') {
  const route = String(categoryRoute || '').toLowerCase().trim();
  const nonCosmetic = route === 'food' || route === 'supplement' || route === 'non_food';
  if (!nonCosmetic) return;
  try {
    const harmfulFlags = Array.isArray(summary?.verdict?.harmful?.flags) ? summary.verdict.harmful.flags : [];
    const harmfulJoined = harmfulFlags.join(' ').toLowerCase();
    if (/\bretinoid|exfoliant|phenoxyethanol|fragrance allergens?\b/.test(harmfulJoined)) {
      Metrics.increment('result_summary.regression.non_cosmetic.cosmetic_harmful_copy.count', 1);
      Metrics.increment(`result_summary.regression.non_cosmetic.cosmetic_harmful_copy.route.${route}.count`, 1);
    }
    if (String(summary?.tiles?.key_actives?.status || '') === 'available') {
      Metrics.increment('result_summary.regression.non_cosmetic.key_actives_available.count', 1);
      Metrics.increment(`result_summary.regression.non_cosmetic.key_actives_available.route.${route}.count`, 1);
    }
    const missingMore = Array.isArray(summary?.missing_more) ? summary.missing_more.join(' ').toLowerCase() : '';
    if (missingMore.includes('pediatric profile')) {
      Metrics.increment('result_summary.regression.non_cosmetic.pediatric_upsell_copy.count', 1);
      Metrics.increment(`result_summary.regression.non_cosmetic.pediatric_upsell_copy.route.${route}.count`, 1);
    }
  } catch (_) {}
}

function _clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function _getByPath(target, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let ref = target;
  for (const p of parts) {
    if (!ref || typeof ref !== 'object') return undefined;
    ref = ref[p];
  }
  return ref;
}

function _setByPath(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return false;
  let ref = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!ref[p] || typeof ref[p] !== 'object') ref[p] = {};
    ref = ref[p];
  }
  ref[parts[parts.length - 1]] = value;
  return true;
}

function sanitizeReasoningText(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  return text
    .replace(/\bdiagnos(?:is|es|e|ed|ing)\b/gi, 'assess')
    .replace(/\bcure(?:s|d|ing)?\b/gi, 'support')
    .replace(/\btreat(?:s|ed|ing)?\b/gi, 'help with')
    .replace(/\bmedical advice\b/gi, 'consumer guidance')
    .replace(/\bguarantee(?:d)?\b/gi, 'suggest')
    .replace(/\bdefinitively\b/gi, 'likely');
}

function isFieldAllowedByContract(contract, fieldPath) {
  const validFields = Array.isArray(contract?.valid_fields) ? contract.valid_fields : [];
  if (!validFields.length) return true;
  const path = String(fieldPath || '').trim();
  return validFields.some((vf) => path === vf || path.startsWith(`${vf}.`));
}

function hasForbiddenVocabulary(contract, candidate) {
  const blocked = Array.isArray(contract?.forbidden_vocab) ? contract.forbidden_vocab : [];
  if (!blocked.length) return false;
  const blob = Array.isArray(candidate) ? candidate.join(' ') : String(candidate || '');
  const lower = blob.toLowerCase();
  return blocked.some((term) => lower.includes(String(term || '').toLowerCase()));
}

function failsReasoningSafetyGate(value) {
  const blob = Array.isArray(value) ? value.join(' ') : String(value || '');
  if (!blob.trim()) return false;
  const lower = blob.toLowerCase();
  if (/\bprescrib(?:e|es|ed|ing)\b/.test(lower)) return true;
  if (/\b100%\s+(effective|safe|cure)\b/.test(lower)) return true;
  return false;
}

function emitReasoningGateMetric(metricName, route) {
  Metrics.increment(metricName, 1);
  Metrics.increment(`${metricName}.route.${route}.count`, 1);
}

function getRouteMinConfidence(route, fieldPath) {
  const r = String(route || 'default').toLowerCase();
  const routeMap = REASONING_MIN_CONFIDENCE_BY_ROUTE[r] || {};
  return Number(routeMap[fieldPath] ?? REASONING_MIN_CONFIDENCE[fieldPath] ?? 1);
}

function getRouteMinEvidence(route, fieldPath) {
  const r = String(route || 'default').toLowerCase();
  const routeMap = REASONING_MIN_EVIDENCE_BY_ROUTE[r] || {};
  const dflt = REASONING_MIN_EVIDENCE_BY_ROUTE.default || {};
  return Number(routeMap[fieldPath] ?? dflt[fieldPath] ?? 0);
}

function buildReasoningMeta({
  enabled = false,
  status = 'disabled',
  patch = null,
  inputHash = null,
  gateDecision = null
} = {}) {
  const mode = String(patch?.reasoning_mode || '').trim().toLowerCase();
  const normalizedMode =
    mode === 'model' || mode === 'stub' || mode === 'deterministic_fallback'
      ? mode
      : (enabled ? 'deterministic_fallback' : 'deterministic_fallback');
  const meta = {
    enabled: !!enabled,
    status,
    reasoning_mode: normalizedMode,
    allowed_upgrade_fields: REASONING_ALLOWED_UPGRADE_FIELDS,
    min_confidence_by_field: { ...REASONING_MIN_CONFIDENCE },
    reasoning_model: patch?.reasoning_model || null,
    reasoning_version: patch?.reasoning_version || null,
    reasoning_evidence_refs: Array.isArray(patch?.reasoning_evidence_refs) ? patch.reasoning_evidence_refs : [],
    reasoning_generated_at: patch?.generated_at || null,
    reasoning_input_hash: patch?.reasoning_input_hash || inputHash || null,
    guardrails: ['no_diagnosis_language', 'no_medical_advice', 'confidence_gate_per_field']
  };
  if (gateDecision && typeof gateDecision === 'object') {
    meta.reasoning_gate_decision = gateDecision;
  }
  return meta;
}

function applyReasoningPatch(resultSummary, patch = null, options = {}) {
  const out = _clone(resultSummary || {});
  const enabled = options.enabled !== false;
  const inputHash = options.inputHash || null;
  const semanticContract = out?.semantic_contract || buildSemanticContract('unknown');
  const route = String(semanticContract?.route || 'unknown').toLowerCase();
  const sessionId = options.sessionId ? String(options.sessionId) : null;
  const semanticGuardEnabled = FeatureFlags.isEnabled('RESULT_SUMMARY_SEMANTIC_GUARD_V1');
  const semanticGuardShadow = FeatureFlags.isEnabled('RESULT_SUMMARY_SEMANTIC_GUARD_SHADOW');

  function emitSemanticMetric(name, fieldPath) {
    Metrics.increment(name, 1);
    Metrics.increment(`${name}.route.${route}.count`, 1);
    Metrics.increment(`${name}.field.${String(fieldPath || 'unknown').replace(/\./g, '_')}.count`, 1);
  }
  if (!enabled) {
    out.reasoning = buildReasoningMeta({ enabled: false, status: 'disabled', patch: null, inputHash });
    return out;
  }
  if (!patch || typeof patch !== 'object') {
    out.reasoning = buildReasoningMeta({
      enabled: true,
      status: 'pending',
      patch: { reasoning_mode: 'deterministic_fallback' },
      inputHash
    });
    return out;
  }

  const evidenceRefs = Array.isArray(patch.reasoning_evidence_refs) ? patch.reasoning_evidence_refs : [];
  const patchContractVersion = String(patch?.semantic_contract_version || '').trim() || null;
  const liveContractVersion = String(semanticContract?.semantic_contract_version || SEMANTIC_CONTRACT_VERSION);
  const schemaGateOk = !(patchContractVersion && patchContractVersion !== liveContractVersion);
  const gateFailures = [];

  if (!schemaGateOk) {
    emitReasoningGateMetric('reasoning.gate.schema.fail.count', route);
    gateFailures.push({
      gate: 'schema',
      field: null,
      reason: 'semantic_contract_version_mismatch',
      patch_contract_version: patchContractVersion,
      live_contract_version: liveContractVersion
    });
  }

  let appliedCount = 0;
  for (const fieldPath of REASONING_ALLOWED_UPGRADE_FIELDS) {
    const candidate = _getByPath(patch, fieldPath);
    if (candidate == null || candidate === '') continue;

    if (!schemaGateOk) {
      continue;
    }

    const fieldBlocked = !isFieldAllowedByContract(semanticContract, fieldPath);
    if (fieldBlocked && semanticGuardShadow) emitSemanticMetric('reasoning.semantic_reject.count', fieldPath);
    if (fieldBlocked && semanticGuardEnabled) {
      const containerPath = fieldPath.split('.').slice(0, -1).join('.');
      const container = _getByPath(out, containerPath);
      if (container && typeof container === 'object') {
        container.status = 'unsupported_for_route';
        container.source = container.source === 'deterministic' ? 'deterministic' : 'none';
        container.reason_unavailable = 'unsupported_for_route';
      }
      emitSemanticMetric('reasoning.unsupported_for_route.count', fieldPath);
      emitReasoningGateMetric('reasoning.gate.semantic_contract.fail.count', route);
      gateFailures.push({ gate: 'semantic_contract', field: fieldPath, reason: 'field_not_allowed_for_route' });
      SemanticRejectAudit.logSemanticReject({
        sessionId,
        route,
        field: fieldPath,
        rejectedValue: candidate,
        contractVersion: liveContractVersion,
        reason: 'field_not_allowed_for_route'
      });
      continue;
    }

    const conf = Number(_getByPath(patch, `${fieldPath}_confidence`) || _getByPath(patch, `${fieldPath}_score`) || 0);
    const minConf = getRouteMinConfidence(route, fieldPath);
    if (!Number.isFinite(conf) || conf < minConf) {
      const containerPath = fieldPath.split('.').slice(0, -1).join('.');
      const container = _getByPath(out, containerPath);
      if (container && typeof container === 'object') {
        container.status = 'deferred';
        container.source = container.source === 'deterministic' ? 'deterministic' : 'none';
        container.reason_unavailable = 'reasoning_low_confidence';
      }
      emitReasoningGateMetric('reasoning.gate.confidence.defer.count', route);
      gateFailures.push({ gate: 'confidence', field: fieldPath, reason: 'reasoning_low_confidence' });
      continue;
    }

    const safeValue =
      typeof candidate === 'string'
        ? sanitizeReasoningText(candidate)
        : Array.isArray(candidate)
          ? candidate.map((v) => (typeof v === 'string' ? sanitizeReasoningText(v) : v)).filter(Boolean)
          : candidate;
    const hasBlockedTerm = hasForbiddenVocabulary(semanticContract, safeValue);
    if (hasBlockedTerm && semanticGuardShadow) emitSemanticMetric('reasoning.semantic_reject.count', fieldPath);
    if (hasBlockedTerm && semanticGuardEnabled) {
      const containerPath = fieldPath.split('.').slice(0, -1).join('.');
      const container = _getByPath(out, containerPath);
      if (container && typeof container === 'object') {
        container.status = 'unsupported_for_route';
        container.source = container.source === 'deterministic' ? 'deterministic' : 'none';
        container.reason_unavailable = 'unsupported_for_route';
      }
      emitSemanticMetric('reasoning.unsupported_for_route.count', fieldPath);
      emitReasoningGateMetric('reasoning.gate.semantic_contract.fail.count', route);
      gateFailures.push({ gate: 'semantic_contract', field: fieldPath, reason: 'forbidden_vocab_for_route' });
      SemanticRejectAudit.logSemanticReject({
        sessionId,
        route,
        field: fieldPath,
        rejectedValue: safeValue,
        contractVersion: liveContractVersion,
        reason: 'forbidden_vocab_for_route'
      });
      continue;
    }

    const claimProv = patch?.reasoning_claim_provenance && typeof patch.reasoning_claim_provenance === 'object'
      ? patch.reasoning_claim_provenance[fieldPath] || []
      : [];
    const minEvidence = getRouteMinEvidence(route, fieldPath);
    if (minEvidence > 0 && (!Array.isArray(claimProv) || claimProv.length < minEvidence)) {
      const containerPath = fieldPath.split('.').slice(0, -1).join('.');
      const container = _getByPath(out, containerPath);
      if (container && typeof container === 'object') {
        container.status = 'deferred';
        container.source = container.source === 'deterministic' ? 'deterministic' : 'none';
        container.reason_unavailable = 'reasoning_insufficient_evidence';
      }
      emitReasoningGateMetric('reasoning.gate.confidence.defer.count', route);
      gateFailures.push({ gate: 'confidence', field: fieldPath, reason: 'reasoning_insufficient_evidence' });
      continue;
    }

    if (failsReasoningSafetyGate(safeValue)) {
      const containerPath = fieldPath.split('.').slice(0, -1).join('.');
      const container = _getByPath(out, containerPath);
      if (container && typeof container === 'object') {
        container.status = 'deferred';
        container.source = container.source === 'deterministic' ? 'deterministic' : 'none';
        container.reason_unavailable = 'reasoning_safety_gate';
      }
      emitReasoningGateMetric('reasoning.gate.safety.fail.count', route);
      gateFailures.push({ gate: 'safety', field: fieldPath, reason: 'post_sanitize_safety_reject' });
      continue;
    }

    _setByPath(out, fieldPath, safeValue);
    const containerPath = fieldPath.split('.').slice(0, -1).join('.');
    const container = _getByPath(out, containerPath);
    if (container && typeof container === 'object') {
      container.status = 'available';
      if (Object.prototype.hasOwnProperty.call(container, 'pending')) container.pending = false;
      if (Object.prototype.hasOwnProperty.call(container, 'reason_unavailable')) container.reason_unavailable = null;
      container.source = 'reasoning';
      if (fieldPath === 'verdict.alternatives.candidates' && Array.isArray(safeValue)) {
        container.count = safeValue.length;
      }
      const claimProvApply = patch?.reasoning_claim_provenance && typeof patch.reasoning_claim_provenance === 'object'
        ? patch.reasoning_claim_provenance[fieldPath] || []
        : [];
      container.reasoning = {
        confidence: conf,
        reasoning_mode: String(patch?.reasoning_mode || '').trim().toLowerCase() || 'deterministic_fallback',
        reasoning_model: patch.reasoning_model || null,
        reasoning_version: patch.reasoning_version || null,
        reasoning_evidence_refs: evidenceRefs,
        claim_provenance: Array.isArray(claimProvApply) ? claimProvApply : []
      };
    }
    appliedCount += 1;
  }

  const gateDecision = {
    version: 1,
    gate_order: ['schema', 'semantic_contract', 'confidence', 'safety'],
    evaluated_at: new Date().toISOString(),
    route,
    schema_ok: schemaGateOk,
    first_failure: gateFailures[0] || null,
    failures: gateFailures.slice(0, 50)
  };

  out.reasoning = buildReasoningMeta({
    enabled: true,
    status: appliedCount > 0 ? 'applied' : 'deferred',
    patch,
    inputHash,
    gateDecision
  });
  return out;
}

function buildDeterministicAlternatives({ categoryRoute, functionTags = [] }) {
  if (categoryRoute === 'unknown') {
    return {
      status: 'deferred',
      source: 'none',
      policy: 'ask_kelly',
      reason_unavailable: 'category_unknown'
    };
  }
  const tags = new Set(functionTags || []);
  const candidates = [];
  if (tags.has('barrier_support') || tags.has('hydration')) {
    candidates.push('Fragrance-free ceramide moisturizer');
  }
  if (tags.has('blemish_control') || tags.has('oil_balance')) {
    candidates.push('Low-irritation niacinamide serum');
  }
  if (tags.has('tone_evening')) {
    candidates.push('Vitamin C derivative serum');
  }
  if (!candidates.length && categoryRoute === 'hygiene') {
    candidates.push('Sulfate-free gentle cleanser');
  }
  if (!candidates.length && categoryRoute === 'cosmetic') {
    candidates.push('Sensitive-skin fragrance-free formula');
  }
  return candidates.length
    ? {
        status: 'available',
        source: 'deterministic',
        policy: 'deterministic_catalog',
        candidates: candidates.slice(0, 3),
        reason_unavailable: null
      }
    : {
        status: 'deferred',
        source: 'none',
        policy: 'ask_kelly',
        reason_unavailable: 'insufficient_data'
      };
}

function buildSemanticContract(categoryRoute = 'unknown') {
  return SemanticContractRegistry.getSemanticContract(categoryRoute);
}

function buildCosmeticDeterministicTiles({ ingredientsText, categoryRoute }) {
  const actives = extractKeyActives(ingredientsText);
  const fn = mapFunctionFromActives(actives, categoryRoute);
  const formulation = classifyFormulation(ingredientsText);
  const hasIngredients = !!ingredientsText.trim();
  return {
    keyActivesTile: (() => {
      if (!hasIngredients) return mkTile({ status: 'unavailable', source: 'none', reason: 'missing_ingredients' });
      if (actives.length) return mkTile({ status: 'available', source: 'deterministic', confidence: 'medium', value: actives });
      return mkTile({ status: 'unavailable', source: 'deterministic', reason: 'missing_ingredients' });
    })(),
    functionTile: (() => {
      if (fn.length) return mkTile({ status: 'available', source: 'deterministic', confidence: 'medium', value: fn });
      if (!hasIngredients) return mkTile({ status: 'unavailable', source: 'deterministic', reason: categoryRoute === 'unknown' ? 'category_unknown' : 'missing_ingredients' });
      return mkTile({ status: 'unavailable', source: 'deterministic', reason: categoryRoute === 'unknown' ? 'category_unknown' : 'missing_ingredients' });
    })(),
    formulationTile: (() => {
      if (!hasIngredients) return mkTile({ status: 'unavailable', source: 'none', reason: 'missing_ingredients' });
      return mkTile({
        status: 'available',
        source: 'deterministic',
        confidence: formulation?.confidence || 'low',
        value: formulation?.label || 'Unknown'
      });
    })(),
    functionTags: fn
  };
}

function buildNonCosmeticDeterministicTiles({ ingredientsText, categoryRoute }) {
  const hasIngredients = !!ingredientsText.trim();
  const foodFormulation = classifyFoodOrSupplementFormulation(ingredientsText);
  const keyActivesTile = !hasIngredients
    ? mkTile({ status: 'unavailable', source: 'none', reason: 'missing_ingredients' })
    : mkTile({ status: 'unavailable', source: 'deterministic', reason: 'not_applicable_cosmetic_actives' });
  const functionTile = !hasIngredients
    ? mkTile({ status: 'unavailable', source: 'deterministic', reason: categoryRoute === 'unknown' ? 'category_unknown' : 'missing_ingredients' })
    : mkTile({ status: 'unavailable', source: 'deterministic', reason: 'not_applicable_cosmetic_function' });
  const formulationTile = !hasIngredients
    ? mkTile({ status: 'unavailable', source: 'none', reason: 'missing_ingredients' })
    : mkTile({
        status: 'available',
        source: 'deterministic',
        confidence: foodFormulation?.confidence || 'low',
        value: foodFormulation?.label || 'See ingredient list'
      });
  return {
    keyActivesTile,
    functionTile,
    formulationTile,
    functionTags: []
  };
}

function buildScanSummary({
  product = {},
  categoryRoute = 'unknown',
  categoryRouteSource = null,
  categoryRouteRuleId = null,
  catalogSource = null
}) {
  const generatedAt = new Date().toISOString();
  const ingredientsText = String(product.ingredients_text || '');
  const contract = buildSemanticContract(categoryRoute);
  const deterministicTiles =
    categoryRoute === 'cosmetic' || categoryRoute === 'hygiene'
      ? buildCosmeticDeterministicTiles({ ingredientsText, categoryRoute })
      : buildNonCosmeticDeterministicTiles({ ingredientsText, categoryRoute });
  const skinTypeReason = isCosmeticRoute(categoryRoute)
    ? 'no_profile_context'
    : 'not_applicable_skin_type_for_food';

  const tiles = {
    key_actives: deterministicTiles.keyActivesTile,
    formulation: deterministicTiles.formulationTile,
    function: deterministicTiles.functionTile,
    skin_type: mkTile({ status: 'deferred', source: 'none', reason: skinTypeReason }),
    safety_score: mkTile({ status: 'deferred', source: 'none', reason: 'no_scoring_pipeline' })
  };
  return {
    schema_version: SCHEMA_VERSION,
    semantic_contract_version: SEMANTIC_CONTRACT_VERSION,
    semantic_contract: contract,
    generated_at: generatedAt,
    resolver_source: categoryRouteSource || null,
    route_rule_id: categoryRouteRuleId || null,
    catalog_source: catalogSource || null,
    tiles
  };
}

function buildResultSummary({
  scanSummary = null,
  product = null,
  hasProfileContext = false,
  routineConflicts = [],
  categoryRoute = 'unknown',
  reasoningPatch = null,
  reasoningEnabled = FeatureFlags.isEnabled('RESULT_SUMMARY_REASONING_V1')
}) {
  const baseTiles = scanSummary?.tiles || buildScanSummary({ categoryRoute }).tiles;
  const semanticContract = scanSummary?.semantic_contract || buildSemanticContract(categoryRoute);
  const functionTags = Array.isArray(baseTiles?.function?.value)
    ? baseTiles.function.value
    : [];
  const keyActives = Array.isArray(baseTiles?.key_actives?.value) ? baseTiles.key_actives.value : [];
  const activeLabels = keyActives.map((x) => String(x?.display || x?.name || '').trim()).filter(Boolean);
  const ingredientsText = String(product?.ingredients_text || '');
  const route = String(categoryRoute || '').toLowerCase().trim();
  const harmfulSeverity =
    routineConflicts.some((c) => String(c?.severity || '').toLowerCase() === 'high')
      ? 'high'
      : routineConflicts.length
        ? 'medium'
        : 'low';
  const goodAnswer = hasProfileContext ? (categoryRoute === 'unknown' ? 'unclear' : 'yes') : 'unknown';
  const goodForMeSummary = hasProfileContext
    ? (
        routineConflicts.length
          ? 'Some routine conflict signals were detected. Review before layering with your current regimen.'
          : activeLabels.length
            ? `Works well for ${activeLabels.slice(0, 2).join(' and ')} goals in your current session context.`
            : 'No profile conflicts detected in your current routine.'
      )
    : null;
  const harmfulFlags = [
    ...summarizeRoutineConflictFlags(routineConflicts),
    ...summarizeWatchFlagsFromIngredients(ingredientsText, route),
    ...summarizeFoodWatchFlagsFromIngredients(ingredientsText, route)
  ].slice(0, 4);
  const childrenSafe = buildChildrenSafeVerdict({
    ingredientsText,
    harmfulSeverity,
    categoryRoute: route
  });
  const skinTypeTile =
    hasProfileContext
      ? mkTile({ status: 'available', source: 'graph', confidence: 'low', value: ['combination'] })
      : mkTile({
          status: 'deferred',
          source: 'none',
          reason: isCosmeticRoute(route)
            ? 'no_profile_context'
          : 'not_applicable_skin_type_for_food'
        });
  const deterministicAlternatives = buildDeterministicAlternatives({ categoryRoute, functionTags });
  const alternativesWithMeta =
    deterministicAlternatives.status === 'available'
      ? {
          ...deterministicAlternatives,
          count: Array.isArray(deterministicAlternatives.candidates) ? deterministicAlternatives.candidates.length : 0,
          footer: defaultAlternativesFooter(route, true)
        }
      : {
          ...deterministicAlternatives,
          count: 0,
          footer: defaultAlternativesFooter(route, false)
        };
  const routeForUpsell = String(categoryRoute || '').toLowerCase().trim();
  const missingMore =
    routeForUpsell === 'food' || routeForUpsell === 'supplement'
      ? [
          'Unlock route-aware guidance tailored to food and supplement products.',
          'Get clearer child-safety context with additive and dye-sensitive checks.',
          'Compare safer alternatives in one tap.'
        ]
      : [
          'Unlock personal-fit mode for age, sensitivity, and routine conflicts.',
          'Enable pediatric profile for stronger child-safety confidence.',
          'Compare against safer alternatives in one tap.'
        ];
  const summary = {
    schema_version: SCHEMA_VERSION,
    semantic_contract_version: SEMANTIC_CONTRACT_VERSION,
    semantic_contract: semanticContract,
    generated_at: new Date().toISOString(),
    disclaimer: 'informational_only',
    tiles: {
      ...baseTiles,
      skin_type: skinTypeTile
    },
    verdict: {
      product_overview: {
        status: 'available',
        source: 'deterministic',
        confidence: functionTags.length ? 'medium' : 'low',
        what_it_does: describeProductFunction(categoryRoute, functionTags)
      },
      good_for_me: {
        status: hasProfileContext ? 'available' : 'deferred',
        source: hasProfileContext ? 'graph' : 'none',
        confidence: hasProfileContext ? 'low' : null,
        answer: goodAnswer,
        summary: goodForMeSummary,
        detail: hasProfileContext ? null : buildPendingReasoningState().pending_copy,
        pending: !hasProfileContext,
        reason_unavailable: hasProfileContext ? null : 'no_profile_context'
      },
      harmful: {
        status: 'available',
        source: 'graph',
        confidence: routineConflicts.length ? 'medium' : 'low',
        severity: harmfulSeverity,
        flags: harmfulFlags,
        top_evidence: routineConflicts[0]?.summary || (
          harmfulFlags.length
            ? 'Flagged ingredients are within concern thresholds from current deterministic checks.'
            : (route === 'food' || route === 'supplement')
              ? 'No additive or dye flags were detected in the current deterministic checks.'
              : 'No flagged ingredients were detected in the current deterministic checks.'
        ),
        summary:
          harmfulSeverity === 'high'
            ? 'Conflict or irritant signals were detected from deterministic checks.'
            : harmfulSeverity === 'medium'
              ? 'Some flagged ingredients may matter for sensitive or acne-prone skin.'
              : 'No immediate high-risk signals detected in the deterministic scan.',
        reason_unavailable: null
      },
      children_safe: {
        status: 'available',
        source: 'deterministic',
        confidence: harmfulSeverity === 'high' ? 'medium' : 'low',
        answer: childrenSafe.answer,
        summary: childrenSafe.summary,
        pending: childrenSafe.pending,
        reason_unavailable: null
      },
      side_effects: {
        status: 'available',
        source: 'deterministic',
        confidence: 'low',
        summary: buildDeterministicSideEffects({ ingredientsText, functionTags, harmfulSeverity, categoryRoute })
      },
      alternatives: alternativesWithMeta
    },
    missing_more: missingMore
  };
  recordRouteRegressionSignals(summary, route);
  return applyReasoningPatch(summary, reasoningPatch, { enabled: reasoningEnabled });
}

module.exports = {
  buildSemanticContract,
  buildScanSummary,
  buildResultSummary,
  applyReasoningPatch,
  sanitizeReasoningText,
  REASONING_ALLOWED_UPGRADE_FIELDS,
  SEMANTIC_CONTRACT_VERSION
};
