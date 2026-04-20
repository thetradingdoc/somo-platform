'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const FeatureFlags = require('../config/feature-flags');
const SemanticContractRegistry = require('./semantic-contract-registry');
const Metrics = require('./metrics');
const { redact } = require('../utils/pii-redactor');
const { getOrCreate } = require('../utils/circuit-breaker');
const RetrievalGrounding = require('./result-summary-retrieval-grounding-service');
const { createVectorRetriever } = require('./vector-retriever');
const ReasoningJobQueue = require('./reasoning-job-queue-service');

const MODEL_INPUT_CHAR_BUDGET = 2400;
const DEFAULT_INPUT_TOKEN_RATE_MICROUSD = 300; // $0.0003/token placeholder until provider contract finalizes.
const DEFAULT_OUTPUT_TOKEN_RATE_MICROUSD = 900; // $0.0009/token placeholder until provider contract finalizes.
const REASONING_MODEL_TIMEOUT_MS = 8000;
const REASONING_MODEL_MAX_TOKENS = 1000;
let _anthropicClient = null;
let _modelCallerOverride = null;
let _hazardDictionaryCache = null;
let _workerScheduled = false;

const HAZARD_DICTIONARY_PATH = path.resolve(__dirname, '..', 'taxonomy', 'hazard-dictionary.v1.json');

function stripMarkupAndUrls(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateToBudget(value, maxChars = MODEL_INPUT_CHAR_BUDGET) {
  const text = String(value || '');
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function sanitizeModelBoundText(value) {
  const stripped = stripMarkupAndUrls(value);
  const maybeRedacted = FeatureFlags.isEnabled('pii_redaction_enabled') ? redact(stripped) : stripped;
  return truncateToBudget(maybeRedacted, MODEL_INPUT_CHAR_BUDGET);
}

function enforceOutputSafety(value) {
  return String(value || '')
    .replace(/\bdiagnos(?:is|es|e|ed|ing)\b/gi, 'assess')
    .replace(/\bcure(?:s|d|ing)?\b/gi, 'support')
    .replace(/\bguarantee(?:d)?\b/gi, 'suggest')
    .replace(/\bmedical advice\b/gi, 'consumer guidance')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateTokens(text) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  return Math.ceil(raw.length / 4);
}

function metricSafeRoute(route) {
  return String(route || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'unknown';
}

function observeReasoningLatencyBuckets(ms) {
  const value = Math.max(0, Number(ms || 0));
  if (value <= 1000) return Metrics.increment('reasoning.provider.latency_ms.bucket.le_1000.count', 1);
  if (value <= 3000) return Metrics.increment('reasoning.provider.latency_ms.bucket.le_3000.count', 1);
  if (value <= 8000) return Metrics.increment('reasoning.provider.latency_ms.bucket.le_8000.count', 1);
  return Metrics.increment('reasoning.provider.latency_ms.bucket.gt_8000.count', 1);
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || `timeout_${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getAnthropicClient() {
  if (_anthropicClient) return _anthropicClient;
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  _anthropicClient = new Anthropic({ apiKey });
  return _anthropicClient;
}

function extractTextBlocks(content = []) {
  if (typeof content === 'string') return content;
  const blocks = Array.isArray(content) ? content : [];
  return blocks
    .map((b) => (b && b.type === 'text' ? String(b.text || '') : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('reasoning_model_empty_output');
  if (text.includes('```')) {
    throw new Error('reasoning_model_non_json_output:fenced');
  }
  if (!text.startsWith('{') || !text.endsWith('}')) {
    throw new Error('reasoning_model_non_json_output');
  }
  return JSON.parse(text);
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function requireString(obj, keyPath) {
  const parts = keyPath.split('.');
  let ref = obj;
  for (const p of parts) ref = ref?.[p];
  if (typeof ref !== 'string') throw new Error(`reasoning_schema_invalid:${keyPath}`);
  return ref;
}

function requireNumber(obj, keyPath) {
  const parts = keyPath.split('.');
  let ref = obj;
  for (const p of parts) ref = ref?.[p];
  const n = Number(ref);
  if (!Number.isFinite(n)) throw new Error(`reasoning_schema_invalid:${keyPath}`);
  return clampConfidence(n);
}

function enforceRouteContractOnModelOutput(parsed, route, isCosmeticRoute) {
  const out = parsed && typeof parsed === 'object' ? parsed : {};
  out.verdict = out.verdict && typeof out.verdict === 'object' ? out.verdict : {};
  out.verdict.good_for_me = out.verdict.good_for_me && typeof out.verdict.good_for_me === 'object' ? out.verdict.good_for_me : {};
  out.verdict.harmful = out.verdict.harmful && typeof out.verdict.harmful === 'object' ? out.verdict.harmful : {};
  out.verdict.children_safe = out.verdict.children_safe && typeof out.verdict.children_safe === 'object' ? out.verdict.children_safe : {};
  out.verdict.side_effects = out.verdict.side_effects && typeof out.verdict.side_effects === 'object' ? out.verdict.side_effects : {};
  out.verdict.alternatives = out.verdict.alternatives && typeof out.verdict.alternatives === 'object' ? out.verdict.alternatives : {};

  out.verdict.harmful.flags = Array.isArray(out.verdict.harmful.flags)
    ? out.verdict.harmful.flags.map((x) => enforceOutputSafety(String(x || ''))).filter(Boolean)
    : [];
  out.verdict.alternatives.candidates = Array.isArray(out.verdict.alternatives.candidates)
    ? out.verdict.alternatives.candidates.map((x) => enforceOutputSafety(String(x || ''))).filter(Boolean).slice(0, 4)
    : [];

  if (!isCosmeticRoute) {
    out.verdict.alternatives.candidates = [];
    out.verdict.alternatives.candidates_confidence = 0;
  }

  const textFields = [
    'verdict.good_for_me.summary',
    'verdict.good_for_me.detail',
    'verdict.harmful.top_evidence',
    'verdict.harmful.summary',
    'verdict.children_safe.summary',
    'verdict.side_effects.summary',
    'verdict.alternatives.footer',
    'reasoning_evidence_summary'
  ];
  for (const path of textFields) {
    const parts = path.split('.');
    let ref = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!ref[parts[i]] || typeof ref[parts[i]] !== 'object') ref[parts[i]] = {};
      ref = ref[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    ref[leaf] = enforceOutputSafety(String(ref[leaf] || ''));
  }

  const confFields = [
    'verdict.good_for_me.summary_confidence',
    'verdict.good_for_me.detail_confidence',
    'verdict.harmful.flags_confidence',
    'verdict.harmful.top_evidence_confidence',
    'verdict.harmful.summary_confidence',
    'verdict.children_safe.summary_confidence',
    'verdict.side_effects.summary_confidence',
    'verdict.alternatives.candidates_confidence',
    'reasoning_confidence_global'
  ];
  for (const path of confFields) {
    const parts = path.split('.');
    let ref = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!ref[parts[i]] || typeof ref[parts[i]] !== 'object') ref[parts[i]] = {};
      ref = ref[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    ref[leaf] = clampConfidence(ref[leaf]);
  }

  if (!out.reasoning_evidence_summary) {
    out.reasoning_evidence_summary = `Model reasoning applied for ${route} route.`;
  }
  return out;
}

function validateModelOutputShape(parsed) {
  requireString(parsed, 'verdict.good_for_me.summary');
  requireString(parsed, 'verdict.good_for_me.detail');
  requireString(parsed, 'verdict.harmful.top_evidence');
  requireString(parsed, 'verdict.harmful.summary');
  requireString(parsed, 'verdict.children_safe.summary');
  requireString(parsed, 'verdict.side_effects.summary');
  requireString(parsed, 'verdict.alternatives.footer');
  requireString(parsed, 'reasoning_evidence_summary');
  requireNumber(parsed, 'verdict.good_for_me.summary_confidence');
  requireNumber(parsed, 'verdict.good_for_me.detail_confidence');
  requireNumber(parsed, 'verdict.harmful.flags_confidence');
  requireNumber(parsed, 'verdict.harmful.top_evidence_confidence');
  requireNumber(parsed, 'verdict.harmful.summary_confidence');
  requireNumber(parsed, 'verdict.children_safe.summary_confidence');
  requireNumber(parsed, 'verdict.side_effects.summary_confidence');
  requireNumber(parsed, 'verdict.alternatives.candidates_confidence');
  requireNumber(parsed, 'reasoning_confidence_global');
  if (!Array.isArray(parsed?.verdict?.harmful?.flags)) throw new Error('reasoning_schema_invalid:verdict.harmful.flags');
  if (!Array.isArray(parsed?.verdict?.alternatives?.candidates)) {
    throw new Error('reasoning_schema_invalid:verdict.alternatives.candidates');
  }
  if (parsed.verdict.alternatives.candidates.length > 4) {
    throw new Error('reasoning_schema_invalid:verdict.alternatives.candidates.max4');
  }
}

function buildRouteSystemPrompt({ route, isCosmeticRoute }) {
  return buildRouteSystemPromptWithLanguage({ route, isCosmeticRoute, language: 'en' });
}

function buildRouteSystemPromptWithLanguage({ route, isCosmeticRoute, language = 'en' }) {
  const lang = String(language || 'en').trim().toLowerCase().split('-')[0] || 'en';
  const shared = [
    'You are a safety-first product reasoning model.',
    'Return JSON only. No markdown, no prose outside JSON.',
    'Never provide diagnosis, cure, or guaranteed claims.',
    'Keep wording informational and consumer-safe.',
    `Respond in language code: ${lang}.`
  ];
  const routeRules = isCosmeticRoute
    ? [
        'Route is cosmetic/hygiene: use topical skincare framing.',
        'Alternatives can include topical cosmetic products only.',
        'Side effects should be dermatological in framing.'
      ]
    : [
        `Route is ${route}: do not use cosmetic/skincare framing.`,
        'Do not classify food acids as skincare actives.',
        'Alternatives must be an empty array for non-cosmetic routes.',
        'Children safety must use food/supplement additive framing only.'
      ];
  return [...shared, ...routeRules].join('\n');
}

function detectReasoningLanguage(snapshot = {}) {
  const candidates = [
    snapshot?.preferred_language,
    snapshot?.language,
    snapshot?.lang,
    snapshot?.result_summary?.language
  ];
  for (const c of candidates) {
    const v = String(c || '').trim().toLowerCase();
    if (!v) continue;
    return v.split('-')[0];
  }
  return 'en';
}

function loadHazardDictionary() {
  if (_hazardDictionaryCache) return _hazardDictionaryCache;
  try {
    if (!fs.existsSync(HAZARD_DICTIONARY_PATH)) {
      _hazardDictionaryCache = [];
      return _hazardDictionaryCache;
    }
    const raw = fs.readFileSync(HAZARD_DICTIONARY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.entries) ? parsed.entries : []);
    _hazardDictionaryCache = rows
      .map((row) => ({
        key: String(row?.key || '').trim().toLowerCase(),
        label: String(row?.label || '').trim(),
        severity: String(row?.severity || 'moderate').trim().toLowerCase(),
        routes_applicable: Array.isArray(row?.routes_applicable)
          ? row.routes_applicable.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
          : []
      }))
      .filter((row) => row.key && row.label);
  } catch (_) {
    _hazardDictionaryCache = [];
  }
  return _hazardDictionaryCache;
}

function findHazardDictionaryMatches({ route = 'unknown', ingredientsTextRaw = '' } = {}) {
  const dictionary = loadHazardDictionary();
  if (!dictionary.length) return [];
  const routeNorm = String(route || 'unknown').trim().toLowerCase();
  const text = String(ingredientsTextRaw || '').toLowerCase();
  if (!text) return [];
  return dictionary
    .filter((entry) => {
      const routeOk = !entry.routes_applicable.length
        || entry.routes_applicable.includes('all')
        || entry.routes_applicable.includes(routeNorm);
      return routeOk && text.includes(entry.key);
    })
    .slice(0, 6);
}

function observeRetrievalSourceMetrics({ source, used = false, failed = false, latencyMs = 0 }) {
  const safeSource = String(source || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'unknown';
  Metrics.increment(`reasoning.retrieval.source_seen.${safeSource}.count`, 1);
  Metrics.increment(`reasoning.retrieval.source_used.${safeSource}.count`, used ? 1 : 0);
  Metrics.increment(`reasoning.retrieval.source_fail.${safeSource}.count`, failed ? 1 : 0);
  if (latencyMs > 0) {
    Metrics.increment(`reasoning.retrieval.latency_ms.${safeSource}.total`, latencyMs);
    Metrics.increment(`reasoning.retrieval.latency_ms.${safeSource}.count`, 1);
  }
}

async function maybeFetchPineconeGrounding(queryText = '') {
  const toggleEnabled = String(process.env.RESULT_SUMMARY_PINECONE_GROUNDING_V1 || '').trim().toLowerCase() === 'true';
  const readinessEnabled = String(process.env.RESULT_SUMMARY_PINECONE_READINESS_V1 || 'false').trim().toLowerCase() === 'true';
  if (!toggleEnabled || !readinessEnabled) {
    return {
      hits: [],
      used: false,
      failed: false,
      latency_ms: 0,
      reason: !toggleEnabled ? 'feature_flag_disabled' : 'readiness_flag_disabled'
    };
  }
  const startedAt = Date.now();
  try {
    const retriever = createVectorRetriever();
    if (typeof retriever?.search !== 'function') {
      return {
        hits: [],
        used: false,
        failed: true,
        latency_ms: Math.max(0, Date.now() - startedAt),
        reason: 'retriever_not_available'
      };
    }
    const hits = await retriever.search(String(queryText || ''), { limit: 3 });
    return {
      hits: Array.isArray(hits) ? hits : [],
      used: true,
      failed: false,
      latency_ms: Math.max(0, Date.now() - startedAt),
      reason: 'ok'
    };
  } catch (_) {
    return {
      hits: [],
      used: true,
      failed: true,
      latency_ms: Math.max(0, Date.now() - startedAt),
      reason: 'search_error'
    };
  }
}

function collectRetrievalContext({ route, ingredientsTextRaw, queryText }) {
  const hazardStarted = Date.now();
  let hazardMatches = [];
  let hazardFailed = false;
  let hazardUsed = true;
  try {
    const hazardForcedUnavailable =
      String(process.env.RESULT_SUMMARY_HAZARD_DICTIONARY_FORCE_UNAVAILABLE || '').trim().toLowerCase() === 'true';
    if (hazardForcedUnavailable) {
      hazardFailed = true;
      hazardUsed = false;
      hazardMatches = [];
    }
    const dictionary = loadHazardDictionary();
    if (!hazardForcedUnavailable && (!Array.isArray(dictionary) || dictionary.length === 0)) {
      hazardFailed = true;
      hazardUsed = false;
    }
    if (!hazardForcedUnavailable) {
      hazardMatches = findHazardDictionaryMatches({ route, ingredientsTextRaw });
    }
  } catch (_) {
    hazardFailed = true;
    hazardMatches = [];
  }
  const hazardLatencyMs = Math.max(0, Date.now() - hazardStarted);
  observeRetrievalSourceMetrics({
    source: 'hazard_dictionary',
    used: hazardUsed,
    failed: hazardFailed,
    latencyMs: hazardLatencyMs
  });
  const executedSources = [{
    source: 'hazard_dictionary',
    required: true,
    used: hazardUsed,
    failed: hazardFailed,
    latency_ms: hazardLatencyMs,
    result_count: Array.isArray(hazardMatches) ? hazardMatches.length : 0
  }];
  const failedSources = hazardFailed ? ['hazard_dictionary'] : [];
  return {
    hazardMatches,
    executedSources,
    failedSources,
    vectorQueryText: String(queryText || '')
  };
}

function buildReasoningUserPrompt({ route, framing, ingredientsTextRaw, routeScopedPromptContext, snapshot, hazardMatches = [] }) {
  const tiles = snapshot?.scan_summary?.tiles || snapshot?.result_summary?.tiles || {};
  const routineConflicts = Array.isArray(snapshot?.routine_conflicts) ? snapshot.routine_conflicts.slice(0, 8) : [];
  const profileContext = {
    primary_concern: snapshot?.primary_concern || null,
    secondary_concerns: Array.isArray(snapshot?.secondary_concerns) ? snapshot.secondary_concerns.slice(0, 6) : [],
    has_profile_context: String(snapshot?.result_summary?.tiles?.skin_type?.status || '') === 'available'
  };
  const schemaSpec = {
    verdict: {
      good_for_me: { summary: '', detail: '', summary_confidence: 0, detail_confidence: 0 },
      harmful: { flags: [], top_evidence: '', summary: '', flags_confidence: 0, top_evidence_confidence: 0, summary_confidence: 0 },
      children_safe: { summary: '', summary_confidence: 0 },
      side_effects: { summary: '', summary_confidence: 0 },
      alternatives: { candidates: [], footer: '', candidates_confidence: 0 }
    },
    reasoning_confidence_global: 0,
    reasoning_evidence_summary: ''
  };
  return [
    'Analyze this scan snapshot and produce strict JSON matching schema exactly.',
    `category_route=${route}`,
    `semantic_framing=${framing}`,
    `ingredients_text=${ingredientsTextRaw}`,
    `route_scoped_context=${routeScopedPromptContext}`,
    `hazard_dictionary_matches=${JSON.stringify(hazardMatches.map((h) => ({
      key: h.key,
      label: h.label,
      severity: h.severity
    })))}`,
    `scan_tiles=${JSON.stringify(tiles)}`,
    `routine_conflicts=${JSON.stringify(routineConflicts)}`,
    `profile_context=${JSON.stringify(profileContext)}`,
    `required_schema=${JSON.stringify(schemaSpec)}`
  ].join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryProviderError(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  return status === 429 || status >= 500;
}

async function withRetry(fn, { retries = 2, baseDelayMs = 250 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !shouldRetryProviderError(err)) break;
      const jitter = Math.floor(Math.random() * 100);
      await sleep(baseDelayMs * (2 ** attempt) + jitter);
      attempt += 1;
    }
  }
  throw lastErr;
}

async function maybeCallReasoningProvider(payload = {}) {
  if (!FeatureFlags.isEnabled('RESULT_SUMMARY_REASONING_MODEL_V1')) return null;
  if (FeatureFlags.isEnabled('RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH')) {
    Metrics.increment('reasoning.provider.killswitch.count', 1);
    Metrics.increment('reasoning.gate.provider_error.count', 1);
    return {
      ok: false,
      output: null,
      error_class: 'killswitch_enabled',
      latency_ms: 0
    };
  }
  const callModel = _modelCallerOverride || (async (input) => {
    const client = getAnthropicClient();
    const model = String(process.env.RESULT_SUMMARY_REASONING_MODEL || process.env.KELLY_ANTHROPIC_MODEL || 'claude-sonnet-4-5');
    const response = await withTimeout(
      client.messages.create({
        model,
        max_tokens: REASONING_MODEL_MAX_TOKENS,
        temperature: 0,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userPrompt }]
      }),
      REASONING_MODEL_TIMEOUT_MS,
      `reasoning_provider_timeout_${REASONING_MODEL_TIMEOUT_MS}ms`
    );
    return {
      model: String(response?.model || model),
      version: String(process.env.RESULT_SUMMARY_REASONING_MODEL_VERSION || response?.model || model),
      rawText: extractTextBlocks(response?.content || ''),
      usage: {
        input_tokens: Number(response?.usage?.input_tokens || 0),
        output_tokens: Number(response?.usage?.output_tokens || 0)
      }
    };
  });
  const startedAt = Date.now();
  const breaker = getOrCreate('result_summary_reasoning_provider', {
    failureThreshold: 3,
    windowMs: 60000,
    resetTimeMs: 60000
  });
  try {
    const out = await breaker.execute(
      async () => withRetry(async () => callModel(payload), { retries: 2, baseDelayMs: 250 }),
      async () => null
    );
    const elapsed = Math.max(0, Date.now() - startedAt);
    Metrics.increment('reasoning.provider.call.count', 1);
    Metrics.increment('reasoning.provider.latency_ms.total', elapsed);
    Metrics.increment('reasoning.provider.latency_ms.count', 1);
    observeReasoningLatencyBuckets(elapsed);
    if (!out) {
      Metrics.increment('reasoning.gate.provider_error.count', 1);
      return {
        ok: false,
        output: null,
        error_class: 'circuit_breaker_fallback',
        latency_ms: elapsed
      };
    }
    return {
      ok: true,
      output: out,
      error_class: null,
      latency_ms: elapsed
    };
  } catch (err) {
    Metrics.increment('reasoning.api_error.count', 1);
    Metrics.increment('reasoning.mode.fallback.count', 1);
    Metrics.increment('reasoning.gate.provider_error.count', 1);
    const elapsed = Math.max(0, Date.now() - startedAt);
    const msg = String(err?.message || '').toLowerCase();
    const errorClass = msg.includes('timeout')
      ? 'provider_timeout'
      : (msg.includes('429') || msg.includes('rate')) ? 'provider_rate_limited'
        : msg.includes('circuit') ? 'circuit_breaker_open'
          : 'provider_error';
    Metrics.increment(`reasoning.provider.error_class.${errorClass}.count`, 1);
    return {
      ok: false,
      output: null,
      error_class: errorClass,
      latency_ms: elapsed
    };
  }
}

function buildReasoningInputHash(snapshot = {}) {
  const semanticContract = snapshot?.result_summary?.semantic_contract || null;
  const payload = {
    schema_version: snapshot?.schema_version || null,
    product_name: snapshot?.scanned_product?.product_name || snapshot?.product?.name || null,
    ingredients_text: snapshot?.scanned_product?.ingredients_text || null,
    category_route: snapshot?.scanned_product?.category_route || snapshot?.category_route || null,
    routine_conflicts: Array.isArray(snapshot?.routine_conflicts)
      ? snapshot.routine_conflicts.map((c) => ({
          id: c?.id || null,
          severity: c?.severity || null,
          summary: c?.summary || c?.recommendation || null
        }))
      : [],
    primary_concern: snapshot?.primary_concern || null,
    secondary_concerns: Array.isArray(snapshot?.secondary_concerns) ? snapshot.secondary_concerns : [],
    scan_summary: snapshot?.scan_summary?.tiles || null,
    semantic_contract_version: snapshot?.result_summary?.semantic_contract_version || null,
    semantic_contract_route: semanticContract?.route || null,
    semantic_contract_framing: semanticContract?.verdict_framing || null
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function shouldEnqueueReasoning({ snapshot = null } = {}) {
  if (!FeatureFlags.isEnabled('RESULT_SUMMARY_REASONING_V1')) {
    return { shouldEnqueue: false, reason: 'reasoning_disabled', inputHash: buildReasoningInputHash(snapshot || {}) };
  }
  const inputHash = buildReasoningInputHash(snapshot || {});
  const reasoning = snapshot?.result_summary?.reasoning || null;
  if (!reasoning) return { shouldEnqueue: true, reason: 'missing_reasoning_meta', inputHash };
  if (String(reasoning.status || '') === 'pending') return { shouldEnqueue: true, reason: 'pending_state', inputHash };
  if (String(reasoning.reasoning_input_hash || '') !== inputHash) {
    return { shouldEnqueue: true, reason: 'stale_input_hash', inputHash };
  }
  if (String(reasoning.status || '') === 'disabled') return { shouldEnqueue: true, reason: 'disabled_then_enabled', inputHash };
  return { shouldEnqueue: false, reason: 'fresh', inputHash };
}

async function buildReasoningPatch({ snapshot = null, inputHash = null } = {}) {
  const sp = snapshot?.scanned_product || {};
  const resultSummary = snapshot?.result_summary || {};
  const route = String(sp?.category_route || snapshot?.category_route || resultSummary?.semantic_contract?.route || 'unknown');
  const isCosmeticRoute = route === 'cosmetic' || route === 'hygiene';
  const language = detectReasoningLanguage(snapshot);
  const framing = String(
    resultSummary?.semantic_contract?.verdict_framing
      || (isCosmeticRoute ? 'cosmetic' : 'catalog_context')
  );
  const hasProfileContext = String(resultSummary?.tiles?.skin_type?.status || '') === 'available';
  const ingredientsTextRaw = sanitizeModelBoundText(sp.ingredients_text || '');
  const ingredientsText = ingredientsTextRaw.toLowerCase();
  const routeScopedPromptContext = sanitizeModelBoundText([
    `category_route=${route}`,
    `semantic_framing=${framing}`,
    isCosmeticRoute ? 'allow_cosmetic_steps=true' : 'allow_cosmetic_steps=false',
    String(snapshot?.input_context || '')
  ].filter(Boolean).join('\n'));
  const flags = [];
  const grounding = RetrievalGrounding.buildRouteAwareGrounding({
    categoryRoute: route,
    ingredientsText: ingredientsTextRaw,
    productName: sp?.product_name || snapshot?.product?.name || '',
    userQueryText: routeScopedPromptContext
  });
  const retrievalContext = collectRetrievalContext({
    route,
    ingredientsTextRaw,
    queryText: [ingredientsTextRaw, routeScopedPromptContext].join('\n')
  });
  retrievalContext.executedSources.push({
    source: 'ingredient_semantic_index',
    required: false,
    used: false,
    failed: false,
    latency_ms: 0,
    result_count: 0
  });

  if (isCosmeticRoute) {
    if (/\bfragrance|parfum|limonene|linalool\b/.test(ingredientsText)) flags.push('Fragrance allergens present');
    else flags.push('No fragrance allergens detected');
    if (/\bphenoxyethanol\b/.test(ingredientsText)) flags.push('Phenoxyethanol preservative');
  }
  if (sp?.nyc_metal_context) flags.unshift('NYC metals reference reviewed');

  const routeCopy = (() => {
    if (framing === 'cosmetic') {
      return {
        goodForMeSummary: hasProfileContext
          ? 'Reasoning layer agrees this fits the current routine context without strong conflict signals.'
          : 'Reasoning unavailable until more profile context is available.',
        goodForMeDetail: hasProfileContext
          ? 'Grounded in current session profile, routine conflict graph, and deterministic ingredient summary.'
          : 'Add more profile context to unlock personalised reasoning.',
        childrenSafeSummary: /\bniacinamide\b/.test(ingredientsText)
          ? 'Adult-targeted active concentrations may need extra caution when pediatric guidance is unavailable.'
          : 'Reasoning did not find enough child-specific evidence to upgrade this row.',
        sideEffectsSummary: /\bniacinamide\b/.test(ingredientsText)
          ? 'Potential flushing or tingling may occur in sensitive individuals at higher niacinamide strengths.'
          : 'Not enough retrieved evidence to upgrade side-effect guidance.',
        alternativesFooter: 'Ask Kelly for personalised alternatives based on your routine.'
      };
    }
    return {
      goodForMeSummary: 'Reasoning confirms this route uses general catalog context rather than skincare-specific personalization.',
      goodForMeDetail: 'Route-scoped semantic contract prevents cosmetic-only framing for this product category.',
      childrenSafeSummary: route === 'food'
        ? 'Reasoning did not add child-specific risk beyond deterministic food-context checks.'
        : 'Reasoning did not find route-valid child-specific evidence to upgrade this row.',
      sideEffectsSummary: 'Reasoning did not add route-valid side-effect guidance beyond deterministic checks.',
      sideEffectsConfidence: 0.82,
      alternativesFooter: 'Reasoning alternatives are not provided for this route under the current semantic contract.'
    };
  })();
  const modelEnabled = FeatureFlags.isEnabled('RESULT_SUMMARY_REASONING_MODEL_V1');
  const liveContractVersion = resultSummary?.semantic_contract_version || SemanticContractRegistry.getLiveSemanticContractVersion();
  const baseMeta = {
    generated_at: new Date().toISOString(),
    semantic_contract_version: liveContractVersion,
    reasoning_input_hash: inputHash || buildReasoningInputHash(snapshot || {}),
    reasoning_route_context: {
      category_route: route,
      semantic_framing: framing,
      cosmetic_steps_enabled: isCosmeticRoute,
      language
    },
    reasoning_input_guardrails: {
      model_input_char_budget: MODEL_INPUT_CHAR_BUDGET,
      pii_redaction_enabled: FeatureFlags.isEnabled('pii_redaction_enabled'),
      markup_and_urls_stripped: true
    },
    reasoning_retrieval_grounding: grounding,
    reasoning_retrieval_contract: {
      contract_version: 'v1',
      required_sources: ['hazard_dictionary'],
      optional_sources: ['ingredient_semantic_index']
    },
    executed_sources: [...retrievalContext.executedSources]
  };

  let inTokens = estimateTokens([ingredientsTextRaw, routeScopedPromptContext].join('\n'));
  let outTokens = 0;
  let reasoningPatch = null;
  const hazardMatches = retrievalContext.hazardMatches;
  let providerTelemetry = {
    latency_ms: 0,
    error_class: null
  };

  if (modelEnabled) {
    const systemPrompt = buildRouteSystemPromptWithLanguage({ route, isCosmeticRoute, language });
    const userPrompt = buildReasoningUserPrompt({
      route,
      framing,
      ingredientsTextRaw,
      routeScopedPromptContext,
      snapshot,
      hazardMatches
    });
    const providerCall = await maybeCallReasoningProvider({
      category_route: route,
      semantic_framing: framing,
      ingredients_text: ingredientsTextRaw,
      input_context: routeScopedPromptContext,
      systemPrompt,
      userPrompt
    });
    providerTelemetry = {
      latency_ms: Number(providerCall?.latency_ms || 0),
      error_class: providerCall?.error_class || null
    };
    const providerOut = providerCall?.ok ? providerCall.output : null;

    if (providerOut && providerOut.rawText) {
      try {
        const parsed = parseJsonObject(providerOut.rawText);
        validateModelOutputShape(parsed);
        const safeOutput = enforceRouteContractOnModelOutput(parsed, route, isCosmeticRoute);
        inTokens = Number(providerOut?.usage?.input_tokens || inTokens || estimateTokens(userPrompt));
        outTokens = Number(providerOut?.usage?.output_tokens || estimateTokens(providerOut.rawText));
        const pinecone = await maybeFetchPineconeGrounding([
          ingredientsTextRaw,
          routeScopedPromptContext,
          safeOutput?.reasoning_evidence_summary || ''
        ].join('\n'));
        observeRetrievalSourceMetrics({
          source: 'ingredient_semantic_index',
          used: !!pinecone?.used,
          failed: !!pinecone?.failed,
          latencyMs: Number(pinecone?.latency_ms || 0)
        });
        const vectorExec = retrievalContext.executedSources.find((s) => s.source === 'ingredient_semantic_index');
        if (vectorExec) {
          vectorExec.used = !!pinecone?.used;
          vectorExec.failed = !!pinecone?.failed;
          vectorExec.latency_ms = Number(pinecone?.latency_ms || 0);
          vectorExec.result_count = Array.isArray(pinecone?.hits) ? pinecone.hits.length : 0;
        }
        if (pinecone?.failed) retrievalContext.failedSources.push('ingredient_semantic_index');
        const pineconeHits = Array.isArray(pinecone?.hits) ? pinecone.hits : [];
        const claimProvenance = {
          'verdict.harmful.flags': [
            {
              source: 'model_reasoning:direct',
              doc_id_ref: 'model_reasoning:direct:1',
              evidence_snippet_key: 'harmful_flags'
            }
          ],
          'verdict.harmful.top_evidence': [
            {
              source: 'model_reasoning:direct',
              doc_id_ref: 'model_reasoning:direct:1',
              evidence_snippet_key: 'harmful_top_evidence'
            }
          ]
        };
        if (hazardMatches.length && Array.isArray(safeOutput?.verdict?.harmful?.flags) && safeOutput.verdict.harmful.flags.length) {
          const hazardRefs = hazardMatches.map((h) => ({
            source: 'hazard_dictionary',
            doc_id_ref: `hazard_dictionary:${h.key}`,
            evidence_snippet_key: h.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          }));
          claimProvenance['verdict.harmful.flags'] = [
            ...claimProvenance['verdict.harmful.flags'],
            ...hazardRefs
          ];
          claimProvenance['verdict.harmful.top_evidence'] = [
            ...claimProvenance['verdict.harmful.top_evidence'],
            ...hazardRefs.slice(0, 2)
          ];
        }
        if (isCosmeticRoute && Array.isArray(safeOutput?.verdict?.alternatives?.candidates) && safeOutput.verdict.alternatives.candidates.length) {
          claimProvenance['verdict.alternatives.candidates'] = [
            {
              source: 'model_reasoning:direct',
              doc_id_ref: 'model_reasoning:direct:1',
              evidence_snippet_key: 'alternatives_candidates'
            }
          ];
        }
        const pineconeRefs = pineconeHits
          .map((h, idx) => `pinecone:${String(h.id || idx + 1)}`)
          .slice(0, 3);
        const hazardRefs = hazardMatches
          .map((h) => `hazard_dictionary:${h.key}`)
          .slice(0, 3);
        reasoningPatch = {
          ...baseMeta,
          reasoning_model: providerOut.model || 'anthropic',
          reasoning_version: providerOut.version || providerOut.model || 'model-v1',
          reasoning_mode: 'model',
          provenance_sources_available: [
            { source: 'model_reasoning:direct', executed: true },
            { source: 'hazard_dictionary', executed: true },
            { source: 'ingredient_semantic_index', executed: !!pinecone?.used && !pinecone?.failed }
          ],
          reasoning_claim_provenance: claimProvenance,
          reasoning_evidence_refs: [`route_context:${route}`, 'model_reasoning:direct', ...hazardRefs, ...pineconeRefs],
          verdict: {
            good_for_me: {
              summary: safeOutput.verdict.good_for_me.summary,
              detail: safeOutput.verdict.good_for_me.detail,
              summary_confidence: safeOutput.verdict.good_for_me.summary_confidence,
              detail_confidence: safeOutput.verdict.good_for_me.detail_confidence
            },
            harmful: {
              flags: safeOutput.verdict.harmful.flags,
              top_evidence: safeOutput.verdict.harmful.top_evidence,
              summary: safeOutput.verdict.harmful.summary,
              flags_confidence: safeOutput.verdict.harmful.flags_confidence,
              top_evidence_confidence: safeOutput.verdict.harmful.top_evidence_confidence,
              summary_confidence: safeOutput.verdict.harmful.summary_confidence
            },
            children_safe: {
              summary: safeOutput.verdict.children_safe.summary,
              summary_confidence: safeOutput.verdict.children_safe.summary_confidence
            },
            side_effects: {
              summary: safeOutput.verdict.side_effects.summary,
              summary_confidence: safeOutput.verdict.side_effects.summary_confidence
            },
            alternatives: {
              candidates: safeOutput.verdict.alternatives.candidates,
              footer: safeOutput.verdict.alternatives.footer,
              candidates_confidence: safeOutput.verdict.alternatives.candidates_confidence
            }
          },
          reasoning_confidence_global: safeOutput.reasoning_confidence_global,
          reasoning_evidence_summary: safeOutput.reasoning_evidence_summary
        };
        Metrics.increment('reasoning.mode.model.count', 1);
      } catch (err) {
        providerTelemetry.error_class = String(err?.message || '').startsWith('reasoning_model_non_json_output')
          ? 'non_json_output'
          : String(err?.message || '').startsWith('reasoning_schema_invalid')
            ? 'schema_validation_error'
            : 'parse_error';
        Metrics.increment(`reasoning.provider.error_class.${providerTelemetry.error_class}.count`, 1);
        Metrics.increment('reasoning.schema_invalid.count', 1);
        Metrics.increment('reasoning.gate.schema.fail.count', 1);
      }
    }

    if (!reasoningPatch) {
      reasoningPatch = {
        ...baseMeta,
        reasoning_provider_error_class: providerTelemetry.error_class || null,
        reasoning_model: 'deterministic-fallback',
        reasoning_version: 'v1',
        reasoning_mode: 'deterministic_fallback',
        provenance_sources_available: [
          { source: 'model_reasoning:direct', executed: false },
          { source: 'hazard_dictionary', executed: true },
          { source: 'ingredient_semantic_index', executed: false }
        ],
        reasoning_claim_provenance: {},
        reasoning_evidence_refs: [`route_context:${route}`],
        verdict: {
          good_for_me: {
            summary: '',
            detail: '',
            summary_confidence: 0,
            detail_confidence: 0
          },
          harmful: {
            flags: [],
            top_evidence: '',
            summary: '',
            flags_confidence: 0,
            top_evidence_confidence: 0,
            summary_confidence: 0
          },
          children_safe: { summary: '', summary_confidence: 0 },
          side_effects: { summary: '', summary_confidence: 0 },
          alternatives: { candidates: [], footer: '', candidates_confidence: 0 }
        },
        reasoning_confidence_global: 0,
        reasoning_evidence_summary: 'Model output unavailable; deterministic fallback active.'
      };
      Metrics.increment('reasoning.mode.fallback.count', 1);
    }
  } else {
    const claimProvenance = {};
    reasoningPatch = {
      ...baseMeta,
      reasoning_model: 'deterministic-stub',
      reasoning_version: 'v1',
      reasoning_mode: 'stub',
      provenance_sources_available: [{ source: 'model_reasoning:direct', executed: false }],
      reasoning_claim_provenance: claimProvenance,
      reasoning_evidence_refs: [`route_context:${route}`],
      verdict: {
        good_for_me: {
          summary: enforceOutputSafety(routeCopy.goodForMeSummary),
          detail: enforceOutputSafety(routeCopy.goodForMeDetail),
          summary_confidence: hasProfileContext ? 0.82 : 0.3,
          detail_confidence: hasProfileContext ? 0.8 : 0.3
        },
        harmful: {
          flags,
          top_evidence: enforceOutputSafety(flags.length
            ? 'Reasoning checked ingredient-line safety cues and routine conflict context for the strongest supporting signal.'
            : 'Not enough evidence to add reasoning-only flags.'),
          summary: enforceOutputSafety(flags.length ? 'Reasoning adds ingredient-level context to the deterministic risk read.' : ''),
          flags_confidence: flags.length ? 0.84 : 0.2,
          top_evidence_confidence: flags.length ? 0.81 : 0.2,
          summary_confidence: flags.length ? 0.79 : 0.2
        },
        children_safe: {
          summary: enforceOutputSafety(routeCopy.childrenSafeSummary),
          summary_confidence: framing === 'cosmetic' && /\bniacinamide\b/.test(ingredientsText) ? 0.82 : 0.55
        },
        side_effects: {
          summary: enforceOutputSafety(routeCopy.sideEffectsSummary),
          summary_confidence:
            framing === 'cosmetic'
              ? (/\bniacinamide\b/.test(ingredientsText) ? 0.83 : 0.55)
              : Number(routeCopy.sideEffectsConfidence || 0.82)
        },
        alternatives: {
          candidates: [],
          footer: enforceOutputSafety(routeCopy.alternativesFooter),
          candidates_confidence: 0.2,
          footer_confidence: 0.7
        }
      }
    };
    Metrics.increment('reasoning.mode.stub.count', 1);
  }

  const inRate = Number(process.env.RESULT_SUMMARY_REASONING_INPUT_TOKEN_RATE_MICROUSD || DEFAULT_INPUT_TOKEN_RATE_MICROUSD);
  const outRate = Number(process.env.RESULT_SUMMARY_REASONING_OUTPUT_TOKEN_RATE_MICROUSD || DEFAULT_OUTPUT_TOKEN_RATE_MICROUSD);
  const estimatedCostMicroUsd = Math.max(0, inTokens * inRate) + Math.max(0, outTokens * outRate);
  const routeMetric = metricSafeRoute(route);
  Metrics.increment('reasoning.tokens.input.total', inTokens);
  Metrics.increment('reasoning.tokens.output.total', outTokens);
  Metrics.increment('reasoning.cost.estimated_microusd.total', estimatedCostMicroUsd);
  Metrics.increment('reasoning.cost.estimated.calls', 1);
  Metrics.increment(`reasoning.cost.estimated.route.${routeMetric}.calls`, 1);
  reasoningPatch.reasoning_cost = {
    estimated_input_tokens: inTokens,
    estimated_output_tokens: outTokens,
    estimated_cost_microusd: estimatedCostMicroUsd
  };
  const usedCount = retrievalContext.executedSources.filter((s) => s.used && !s.failed).length;
  const failedCount = retrievalContext.executedSources.filter((s) => s.failed).length;
  const requiredFailed = retrievalContext.executedSources.some((s) => s.required && s.failed);
  reasoningPatch.executed_sources = retrievalContext.executedSources.map((s) => ({ ...s }));
  reasoningPatch.reasoning_retrieval = {
    executed_sources: reasoningPatch.executed_sources,
    failed_sources: [...new Set(retrievalContext.failedSources)],
    status: requiredFailed ? 'failed' : (failedCount > 0 ? 'partial' : usedCount > 0 ? 'ok' : 'none')
  };
  reasoningPatch.reasoning_model_telemetry = {
    provider_latency_ms: Number(providerTelemetry?.latency_ms || 0),
    provider_error_class: providerTelemetry?.error_class || null,
    input_tokens_estimate: inTokens,
    output_tokens_estimate: outTokens,
    estimated_cost_microusd: estimatedCostMicroUsd
  };
  Metrics.increment(`reasoning.retrieval.status.${reasoningPatch.reasoning_retrieval.status}.count`, 1);
  reasoningPatch.patch_built_at = new Date().toISOString();
  return reasoningPatch;
}

function _compactExecutionSummaryForJob(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const rt = p.reasoning_retrieval && typeof p.reasoning_retrieval === 'object' ? p.reasoning_retrieval : null;
  let executed = Array.isArray(p.executed_sources) ? p.executed_sources : [];
  if (executed.length > 24) executed = executed.slice(0, 24);
  return {
    reasoning_mode: p.reasoning_mode || null,
    reasoning_model: p.reasoning_model || null,
    reasoning_input_hash: p.reasoning_input_hash || null,
    reasoning_retrieval: rt
      ? {
          status: rt.status || null,
          failed_sources: Array.isArray(rt.failed_sources) ? rt.failed_sources.slice(0, 24) : []
        }
      : null,
    executed_sources: executed
  };
}

async function processReasoningJobs({ maxJobs = 3 } = {}) {
  const limit = Math.max(1, Math.min(25, Number(maxJobs || 3)));
  for (let i = 0; i < limit; i += 1) {
    const job = ReasoningJobQueue.claimNextReasoningJob('result-summary-reasoning-service');
    if (!job) break;
    try {
      const SnapshotService = require('./session-result-snapshot-service');
      const latest = SnapshotService.getLatestSessionResultSnapshot(job.session_id);
      if (!latest?.snapshot) {
        ReasoningJobQueue.markReasoningJobRetryOrDlq(job.id, 'latest_snapshot_missing');
        continue;
      }
      if (String(latest.snapshot_id || '') !== String(job.snapshot_id || '')) {
        ReasoningJobQueue.markReasoningJobObsolete(job.id, 'snapshot_superseded');
        try {
          Metrics.increment('reasoning.merge.stale_reject.count', 1);
        } catch (_) {}
        continue;
      }
      const nextCheck = shouldEnqueueReasoning({ snapshot: latest.snapshot });
      if (!nextCheck.shouldEnqueue) {
        ReasoningJobQueue.markReasoningJobSuccess(job.id);
        continue;
      }
      ReasoningJobQueue.touchReasoningJobHeartbeat(job.id);
      const patch = await buildReasoningPatch({ snapshot: latest.snapshot, inputHash: job.input_hash });
      if (FeatureFlags.isEnabled('RESULT_SUMMARY_REASONING_SHADOW_V1')) {
        try {
          Metrics.increment('reasoning.shadow.patch_built.count', 1);
          const modeKey = String(patch?.reasoning_mode || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 48);
          Metrics.increment(`reasoning.shadow.mode.${modeKey || 'unknown'}.count`, 1);
        } catch (_) {}
        ReasoningJobQueue.markReasoningJobSuccess(job.id, {
          executionSummary: _compactExecutionSummaryForJob(patch)
        });
        continue;
      }
      SnapshotService.applySessionResultReasoningPatch({
        sessionId: job.session_id,
        reasoningPatch: patch,
        expectedSnapshotId: job.snapshot_id,
        inputHash: job.input_hash,
        mergeLineage: {
          snapshotVersion: job.snapshot_version,
          contextHash: job.context_hash
        }
      });
      ReasoningJobQueue.markReasoningJobSuccess(job.id, {
        executionSummary: _compactExecutionSummaryForJob(patch)
      });
    } catch (e) {
      const msg = String(e?.message || e || 'reasoning_job_failed');
      if (e?.code === 'SNAPSHOT_CONFLICT' || e?.name === 'SnapshotConflictError') {
        ReasoningJobQueue.markReasoningJobObsolete(job.id, 'snapshot_conflict');
        continue;
      }
      if (e?.code === 'REASONING_MERGE_STALE' || e?.name === 'ReasoningMergeStaleError') {
        ReasoningJobQueue.markReasoningJobObsolete(job.id, 'stale_lineage');
        continue;
      }
      if (msg === 'snapshot_conflict' || msg === 'SNAPSHOT_CONFLICT') {
        ReasoningJobQueue.markReasoningJobObsolete(job.id, 'snapshot_conflict');
        continue;
      }
      ReasoningJobQueue.markReasoningJobRetryOrDlq(job.id, msg);
    }
  }
}

function _scheduleWorker() {
  if (_workerScheduled) return;
  _workerScheduled = true;
  setImmediate(async () => {
    try {
      await processReasoningJobs({ maxJobs: 6 });
    } finally {
      _workerScheduled = false;
    }
  });
}

function enqueueReasoningJob({ sessionId, snapshotId, snapshotVersion, contextHash, inputHash }) {
  const out = ReasoningJobQueue.enqueueReasoningJob({
    sessionId,
    snapshotId,
    snapshotVersion,
    contextHash,
    inputHash,
    payload: {
      queued_at: new Date().toISOString()
    }
  });
  if (out?.enqueued) _scheduleWorker();
  return !!out?.enqueued;
}

function __setModelCallerForTests(fn) {
  _modelCallerOverride = typeof fn === 'function' ? fn : null;
}

function __resetReasoningProviderForTests() {
  _modelCallerOverride = null;
  _anthropicClient = null;
  _hazardDictionaryCache = null;
  _workerScheduled = false;
}

module.exports = {
  buildReasoningInputHash,
  shouldEnqueueReasoning,
  buildReasoningPatch,
  enqueueReasoningJob,
  processReasoningJobs,
  __setModelCallerForTests,
  __resetReasoningProviderForTests
};
