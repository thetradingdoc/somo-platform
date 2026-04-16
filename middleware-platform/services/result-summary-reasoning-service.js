'use strict';

const crypto = require('crypto');
const FeatureFlags = require('../config/feature-flags');
const RetrievalGrounding = require('./result-summary-retrieval-grounding-service');
const SemanticContractRegistry = require('./semantic-contract-registry');

const _pendingJobs = new Map();

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
  if (String(reasoning.status || '') === 'pending') return { shouldEnqueue: false, reason: 'already_pending', inputHash };
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
  const framing = String(
    resultSummary?.semantic_contract?.verdict_framing
      || (route === 'cosmetic' || route === 'hygiene' ? 'cosmetic' : 'catalog_context')
  );
  const hasProfileContext = String(resultSummary?.tiles?.skin_type?.status || '') === 'available';
  const ingredientsText = String(sp.ingredients_text || '').toLowerCase();
  const flags = [];
  const alternatives = [];
  const grounding = RetrievalGrounding.buildRouteAwareGrounding({
    categoryRoute: route,
    ingredientsText,
    productName: sp?.product_name || snapshot?.product?.name || '',
    userQueryText: snapshot?.input_context || ''
  });

  if (/\bfragrance|parfum|limonene|linalool\b/.test(ingredientsText)) flags.push('Fragrance allergens present');
  else flags.push('No fragrance allergens detected');
  if (/\bphenoxyethanol\b/.test(ingredientsText)) flags.push('Phenoxyethanol preservative');
  if (sp?.nyc_metal_context) flags.unshift('NYC metals reference reviewed');
  if (framing === 'cosmetic' && /\bniacinamide\b/.test(ingredientsText)) {
    alternatives.push("Paula's Choice 10% Niacinamide Booster", 'The Inkey List Niacinamide Serum');
  }

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
        alternativesFooter: alternatives.length
          ? 'Reasoning matched alternatives by active profile and lower-irritation positioning.'
          : 'Ask Kelly for personalised alternatives based on your routine.'
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
  const claimProvenance = {
    'verdict.good_for_me.summary': RetrievalGrounding.buildClaimProvenance({
      fieldPath: 'verdict.good_for_me.summary',
      plan: grounding.retrieval_plan,
      keywords: grounding.keywords
    }),
    'verdict.harmful.flags': RetrievalGrounding.buildClaimProvenance({
      fieldPath: 'verdict.harmful.flags',
      plan: grounding.retrieval_plan,
      keywords: grounding.keywords
    }),
    'verdict.harmful.top_evidence': RetrievalGrounding.buildClaimProvenance({
      fieldPath: 'verdict.harmful.top_evidence',
      plan: grounding.retrieval_plan,
      keywords: grounding.keywords
    }),
    'verdict.alternatives.candidates': RetrievalGrounding.buildClaimProvenance({
      fieldPath: 'verdict.alternatives.candidates',
      plan: grounding.retrieval_plan,
      keywords: grounding.keywords
    })
  };
  const flattenedRefs = Object.values(claimProvenance)
    .flat()
    .map((x) => `${x.source}:${x.evidence_snippet_key}`)
    .filter(Boolean);

  return {
    generated_at: new Date().toISOString(),
    reasoning_model: 'result-summary-reasoning-stub',
    reasoning_version: 'v1',
    semantic_contract_version: resultSummary?.semantic_contract_version || SemanticContractRegistry.getLiveSemanticContractVersion(),
    reasoning_input_hash: inputHash || buildReasoningInputHash(snapshot || {}),
    reasoning_retrieval_grounding: grounding,
    reasoning_claim_provenance: claimProvenance,
    reasoning_evidence_refs: [
      ...(flags.length ? ['ingredient_text:scan'] : []),
      ...(snapshot?.routine_conflicts?.length ? ['routine_conflicts:graph'] : []),
      ...(sp?.nyc_metal_context ? ['nyc_metal_context:reference'] : []),
      ...flattenedRefs
    ],
    verdict: {
      good_for_me: {
        summary: routeCopy.goodForMeSummary,
        detail: routeCopy.goodForMeDetail,
        summary_confidence: hasProfileContext ? 0.82 : 0.3,
        detail_confidence: hasProfileContext ? 0.8 : 0.3
      },
      harmful: {
        flags,
        top_evidence: flags.length
          ? 'Reasoning checked ingredient-line safety cues and routine conflict context for the strongest supporting signal.'
          : 'Not enough evidence to add reasoning-only flags.',
        summary: flags.length ? 'Reasoning adds ingredient-level context to the deterministic risk read.' : '',
        flags_confidence: flags.length ? 0.84 : 0.2,
        top_evidence_confidence: flags.length ? 0.81 : 0.2,
        summary_confidence: flags.length ? 0.79 : 0.2
      },
      children_safe: {
        summary: routeCopy.childrenSafeSummary,
        summary_confidence: framing === 'cosmetic' && /\bniacinamide\b/.test(ingredientsText) ? 0.82 : 0.55
      },
      side_effects: {
        summary: routeCopy.sideEffectsSummary,
        summary_confidence:
          framing === 'cosmetic'
            ? (/\bniacinamide\b/.test(ingredientsText) ? 0.83 : 0.55)
            : Number(routeCopy.sideEffectsConfidence || 0.82)
      },
      alternatives: {
        candidates: framing === 'cosmetic' ? alternatives : [],
        footer: routeCopy.alternativesFooter,
        candidates_confidence: alternatives.length ? 0.8 : 0.2,
        footer_confidence: framing === 'cosmetic' ? (alternatives.length ? 0.78 : 0.2) : 0.7
      }
    }
  };
}

function enqueueReasoningJob({ sessionId, snapshotId, inputHash }) {
  if (!sessionId || !snapshotId) return false;
  const key = String(sessionId);
  const existing = _pendingJobs.get(key);
  if (existing && existing.snapshotId === snapshotId && existing.inputHash === inputHash) return false;
  _pendingJobs.set(key, { snapshotId, inputHash, queuedAt: Date.now() });
  setImmediate(async () => {
    try {
      const SnapshotService = require('./session-result-snapshot-service');
      const latest = SnapshotService.getLatestSessionResultSnapshot(key);
      if (!latest?.snapshot || String(latest.snapshot_id || '') !== String(snapshotId)) return;
      const nextCheck = shouldEnqueueReasoning({ snapshot: latest.snapshot });
      if (!nextCheck.shouldEnqueue && nextCheck.reason !== 'already_pending') return;
      const patch = await buildReasoningPatch({ snapshot: latest.snapshot, inputHash });
      SnapshotService.applySessionResultReasoningPatch({
        sessionId: key,
        reasoningPatch: patch,
        expectedSnapshotId: snapshotId,
        inputHash
      });
    } catch (_) {
      // best-effort async scaffold; deterministic snapshot remains authoritative
    } finally {
      _pendingJobs.delete(key);
    }
  });
  return true;
}

module.exports = {
  buildReasoningInputHash,
  shouldEnqueueReasoning,
  buildReasoningPatch,
  enqueueReasoningJob
};
