'use strict';

const HANDOFF_STEPS = ['offer', 'attempt', 'failed_retry', 'message_taken', 'resume'];

async function handleHandoffSubrail(ctx = {}) {
  const step = ctx.handoff_step || ctx.active_subrail_step || 'offer';
  const msg = String(ctx.message || '').toLowerCase();
  const retryCount = ctx.handoff_retry_count || 0;

  const contextPayload = {
    conversation_mode: ctx.conversation_mode,
    billing_step: ctx.billing_step,
    appointment_id: ctx.cancellation_context?.appointment_id || ctx.appointment_id,
    active_subrail: ctx.active_subrail
  };

  if (step === 'attempt' && /unavailable|no answer|can't connect|not available/.test(msg)) {
    if (retryCount < 1) {
      return {
        reply:
          'Our team is not available right now. I can take a message and have someone call you back. What is the best callback number?',
        handoff_step: 'failed_retry',
        handoff_retry_count: retryCount + 1,
        disposition: 'handoff_failed',
        state_updates: { handoff_failed: true },
        context_payload: contextPayload
      };
    }
    return {
      reply:
        'I apologize — our team is unavailable at the moment. I have taken your message and someone will call you back. Is there anything else I can help with in the meantime?',
      handoff_step: 'message_taken',
      disposition: 'handoff_failed',
      flags: { handoff_failed: true, pending_human_handoff: true },
      context_payload: contextPayload
    };
  }

  if (/continue|keep going|never mind|actually|wait/.test(msg) && step !== 'offer') {
    return {
      reply: 'No problem — I am still here to help. What would you like to do?',
      active_subrail: null,
      handoff_step: 'resume',
      disposition: 'completed',
      flags: { pending_human_handoff: false },
      resume_automated_flow: true,
      context_payload: contextPayload
    };
  }

  if (/dispute|wrong charge|billing error|overcharged/.test(msg)) {
    return {
      reply:
        'I understand you have a billing concern. Let me connect you with our billing team who can review your account.',
      handoff_step: 'attempt',
      disposition: 'handoff_requested',
      flags: { pending_human_handoff: true, billing_dispute: true },
      context_payload: contextPayload,
      active_subrail: 'handoff'
    };
  }

  return {
    reply: 'I am connecting you with a team member now. One moment please.',
    handoff_step: 'attempt',
    active_subrail: 'handoff',
    disposition: 'handoff_requested',
    flags: { pending_human_handoff: true },
    context_payload: contextPayload
  };
}

module.exports = { handleHandoffSubrail, HANDOFF_STEPS };
