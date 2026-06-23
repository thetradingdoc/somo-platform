'use strict';

function extractRouteFromThread(shortTermThread = []) {
  const thread = Array.isArray(shortTermThread) ? shortTermThread : [];
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const row = thread[i] || {};
    const pd = row.product_data && typeof row.product_data === 'object' ? row.product_data : null;
    const fromPd = String(pd?.category_route || '').trim().toLowerCase();
    if (fromPd) return { route: fromPd, source: 'thread_product_data' };
    const txt = String(row.text || '');
    const m = txt.match(/Category Route:\s*([a-z_ -]+)/i);
    if (m && m[1]) {
      return { route: String(m[1]).trim().toLowerCase().replace(/\s+/g, '_'), source: 'thread_text' };
    }
  }
  return { route: 'unknown', source: 'none' };
}

function classifyIntent(message) {
  const t = String(message || '').trim().toLowerCase();
  const scan = /\b(scan|scanned|barcode|ingredients?|food scan|supplement|low risk|generally safe|additive|dye)\b/.test(t);
  const triage = /\b(pain|itch|rash|bleed|swelling|fever|symptom|hurt|urgent|emergency)\b/.test(t);
  const routine = /\b(routine|cleanser|serum|moisturizer|skin type|oily|dry|combination|sensitive|acne|retinol|niacinamide|bha|aha|spf)\b/.test(t);
  if (scan && triage) return { intent: 'mixed_scan_triage', scan, triage, routine };
  if (scan && routine) return { intent: 'mixed_scan_routine', scan, triage, routine };
  if (scan) return { intent: 'scan_question', scan, triage, routine };
  if (triage) return { intent: 'triage_question', scan, triage, routine };
  if (routine) return { intent: 'routine_question', scan, triage, routine };
  return { intent: 'general_question', scan, triage, routine };
}

function selectPolicyPack(route, intent) {
  const r = String(route || 'unknown').trim().toLowerCase();
  const i = String(intent || 'general_question').trim().toLowerCase();
  const foodLike = r === 'food' || r === 'supplement';
  const cosmeticLike = r === 'cosmetic' || r === 'hygiene';

  if (i === 'mixed_scan_triage') return foodLike ? 'scan_route_priority_with_triage_safety' : 'scan_triage_blended';
  if (i === 'mixed_scan_routine') return foodLike ? 'scan_route_priority_with_routine_safety' : 'scan_routine_blended';
  if (i === 'scan_question') {
    if (foodLike) return 'food_scan_policy';
    if (cosmeticLike) return 'cosmetic_scan_policy';
    return 'unknown_scan_policy';
  }
  if (i === 'triage_question') return 'triage_policy';
  if (i === 'routine_question') return 'routine_policy';
  return 'default_policy';
}

function buildLandingRouteIntentPlan({ message = '', shortTermThread = [], explicitRoute = '' } = {}) {
  const explicit = String(explicitRoute || '').trim().toLowerCase();
  const fromThread = extractRouteFromThread(shortTermThread);
  const route = explicit || fromThread.route || 'unknown';
  const intentBits = classifyIntent(message);
  const policyPack = selectPolicyPack(route, intentBits.intent);
  const foodLike = route === 'food' || route === 'supplement';
  const shouldBypassSkincareClarifier =
    foodLike && (intentBits.intent === 'scan_question' || intentBits.intent === 'mixed_scan_triage' || intentBits.intent === 'mixed_scan_routine');
  return {
    route_context: {
      route,
      source: explicit ? 'explicit' : fromThread.source,
      confidence: route === 'unknown' ? 'low' : 'high'
    },
    intent_context: {
      intent: intentBits.intent,
      scan_detected: intentBits.scan,
      triage_detected: intentBits.triage,
      routine_detected: intentBits.routine
    },
    policy_pack: policyPack,
    arbitration: {
      mixed_intent: intentBits.intent.startsWith('mixed_'),
      strategy: intentBits.intent === 'mixed_scan_triage'
        ? 'scan_context_priority_with_triage_safety_overlay'
        : intentBits.intent === 'mixed_scan_routine'
          ? 'scan_context_priority_with_routine_overlay'
          : 'single_intent'
    },
    flags: {
      should_bypass_skincare_clarifier: shouldBypassSkincareClarifier,
      scan_chat_mode: shouldBypassSkincareClarifier || intentBits.scan
    }
  };
}

module.exports = {
  buildLandingRouteIntentPlan,
  extractRouteFromThread,
  classifyIntent,
  selectPolicyPack
};
