'use strict';

const crypto = require('crypto');
const dbModule = require('../database');
const Metrics = require('./metrics');
const FeatureFlags = require('../config/feature-flags');
const {
  buildReasoningMap,
  routineConflictsFromGraphVerdict,
  routineConflictsFromGraphHits
} = require('./reasoning-map-service');
const { inferCanonicalIngredientIdsFromText } = require('./skincare-routine-infer');
const { buildResultSummary, buildScanSummary, applyReasoningPatch } = require('./product-summary-service');
const ReasoningFsm = require('./reasoning-fsm-service');
const { pickFirstCatalogImageUrl } = require('./catalog-image-url');

const SCHEMA_VERSION = '1.0';
const ROUTE_CONFIDENCE_MIN = Number(process.env.CATEGORY_ROUTE_CONFIDENCE_MIN || 0.55);
const db = dbModule.db;

class SnapshotConflictError extends Error {
  constructor(message = 'snapshot_conflict') {
    super(message);
    this.name = 'SnapshotConflictError';
    this.code = 'SNAPSHOT_CONFLICT';
  }
}

class ReasoningMergeStaleError extends Error {
  constructor(message = 'reasoning_merge_stale_lineage') {
    super(message);
    this.name = 'ReasoningMergeStaleError';
    this.code = 'REASONING_MERGE_STALE';
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

function _lastUserMessage(orch) {
  const hist = Array.isArray(orch?.conversation_history) ? orch.conversation_history : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const role = String(hist[i]?.role || '').toLowerCase();
    if (role === 'user') return String(hist[i]?.content || '').trim();
  }
  return '';
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
    const pd = e?.product_data && typeof e.product_data === 'object' && !Array.isArray(e.product_data) ? e.product_data : null;
    const imgFromPd = pd ? pickFirstCatalogImageUrl(pd) : null;
    return {
      name: nameMatch ? nameMatch[1].trim() : null,
      image_url: imgFromPd || (imgMatch ? imgMatch[1].trim() : null),
      barcode: barcodeMatch ? barcodeMatch[1] : null
    };
  }
  return null;
}

/** Latest structured OBF payload from client thread events (see `product_data` on `barcode_product_context`). */
function _extractLatestObfProductDataFromThread(orch) {
  const thread = Array.isArray(orch?.flow_state?.short_term_thread) ? orch.flow_state.short_term_thread : [];
  for (let i = thread.length - 1; i >= 0; i--) {
    const e = thread[i];
    if (String(e?.type || '') !== 'barcode_product_context') continue;
    const pd = e?.product_data;
    if (pd && typeof pd === 'object' && !Array.isArray(pd)) return pd;
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

function _readKellyRoutineVerdict(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  try {
    const row = db.prepare(`
      SELECT value FROM kelly_session_meta_kv
      WHERE session_id = ? AND meta_key = 'kelly_routine_verdict_json'
      LIMIT 1
    `).get(sid);
    if (!row?.value) return null;
    return JSON.parse(String(row.value));
  } catch (_) {
    return null;
  }
}

function _mergeGraphRoutineConflicts(sessionId, combinedText, heuristicConflicts) {
  const verdict = _readKellyRoutineVerdict(sessionId);
  let graphConflicts = [];
  if (verdict && Array.isArray(verdict.conflicts) && verdict.conflicts.length) {
    graphConflicts = routineConflictsFromGraphVerdict(verdict);
  } else {
    try {
      const cg = dbModule.createIngredientConflictGraph && dbModule.createIngredientConflictGraph();
      if (cg && combinedText) {
        const ids = inferCanonicalIngredientIdsFromText(combinedText);
        if (ids.length >= 2) {
          const { conflicts: hits } = cg.buildBasket(ids);
          graphConflicts = routineConflictsFromGraphHits(hits);
        }
      }
    } catch (_) {}
  }
  return [...graphConflicts, ...heuristicConflicts].slice(0, 12);
}

/** Graph-derived conflicts for a single OBF ingredient line (scan-only enrichment). */
function _graphConflictsFromIngredientText(ingredientsText) {
  const t = String(ingredientsText || '').trim();
  if (!t) return [];
  try {
    const cg = dbModule.createIngredientConflictGraph && dbModule.createIngredientConflictGraph();
    if (!cg) return [];
    const ids = inferCanonicalIngredientIdsFromText(t);
    if (ids.length < 2) return [];
    const { conflicts: hits } = cg.buildBasket(ids);
    return routineConflictsFromGraphHits(hits).slice(0, 8);
  } catch (_) {
    return [];
  }
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

function _routeConfidenceToScore(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 0;
  const numeric = Number(v);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(1, numeric));
  if (v === 'high') return 0.9;
  if (v === 'medium') return 0.65;
  if (v === 'low') return 0.35;
  return 0;
}

function _withSemanticContractCompat(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const out = JSON.parse(JSON.stringify(snapshot));
  const categoryRoute = String(
    out?.result_summary?.semantic_contract?.route
      || out?.scanned_product?.category_route
      || out?.category_route
      || 'unknown'
  ).toLowerCase();
  const hasContract = !!out?.result_summary?.semantic_contract;
  const hasVersion = !!out?.result_summary?.semantic_contract_version;
  if (!hasContract || !hasVersion) {
    const legacyContract = buildScanSummary({ categoryRoute }).semantic_contract;
    if (!out.result_summary || typeof out.result_summary !== 'object') out.result_summary = {};
    out.result_summary.semantic_contract = out.result_summary.semantic_contract || legacyContract;
    out.result_summary.semantic_contract_version =
      out.result_summary.semantic_contract_version || legacyContract?.semantic_contract_version || null;
    out.result_summary.legacy_pre_contract = true;
  } else {
    out.result_summary.legacy_pre_contract = !!out.result_summary.legacy_pre_contract;
  }
  return out;
}

function _stableClone(value) {
  if (Array.isArray(value)) return value.map((v) => _stableClone(v));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach((k) => {
    out[k] = _stableClone(value[k]);
  });
  return out;
}

function _stableHash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(_stableClone(value))).digest('hex');
}

function _latestSnapshotVersion(sessionId) {
  const row = db.prepare(`
    SELECT snapshot_json
    FROM session_result_snapshots
    WHERE session_id = ? AND is_latest = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId);
  if (!row?.snapshot_json) return 0;
  const parsed = _safeJsonParse(row.snapshot_json, {});
  const n = Number(parsed?.snapshot_version || 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function _buildContextHash({ triage, orch, combinedText, concerns, routeHint }) {
  return _stableHash({
    triage_quality: triage?.quality || null,
    triage_concerns: Array.isArray(concerns) ? concerns : [],
    product_taxonomy_json: triage?.product_taxonomy_json || null,
    short_term_thread: Array.isArray(orch?.flow_state?.short_term_thread) ? orch.flow_state.short_term_thread : [],
    combined_text: combinedText || '',
    route_hint: routeHint || 'unknown'
  });
}

const FSM_AUDIT_MAX_ENTRIES = 48;

function _appendReasoningFsmAudit(snapshot, entry) {
  if (!snapshot || typeof snapshot !== 'object' || !entry || typeof entry !== 'object') return;
  const prev = Array.isArray(snapshot.reasoning_fsm_audit) ? snapshot.reasoning_fsm_audit : [];
  const row = {
    at: new Date().toISOString(),
    from_state: String(entry.from_state != null ? entry.from_state : ''),
    to_state: String(entry.to_state != null ? entry.to_state : ''),
    actor: String(entry.actor || 'unknown').slice(0, 120),
    reason: String(entry.reason || '').slice(0, 240),
    snapshot_version: Number.isFinite(Number(entry.snapshot_version)) ? Number(entry.snapshot_version) : null
  };
  snapshot.reasoning_fsm_audit = [...prev, row].slice(-FSM_AUDIT_MAX_ENTRIES);
}

function _buildBaselineHash(snapshot) {
  const cloned = JSON.parse(JSON.stringify(snapshot || {}));
  const scrubVolatile = (value) => {
    if (Array.isArray(value)) return value.map((v) => scrubVolatile(v));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (
        k === 'generated_at' ||
        k === 'created_at' ||
        k === 'updated_at' ||
        k === 'snapshot_version' ||
        k === 'reasoning_state' ||
        k === 'reasoning_input_hash' ||
        k === 'reasoning_generated_at' ||
        k === 'reasoning_fsm_pending_at' ||
        k === 'reasoning_fsm_last_transition_at' ||
        k === 'reasoning_fallback_reason' ||
        k === 'reasoning_mode' ||
        k === 'reasoning_version' ||
        k === 'reasoning_fsm_audit'
      ) {
        continue;
      }
      out[k] = scrubVolatile(v);
    }
    return out;
  };
  const stable = scrubVolatile(cloned);
  if (stable.result_summary && typeof stable.result_summary === 'object') {
    delete stable.result_summary.generated_at;
  }
  return _stableHash(stable);
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
    INSERT INTO session_result_snapshots (id, session_id, schema_version, semantic_contract_version, snapshot_json, source, is_latest, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `).run(
    id,
    sessionId,
    String(snapshot.schema_version || SCHEMA_VERSION),
    String(snapshot?.result_summary?.semantic_contract_version || ''),
    JSON.stringify(snapshot),
    source || 'assembler_v1'
  );
  return id;
}

function getLatestSessionResultSnapshot(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const row = db.prepare(`
    SELECT id, snapshot_json, schema_version, semantic_contract_version, generated_at
    FROM session_result_snapshots
    WHERE session_id = ? AND is_latest = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sid);
  if (!row) return null;
  return {
    snapshot_id: row.id,
    schema_version: row.schema_version,
    semantic_contract_version: row.semantic_contract_version || null,
    generated_at: row.generated_at,
    snapshot: _withSemanticContractCompat(_safeJsonParse(row.snapshot_json, null))
  };
}

function buildSessionResultSnapshot({ sessionId, source = 'assembler_v1' }) {
  const includeResultSummary = String(process.env.RESULT_SUMMARY_V1 || '1').trim() !== '0';
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
  const snapshotVersion = _latestSnapshotVersion(sid) + 1;
  const primaryConcern = _pickPrimaryConcern(concerns, combinedText);
  const routineConflicts = _mergeGraphRoutineConflicts(sid, combinedText, _deriveRoutineConflicts(triage || {}, combinedText));
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
  const obfPd = _extractLatestObfProductDataFromThread(orch);
  const mergedName = obfPd?.product_name || threadProduct?.name || null;
  const mergedImage =
    pickFirstCatalogImageUrl(obfPd) || (threadProduct?.image_url != null ? String(threadProduct.image_url).trim() : '') || null;
  const mergedBarcode = obfPd?.barcode || threadProduct?.barcode || null;
  if (mergedName || mergedImage || mergedBarcode) {
    snapshot.product = {
      ...(mergedName ? { name: mergedName } : {}),
      ...(mergedImage ? { image_url: mergedImage } : {}),
      ...(mergedBarcode ? { barcode: mergedBarcode } : {})
    };
  }
  if (obfPd && obfPd.lookup_status === 'not_found') {
    const factsSource =
      obfPd.facts_source === 'open_food_facts' ||
      obfPd.facts_source === 'open_beauty_facts' ||
      obfPd.facts_source === 'both'
        ? obfPd.facts_source
        : 'both';
    snapshot.scanned_product = {
      source: factsSource,
      barcode: obfPd.barcode != null ? String(obfPd.barcode).trim() : mergedBarcode,
      product_name: null,
      image_url: null,
      lookup_status: 'not_found',
      ingredients_text: null,
      labels: [],
      allergens: [],
      categories_tags: [],
      data_source: obfPd.data_source != null ? String(obfPd.data_source).trim() : null,
      ingredient_graph_conflicts: []
    };
    snapshot.scan_summary =
      obfPd.scan_summary && typeof obfPd.scan_summary === 'object'
        ? obfPd.scan_summary
        : buildScanSummary({
            product: { ingredients_text: '', product_name: null },
            categoryRoute: 'unknown',
            categoryRouteSource: 'none',
            categoryRouteRuleId: null,
            catalogSource: factsSource
          });
  } else if (obfPd) {
    const ingText = obfPd.ingredients_text != null ? String(obfPd.ingredients_text) : null;
    const ingredientGraphConflicts = ingText ? _graphConflictsFromIngredientText(ingText) : [];
    const factsSource =
      obfPd.facts_source === 'open_food_facts' || obfPd.facts_source === 'open_beauty_facts'
        ? obfPd.facts_source
        : 'open_beauty_facts';
    const rawRoute = String(obfPd.category_route || 'unknown');
    const rawRouteConfidence = obfPd.category_route_confidence || null;
    const routeScore = _routeConfidenceToScore(rawRouteConfidence);
    const routeConflict = String(obfPd.category_route_fallback || '').toLowerCase() === 'true' || routeScore < ROUTE_CONFIDENCE_MIN;
    const effectiveRoute = routeConflict ? 'unknown' : rawRoute;
    snapshot.category_route = effectiveRoute;
    snapshot.route_confidence = routeScore;
    snapshot.route_conflict = !!routeConflict;
    snapshot.route_conflict_policy = routeConflict ? 'fallback_to_catalog_context' : 'single_route_selected';
    snapshot.scanned_product = {
      source: factsSource,
      barcode: obfPd.barcode != null ? String(obfPd.barcode).trim() : mergedBarcode,
      product_name: obfPd.product_name != null ? String(obfPd.product_name).trim() : mergedName,
      generic_name: obfPd.generic_name != null ? String(obfPd.generic_name).trim() : null,
      image_url: mergedImage,
      ingredients_text: ingText,
      labels: Array.isArray(obfPd.labels) ? obfPd.labels.map((x) => String(x || '').trim()).filter(Boolean) : [],
      allergens: Array.isArray(obfPd.allergens) ? obfPd.allergens.map((x) => String(x || '').trim()).filter(Boolean) : [],
      categories_tags: Array.isArray(obfPd.categories_tags)
        ? obfPd.categories_tags.map((x) => String(x || '').trim()).filter(Boolean)
        : [],
      category_route: effectiveRoute,
      category_route_confidence: routeScore,
      category_route_conflict: !!routeConflict,
      data_source: obfPd.data_source != null ? String(obfPd.data_source).trim() : null,
      ingredient_graph_conflicts: ingredientGraphConflicts
    };
    snapshot.scan_summary =
      obfPd.scan_summary && typeof obfPd.scan_summary === 'object'
        ? obfPd.scan_summary
        : buildScanSummary({
            product: snapshot.scanned_product,
            categoryRoute: effectiveRoute,
            categoryRouteSource: obfPd.category_route_source || null,
            categoryRouteRuleId: obfPd.category_route_rule_id || null,
            catalogSource: factsSource
          });
    try {
      // NYC metals enrichment is only applicable to cosmetic/hygiene contexts.
      const routeForNyc = String(effectiveRoute || '').toLowerCase();
      if (routeForNyc === 'cosmetic' || routeForNyc === 'hygiene') {
        const { buildNycMetalContext } = require('./nyc-metal-context-service');
        const nycCtx = buildNycMetalContext({
          productName: snapshot.scanned_product.product_name,
          categoriesTags: snapshot.scanned_product.categories_tags,
          ingredientsText: snapshot.scanned_product.ingredients_text,
          factsSource: snapshot.scanned_product.source
        });
        if (nycCtx) snapshot.scanned_product.nyc_metal_context = nycCtx;
      }
    } catch (_) {
      /* optional enrichment */
    }
    try {
      const routeForNycGuard = String(effectiveRoute || '').toLowerCase();
      const hasNyc = !!snapshot?.scanned_product?.nyc_metal_context;
      if (hasNyc && routeForNycGuard !== 'cosmetic' && routeForNycGuard !== 'hygiene') {
        Metrics.increment('session_result_snapshot.regression.non_cosmetic.nyc_context_present.count', 1);
        Metrics.increment(
          `session_result_snapshot.regression.non_cosmetic.nyc_context_present.route.${routeForNycGuard || 'unknown'}.count`,
          1
        );
      }
    } catch (_) {}
  }

  if (includeResultSummary) {
    snapshot.result_summary = buildResultSummary({
      scanSummary: snapshot.scan_summary || null,
      product: snapshot.scanned_product || snapshot.product || null,
      hasProfileContext: !!(Array.isArray(concerns) && concerns.length),
      routineConflicts,
      categoryRoute: String(snapshot?.scanned_product?.category_route || obfPd?.category_route || 'unknown')
    });
    try {
      const tileEntries = Object.entries(snapshot?.result_summary?.tiles || {});
      tileEntries.forEach(([tile, data]) => {
        const status = String(data?.status || 'unknown');
        Metrics.increment(`result_summary.tile.${tile}.${status}.count`, 1);
        if (status === 'available') Metrics.increment(`result_summary.tile_available_rate.${tile}.hit`, 1);
        Metrics.increment(`result_summary.tile_available_rate.${tile}.total`, 1);
        if (data?.reason_unavailable) {
          Metrics.increment(`result_summary.tile_reason.${tile}.${String(data.reason_unavailable)}.count`, 1);
        }
      });
    } catch (_) {}
  }

  const contextHash = _buildContextHash({
    triage,
    orch,
    combinedText,
    concerns,
    routeHint: snapshot?.scanned_product?.category_route || snapshot?.category_route || 'unknown'
  });
  snapshot.snapshot_version = snapshotVersion;
  snapshot.context_hash = contextHash;
  snapshot.baseline_hash = _buildBaselineHash(snapshot);

  try {
    const { buildLandingRouteIntentPlan } = require('./landing-route-intent-planner');
    const lastUser = _lastUserMessage(orch);
    const explicitRoute = String(
      snapshot?.scanned_product?.category_route || snapshot?.category_route || ''
    ).trim();
    const plan = buildLandingRouteIntentPlan({
      message: lastUser || combinedText.slice(0, 800),
      shortTermThread: Array.isArray(orch?.flow_state?.short_term_thread) ? orch.flow_state.short_term_thread : [],
      explicitRoute
    });
    snapshot.unified_context = {
      schema_version: '1',
      route_context: plan.route_context,
      intent_context: plan.intent_context,
      policy_pack: plan.policy_pack,
      arbitration: plan.arbitration,
      flags: plan.flags,
      scan_ingest: {
        thread_event_type: 'barcode_product_context',
        canonical_product_fields: ['scanned_product', 'product', 'scan_summary'],
        note:
          'Thread rows are append-only transport; canonical scan fields are normalized on this snapshot.'
      }
    };
  } catch (_) {
    try {
      Metrics.increment('session_result_snapshot.unified_context_plan.error.count', 1);
    } catch (__) {}
  }

  let reasoningDecision = { shouldEnqueue: false, reason: 'reasoning_disabled', inputHash: null };
  try {
    const ReasoningService = require('./result-summary-reasoning-service');
    reasoningDecision = ReasoningService.shouldEnqueueReasoning({ snapshot });
  } catch (_) {}
  snapshot.reasoning_state = reasoningDecision.shouldEnqueue
    ? 'pending'
    : (reasoningDecision.reason === 'reasoning_disabled' ? 'disabled' : 'complete');
  if (reasoningDecision.shouldEnqueue) {
    snapshot.reasoning_fsm_pending_at = new Date().toISOString();
  } else {
    snapshot.reasoning_fsm_pending_at = null;
  }
  if (reasoningDecision.reason === 'reasoning_disabled' || !reasoningDecision.shouldEnqueue) {
    snapshot.reasoning_fallback_reason = null;
  }
  if (reasoningDecision?.inputHash) {
    snapshot.reasoning_input_hash = reasoningDecision.inputHash;
  }

  try {
    _appendReasoningFsmAudit(snapshot, {
      from_state: 'none',
      to_state: String(snapshot.reasoning_state || 'unknown'),
      actor: 'snapshot_assembler',
      reason: 'build_session_result_snapshot',
      snapshot_version: snapshotVersion
    });
  } catch (_) {}

  const snapshotId = _persistSnapshot({ sessionId: sid, snapshot, source });
  try {
    const ReasoningService = require('./result-summary-reasoning-service');
    if (reasoningDecision.shouldEnqueue) {
      ReasoningService.enqueueReasoningJob({
        sessionId: sid,
        snapshotId,
        snapshotVersion,
        contextHash,
        inputHash: reasoningDecision.inputHash
      });
    }
  } catch (_) {
    /* async reasoning scaffold is best-effort */
  }
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
  if (out?.skipped) return out;
  try {
    Metrics.increment('session_result_snapshot.edit.count', 1);
    const latestReasoningStatus = String(out?.snapshot?.result_summary?.reasoning?.status || '');
    if (path.startsWith('result_summary.verdict.') && latestReasoningStatus === 'applied') {
      Metrics.increment('result_summary.reasoning.user_correction.count', 1);
    }
  } catch (_) {}
  return out;
}

function applySessionResultReasoningPatch({
  sessionId,
  reasoningPatch,
  expectedSnapshotId = null,
  inputHash = null,
  mergeLineage = null
}) {
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId required');
  if (!reasoningPatch || typeof reasoningPatch !== 'object') throw new Error('reasoningPatch required');

  const run = db.transaction(() => {
    const latestRow = getLatestSessionResultSnapshot(sid);
    if (!latestRow?.snapshot) throw new Error('latest snapshot missing');
    if (expectedSnapshotId != null && String(expectedSnapshotId).trim() !== '') {
      const want = String(expectedSnapshotId).trim();
      if (String(latestRow.snapshot_id || '') !== want) {
        throw new SnapshotConflictError();
      }
    }
    const latestSnapshot = latestRow.snapshot || {};
    const mergeActive = mergeLineage && typeof mergeLineage === 'object';
    if (mergeActive) {
      const wantVer = Number(mergeLineage.snapshotVersion ?? mergeLineage.snapshot_version);
      const wantCtx = String(mergeLineage.contextHash ?? mergeLineage.context_hash ?? '').trim();
      const liveVer = Number(latestSnapshot.snapshot_version || 0);
      const liveCtx = String(latestSnapshot.context_hash || '').trim();
      if (!Number.isFinite(wantVer) || wantVer < 1 || liveVer !== wantVer || liveCtx !== wantCtx) {
        throw new ReasoningMergeStaleError(
          `reasoning_merge_stale_lineage:live=${liveVer}/${liveCtx.slice(0, 16)} want=${wantVer}/${wantCtx.slice(0, 16)}`
        );
      }
    }
    const pbaRaw =
      reasoningPatch?.patch_built_at != null ? String(reasoningPatch.patch_built_at).trim() : '';
    const pba = pbaRaw ? Date.parse(pbaRaw) : NaN;
    const lgaRaw = latestSnapshot?.generated_at != null ? String(latestSnapshot.generated_at).trim() : '';
    const lga = lgaRaw ? Date.parse(lgaRaw) : NaN;
    if (Number.isFinite(pba) && Number.isFinite(lga) && lga > pba + 750) {
      try {
        Metrics.increment('reasoning.fsm.transition.rejected_stale_patch.count', 1);
      } catch (_) {}
      throw new ReasoningMergeStaleError(
        `reasoning_patch_predates_newer_snapshot:patch=${pbaRaw.slice(0, 24)} live=${lgaRaw.slice(0, 24)}`
      );
    }

    const latestReasoning = latestSnapshot?.result_summary?.reasoning || {};
    const latestHash = String(latestReasoning?.reasoning_input_hash || '').trim();
    const normalizedHash = String(inputHash || reasoningPatch?.reasoning_input_hash || '').trim();
    const latestStatus = String(latestReasoning?.status || '').trim().toLowerCase();
    const settled = latestStatus === 'applied' || latestStatus === 'deferred' || latestStatus === 'disabled';
    // Idempotency guard: do not create duplicate snapshots for the same reasoning tuple.
    if (normalizedHash && settled && latestHash && latestHash === normalizedHash) {
      try {
        Metrics.increment('session_result_snapshot.reasoning_patch.idempotent_skip.count', 1);
      } catch (_) {}
      return { snapshot_id: latestRow.snapshot_id, snapshot: latestSnapshot, skipped: true };
    }
    const prevFsmState = String(latestSnapshot.reasoning_state || 'unknown').toLowerCase();
    const pendingSince = latestSnapshot.reasoning_fsm_pending_at || null;
    const nextSnapshot = JSON.parse(JSON.stringify(latestSnapshot));
    nextSnapshot.generated_at = new Date().toISOString();
    const dbMaxVer = _latestSnapshotVersion(sid);
    const jsonVer = Number(latestSnapshot.snapshot_version || 0);
    const baseVer = Math.max(Number.isFinite(jsonVer) && jsonVer > 0 ? jsonVer : 0, dbMaxVer);
    nextSnapshot.snapshot_version = baseVer + 1;
    if (!nextSnapshot.context_hash) {
      nextSnapshot.context_hash = _stableHash({
        session_id: sid,
        snapshot_id: latestRow.snapshot_id,
        snapshot_version: nextSnapshot.snapshot_version
      });
    }
    if (!nextSnapshot.baseline_hash) {
      nextSnapshot.baseline_hash = _buildBaselineHash(nextSnapshot);
    }
    nextSnapshot.result_summary = applyReasoningPatch(nextSnapshot.result_summary || {}, reasoningPatch, {
      enabled: true,
      inputHash,
      sessionId: sid
    });
    const rs = String(nextSnapshot.result_summary?.reasoning?.status || '').toLowerCase();
    const rm = String(nextSnapshot.result_summary?.reasoning?.reasoning_mode || '').toLowerCase();
    const fsmResult = ReasoningFsm.computePostPatchSnapshotState({
      prevState: prevFsmState,
      reasoningStatus: rs,
      reasoningMode: rm,
      providerErrorClass: reasoningPatch?.reasoning_provider_error_class || null
    });
    const nextFsmState = fsmResult.state;
    const chk = ReasoningFsm.canTransition(prevFsmState, nextFsmState);
    if (!chk.allowed) {
      try {
        Metrics.increment('reasoning.fsm.transition.rejected.count', 1);
      } catch (_) {}
      throw new Error(`reasoning_fsm_invalid_transition:${chk.reason}`);
    }
    ReasoningFsm.recordTransition({
      fromState: prevFsmState,
      toState: nextFsmState,
      pendingSinceIso: pendingSince
    });
    try {
      _appendReasoningFsmAudit(nextSnapshot, {
        from_state: prevFsmState,
        to_state: nextFsmState,
        actor: 'reasoning_patch_worker',
        reason: 'apply_session_result_reasoning_patch',
        snapshot_version: nextSnapshot.snapshot_version
      });
    } catch (_) {}
    nextSnapshot.reasoning_state = nextFsmState;
    nextSnapshot.reasoning_fallback_reason =
      nextFsmState === 'fallback' ? fsmResult.fallback_reason : null;
    if (nextFsmState !== 'pending') {
      nextSnapshot.reasoning_fsm_pending_at = null;
      nextSnapshot.reasoning_fsm_last_transition_at = new Date().toISOString();
    }
    const rmFinal = String(nextSnapshot.result_summary?.reasoning?.reasoning_mode || '').trim() || null;
    const rvFinal =
      String(reasoningPatch?.reasoning_version || nextSnapshot.result_summary?.reasoning?.reasoning_version || '')
        .trim() || null;
    const rihFinal = String(
      normalizedHash ||
        nextSnapshot.result_summary?.reasoning?.reasoning_input_hash ||
        nextSnapshot.reasoning_input_hash ||
        ''
    ).trim() || null;
    nextSnapshot.reasoning_mode = rmFinal;
    nextSnapshot.reasoning_version = rvFinal;
    nextSnapshot.reasoning_input_hash = rihFinal;
    const nextSnapshotId = _persistSnapshot({ sessionId: sid, snapshot: nextSnapshot, source: 'reasoning_patch' });
    return {
      snapshot_id: nextSnapshotId,
      snapshot: nextSnapshot,
      skipped: false,
      merge_lineage_ok: !!mergeActive
    };
  });

  let out;
  try {
    out = run();
  } catch (err) {
    if (err instanceof SnapshotConflictError) {
      try {
        Metrics.increment('reasoning.merge.conflict_reject.count', 1);
      } catch (_) {}
    } else if (err instanceof ReasoningMergeStaleError) {
      try {
        Metrics.increment('reasoning.merge.stale_reject.count', 1);
      } catch (_) {}
    }
    throw err;
  }
  try {
    Metrics.increment('session_result_snapshot.reasoning_patch.count', 1);
    const status = String(out?.snapshot?.result_summary?.reasoning?.status || 'unknown');
    const route = String(
      out?.snapshot?.result_summary?.semantic_contract?.route
        || out?.snapshot?.scanned_product?.category_route
        || out?.snapshot?.category_route
        || 'unknown'
    ).toLowerCase();
    Metrics.increment(`result_summary.reasoning.status.${status}.count`, 1);
    Metrics.increment(`result_summary.reasoning.status.${status}.route.${route}.count`, 1);
    Metrics.increment('result_summary.reasoning.generated.count', 1);
    const mode = String(out?.snapshot?.result_summary?.reasoning?.reasoning_mode || 'deterministic_fallback').toLowerCase();
    Metrics.increment(`reasoning.mode.${mode}.count`, 1);
    if (status === 'applied') Metrics.increment('result_summary.reasoning.accepted.count', 1);
    const altCount = Array.isArray(out?.snapshot?.result_summary?.verdict?.alternatives?.candidates)
      ? out.snapshot.result_summary.verdict.alternatives.candidates.length
      : 0;
    if (altCount > 0) Metrics.increment('result_summary.reasoning.alternatives_suggested.count', altCount);
    if (!out?.skipped && mergeLineage && typeof mergeLineage === 'object') {
      Metrics.increment('reasoning.merge.merge_success.count', 1);
    }
  } catch (_) {}
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  SnapshotConflictError,
  ReasoningMergeStaleError,
  buildSessionResultSnapshot,
  getLatestSessionResultSnapshot,
  applySessionResultEdit,
  applySessionResultReasoningPatch
};
