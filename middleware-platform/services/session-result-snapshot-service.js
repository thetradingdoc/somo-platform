'use strict';

const crypto = require('crypto');
const dbModule = require('../database');
const Metrics = require('./metrics');
const FeatureFlags = require('../config/feature-flags');
const { buildReasoningMap } = require('./reasoning-map-service');

const SCHEMA_VERSION = '1.0';
const db = dbModule.db;

class SnapshotConflictError extends Error {
  constructor(message = 'snapshot_conflict') {
    super(message);
    this.name = 'SnapshotConflictError';
    this.code = 'SNAPSHOT_CONFLICT';
  }
}

function _safeJsonParse(raw, fallback) {
  try {
    const v = JSON.parse(String(raw || ''));
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function _clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function _confidenceBandToScore(band) {
  const v = String(band || '').toLowerCase();
  if (v === 'high') return 0.9;
  if (v === 'medium') return 0.65;
  if (v === 'low') return 0.35;
  return 0.3;
}

function _parseConcerns(row) {
  const concerns = Array.isArray(row?.skin_concerns_json) ? row.skin_concerns_json : [];
  if (concerns.length) return concerns.map((x) => String(x).trim()).filter(Boolean);
  const quality = String(row?.quality || '').trim();
  if (!quality) return [];
  return [quality];
}

function _classifyPrimaryIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return { primary: 'treat', secondary: [] };
  const intentFlags = [];
  if (/\b(what is this|what do i have|identify|diagnose|is this)\b/.test(t)) intentFlags.push('identify');
  if (/\b(help|routine|treat|fix|get rid|what now|how do i)\b/.test(t)) intentFlags.push('treat');
  if (/\b(can i use|with|combine|together|causing|cause)\b/.test(t)) intentFlags.push('compare');
  if (/\b(best|recommend|suggest|alternative|replacement|review)\b/.test(t)) intentFlags.push('recommend');
  if (/\b(laser|hifu|filler|botox|microneedling|clinic|procedure)\b/.test(t)) intentFlags.push('procedure');
  if (/\b(progress|improve|tracking|before after|flare)\b/.test(t)) intentFlags.push('monitor');
  if (!intentFlags.length) intentFlags.push('treat');
  return { primary: intentFlags[0], secondary: intentFlags.slice(1, 3) };
}

function _extractBodyAreas(text) {
  const t = String(text || '').toLowerCase();
  const areas = [];
  if (/\b(face|facial)\b/.test(t)) areas.push('face');
  if (/\b(cheek|cheeks)\b/.test(t)) areas.push('cheeks');
  if (/\b(forehead|brow)\b/.test(t)) areas.push('forehead');
  if (/\b(chin|jaw|jawline)\b/.test(t)) areas.push('chin_jaw');
  if (/\b(under eye|under-eye|eye area|eyelid|periorbital)\b/.test(t)) areas.push('under_eye');
  if (/\b(neck)\b/.test(t)) areas.push('neck');
  if (/\b(scalp|hairline)\b/.test(t)) areas.push('scalp_hairline');
  return [...new Set(areas)];
}

function _extractProcedureInterest(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(laser|hifu|ultherapy|tightening)\b/.test(t)) return { category: 'energy_device', confidence: 0.75 };
  if (/\b(botox|dysport)\b/.test(t)) return { category: 'neuromodulator', confidence: 0.8 };
  if (/\b(filler|sculptra)\b/.test(t)) return { category: 'injectable', confidence: 0.8 };
  if (/\b(microneedling|rf microneedling)\b/.test(t)) return { category: 'microneedling', confidence: 0.75 };
  return null;
}

function _deriveUrgencyFlag(text, row) {
  const urgency = String(row?.urgency || '').toUpperCase();
  if (urgency === 'EMERGENT') return { level: 'high', reason: 'emergent_triage_signal' };
  if (urgency === 'URGENT') return { level: 'medium', reason: 'urgent_triage_signal' };
  const t = String(text || '').toLowerCase();
  if (/\b(mole|lesion|skin cancer|basal cell|melanoma|changing spot)\b/.test(t)) {
    return { level: 'medium', reason: 'suspicious_lesion_pattern' };
  }
  return null;
}

function _extractLikelyTriggers(row, text) {
  const out = [];
  const tri = Array.isArray(row?.triggers_json) ? row.triggers_json : [];
  tri.forEach((x) => out.push(String(x)));
  const t = String(text || '').toLowerCase();
  if (/\bretinoid|retinol|tretinoin\b/.test(t)) out.push('retinoid');
  if (/\bazelaic acid\b/.test(t)) out.push('azelaic_acid');
  if (/\baha|bha|glycolic|salicylic\b/.test(t)) out.push('exfoliating_actives');
  if (/\bsunscreen|spf\b/.test(t)) out.push('uv_exposure_or_spf_context');
  return [...new Set(out)].filter(Boolean).slice(0, 12);
}

function _extractProductFromThread(orch) {
  const thread = Array.isArray(orch?.flow_state?.short_term_thread) ? orch.flow_state.short_term_thread : [];
  for (let i = thread.length - 1; i >= 0; i--) {
    const e = thread[i];
    const text = String(e?.text || '');
    const typeOk = String(e?.type || '') === 'barcode_product_context';
    if (!typeOk && !text.includes('[Barcode Scan]')) continue;
    const nameMatch = text.match(/\[Barcode Scan\]\s*([^\n(]+?)\s*\(/);
    const imgMatch = text.match(/Product image:\s*(https?:\/\/\S+)/i);
    const barcodeMatch = text.match(/\((\d{8,14})\)/);
    return {
      name: nameMatch ? nameMatch[1].trim() : null,
      image_url: imgMatch ? imgMatch[1].trim() : null,
      barcode: barcodeMatch ? barcodeMatch[1] : null
    };
  }
  return null;
}

function _deriveRoutineConflicts(row, text) {
  const conflicts = [];
  const reactions = String(row?.ingredient_reactions || '').trim();
  if (reactions) {
    conflicts.push({
      id: 'reported_ingredient_reaction',
      severity: 'medium',
      summary: reactions.slice(0, 240),
      recommendation: 'Patch-test and reduce active overlap until tolerance is clear.'
    });
  }
  const t = String(text || '').toLowerCase();
  if (/\b(barrier (damaged|compromised)|tight|flaky|irritat)\b/.test(t) && /\bretinoid|aha|bha|glycolic\b/.test(t)) {
    conflicts.push({
      id: 'barrier_vs_strong_actives',
      severity: 'high',
      summary: 'Barrier stress signals appear alongside strong active use.',
      recommendation: 'Pause strong exfoliants/retinoids and prioritize barrier support first.'
    });
  }
  return conflicts.slice(0, 5);
}

function _pickPrimaryConcern(concerns, text) {
  if (Array.isArray(concerns) && concerns.length) return concerns[0];
  const t = String(text || '').toLowerCase();
  if (/\bacne|breakout|comedone|whitehead|cyst\b/.test(t)) return 'acne_clogged_pores';
  if (/\brosacea|redness|dermatitis|eczema\b/.test(t)) return 'redness_rosacea_dermatitis';
  if (/\bdry|barrier|sensitive|irritat|tewl\b/.test(t)) return 'barrier_dryness_sensitivity';
  if (/\bhyperpigmentation|dark spot|melasma|pigment\b/.test(t)) return 'pigmentation_dark_spots';
  if (/\bwrinkle|tighten|laxity|aging|fine line\b/.test(t)) return 'aging_laxity_wrinkles';
  return 'general_skin_concern';
}

function _setByPath(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return false;
  let ref = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!ref[k] || typeof ref[k] !== 'object') ref[k] = {};
    ref = ref[k];
  }
  ref[parts[parts.length - 1]] = value;
  return true;
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

function _persistSnapshot({ sessionId, snapshot, source }) {
  const id = crypto.randomUUID();
  db.prepare(`UPDATE session_result_snapshots SET is_latest = 0 WHERE session_id = ? AND is_latest = 1`).run(sessionId);
  db.prepare(`
    INSERT INTO session_result_snapshots (id, session_id, schema_version, snapshot_json, source, is_latest, generated_at)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `).run(id, sessionId, String(snapshot.schema_version || SCHEMA_VERSION), JSON.stringify(snapshot), source || 'assembler_v1');
  return id;
}

function getLatestSessionResultSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const row = db.prepare(`
    SELECT id, snapshot_json, schema_version, generated_at
    FROM session_result_snapshots
    WHERE session_id = ? AND is_latest = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sid);
  if (!row) return null;
  return {
    snapshot_id: row.id,
    schema_version: row.schema_version,
    generated_at: row.generated_at,
    snapshot: _safeJsonParse(row.snapshot_json, null)
  };
}

function buildSessionResultSnapshot({ sessionId, source = 'assembler_v1' }) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId required');
  const startedAt = Date.now();
  const triage = dbModule.getTriageSession ? dbModule.getTriageSession(sid) : null;
  const orch = dbModule.getOrchestrateSessionBySessionId ? dbModule.getOrchestrateSessionBySessionId(sid) : null;
  const historyText = Array.isArray(orch?.conversation_history)
    ? orch.conversation_history.map((m) => String(m?.content || '')).join(' ')
    : '';
  const threadText = Array.isArray(orch?.flow_state?.short_term_thread)
    ? orch.flow_state.short_term_thread.map((e) => String(e?.text || '')).join(' ')
    : '';
  const combinedText = `${historyText} ${threadText}`.trim();
  const concerns = _parseConcerns(triage || {});
  const primaryConcern = _pickPrimaryConcern(concerns, combinedText);
  const routineConflicts = _deriveRoutineConflicts(triage || {}, combinedText);
  const intent = _classifyPrimaryIntent(combinedText);
  const urgencyFlag = _deriveUrgencyFlag(combinedText, triage || {});
  const likelyTriggers = _extractLikelyTriggers(triage || {}, combinedText);
  const bodyAreas = _extractBodyAreas(combinedText);
  const procedureInterest = _extractProcedureInterest(combinedText);
  const concernConfidence = concerns.length ? 0.82 : 0.62;
  const conflictConfidence = routineConflicts.length ? 0.78 : 0.42;
  const globalConfidence = _clamp01((concernConfidence + conflictConfidence) / 2);
  const nextUiStep = urgencyFlag?.level === 'high' ? 'clinical_handoff' : 'skincare_report';
  let reasoningMap = null;
  if (FeatureFlags.isEnabled('AGENT_REASONING_MAP_V1')) {
    const productTaxonomy = _safeJsonParse(triage?.product_taxonomy_json, null);
    reasoningMap = buildReasoningMap({
      triage,
      historyText: combinedText,
      productTaxonomy,
      routineConflicts,
      primaryConcern,
      concerns,
      triggers: likelyTriggers,
      bodyAreas,
      intentPrimary: intent.primary,
      intentSecondary: intent.secondary,
      baseConfidence: globalConfidence
    });
  }

  const snapshot = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    primary_concern: primaryConcern,
    routine_conflicts: routineConflicts,
    secondary_concerns: concerns.slice(1, 6),
    intent_primary: intent.primary,
    intent_secondary: intent.secondary,
    likely_triggers: likelyTriggers,
    body_areas: bodyAreas,
    procedure_interest: procedureInterest,
    urgency_flag: urgencyFlag,
    confidence: {
      global: Number(globalConfidence.toFixed(2)),
      primary_concern: Number(concernConfidence.toFixed(2)),
      routine_conflicts: Number(conflictConfidence.toFixed(2))
    },
    instruction: null,
    entity_events: [],
    quality_signals: {
      capture_quality: 'unknown'
    },
    insight_badges: [],
    next_ui_step: nextUiStep,
    reasoning_map: reasoningMap
  };

  const threadProduct = _extractProductFromThread(orch);
  if (threadProduct && (threadProduct.name || threadProduct.image_url || threadProduct.barcode)) {
    snapshot.product = {
      ...(threadProduct.name ? { name: threadProduct.name } : {}),
      ...(threadProduct.image_url ? { image_url: threadProduct.image_url } : {}),
      ...(threadProduct.barcode ? { barcode: threadProduct.barcode } : {})
    };
  }

  const snapshotId = _persistSnapshot({ sessionId: sid, snapshot, source });
  const elapsed = Date.now() - startedAt;
  try {
    Metrics.increment('session_result_snapshot.generated.count', 1);
    Metrics.increment('session_result_snapshot.generated_ms.total', elapsed);
    Metrics.increment('session_result_snapshot.generated_ms.count', 1);
    if (reasoningMap) {
      Metrics.increment('reasoning_map.generated.count', 1);
      Metrics.increment(`reasoning_map.confidence_band.${reasoningMap?.confidence?.confidence_band || 'unknown'}.count`, 1);
      if (reasoningMap?.safety_flags?.blocked) Metrics.increment('reasoning_map.safety_block.count', 1);
      if (reasoningMap?.safety_flags?.escalated) Metrics.increment('reasoning_map.escalated.count', 1);
    }
  } catch (_) {}
  return { snapshot_id: snapshotId, snapshot };
}

function applySessionResultEdit({
  sessionId,
  fieldPath,
  userCorrectedValue,
  reasonForChange = '',
  confidenceAfter = null,
  expectedSnapshotId = null
}) {
  const sid = String(sessionId || '').trim();
  const path = String(fieldPath || '').trim();
  if (!sid) throw new Error('sessionId required');
  if (!path) throw new Error('fieldPath required');

  const run = db.transaction(() => {
    const latestRow = getLatestSessionResultSnapshot(sid);
    if (expectedSnapshotId != null && String(expectedSnapshotId).trim() !== '') {
      const want = String(expectedSnapshotId).trim();
      if (!latestRow || String(latestRow.snapshot_id) !== want) {
        throw new SnapshotConflictError();
      }
    }
    const latest = latestRow || buildSessionResultSnapshot({ sessionId: sid, source: 'edit_bootstrap' });
    const latestSnapshot = latest.snapshot || {};
    const original = _getByPath(latestSnapshot, path);
    const nextSnapshot = JSON.parse(JSON.stringify(latestSnapshot));
    _setByPath(nextSnapshot, path, userCorrectedValue);
    nextSnapshot.generated_at = new Date().toISOString();

    const beforeConf = path.startsWith('confidence.')
      ? _clamp01(Number(original || 0))
      : _clamp01(Number(nextSnapshot?.confidence?.global || 0));
    if (confidenceAfter != null) {
      if (!nextSnapshot.confidence || typeof nextSnapshot.confidence !== 'object') nextSnapshot.confidence = {};
      nextSnapshot.confidence.global = _clamp01(Number(confidenceAfter));
    }
    const afterConf = _clamp01(Number(nextSnapshot?.confidence?.global || beforeConf));

    const nextSnapshotId = _persistSnapshot({ sessionId: sid, snapshot: nextSnapshot, source: 'user_edit' });
    db.prepare(`
      INSERT INTO session_result_edits (
        id, session_id, snapshot_id, field_path, original_ai_value_json, user_corrected_value_json,
        reason_for_change, confidence_before, confidence_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      sid,
      nextSnapshotId,
      path,
      JSON.stringify(original == null ? null : original),
      JSON.stringify(userCorrectedValue == null ? null : userCorrectedValue),
      String(reasonForChange || '').slice(0, 800),
      beforeConf,
      afterConf
    );

    return { snapshot_id: nextSnapshotId, snapshot: nextSnapshot };
  });

  const out = run();
  try { Metrics.increment('session_result_snapshot.edit.count', 1); } catch (_) {}
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  SnapshotConflictError,
  buildSessionResultSnapshot,
  getLatestSessionResultSnapshot,
  applySessionResultEdit
};
