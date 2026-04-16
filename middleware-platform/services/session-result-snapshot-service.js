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
      const { buildNycMetalContext } = require('./nyc-metal-context-service');
      const nycCtx = buildNycMetalContext({
        productName: snapshot.scanned_product.product_name,
        categoriesTags: snapshot.scanned_product.categories_tags,
        ingredientsText: snapshot.scanned_product.ingredients_text,
        factsSource: snapshot.scanned_product.source
      });
      if (nycCtx) snapshot.scanned_product.nyc_metal_context = nycCtx;
    } catch (_) {
      /* optional enrichment */
    }
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

  const snapshotId = _persistSnapshot({ sessionId: sid, snapshot, source });
  try {
    const ReasoningService = require('./result-summary-reasoning-service');
    const next = ReasoningService.shouldEnqueueReasoning({ snapshot });
    if (next.shouldEnqueue) {
      ReasoningService.enqueueReasoningJob({
        sessionId: sid,
        snapshotId,
        inputHash: next.inputHash
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
  inputHash = null
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
    const nextSnapshot = JSON.parse(JSON.stringify(latestSnapshot));
    nextSnapshot.generated_at = new Date().toISOString();
    nextSnapshot.result_summary = applyReasoningPatch(nextSnapshot.result_summary || {}, reasoningPatch, {
      enabled: true,
      inputHash,
      sessionId: sid
    });
    const nextSnapshotId = _persistSnapshot({ sessionId: sid, snapshot: nextSnapshot, source: 'reasoning_patch' });
    return { snapshot_id: nextSnapshotId, snapshot: nextSnapshot };
  });

  const out = run();
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
    if (status === 'applied') Metrics.increment('result_summary.reasoning.accepted.count', 1);
    const altCount = Array.isArray(out?.snapshot?.result_summary?.verdict?.alternatives?.candidates)
      ? out.snapshot.result_summary.verdict.alternatives.candidates.length
      : 0;
    if (altCount > 0) Metrics.increment('result_summary.reasoning.alternatives_suggested.count', altCount);
  } catch (_) {}
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  SnapshotConflictError,
  buildSessionResultSnapshot,
  getLatestSessionResultSnapshot,
  applySessionResultEdit,
  applySessionResultReasoningPatch
};
