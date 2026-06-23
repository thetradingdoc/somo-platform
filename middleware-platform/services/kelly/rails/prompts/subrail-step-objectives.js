'use strict';

const STEP_OBJECTIVES = {
  'booking:intent_confirm': 'Confirm the patient wants to book and identify appointment type or specialty.',
  'booking:slot_lookup': 'Find available appointment slots and present clear options.',
  'booking:slot_select': 'Confirm which offered slot the patient prefers.',
  'booking:contact_confirm': 'Confirm patient contact details needed for booking.',
  'booking:schedule': 'Schedule the selected slot using tools — do not invent availability.',
  'booking:confirm': 'Confirm the chosen slot and complete booking with schedule_appointment.',
  'cancellation:find_booking': 'Find which appointment the patient means.',
  'cancellation:cancel_execute': 'Confirm and execute cancellation.',
  'opqrst:onset': 'Ask when symptoms started — one question only.',
  'opqrst:quality': 'Ask about symptom quality or description — one question only.',
  'opqrst:region': 'Ask where symptoms are located — one question only.',
  'copay_link:payment_start': 'Help the patient pay their copay with a secure payment link.'
};

function getStepObjective(subrail, step) {
  if (!subrail || !step) return 'Complete the current step in the active flow.';
  return STEP_OBJECTIVES[`${subrail}:${step}`] || `Complete the ${subrail} step: ${step}.`;
}

function subrailPromptBlock(state = {}) {
  const subrail = state.active_subrail || state.flags?.active_subrail;
  const step = state.active_subrail_step || state.flags?.active_subrail_step;
  if (!subrail) return '';
  const objective = getStepObjective(subrail, step);
  const localeBlock = localePromptBlock(state.locale, state);
  return (
    `\nSubrail: ${subrail}, step: ${step || 'unknown'}.\n` +
    `Objective: ${objective}\n` +
    'Do NOT ask questions outside this step. Do NOT mention unrelated services.' +
    localeBlock
  );
}

function localePromptBlock(locale, state = {}) {
  const sticky = state.flags?.preferred_language || state.preferred_language;
  const loc = String(sticky || locale || 'en').slice(0, 2);
  if (loc === 'en') return '';
  const names = { es: 'Spanish', zh: 'Chinese', pt: 'Portuguese', fr: 'French' };
  const label = names[loc] || loc;
  return (
    `\nIMPORTANT: You MUST respond in ${label} only. ` +
    `Never switch back to English during this call.`
  );
}

module.exports = { getStepObjective, subrailPromptBlock, localePromptBlock, STEP_OBJECTIVES };
