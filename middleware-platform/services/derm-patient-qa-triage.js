/**
 * Derm patient Q&A — Phase 2 triage (intent + retrieval policy + scheduling alignment).
 *
 * Spec: docs/architecture/README.md#derm-patient-qa-phase-0-scope-and-metrics
 * Rules: Knowledge/rules/derm-patient-qa-intent-rules.json (+ global triage-service)
 */

const fs = require('fs');
const path = require('path');
const secureLogger = require('./secure-logger');
const { detectRedFlags, checkBeforeScheduling } = require('./triage-service');

const RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/derm-patient-qa-intent-rules.json');

let dermRules = {
  derm_urgent_skin: [],
  vague_clarify: [],
  routine_product: [],
  off_topic: []
};

try {
  if (fs.existsSync(RULES_PATH)) {
    dermRules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  }
} catch (e) {
  console.warn('[derm-patient-qa-triage] Failed to load derm-patient-qa-intent-rules.json:', e.message);
}

function formatStructuredIntakeForTriage(slots) {
  if (!slots || typeof slots !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(slots)) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (s) parts.push(`${k}: ${s}`);
  }
  return parts.length ? parts.join('\n') : '';
}

function matchAnyPattern(text, patterns) {
  const t = (text || '').toLowerCase();
  if (!patterns || !patterns.length) return false;
  return patterns.some((p) => t.includes(String(p).toLowerCase()));
}

function matchesDermRuleGroup(text, rules) {
  for (const rule of rules || []) {
    const patterns = rule.patterns || [];
    if (matchAnyPattern(text, patterns)) {
      return { matched: true, ruleId: rule.id, rationale: rule.rationale || '' };
    }
  }
  return { matched: false };
}

function needsClarification(text, vagueRules) {
  const t = (text || '').trim();
  const len = t.length;
  for (const rule of vagueRules || []) {
    const patterns = rule.patterns || [];
    if (!matchAnyPattern(t, patterns)) continue;
    const minL = rule.min_message_length;
    const maxL = rule.max_message_length;
    if (minL != null && len >= minL) continue;
    if (maxL != null && len > maxL) continue;
    if (rule.id === 'please_help' && minL != null && len < minL) {
      return { needs: true, ruleId: rule.id, hint: 'Ask what body area, duration, and whether changing.' };
    }
    if (rule.id === 'is_this_concerning_short' && maxL != null && len <= maxL) {
      return { needs: true, ruleId: rule.id, hint: 'Ask for one sentence on location and what changed.' };
    }
  }
  if (len > 0 && len < 12 && !/\?/.test(t)) {
    return { needs: true, ruleId: 'too_short', hint: 'Ask what skin concern they mean.' };
  }
  return { needs: false };
}

/**
 * @typedef {Object} DermPatientQAInput
 * @property {string} message - Raw user text (required)
 * @property {string} [imageCaption] - Optional vision caption
 * @property {Object} [structuredIntake] - OPQRST-like slots (optional; reserved)
 * @property {{role:string,content:string}[]} [recentTurns] - For checkBeforeScheduling
 */

/**
 * Classify derm patient Q&A intent and retrieval policy.
 * @param {DermPatientQAInput} input
 * @returns {object}
 */
function classifyDermPatientQA(input = {}) {
  const message = (input.message || '').toString().trim();
  const imageCaption = (input.imageCaption || '').toString().trim();
  const intakeStr = formatStructuredIntakeForTriage(input.structuredIntake);
  const combined = [message, imageCaption, intakeStr].filter(Boolean).join('\n');

  const turns =
    Array.isArray(input.recentTurns) && input.recentTurns.length > 0
      ? input.recentTurns
      : [{ role: 'user', content: combined || message }];

  const schedulingCheck = checkBeforeScheduling(turns);
  const systemic = detectRedFlags(combined || message);

  const rationale = [];
  let intent = 'education';
  let subkind = 'general_education';
  let needs_clarification = false;
  let clarifying_hint = null;

  const off = matchesDermRuleGroup(combined, dermRules.off_topic);
  if (off.matched) {
    rationale.push(`off_topic:${off.ruleId}`);
    return buildOutput({
      intent: 'off_topic',
      subkind: off.ruleId,
      systemic,
      schedulingCheck,
      rationale,
      retrievalPolicy: retrievalForIntent('off_topic', systemic, schedulingCheck)
    });
  }

  if (systemic.urgency === 'EMERGENT' || systemic.isEmergency) {
    rationale.push(`systemic_emergent:${systemic.ruleId || systemic.redFlags?.[0] || 'pattern'}`);
    return buildOutput({
      intent: 'urgent',
      subkind: 'systemic_emergency',
      systemic,
      schedulingCheck,
      rationale,
      retrievalPolicy: retrievalForIntent('urgent_systemic', systemic, schedulingCheck)
    });
  }

  const dermUrgent = matchesDermRuleGroup(combined, dermRules.derm_urgent_skin);
  if (dermUrgent.matched) {
    rationale.push(`derm_urgent_skin:${dermUrgent.ruleId}`);
    return buildOutput({
      intent: 'urgent',
      subkind: 'derm_skin_urgent',
      systemic,
      schedulingCheck,
      rationale,
      retrievalPolicy: retrievalForIntent('urgent_derm_skin', systemic, schedulingCheck)
    });
  }

  const clarify = needsClarification(combined, dermRules.vague_clarify);
  if (clarify.needs && !matchAnyPattern(combined, (dermRules.derm_urgent_skin || []).flatMap((r) => r.patterns || []))) {
    needs_clarification = true;
    clarifying_hint = clarify.hint;
    rationale.push(`needs_clarification:${clarify.ruleId}`);
    return buildOutput({
      intent: 'education',
      subkind: 'pending_clarification',
      needs_clarification: true,
      clarifying_hint,
      systemic,
      schedulingCheck,
      rationale,
      retrievalPolicy: retrievalForIntent('clarify', systemic, schedulingCheck)
    });
  }

  if (systemic.urgency === 'URGENT') {
    rationale.push('systemic_urgent_non_derm_or_general');
    return buildOutput({
      intent: 'urgent',
      subkind: 'systemic_urgent',
      systemic,
      schedulingCheck,
      rationale,
      retrievalPolicy: retrievalForIntent('urgent_systemic_soft', systemic, schedulingCheck)
    });
  }

  const routine = matchesDermRuleGroup(combined, dermRules.routine_product);
  if (routine.matched) {
    rationale.push(`routine_product:${routine.ruleId}`);
    return buildOutput({
      intent: 'routine',
      subkind: 'product_routine',
      systemic,
      schedulingCheck,
      rationale,
      retrievalPolicy: retrievalForIntent('routine', systemic, schedulingCheck)
    });
  }

  rationale.push('default_education');
  return buildOutput({
    intent: 'education',
    subkind: 'general_education',
    systemic,
    schedulingCheck,
    rationale,
    retrievalPolicy: retrievalForIntent('education', systemic, schedulingCheck)
  });
}

function retrievalForIntent(kind, systemic, schedulingCheck) {
  const block = schedulingCheck.blockScheduling;

  const base = {
    passage_retrieval: 'full',
    top_k: 12,
    specialty: 'dermatology',
    use_code_rag: false,
    scheduling_allowed: !block,
    short_circuit_long_answer: false
  };

  switch (kind) {
    case 'urgent_systemic':
    case 'urgent_derm_skin':
      return {
        ...base,
        passage_retrieval: 'minimal',
        top_k: 3,
        use_code_rag: false,
        scheduling_allowed: false,
        short_circuit_long_answer: true
      };
    case 'urgent_systemic_soft':
      return {
        ...base,
        passage_retrieval: 'minimal',
        top_k: 5,
        scheduling_allowed: false,
        short_circuit_long_answer: true
      };
    case 'clarify':
      return {
        ...base,
        passage_retrieval: 'none',
        top_k: 0,
        short_circuit_long_answer: true
      };
    case 'off_topic':
      return {
        ...base,
        passage_retrieval: 'none',
        top_k: 0,
        scheduling_allowed: false,
        short_circuit_long_answer: true
      };
    case 'routine':
      return {
        ...base,
        passage_retrieval: 'full',
        top_k: 15,
        scheduling_allowed: !block
      };
    case 'education':
    default:
      return {
        ...base,
        passage_retrieval: 'full',
        top_k: 12,
        scheduling_allowed: !block
      };
  }
}

function buildOutput(partial) {
  const log = {
    intent: partial.intent,
    subkind: partial.subkind,
    needs_clarification: !!partial.needs_clarification,
    systemic_urgency: partial.systemic?.urgency,
    scheduling_blocked: partial.schedulingCheck?.blockScheduling,
    rationale: partial.rationale,
    ts: new Date().toISOString()
  };

  if (process.env.DERM_QA_TRIAGE_LOG === '1' || process.env.DERM_QA_TRIAGE_LOG === 'true') {
    secureLogger.info('[derm-patient-qa-triage]', log);
  }

  return {
    success: true,
    intent: partial.intent,
    subkind: partial.subkind || null,
    needs_clarification: !!partial.needs_clarification,
    clarifying_hint: partial.clarifying_hint || null,
    phase0_taxonomy: partial.intent,
    systemic_assessment: {
      urgency: partial.systemic?.urgency,
      is_emergency: !!partial.systemic?.isEmergency,
      red_flags: partial.systemic?.redFlags || [],
      rule_id: partial.systemic?.ruleId || null
    },
    scheduling: {
      block_scheduling: !!partial.schedulingCheck?.blockScheduling,
      consistent_with_triage_service: true
    },
    retrieval_policy: partial.retrievalPolicy,
    triage_rationale: partial.rationale || [],
    _log: log
  };
}

module.exports = {
  classifyDermPatientQA,
  checkBeforeScheduling,
  detectRedFlags
};
