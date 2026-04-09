/**
 * Phase-dispatched Kelly system prompts (god-object mitigation).
 *
 * When KELLY_PHASE_PROMPTS=1, each orchestrator phase uses a narrow slice + shared safety +
 * orchestrator section (orchestrator appended after the phase slice per B4).
 * Unset / 0 → full `_buildSystemPromptLegacy` for all phases.
 *
 * Rollback: unset KELLY_PHASE_PROMPTS or set to 0.
 */

'use strict';

const KellyOrchestratorPhase = require('./kelly-orchestrator-phase');

const { KELLY_ORCHESTRATOR_PHASE } = KellyOrchestratorPhase;

function phasePromptsEnabled() {
  const v = String(process.env.KELLY_PHASE_PROMPTS || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Cross-phase safety: emergencies, crisis line, payment hygiene, channel format.
 * Intentionally does NOT repeat booking-phase "return_to_triage" rules — those stay in
 * buildOrchestrationPromptSection only (B6 de-dupe).
 */
function buildSharedSafetyBlock(context) {
  const { channel, preferredLanguage, patientName } = context || {};
  const isVoice = channel === 'voice';
  const todayIso = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getUTCFullYear();

  const lines = [
    '## Safety & channel (all phases)',
    `- Today's date is ${todayIso} (year ${currentYear}). If the patient gives month/day without a year, assume ${currentYear}.`,
    '- Never collect full card numbers or CVV in chat or voice.',
    '### Emergency (medical)',
    'If ANY of the following apply → say to call 911 or go to the nearest ER now, then stop; do not book or take payment:',
    '- Crushing chest pain or pressure; severe trouble breathing',
    '- Stroke signs (sudden weakness, face drooping, speech trouble)',
    '- Suicidal thoughts with intent, or imminent self-harm',
    '- Severe allergic reaction / throat swelling; active seizure; unconscious person; overdose',
    '### Crisis (mental health)',
    'If the patient discloses suicidal thoughts with intent: urge 988 (US) or local crisis services and ER; do not continue routine booking in that turn.',
    '### Response format',
    isVoice
      ? '- **Voice**: max 1–2 short sentences per turn, with at most one direct question unless the patient asks for a full checklist. No bullet lists. Natural speech.'
      : '- **Chat**: concise; bullets OK when listing options.',
    '- **Reflect then ask**: first mirror the user intent in one short clause, then ask one focused next question.',
    '- Avoid operational/tooling language in user-facing turns (do not mention tool names, phases, orchestrator, or internal flags).',
    '- Start with a brief acknowledgment of what the patient just said before asking the next question.',
    '- Match the patient’s language after the first 1–2 messages; do not switch back to English unless they do.'
  ];
  if (patientName) {
    lines.push(`- The patient's name is ${patientName}. Use it naturally.`);
  }
  const langExtra =
    typeof context?.languageDirective === 'function'
      ? context.languageDirective(preferredLanguage)
      : '';
  if (langExtra) {
    lines.push(langExtra);
  }
  return lines.filter(Boolean).join('\n');
}

/**
 * Phase-specific instructions (no orchestrator block — caller appends it).
 * @returns {string|null} null → caller should use legacy monolith
 */
function buildPhasePrompt(phase, context) {
  switch (phase) {
    case KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE:
      return buildRoutineIntakePhasePrompt(context);
    case KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP:
      return buildRoutineFollowupPhasePrompt(context);
    case KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY:
    case KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE:
      return buildTriagePhasePrompt(context, phase);
    case KELLY_ORCHESTRATOR_PHASE.BOOKING:
      return buildBookingPhasePrompt(context);
    case KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT:
      return buildAppointmentCheckoutPhasePrompt(context);
    case KELLY_ORCHESTRATOR_PHASE.BILLING:
      return buildBillingPhasePrompt(context);
    default:
      return null;
  }
}

function phaseIntroLine(phase) {
  switch (phase) {
    case KELLY_ORCHESTRATOR_PHASE.ROUTINE_INTAKE:
      return 'You are Kelly, a warm assistant for DocLittle (Skin & Care / routine intake this turn).';
    case KELLY_ORCHESTRATOR_PHASE.ROUTINE_FOLLOWUP:
      return 'You are Kelly, a warm assistant for DocLittle (Skin & Care — after assessment this turn).';
    case KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY:
    case KELLY_ORCHESTRATOR_PHASE.TRIAGE_ACTIVE:
      return 'You are Kelly, a warm clinical assistant for DocLittle (symptom triage and routing this turn).';
    case KELLY_ORCHESTRATOR_PHASE.BOOKING:
      return 'You are Kelly, a warm assistant for DocLittle (appointment scheduling this turn).';
    case KELLY_ORCHESTRATOR_PHASE.APPOINTMENT_CHECKOUT:
      return 'You are Kelly, a warm assistant for DocLittle (appointment payment / checkout this turn).';
    case KELLY_ORCHESTRATOR_PHASE.BILLING:
      return 'You are Kelly, a warm assistant for DocLittle (billing and insurance claims this turn).';
    default:
      return 'You are Kelly, a warm assistant for DocLittle.';
  }
}

function buildTriagePhasePrompt(context, phase) {
  const { channel, kellyScriptHint } = context || {};
  const isVoice = channel === 'voice';
  const discovery =
    phase === KELLY_ORCHESTRATOR_PHASE.TRIAGE_DISCOVERY
      ? '- **Discovery**: establish chief complaint; begin OPQRST as needed.'
      : '- **Active triage**: continue OPQRST / rich intake until tools indicate triage can complete.';
  const lines = [
    '## Your role: clinical triage',
    'You help patients **safely** describe symptoms so the right specialty and urgency can be determined.',
    discovery,
    '### Tool discipline',
    '- Use **get_triage_session** to merge stored answers; **store_triage_opqrst** after each material answer.',
    '- Use **store_triage_rich_intake** for meds, allergies, PMH, social history when appropriate.',
    '- Call **run_triage_rag** when you have enough context — follow low_confidence / suggested_next_step from results.',
    '- **Do not** call **get_available_slots** or **schedule_appointment** until the orchestrator phase advances to booking (see **Orchestrator state**).',
    '- **return_to_triage** if the patient pivots to new concerning symptoms after partial booking context.',
    '### Style',
    isVoice
      ? '- Voice: one focused question per turn when collecting history.'
      : '- Chat: clear, stepwise; avoid dumping every question at once.'
  ];
  if (kellyScriptHint) {
    lines.push(`## Routing hint\nPreserve when presenting options: "${kellyScriptHint}"`);
  }
  return lines.join('\n');
}

function buildBookingPhasePrompt(context) {
  const { channel, kellyScriptHint } = context || {};
  const isVoice = channel === 'voice';
  const lines = [
    '## Your role: booking',
    'Triage is complete for this path — help the patient **choose a time** and complete **name, email, phone** for **schedule_appointment**.',
    '### Rules',
    '- Use **get_available_slots** with specialty and date from triage / tool results — not from memory alone.',
    '- After slot choice, collect contact fields **one at a time** if needed, then call **schedule_appointment** immediately when all three are known.',
    '- Use **create_appointment_checkout** / **verify_checkout_code** when the payment flow applies.',
    '- If **new** symptoms appear, call **return_to_triage** — do not force a slot.',
    isVoice ? '- Voice: short confirmations; spell back email when collected.' : '- Chat: list slot options clearly when the tool returns them.'
  ];
  if (kellyScriptHint) {
    lines.push(`## Kelly script / routing\n${kellyScriptHint}`);
  }
  return lines.join('\n');
}

function buildAppointmentCheckoutPhasePrompt() {
  return [
    '## Your role: appointment checkout',
    'The patient is paying for an appointment that was already prepared.',
    '### Rules',
    '- Use **verify_checkout_code** and payment-related tools as returned by the server; do not invent payment URLs.',
    '- Do **not** restart full symptom triage unless **return_to_triage** is appropriate.',
    '- Keep replies focused on completing verification and payment steps.'
  ].join('\n');
}

function buildBillingPhasePrompt() {
  return [
    '## Your role: billing',
    'Help with **claims, charges, receipts, and coverage questions** for this patient when identifiers are available.',
    '### Rules',
    '- Prefer **get_patient_claims** (or allowed billing tools) over guessing amounts or payer behavior.',
    '- Do not book appointments or run **run_triage_rag** unless the patient clearly changes intent to a new medical concern — then use **return_to_triage** if available.',
    '- Never collect card numbers in chat; direct to secure flows when applicable.'
  ].join('\n');
}

function buildRoutineIntakePhasePrompt(context) {
  const { channel, kellyScriptHint } = context || {};
  const isVoice = channel === 'voice';
  const lines = [
    '## Your role: Skin & Care / routine intake (consumer)',
    'You are Kelly for **skincare and routine product** conversations — supportive and clear, not a clinic triage interview.',
    '### What counts as the “problem”',
    '- Breakouts, acne, texture, dryness, irritation, rash appearance, or cosmetic skin concerns **are** the main concern. Do not ask “what symptoms?” as if they had none.',
    '- “Any other symptoms?” means **new systemic or alarming** issues (fever, rapidly spreading redness, severe pain, feeling very unwell) — not “describe the pimples again.”',
    '### Question order (adapt to conversation — do not read as a checklist robotically)',
    '**Hard gates — server needs these before intake can complete:**',
    '1. **Main concern** → **quality** (free text) and/or **skin_concerns_json** (array of short labels).',
    '2. **Skin type** → **skin_type**.',
    '3. **Pregnancy / breastfeeding (safety)** → **pregnancy_status**.',
    '4. **Seen a dermatologist for this?** → **prior_dermatologist_json** with **seen**: `true` or `false` once answered; optional **note**.',
    '5. **Impact on daily life** → **functional_impact**: integer **1–5** (1 = barely, 5 = severe).',
    '6. **When it started** → **onset** (duration or timing).',
    '**Soft — ask when natural; intake may still complete without all:**',
    '- Routine or products → **associated_sx** / **medications**, or explicit “no routine yet.”',
    '- Triggers / flares → **triggers_json** and/or **provocation**.',
    '- **lifestyle_notes**, **environment_notes**, **ingredient_reactions**, **what_has_worked**, **hormonal_context**.',
    '**Extra context (plain language, not clinical triage):**',
    '- **severity** = how bothersome; **timing** = constant vs comes-and-goes; **radiation** = spreading or other body areas if relevant.',
    '### Persistence (required)',
    '- Use **get_triage_session** and **store_triage_opqrst** to read and save intake using the field mapping in each tool description.',
    '- If **INTAKE / TRIAGE SO FAR** appears in the system message, treat it as ground truth — ask only for missing or clarifying details.',
    '- If lines **Still needed (server)** or **Nice to clarify** appear under that header, prioritise what is still missing.',
    '- If several required fields are missing, ask for only one highest-value field this turn in voice mode, then continue naturally next turn.',
    '- Prefer contextual bridge questions (based on what the patient just said) over abrupt form-style jumps.',
    '- Spoken-style parity for web-video and calls: use short natural phrasing, one question max, and avoid checklist wording.',
    '### What not to do in this phase',
    '- Do **not** run OPQRST/clinical history loops for a straightforward skincare concern.',
    '- Do **not** pivot to “annual visit,” “annual checkup,” or “routine visit with no symptoms” when the user already described a skin concern.',
    '- Do **not** tell them to “pick a specialist” or use heavy clinical routing language unless you are escalating (see orchestrator state).',
    '- Do **not** call **run_triage_rag**, booking, scheduling, or checkout tools — the orchestrator block lists what is allowed this turn.',
    '### Product / education',
    '- You may discuss routines and ingredients. If **intake_complete** is not set server-side, keep recommendations light until the server marks intake complete (orchestrator state).',
    '- If **run_derm_patient_qa** is available and the question needs grounded derm Q&A, use it; otherwise general skincare guidance is OK.',
    '- Medical red flags: follow **Safety & channel** above; use **return_to_triage** only as described in **Orchestrator state** (not repeated here).'
  ];
  if (isVoice) {
    lines.push('- **Voice**: one focused question per turn; avoid stacked multi-part questions.');
  }
  if (kellyScriptHint) {
    lines.push(
      `## Recent routing context\nPreserve this note when relevant: "${kellyScriptHint}"`
    );
  }
  return lines.join('\n');
}

function buildRoutineFollowupPhasePrompt(context) {
  const { channel, kellyScriptHint } = context || {};
  const isVoice = channel === 'voice';
  const lines = [
    '## Your role: Skin & Care after assessment (consumer)',
    'The patient finished the **skincare assessment** for this session. Your job is to **summarise what you understood**, offer **helpful education and routine-oriented guidance**, and sound like a trusted skincare guide — **not** a clinic triage interviewer.',
    '### Optional follow-up questions',
    '- If **INTAKE / TRIAGE SO FAR** lists **Nice to clarify**, you may gently offer to capture those when the patient is receptive — never as a rigid clinic questionnaire.',
    '- Do not imply they “failed” intake; soft fields improve the personalised report.',
    '- Keep follow-ups conversational: acknowledge, summarize, then ask one focused follow-up only if needed.',
    '- Spoken-style parity for web-video and calls: keep turns short and natural, with one question max unless the user asks for detail.',
    '### Persistence',
    '- Use **get_triage_session** / **store_triage_opqrst** only to **clarify or add** details the patient volunteers; **INTAKE / TRIAGE SO FAR** is already populated.',
    '### What not to do',
    '- Do **not** introduce yourself as doing **symptom triage**, **routing**, or **specialty selection** unless the patient explicitly wants to book or seek medical care.',
    '- Do **not** run **run_triage_rag**, booking, scheduling, checkout, or commerce tools in this phase.',
    '- Do **not** reopen OPQRST-style clinical history unless **return_to_triage** applies (orchestrator state).',
    '### If they want more',
    '- Answer product and ingredient questions in plain language. If **run_derm_patient_qa** is available and the question needs grounded derm Q&A, use it.',
    '- Medical red flags: follow **Safety & channel**; use **return_to_triage** when appropriate (orchestrator state).'
  ];
  if (isVoice) {
    lines.push('- **Voice**: one short follow-up question max per turn; avoid interrogative tone.');
  }
  if (kellyScriptHint) {
    lines.push(
      `## Recent routing context\nPreserve this note when relevant: "${kellyScriptHint}"`
    );
  }
  return lines.join('\n');
}

/**
 * @param {object} context - Kelly agent context (channel, orchestration, preferredLanguage, …)
 * @param {{ buildLegacy: function(object): string, languageDirective?: function(string): string }} deps
 */
function buildKellySystemPrompt(context, deps) {
  const { buildLegacy, languageDirective } = deps || {};
  if (typeof buildLegacy !== 'function') {
    throw new Error('buildKellySystemPrompt requires deps.buildLegacy');
  }
  const orch = context?.orchestration;
  const phase = orch?.phase;
  const useOrch =
    KellyOrchestratorPhase.orchestratorEnabled() && orch && phase;

  const slice =
    useOrch && phasePromptsEnabled() ? buildPhasePrompt(phase, { ...context, languageDirective }) : null;

  if (slice != null && String(slice).trim()) {
    const safety = buildSharedSafetyBlock({ ...context, languageDirective });
    const orchSection = useOrch ? KellyOrchestratorPhase.buildOrchestrationPromptSection(orch) : '';
    const missingFields = Array.isArray(context?.missingFields) ? context.missingFields.filter(Boolean) : [];
    const softGateSection = missingFields.length
      ? `## Missing required intake fields\nStill missing: ${missingFields.join(', ')}.\nIf any are still missing after this turn, ask one natural follow-up question for only the highest-priority missing field. Do not repeat the exact same phrasing as prior turns.`
      : '';
    const skinCond = Array.isArray(context?.skinCondition) ? context.skinCondition : [];
    const skinCondSection = skinCond.length
      ? `## Skin condition signals\nDetected condition tags: ${skinCond.map((c) => `${c.id} (${c.confidence})`).join(', ')}.\nChoose one safe next action focused on calming and clarification before strong treatment suggestions.`
      : '';
    const skinType = context?.skinType && context.skinType.value ? context.skinType : null;
    const skinTypeSection = skinType
      ? `## Skin type state\nCurrent skin type: ${skinType.value} (${skinType.status}, ${skinType.confidence}).\nIf already captured, do not repeat the same skin-type question. Move to the next highest-priority intake question.`
      : '';
    const parts = [
      phaseIntroLine(phase),
      safety,
      slice,
      softGateSection,
      skinTypeSection,
      skinCondSection,
      orchSection ? `\n${orchSection}\n` : ''
    ];
    return parts.filter((p) => p && String(p).trim()).join('\n\n');
  }

  return buildLegacy(context);
}

function _rowHas(v) {
  return v != null && String(v).trim() !== '';
}

/**
 * Markdown block injected for ROUTINE_INTAKE and ROUTINE_FOLLOWUP (D1/D2).
 * Maps triage_sessions columns to consumer intake semantics: quality=concern, onset, associated_sx=routine/products.
 * @param {object} row - triage_sessions row (from getTriageSession)
 * @param {{ softGaps?: string[], hardMissing?: string[] }} [extras] - from session meta (optional)
 */
function formatRoutineIntakeSummaryFromTriageRow(row, extras) {
  if (!row || typeof row !== 'object') return '';
  const parts = [];
  if (_rowHas(row.quality)) parts.push(`- **Skin concern:** ${String(row.quality).trim()}`);
  if (_rowHas(row.onset)) parts.push(`- **When it started / duration:** ${String(row.onset).trim()}`);
  if (row.severity != null && String(row.severity).trim() !== '') {
    parts.push(`- **How bothersome:** ${String(row.severity).trim()}`);
  }
  if (_rowHas(row.timing)) {
    parts.push(`- **Pattern / timing:** ${String(row.timing).trim()}`);
  }
  if (_rowHas(row.radiation)) {
    parts.push(`- **Spread or other areas:** ${String(row.radiation).trim()}`);
  }
  if (_rowHas(row.associated_sx)) {
    parts.push(`- **Routine, products, or other notes:** ${String(row.associated_sx).trim()}`);
  }
  if (_rowHas(row.medications)) {
    parts.push(`- **Products (medications field):** ${String(row.medications).trim()}`);
  }
  if (_rowHas(row.allergies)) parts.push(`- **Allergies:** ${String(row.allergies).trim()}`);
  if (_rowHas(row.provocation)) parts.push(`- **Triggers / what makes it worse:** ${String(row.provocation).trim()}`);
  if (_rowHas(row.skin_type)) parts.push(`- **Skin type:** ${String(row.skin_type).trim()}`);
  const sc = row.skin_concerns_json;
  if (Array.isArray(sc) && sc.length) {
    parts.push(`- **Concerns (structured):** ${sc.join(', ')}`);
  }
  if (_rowHas(row.pregnancy_status)) {
    parts.push(`- **Pregnancy / breastfeeding:** ${String(row.pregnancy_status).trim()}`);
  }
  const pd = row.prior_dermatologist_json;
  if (pd && typeof pd === 'object' && (pd.seen === true || pd.seen === false)) {
    const note = pd.note ? ` (${String(pd.note).trim()})` : '';
    parts.push(`- **Seen dermatologist for this:** ${pd.seen ? 'Yes' : 'No'}${note}`);
  }
  if (row.functional_impact != null && String(row.functional_impact).trim() !== '') {
    parts.push(`- **Impact on daily life (1–5):** ${String(row.functional_impact).trim()}`);
  }
  if (_rowHas(row.ingredient_reactions)) {
    parts.push(`- **Ingredient / product reactions:** ${String(row.ingredient_reactions).trim()}`);
  }
  if (_rowHas(row.what_has_worked)) {
    parts.push(`- **What has worked before:** ${String(row.what_has_worked).trim()}`);
  }
  if (_rowHas(row.hormonal_context)) {
    parts.push(`- **Hormonal / life-stage context:** ${String(row.hormonal_context).trim()}`);
  }
  if (_rowHas(row.lifestyle_notes)) {
    parts.push(`- **Lifestyle:** ${String(row.lifestyle_notes).trim()}`);
  }
  if (_rowHas(row.environment_notes)) {
    parts.push(`- **Environment:** ${String(row.environment_notes).trim()}`);
  }
  const tr = row.triggers_json;
  if (Array.isArray(tr) && tr.length) {
    parts.push(`- **Triggers (structured):** ${tr.join(', ')}`);
  }
  const mr = row.media_received === 1 || row.media_received === true;
  const mediaIds = row.media_ids;
  const mediaCount = Array.isArray(mediaIds) ? mediaIds.length : 0;
  if (row.media_requested || mr || mediaCount > 0) {
    const bits = [];
    if (mr) bits.push('Received');
    else if (row.media_requested) bits.push('Upload requested / pending');
    if (mediaCount > 0) bits.push(`${mediaCount} file reference(s) on file`);
    parts.push(`- **Photos / uploads:** ${bits.join(' — ') || 'None'}`);
  }
  const hm = extras?.hardMissing;
  if (Array.isArray(hm) && hm.length) {
    parts.push(`- **Still needed (server):** ${hm.join(', ')}`);
  }
  const sg = extras?.softGaps;
  if (Array.isArray(sg) && sg.length) {
    parts.push(`- **Nice to clarify if time:** ${sg.join(', ')}`);
  }
  if (!parts.length) return '';
  return `## INTAKE / TRIAGE SO FAR (stored — do not re-ask unless clarifying)\n${parts.join('\n')}`;
}

module.exports = {
  phasePromptsEnabled,
  buildSharedSafetyBlock,
  buildPhasePrompt,
  buildKellySystemPrompt,
  formatRoutineIntakeSummaryFromTriageRow,
  phaseIntroLine
};
