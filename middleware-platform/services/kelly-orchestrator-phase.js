/**
 * Kelly orchestrator phases — single source of truth for:
 * - phase enum + sticky resolution
 * - voice transcript deduplication before routing
 * - tool allow-lists (used with kelly-agent-service KELLY_TOOLS)
 *
 * Env: KELLY_ORCHESTRATOR_PHASE=0 disables tool pruning + extra prompt (rollback).
 *
 * Skin-care consumer path (Option A) — session meta contract:
 * - routine_intake_active: set by landing / Retell when flow is Skin & Care (already in place).
 * - intake_complete + skincare_post_intake: set together in KellyToolExecutor
 *   _syncRoutineSkincareIntakeMeta when Skin & Care hard gates pass (single writer).
 * - When all three are true, resolveOrchestrationPhase holds ROUTINE_FOLLOWUP instead of
 *   falling through to TRIAGE_ACTIVE (session row + no RAG).
 * Escalation clears consumer flags (see resolveOrchestrationPhase + return_to_triage).
 */

'use strict';

const KELLY_ORCHESTRATOR_PHASE = {
  ROUTINE_INTAKE: 'ROUTINE_INTAKE',
  /** After skincare assessment complete: consumer report/education — not clinical triage until escalation. */
  ROUTINE_FOLLOWUP: 'ROUTINE_FOLLOWUP',
  TRIAGE_DISCOVERY: 'TRIAGE_DISCOVERY',
  TRIAGE_ACTIVE: 'TRIAGE_ACTIVE',
  BOOKING: 'BOOKING',
  APPOINTMENT_CHECKOUT: 'APPOINTMENT_CHECKOUT',
  BILLING: 'BILLING'
};

/** Symptom fragments for escape-from-booking (aligned with kelly-agent-service SYMPTOM_KEYWORDS). */
const ESCAPE_SYMPTOM_FRAGMENTS = [
  'pain', 'hurt', 'ache', 'rash', 'fever', 'cough', 'nausea', 'vomit',
  'dizzy', 'bleed', 'swollen', 'swelling', 'tired', 'fatigue', 'shortness',
  'breath', 'chest', 'headache', 'stomach', 'sore', 'burning', 'itching',
  'discharge', 'lump', 'bump', 'infection', 'sick', 'ill', 'not feeling well',
  'feeling bad', 'something wrong', 'worried about'
];

const ROUTINE_DENIAL_FRAGMENTS = [
  'no symptoms', "don't have symptoms", 'do not have symptoms', 'without symptoms',
  'no pain', 'just routine', 'routine visit', 'routine check', 'just a checkup', 'check-up',
  'нет симптом', 'без симптом',
  // Negated skin / symptom words (avoid matching ESCAPE_SYMPTOM_FRAGMENTS inside denials)
  "don't have a rash", "dont have a rash", 'do not have a rash', "don't have any rash",
  'no rash', "i don't have rash", 'not a rash', 'never had a rash',
  'no swelling', 'not swollen', 'no lump', 'no bump', 'no bleeding', 'no discharge',
  'without a rash', 'without rash', 'without swelling'
];

const SCHEDULING_TOOL_NAMES = new Set([
  'get_available_slots',
  'schedule_appointment',
  'search_appointments',
  'create_appointment_checkout',
  'verify_checkout_code'
]);

const RETAIL_TOOL_NAMES = new Set([
  'get_product_quote',
  'get_cart',
  'add_to_cart',
  'update_cart_item',
  'remove_cart_item',
  'clear_cart',
  'save_shipping_address',
  'send_commerce_verification_code',
  'verify_commerce_code',
  'prepare_commerce_checkout',
  'get_checkout_payment_status'
]);

const TRIAGE_TRIAGE_TOOL_NAMES = new Set([
  'get_triage_session',
  'store_triage_opqrst',
  'store_triage_rich_intake',
  'run_triage_rag',
  'request_document_upload',
  'resolve_product_ingredients',
  'lookup_ingredient_functions',
  'query_patient_records',
  'search_medical_literature',
  'find_clinic_specialists',
  'end_call',
  'return_to_triage'
]);

const BILLING_TRIAGE_TOOL_NAMES = new Set([
  'get_patient_claims',
  'get_triage_session',
  'query_patient_records',
  'search_medical_literature',
  'find_clinic_specialists',
  'end_call',
  'return_to_triage'
]);

/** In BOOKING / CHECKOUT, triage tools are off except escalation and hangup. */
const BOOKING_TRIAGE_TOOL_ALLOW = new Set(['return_to_triage', 'end_call']);

/** Skincare / routine-builder intake: no scheduling, commerce, or clinical triage RAG. */
const ROUTINE_INTAKE_TOOL_NAMES = new Set([
  'end_call',
  'return_to_triage',
  'request_document_upload',
  'get_triage_session',
  'store_triage_opqrst'
]);

/** `kelly_flow` / body values that turn on routine intake for the session (Retell dynamic_variables or HTTP). */
const ROUTINE_INTAKE_KELLY_FLOW_VALUES = new Set(['routine_intake', 'skincare', 'skincare_intake']);

function orchestratorEnabled() {
  const v = process.env.KELLY_ORCHESTRATOR_PHASE;
  if (v === undefined || v === null || v === '') return true;
  return String(v).toLowerCase() !== '0' && String(v).toLowerCase() !== 'false';
}

/**
 * Collapse consecutive duplicate tokens and repeated short words (voice/STT noise).
 * @returns {{ text: string, collapsed: boolean, beforeLength: number, afterLength: number }}
 */
function dedupeConsecutiveUserFragments(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { text: '', collapsed: false, beforeLength: 0, afterLength: 0 };
  }
  const parts = raw.split(/\s+/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i > 0 && p === parts[i - 1] && p.length > 0) continue;
    out.push(p);
  }
  let joined = out.join(' ');
  const phrase = joined.replace(/\b(\w{1,24})(\s+\1){2,}\b/gi, '$1');
  const collapsed = phrase.length !== raw.length || out.length !== parts.length;
  return { text: phrase, collapsed, beforeLength: raw.length, afterLength: phrase.length };
}

function _hasRoutineDenial(t) {
  const s = String(t || '').toLowerCase();
  return ROUTINE_DENIAL_FRAGMENTS.some((f) => s.includes(f));
}

/**
 * True if single-word escape keyword at index `idx` is immediately preceded by a negation
 * (e.g. "don't have a rash", "no swelling"). Multi-word ESCAPE_SYMPTOM_FRAGMENTS skip this.
 */
function _symptomKeywordNegatedBefore(t, idx) {
  const before = t.slice(Math.max(0, idx - 88), idx);
  const patterns = [
    /\b(?:no|without|never)\s+(?:a|an|the|any|much|really|\w+\s+){0,2}$/i,
    /\bnot\s+(?:really\s+)?(?:a|an|the|any|\w+\s+){0,2}$/i,
    /\b(?:don't|dont|do\s+not)\s+have\s+(?:a|any|the|much|some|\w+\s+){0,2}$/i,
    /\b(?:don't|dont|do\s+not)\s+(?:get|see|feel)\s+(?:a|any|some|\w+\s+){0,1}$/i,
    /\b(?:isn't|isnt|is\s+not|aren't|arent|are\s+not|wasn't|wasnt|was\s+not)\s+(?:a|an|the|any|\w+\s+){0,2}$/i,
    /\b(?:haven't|havent|have\s+not|hasn't|hasnt|has\s+not)\s+(?:a|any|the|some|\w+\s+){0,2}$/i
  ];
  return patterns.some((re) => re.test(before));
}

/**
 * Escape fragment present as a real token/phrase and not a negated denial (e.g. "no rash").
 */
function _escapeFragmentMatchesNonNegated(t) {
  const text = String(t || '').toLowerCase();
  for (const fragment of ESCAPE_SYMPTOM_FRAGMENTS) {
    const f = fragment.toLowerCase();
    if (f.includes(' ')) {
      if (text.includes(f)) return true;
      continue;
    }
    let start = 0;
    while (true) {
      const i = text.indexOf(f, start);
      if (i === -1) break;
      const leftOk = i === 0 || !/\w/.test(text[i - 1]);
      const rightOk = i + f.length >= text.length || !/\w/.test(text[i + f.length]);
      if (leftOk && rightOk && !_symptomKeywordNegatedBefore(text, i)) {
        return true;
      }
      start = i + 1;
    }
  }
  return false;
}

/**
 * Strong signal to reopen triage while booking tools were available.
 */
function shouldEscalateTriageFromBooking(message, routineLocked) {
  const t = String(message || '').toLowerCase();
  if (_hasRoutineDenial(t)) return false;
  if (routineLocked && !_escapeFragmentMatchesNonNegated(t)) return false;
  return _escapeFragmentMatchesNonNegated(t);
}

/**
 * During ROUTINE_INTAKE, escalate to clinical triage on the same symptom fragments as booking-escape
 * (no routine-lock suppression — intake must not block red-flag routing).
 * Negated mentions ("don't have a rash") do not escalate.
 */
function shouldEscalateRoutineIntakeToTriage(message) {
  const t = String(message || '').toLowerCase();
  if (_hasRoutineDenial(t)) return false;
  return _escapeFragmentMatchesNonNegated(t);
}

/**
 * Read `kelly_flow` from Retell call payload (dynamic_variables / metadata).
 * @param {object|null} call - message.call or call-shaped object
 * @returns {string}
 */
function extractKellyFlowFromRetellCall(call) {
  if (!call || typeof call !== 'object') return '';
  const dv =
    call.dynamic_variables ||
    call.retell_llm_dynamic_variables ||
    (call.metadata && call.metadata.dynamic_variables) ||
    {};
  const md = call.metadata || {};
  const direct = dv.kelly_flow ?? dv.KellyFlow ?? md.kelly_flow;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  const ra = dv.routine_intake_active ?? md.routine_intake_active;
  if (ra != null && (String(ra).toLowerCase() === '1' || String(ra).toLowerCase() === 'true')) {
    return 'routine_intake';
  }
  return '';
}

function kellyFlowActivatesRoutineIntake(flow) {
  const f = String(flow || '').trim().toLowerCase();
  if (!f) return false;
  return ROUTINE_INTAKE_KELLY_FLOW_VALUES.has(f);
}

function _metaGet(KellyToolExecutor, sessionId, key) {
  try {
    return KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, key) : null;
  } catch (_) {
    return null;
  }
}

function _metaSet(KellyToolExecutor, sessionId, key, val) {
  try {
    if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, key, val);
  } catch (_) {}
}

/**
 * Resolve orchestrator phase for this turn (sticky unknown + cold start + checkout + escape).
 *
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.message
 * @param {string} opts.intentBucket - from _classifyIntent: billing | routine_booking | symptom | unknown
 * @param {object|null} opts.db - database module
 * @param {object} opts.KellyToolExecutor
 * @param {function(string): *} opts.getLatestRag - e.g. (sid) => TriageRAGService.getLatestForSession(sid)
 * @param {boolean} opts.routineLocked
 * @returns {object}
 */
function resolveOrchestrationPhase(opts) {
  const {
    sessionId,
    message,
    intentBucket,
    db,
    KellyToolExecutor,
    getLatestRag,
    routineLocked
  } = opts;

  const metaTrue = (key) => {
    const v = String(_metaGet(KellyToolExecutor, sessionId, key) || '').toLowerCase();
    return v === '1' || v === 'true';
  };

  const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  const triageComplete = !!(sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true));
  const hasRag = !!getLatestRag(sessionId);
  let triageReopen = metaTrue('kelly_triage_reopen');
  const paymentToken = _metaGet(KellyToolExecutor, sessionId, 'payment_token');
  const lastPersisted = _metaGet(KellyToolExecutor, sessionId, 'kelly_orchestrator_phase');

  let escapeTriggered = false;
  if (
    triageComplete &&
    hasRag &&
    shouldEscalateTriageFromBooking(message, routineLocked)
  ) {
    _metaSet(KellyToolExecutor, sessionId, 'kelly_triage_reopen', '1');
    escapeTriggered = true;
  }
  triageReopen = metaTrue('kelly_triage_reopen');

  // Routine / skincare intake → clinical triage when message looks like acute medical concern
  if (
    metaTrue('routine_intake_active') &&
    !metaTrue('intake_complete') &&
    intentBucket !== 'billing' &&
    shouldEscalateRoutineIntakeToTriage(message)
  ) {
    _metaSet(KellyToolExecutor, sessionId, 'kelly_triage_reopen', '1');
    _metaSet(KellyToolExecutor, sessionId, 'routine_intake_active', '0');
  }
  triageReopen = metaTrue('kelly_triage_reopen');

  // Post–skincare intake: same medical-escape rule (was gated on !intake_complete only before).
  if (
    metaTrue('routine_intake_active') &&
    metaTrue('intake_complete') &&
    metaTrue('skincare_post_intake') &&
    intentBucket !== 'billing' &&
    shouldEscalateRoutineIntakeToTriage(message)
  ) {
    _metaSet(KellyToolExecutor, sessionId, 'kelly_triage_reopen', '1');
    _metaSet(KellyToolExecutor, sessionId, 'routine_intake_active', '0');
    _metaSet(KellyToolExecutor, sessionId, 'skincare_post_intake', '0');
  }
  triageReopen = metaTrue('kelly_triage_reopen');

  const routineSkincareConsumerHold =
    metaTrue('routine_intake_active') &&
    metaTrue('intake_complete') &&
    metaTrue('skincare_post_intake') &&
    intentBucket !== 'billing';

  const routineIntakeHold =
    metaTrue('routine_intake_active') && !metaTrue('intake_complete') && intentBucket !== 'billing';

  let phase;
  let stickyApplied = false;

  if (String(paymentToken || '').trim()) {
    phase = KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT;
  } else if (intentBucket === 'billing') {
    // Do not collapse to billing-only tools while triage is still incomplete (mixed-intent turns).
    if (sessionRow && !triageComplete) {
      phase = KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE;
    } else {
      phase = KELLY_ORCHESTRATOR_PHASE.BILLING;
    }
  } else if (triageReopen || escapeTriggered) {
    phase = KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE;
  } else if (routineSkincareConsumerHold) {
    phase = KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP;
  } else if (routineIntakeHold) {
    phase = KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE;
  } else if (triageComplete && hasRag) {
    phase = KELLY_ORCHESTRATOR_PHASE.BOOKING;
  } else if (sessionRow || hasRag) {
    phase = KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE;
  } else {
    phase = KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY;
  }

  // Sticky: unknown intent → keep last phase when safe (voice noise).
  if (intentBucket === 'unknown' && lastPersisted && !escapeTriggered && !paymentToken) {
    const lp = String(lastPersisted);
    if (
      lp === KELLY_ORCHESTRATOR_PHASE.BOOKING &&
      triageComplete &&
      hasRag &&
      !triageReopen
    ) {
      phase = KELLY_ORCHESTRATOR_PHASE.BOOKING;
      stickyApplied = true;
    } else if (
      lp === KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE ||
      lp === KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY
    ) {
      if (!triageComplete || !hasRag) {
        phase = lp;
        stickyApplied = true;
      }
    } else if (lp === KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE && routineIntakeHold) {
      phase = KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE;
      stickyApplied = true;
    } else if (lp === KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP && routineSkincareConsumerHold) {
      phase = KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP;
      stickyApplied = true;
    } else if (lp === KELLY_ORCHESTRATOR_PHASE.BILLING && intentBucket === 'unknown') {
      phase = KELLY_ORCHESTRATOR_PHASE.BILLING;
      stickyApplied = true;
    }
  }

  // Cold start: no persisted phase yet — default discovery (handled by branch above).
  _metaSet(KellyToolExecutor, sessionId, 'kelly_orchestrator_phase', phase);

  return {
    phase,
    intentBucket,
    stickyApplied,
    escapeTriggered,
    triageReopen: !!(triageReopen || escapeTriggered),
    triageComplete,
    hasRag,
    lastPersisted: lastPersisted || null,
    routineIntakeHold,
    routineSkincareConsumerHold
  };
}

/**
 * Filter OpenAI-style tool list by phase.
 * @param {Array} allTools - KELLY_TOOLS
 * @param {string} phase
 * @param {{ includeDermEducation?: boolean }} opts
 */
function filterKellyToolsByPhase(allTools, phase, opts = {}) {
  const includeDerm = !!opts.includeDermEducation;
  const names = (allTools || [])
    .map((t) => t?.function?.name)
    .filter(Boolean);

  const pass = (name) => {
    if (
      phase === KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE ||
      phase === KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP
    ) {
      if (ROUTINE_INTAKE_TOOL_NAMES.has(name)) return true;
      if (includeDerm && name === 'run_derm_patient_qa') return true;
      if (SCHEDULING_TOOL_NAMES.has(name)) return false;
      if (RETAIL_TOOL_NAMES.has(name)) return false;
      return false;
    }
    if (phase === KELLY_ORCHESTRATOR_PHASE.BOOKING || phase === KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT) {
      if (BOOKING_TRIAGE_TOOL_ALLOW.has(name)) return true;
      if (TRIAGE_TRIAGE_TOOL_NAMES.has(name)) return false;
      return true;
    }
    if (phase === KELLY_ORCHESTRATOR_PHASE.BILLING) {
      if (BILLING_TRIAGE_TOOL_NAMES.has(name)) return true;
      if (name === 'get_patient_claims') return true;
      return false;
    }
    // TRIAGE_DISCOVERY + TRIAGE_ACTIVE
    if (TRIAGE_TRIAGE_TOOL_NAMES.has(name)) return true;
    if (includeDerm && name === 'run_derm_patient_qa') return true;
    if (SCHEDULING_TOOL_NAMES.has(name)) return false;
    if (RETAIL_TOOL_NAMES.has(name)) return false;
    return false;
  };

  return (allTools || []).filter((t) => pass(t?.function?.name));
}

/** Intake-safe tool descriptions (schema copy) — avoids triage/booking steering in ROUTINE_INTAKE. */
const ROUTINE_INTAKE_TOOL_DESCRIPTION_OVERRIDES = {
  get_triage_session:
    'Read **Skin & Care** answers already saved for this session (not clinical triage state). Returns concern text, timing, bother level, routine/products, structured assessment fields (skin type, concerns array, pregnancy, derm visit, impact score), triggers, lifestyle/environment notes, allergies, and photo flags. Call at the **start of a turn** or before writing updates. Never implies run_triage_rag or booking.',
  store_triage_opqrst:
    'Save **Skin & Care intake** only. Do **not** present this to the patient as “OPQRST” or hospital triage — use conversational skincare language. Does **not** call run_triage_rag or scheduling.\n\n' +
    '**Core story:** **quality** = main concern in their words; **onset** = how long / when started; **associated_sx** = routine steps and product names (or **systemic** red flags: fever, very unwell); **medications** = topicals/OTC if you use this field.\n' +
    '**Consumer context (not emergency triage):** **severity** = how bothersome (mild/moderate/severe or 1–10); **timing** = constant vs comes-and-goes; **radiation** = spreading or other areas if relevant.\n' +
    '**Hard gates (server — all required before intake_complete):** **skin_type**; **skin_concerns_json** (string array) **or** a filled **quality**; **pregnancy_status**; **prior_dermatologist_json** `{ seen: true|false, note? }`; **functional_impact** integer **1–5** (daily-life impact).\n' +
    '**Soft (nice for the report):** **triggers_json**, **provocation**, **lifestyle_notes**, **environment_notes**, **ingredient_reactions**, **what_has_worked**, **hormonal_context**, **allergies**.\n' +
    'Write **after each material answer**; merge with get_triage_session so nothing is dropped.',
  request_document_upload:
    'Offer secure photo upload when a skin image would help. Use a short, consumer-friendly reason.',
  return_to_triage:
    'Switch to **clinical triage** when the user reports **new concerning medical symptoms** (e.g. chest pain, stroke signs, severe systemic illness) or needs a routed medical visit. Do not use for routine skincare or product shopping.',
  end_call: 'End the chat or voice session when the user is finished.',
  run_derm_patient_qa:
    'Dermatology / skin **education** only (not a diagnosis). For product and routine questions. For emergencies, direct to urgent care/911; use **return_to_triage** if they need clinical triage — do not reference scheduling or run_triage_rag from this tool.'
};

/**
 * Clone tools and replace descriptions for routine intake so the model is not steered by triage/booking copy.
 * @param {Array} tools - already phase-filtered
 * @returns {Array}
 */
function mapToolDescriptionsForRoutineIntake(tools) {
  return (tools || []).map((t) => {
    const name = t?.function?.name;
    const desc = name ? ROUTINE_INTAKE_TOOL_DESCRIPTION_OVERRIDES[name] : null;
    if (!desc) return t;
    return {
      ...t,
      function: { ...t.function, description: desc }
    };
  });
}

/**
 * Prompt block: phase + why tools are locked (must match filterKellyToolsByPhase).
 */
function buildOrchestrationPromptSection(orch) {
  if (!orch || !orch.phase) return '';
  const p = orch.phase;
  const lines = ['## Orchestrator state (follow strictly)'];
  lines.push(`- **Current phase**: ${p}.`);
  if (p === KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE) {
    lines.push('- **Skincare / routine intake**: collect routine goals, skin context, and current products only for this phase.');
    lines.push(
      '- Persist answers with **get_triage_session** / **store_triage_opqrst** using the field mapping in each tool description (not clinical OPQRST triage).'
    );
    lines.push('- **Do not** run **run_triage_rag**, book appointments, or use scheduling/checkout/commerce tools until intake is complete and the phase advances.');
    lines.push('- **Do not recommend** a full product routine until **intake_complete** is set server-side.');
    lines.push(
      '- If the patient reports **concerning medical symptoms** (pain, chest symptoms, severe bleeding, etc.), call **return_to_triage** so clinical triage can take over.'
    );
  }
  if (p === KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP) {
    lines.push(
      '- **Skincare assessment is complete** (server marked intake). Focus on **personalised explanation, education, and light routine guidance** — not a clinical triage interview.'
    );
    lines.push(
      '- **Do not** run **run_triage_rag**, pick a specialty, or use scheduling/checkout/commerce tools unless the patient clearly asks to book or you use **return_to_triage** for a new medical concern.'
    );
    lines.push(
      '- If the patient reports **new concerning medical symptoms**, call **return_to_triage** so clinical triage can take over.'
    );
  }
  if (p === KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY || p === KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE) {
    lines.push('- **Scheduling tools are NOT available this turn** until triage is complete (OPQRST + run_triage_rag with acceptable confidence).');
    lines.push('- Do NOT promise to look up the calendar, book, or take payment until the phase advances to booking.');
    lines.push('- If the patient asks for times, explain you need to finish triage questions first for safe routing.');
  }
  if (orch.triageReopen || orch.escapeTriggered) {
    lines.push('- **Triage was reopened** (new symptoms). Complete OPQRST and run_triage_rag again before slots or scheduling.');
  }
  if (p === KELLY_ORCHESTRATOR_PHASE.BILLING) {
    lines.push('- Focus on billing/claims questions; use get_patient_claims when appropriate.');
  }
  if (p === KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT) {
    lines.push('- **Checkout**: use verify_checkout_code / payment tools as needed; complete the flow the patient started.');
  }
  if (p === KELLY_ORCHESTRATOR_PHASE.BOOKING || p === KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT) {
    lines.push('- **Do not call run_triage_rag** in this phase; use **return_to_triage** if triage must reopen.');
  }
  if (orch.stickyApplied) {
    lines.push('- (Sticky phase kept for this turn because the message was ambiguous — stay consistent unless safety requires a change.)');
  }
  if (p === KELLY_ORCHESTRATOR_PHASE.BOOKING || p === KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT) {
    lines.push(
      '- If the patient reports NEW symptoms during booking, call **return_to_triage** or continue triage — do not schedule until triage is complete again.'
    );
  }
  return lines.join('\n');
}

module.exports = {
  KELLY_ORCHESTRATOR_PHASE,
  dedupeConsecutiveUserFragments,
  shouldEscalateTriageFromBooking,
  shouldEscalateRoutineIntakeToTriage,
  extractKellyFlowFromRetellCall,
  kellyFlowActivatesRoutineIntake,
  resolveOrchestrationPhase,
  filterKellyToolsByPhase,
  mapToolDescriptionsForRoutineIntake,
  buildOrchestrationPromptSection,
  orchestratorEnabled,
  SCHEDULING_TOOL_NAMES,
  TRIAGE_TRIAGE_TOOL_NAMES,
  ROUTINE_INTAKE_TOOL_NAMES
};
