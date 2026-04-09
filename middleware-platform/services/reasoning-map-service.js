'use strict';

const crypto = require('crypto');

const REASONING_MAP_VERSION = '1.0';

const EVIDENCE_GRADE_WEIGHT = {
  guideline: 1.0,
  clinical_trial: 0.95,
  regulatory_label: 0.92,
  database_record: 0.82,
  taxonomy_rule: 0.88,
  vector_match: 0.75,
  marketing_claim: 0.35
};

function _clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function _nowIso() {
  return new Date().toISOString();
}

function _asArray(v) {
  return Array.isArray(v) ? v : [];
}

function _slug(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function _daysSince(ts) {
  const t = Date.parse(String(ts || ''));
  if (!Number.isFinite(t)) return 9999;
  const d = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return Math.max(0, d);
}

function _freshnessScore(ts) {
  const days = _daysSince(ts);
  if (days <= 30) return 1;
  if (days <= 90) return 0.9;
  if (days <= 180) return 0.8;
  if (days <= 365) return 0.65;
  return 0.45;
}

function createEvidenceItem(input) {
  const sourceType = String(input?.source_type || 'unknown');
  const sourceId = String(input?.source_id || '').trim() || `src_${crypto.randomUUID().slice(0, 8)}`;
  const evidenceGrade = String(input?.evidence_grade || 'database_record').toLowerCase();
  const confidence = _clamp01(input?.confidence == null ? 0.5 : input.confidence);
  const reliability = _clamp01(input?.source_reliability_score == null ? 0.7 : input.source_reliability_score);
  const freshnessTs = input?.freshness_ts || _nowIso();
  const item = {
    evidence_id: String(input?.evidence_id || `ev_${crypto.randomUUID().slice(0, 12)}`),
    source_type: sourceType,
    source_id: sourceId,
    source_label: String(input?.source_label || sourceType),
    source_reliability_score: reliability,
    evidence_grade: evidenceGrade,
    freshness_ts: freshnessTs,
    confidence,
    relevance: _clamp01(input?.relevance == null ? confidence : input.relevance),
    tags: _asArray(input?.tags).map((x) => String(x)),
    payload: input?.payload && typeof input.payload === 'object' ? input.payload : {}
  };
  return item;
}

function scoreEvidence(item) {
  const gradeWeight = EVIDENCE_GRADE_WEIGHT[item.evidence_grade] || 0.65;
  const freshness = _freshnessScore(item.freshness_ts);
  const score = _clamp01(
    item.confidence * 0.4 +
      item.relevance * 0.25 +
      item.source_reliability_score * 0.2 +
      gradeWeight * 0.1 +
      freshness * 0.05
  );
  return { ...item, score: Number(score.toFixed(4)) };
}

function normalizeSignals({ triage, historyText, productTaxonomy }) {
  const text = String(historyText || '').toLowerCase();
  const signals = {
    session_has_history: Boolean(String(historyText || '').trim()),
    has_barrier_distress: /\b(barrier|irritat|burning|stinging|flaky|tight)\b/.test(text),
    has_sunburn: /\b(sunburn|sunburned|sun burned|burned skin)\b/.test(text),
    has_open_wound: /\b(open wound|broken skin|bleeding lesion|raw skin)\b/.test(text),
    mentions_retinoid: /\b(retinoid|retinol|tretinoin|adapalene)\b/.test(text),
    mentions_exfoliant: /\b(aha|bha|glycolic|salicylic|lactic acid|exfoliat)\b/.test(text),
    mentions_suspicious_lesion: /\b(melanoma|basal cell|changing mole|irregular mole|skin cancer)\b/.test(text),
    has_reported_ingredient_reaction: Boolean(String(triage?.ingredient_reactions || '').trim()),
    product_grade_class: String(productTaxonomy?.grade_class || '')
  };
  return signals;
}

function normalizeEntities({ primaryConcern, concerns, triggers, bodyAreas, intentPrimary, intentSecondary, productTaxonomy }) {
  return {
    primary_concern: String(primaryConcern || '').trim() || 'general_skin_concern',
    secondary_concerns: _asArray(concerns).map((x) => String(x)).filter(Boolean).slice(0, 6),
    likely_triggers: _asArray(triggers).map((x) => String(x)).filter(Boolean).slice(0, 12),
    body_areas: _asArray(bodyAreas).map((x) => String(x)).filter(Boolean).slice(0, 8),
    intent_primary: String(intentPrimary || 'treat'),
    intent_secondary: _asArray(intentSecondary).map((x) => String(x)).filter(Boolean).slice(0, 3),
    product_grade_class: String(productTaxonomy?.grade_class || '')
  };
}

function buildEvidenceFromInputs({ normalized, productTaxonomy, routineConflicts }) {
  const evidenceItems = [];
  evidenceItems.push(
    createEvidenceItem({
      source_type: 'taxonomy_rule',
      source_id: `concern:${_slug(normalized.primary_concern)}`,
      source_label: 'primary_concern_classifier',
      evidence_grade: 'taxonomy_rule',
      source_reliability_score: 0.9,
      confidence: 0.82,
      relevance: 0.9,
      tags: ['concern', normalized.primary_concern]
    })
  );
  if (String(productTaxonomy?.source_priority || '').trim()) {
    evidenceItems.push(
      createEvidenceItem({
        source_type: 'api',
        source_id: `product_grade:${_slug(productTaxonomy.source_priority)}`,
        source_label: 'product_taxonomy_pipeline',
        evidence_grade: 'regulatory_label',
        source_reliability_score: 0.9,
        confidence: _clamp01(productTaxonomy?.confidence == null ? 0.75 : productTaxonomy.confidence),
        relevance: 0.8,
        tags: ['product', String(productTaxonomy?.grade_class || 'unknown')],
        payload: {
          grade_class: productTaxonomy?.grade_class || null
        }
      })
    );
  }
  for (const c of _asArray(routineConflicts)) {
    evidenceItems.push(
      createEvidenceItem({
        source_type: 'taxonomy_rule',
        source_id: `routine_conflict:${_slug(c?.id || c?.summary || 'conflict')}`,
        source_label: 'routine_conflict_detector',
        evidence_grade: 'taxonomy_rule',
        source_reliability_score: 0.88,
        confidence: c?.severity === 'high' ? 0.88 : 0.73,
        relevance: 0.86,
        tags: ['routine_conflict'],
        payload: c
      })
    );
  }
  return evidenceItems.map(scoreEvidence).sort((a, b) => b.score - a.score);
}

function runNegativeRules({ signals, normalized }) {
  const out = [];
  const add = (id, rail, severity, outcome, rationale, recommendation, confidence = 0.9) => {
    out.push({
      rule_id: id,
      rail,
      severity,
      outcome,
      rationale,
      recommendation,
      confidence: _clamp01(confidence)
    });
  };
  if (signals.mentions_retinoid && signals.has_open_wound) {
    add(
      'neg_retinoid_open_wound',
      'safety',
      'critical',
      'block',
      'Retinoid mention with open-wound signal',
      'Avoid retinoids on broken skin; prioritize clinical review and barrier recovery.'
    );
  }
  if (signals.mentions_exfoliant && signals.has_sunburn) {
    add(
      'neg_exfoliant_sunburn',
      'safety',
      'high',
      'block',
      'Exfoliant mention with active sunburn',
      'Pause acids/exfoliants until sunburn resolves; focus on soothing and SPF.'
    );
  }
  if (signals.mentions_suspicious_lesion) {
    add(
      'neg_suspicious_lesion_cosmetic_only',
      'safety',
      'critical',
      'escalate',
      'Suspicious lesion keywords detected',
      'Escalate to clinician/dermatology assessment before cosmetic optimization.'
    );
  }
  if (signals.has_barrier_distress && (signals.mentions_retinoid || signals.mentions_exfoliant)) {
    add(
      'neg_barrier_distress_with_strong_actives',
      'contraindication',
      'high',
      'block',
      'Barrier distress plus strong actives',
      'Temporarily pause strong actives and rebuild barrier tolerance first.',
      0.85
    );
  }
  return out;
}

function runPositiveRules({ signals, normalized }) {
  const out = [];
  const add = (id, rail, severity, outcome, rationale, recommendation, confidence = 0.75) => {
    out.push({
      rule_id: id,
      rail,
      severity,
      outcome,
      rationale,
      recommendation,
      confidence: _clamp01(confidence)
    });
  };
  if (normalized.primary_concern === 'barrier_dryness_sensitivity' || signals.has_barrier_distress) {
    add(
      'pos_barrier_support_baseline',
      'efficacy',
      'medium',
      'recommend',
      'Barrier-support pattern detected',
      'Use gentle cleanser + moisturizer + daytime SPF; reintroduce actives gradually.'
    );
  }
  if (normalized.primary_concern === 'pigmentation_dark_spots' && !signals.has_sunburn) {
    add(
      'pos_pigment_photoprotection',
      'efficacy',
      'medium',
      'recommend',
      'Pigmentation concern without acute contraindication',
      'Prioritize strict SPF and gradual brightening strategy with irritation monitoring.',
      0.72
    );
  }
  return out;
}

function applyRails({ negativeRules, positiveRules }) {
  const all = [...negativeRules, ...positiveRules];
  const byPriority = { safety: 1, contraindication: 2, efficacy: 3, preference: 4 };
  all.sort((a, b) => (byPriority[a.rail] || 99) - (byPriority[b.rail] || 99));

  const blocked = all.some((r) => r.outcome === 'block' && (r.rail === 'safety' || r.rail === 'contraindication'));
  const escalated = all.some((r) => r.outcome === 'escalate');

  const recommendations = [];
  const conflicts = [];
  for (const r of all) {
    if (r.outcome === 'recommend' && !blocked) {
      recommendations.push({
        id: `rec_${_slug(r.rule_id)}`,
        text: r.recommendation,
        source_rule_id: r.rule_id,
        confidence: r.confidence
      });
    } else if (r.outcome === 'block' || r.outcome === 'escalate') {
      conflicts.push({
        id: `conf_${_slug(r.rule_id)}`,
        severity: r.severity,
        summary: r.rationale,
        resolution: r.recommendation,
        source_rule_id: r.rule_id
      });
    }
  }

  return {
    rules_fired: all,
    conflicts: conflicts.slice(0, 8),
    recommendations: recommendations.slice(0, 8),
    blocked,
    escalated
  };
}

function confidencePolicy({ baseConfidence, blocked, escalated, ruleCount, evidenceCount }) {
  let c = _clamp01(baseConfidence);
  if (evidenceCount < 2) c = Math.min(c, 0.62);
  if (ruleCount === 0) c = Math.min(c, 0.58);
  if (blocked) c = Math.min(c, 0.64);
  if (escalated) c = Math.min(c, 0.72);
  const band = c >= 0.8 ? 'high' : c >= 0.62 ? 'medium' : 'low';
  const action = band === 'low' ? 'ask_clarifying_question' : band === 'medium' ? 'recommend_with_caution' : 'recommend';
  return {
    final_confidence: Number(c.toFixed(2)),
    confidence_band: band,
    action_policy: action
  };
}

function validateReasoningMap(map) {
  if (!map || typeof map !== 'object') return { ok: false, error: 'map_missing' };
  const required = ['version', 'generated_at', 'trace_id', 'signals', 'normalized_entities', 'evidence_items', 'rules_fired', 'conflicts', 'recommendations', 'confidence', 'safety_flags'];
  for (const k of required) {
    if (!(k in map)) return { ok: false, error: `missing_${k}` };
  }
  return { ok: true };
}

function buildReasoningMap(input) {
  const signals = normalizeSignals(input);
  const normalized = normalizeEntities(input);
  const evidenceItems = buildEvidenceFromInputs({
    normalized,
    productTaxonomy: input.productTaxonomy,
    routineConflicts: input.routineConflicts
  });
  const negativeRules = runNegativeRules({ signals, normalized });
  const positiveRules = runPositiveRules({ signals, normalized });
  const rails = applyRails({ negativeRules, positiveRules });
  const baseConfidence = _clamp01(input.baseConfidence == null ? 0.7 : input.baseConfidence);
  const conf = confidencePolicy({
    baseConfidence,
    blocked: rails.blocked,
    escalated: rails.escalated,
    ruleCount: rails.rules_fired.length,
    evidenceCount: evidenceItems.length
  });
  const safetyFlags = {
    blocked: rails.blocked,
    escalated: rails.escalated,
    must_handoff: rails.escalated || signals.mentions_suspicious_lesion
  };
  const map = {
    version: REASONING_MAP_VERSION,
    generated_at: _nowIso(),
    trace_id: `rm_${crypto.randomUUID()}`,
    signals,
    normalized_entities: normalized,
    evidence_items: evidenceItems,
    rules_fired: rails.rules_fired,
    conflicts: rails.conflicts,
    recommendations: rails.recommendations,
    confidence: conf,
    safety_flags: safetyFlags,
    explanation_payload: {
      top_rule_ids: rails.rules_fired.slice(0, 5).map((r) => r.rule_id),
      top_evidence_ids: evidenceItems.slice(0, 5).map((e) => e.evidence_id),
      summary: rails.escalated
        ? 'Safety escalation triggered by deterministic rules.'
        : rails.blocked
          ? 'Contraindication rules block aggressive routine recommendations.'
          : 'No high-priority safety block detected; recommendations based on ranked evidence.'
    }
  };
  const valid = validateReasoningMap(map);
  if (!valid.ok) {
    return {
      version: REASONING_MAP_VERSION,
      generated_at: _nowIso(),
      trace_id: `rm_${crypto.randomUUID()}`,
      signals: {},
      normalized_entities: normalized,
      evidence_items: [],
      rules_fired: [],
      conflicts: [],
      recommendations: [],
      confidence: { final_confidence: 0.45, confidence_band: 'low', action_policy: 'ask_clarifying_question' },
      safety_flags: { blocked: false, escalated: false, must_handoff: false },
      explanation_payload: { summary: `Reasoning map fallback: ${valid.error}` }
    };
  }
  return map;
}

module.exports = {
  REASONING_MAP_VERSION,
  buildReasoningMap,
  validateReasoningMap,
  createEvidenceItem,
  scoreEvidence
};

