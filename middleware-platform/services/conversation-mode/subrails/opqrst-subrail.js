'use strict';

const { OpqrstExitState, InconclusiveTriageAction } = require('../opqrst-exit-states');
const { Subrail } = require('../conversation-mode-types');
const {
  mergeAccumulator,
  applyFieldUtterance,
  OPQRST_FIELDS,
  FIELD_KEYS
} = require('../opqrst-accumulator');

const FIELD_LABELS = {
  O: 'When did this start?',
  P: 'What makes it better or worse?',
  Q: 'Can you describe the quality — sharp, dull, itchy, burning?',
  R: 'Where exactly is it located?',
  S: 'On a scale of 1 to 10, how severe is it?',
  T: 'Have you had this before, or is anything else going on?'
};

function nextMissingField(accumulator = {}) {
  for (const f of OPQRST_FIELDS) {
    const key = FIELD_KEYS[f];
    if (!accumulator[f] && !accumulator[key]) return f;
  }
  return null;
}

function assessExit(accumulator, policy = {}) {
  const filled = OPQRST_FIELDS.filter((f) => accumulator[f] || accumulator[FIELD_KEYS[f]]).length;
  if (filled < 3) {
    return OpqrstExitState.INCONCLUSIVE_TRIAGE;
  }
  if (accumulator.rich_intake?.emergency_risk) {
    return OpqrstExitState.COMPLETED_ESCALATE;
  }
  if (accumulator.rich_intake?.referral_needed) {
    return OpqrstExitState.COMPLETED_REFER;
  }
  if (filled >= 4) {
    return OpqrstExitState.COMPLETED_BOOK;
  }
  return OpqrstExitState.INCOMPLETE_HOLD;
}

function inconclusiveActionReply(action) {
  switch (action) {
    case InconclusiveTriageAction.NURSE_CALLBACK:
      return 'I want to make sure you get the right care. A nurse will call you back shortly to follow up.';
    case InconclusiveTriageAction.HANDOFF:
      return 'Let me connect you with our care team to make sure we understand your symptoms fully.';
  }
  return 'Based on what you have shared, I can schedule a general visit for you. Would you like me to find an opening?';
}

async function handleOpqrstSubrail(ctx = {}) {
  const acc = mergeAccumulator(ctx.opqrst_accumulator || {});
  const msg = String(ctx.message || '').trim();
  const policy = ctx.tenantPolicy || {};
  const field = ctx.opqrst_current_field || nextMissingField(acc);

  if (field && msg) {
    Object.assign(acc, applyFieldUtterance(acc, field, msg));
  }

  const nextField = nextMissingField(acc);
  const stateUpdates = { opqrst_accumulator: acc, active_subrail: 'opqrst' };

  if (nextField) {
    return {
      reply: FIELD_LABELS[nextField],
      active_subrail: 'opqrst',
      opqrst_current_field: nextField,
      state_updates: stateUpdates,
      toolsUsed: ['store_triage_opqrst'],
      use_kelly: true
    };
  }

  const exitState = assessExit(acc, policy);
  stateUpdates.opqrst_exit_state = exitState;

  if (exitState === OpqrstExitState.COMPLETED_ESCALATE) {
    return {
      reply: 'Based on your symptoms, I need to connect you with urgent care support right away.',
      conversation_mode: 'emergency_safety',
      active_subrail: Subrail.HANDOFF,
      disposition: 'emergency_redirect',
      state_updates: stateUpdates,
      flags: { safety_blocked: true }
    };
  }

  if (exitState === OpqrstExitState.COMPLETED_REFER) {
    return {
      reply: 'I recommend speaking with a clinician about this. Let me connect you now.',
      active_subrail: Subrail.HANDOFF,
      disposition: 'handoff_requested',
      state_updates: stateUpdates,
      flags: { pending_human_handoff: true }
    };
  }

  if (exitState === OpqrstExitState.INCONCLUSIVE_TRIAGE) {
    const action = policy.inconclusive_triage_action || InconclusiveTriageAction.BOOK_GENERAL;
    stateUpdates.triage_inconclusive = true;
    if (action === InconclusiveTriageAction.BOOK_GENERAL) {
      return {
        reply: inconclusiveActionReply(action),
        active_subrail: Subrail.BOOKING,
        active_subrail_step: 'intent_confirm',
        disposition: 'triage_inconclusive',
        state_updates: { ...stateUpdates, active_subrail: Subrail.BOOKING },
        use_kelly: true
      };
    }
    return {
      reply: inconclusiveActionReply(action),
      active_subrail: action === InconclusiveTriageAction.HANDOFF ? Subrail.HANDOFF : null,
      disposition: 'triage_inconclusive',
      state_updates: stateUpdates,
      flags: { pending_human_handoff: action !== InconclusiveTriageAction.BOOK_GENERAL }
    };
  }

  if (exitState === OpqrstExitState.INCOMPLETE_HOLD) {
    return {
      reply:
        'Thank you for sharing that. I have noted your symptoms and a care team member will follow up with you shortly.',
      disposition: 'triage_pending',
      state_updates: stateUpdates
    };
  }

  return {
    reply: 'Thank you for sharing those details. Let me find an appointment time for you.',
    active_subrail: Subrail.BOOKING,
    active_subrail_step: 'intent_confirm',
    disposition: 'completed',
    state_updates: { ...stateUpdates, active_subrail: Subrail.BOOKING, triage_complete: true },
    use_kelly: true
  };
}

module.exports = {
  handleOpqrstSubrail,
  OPQRST_FIELDS,
  FIELD_LABELS,
  FIELD_KEYS,
  nextMissingField,
  assessExit,
  inconclusiveActionReply
};
