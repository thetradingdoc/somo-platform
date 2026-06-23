'use strict';

const HANDOFF_STEPS = ['offer', 'attempt', 'failed_retry', 'message_taken', 'resume'];
const HANDOFF_RETRY_CEILING = 2;

function emitHandoffEvent(db, sessionId, eventType, payload = {}) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: sessionId || null,
      event_type: eventType,
      payload_json: payload
    });
  } catch (_) {}
}

function callbackOfferReply(locale = 'en') {
  if (locale === 'es') {
    return 'Nuestro equipo no está disponible en este momento. Puedo tomar un mensaje y alguien le devolverá la llamada. ¿Cuál es el mejor número para contactarle?';
  }
  if (locale === 'zh') {
    return '我们的团队目前无法接听。我可以记录留言并安排回电。请问最佳联系电话是多少？';
  }
  return 'Our team is not available right now. I can take a message and have someone call you back. What is the best callback number?';
}

function exhaustedReply(locale = 'en') {
  if (locale === 'es') {
    return 'Lo siento — no pude conectarle con nuestro equipo después de varios intentos. He registrado su solicitud y le llamaremos lo antes posible.';
  }
  if (locale === 'zh') {
    return '抱歉，多次尝试后仍无法为您转接人工。我已记录您的请求，我们会尽快回电。';
  }
  return 'I apologize — I could not reach our team after several attempts. I have logged your request and someone will call you back as soon as possible.';
}

async function handleHandoffSubrail(ctx = {}) {
  const step = ctx.handoff_step || ctx.active_subrail_step || 'offer';
  const msg = String(ctx.message || '').toLowerCase();
  const retryCount = ctx.handoff_retry_count || 0;
  const locale = String(ctx.locale || ctx.preferredLanguage || 'en').slice(0, 2);
  const db = ctx.db || null;

  const contextPayload = {
    conversation_mode: ctx.conversation_mode,
    billing_step: ctx.billing_step,
    appointment_id: ctx.cancellation_context?.appointment_id || ctx.appointment_id,
    active_subrail: ctx.active_subrail
  };

  const failedSignal = /unavailable|no answer|can't connect|not available|failed|didn't connect/.test(msg);

  if ((step === 'attempt' || step === 'failed_retry') && failedSignal) {
    const nextRetry = retryCount + 1;
    emitHandoffEvent(db, ctx.sessionId, 'handoff_recovery', {
      handoff_retry_count: nextRetry,
      handoff_step: step
    });

    if (nextRetry < HANDOFF_RETRY_CEILING) {
      return {
        reply: callbackOfferReply(locale),
        handoff_step: 'failed_retry',
        handoff_retry_count: nextRetry,
        disposition: 'handoff_failed',
        state_updates: { handoff_failed: true, handoff_retry_count: nextRetry },
        context_payload: contextPayload
      };
    }

    emitHandoffEvent(db, ctx.sessionId, 'handoff_exhausted', {
      handoff_retry_count: nextRetry,
      ceiling: HANDOFF_RETRY_CEILING
    });
    return {
      reply: exhaustedReply(locale),
      handoff_step: 'message_taken',
      handoff_retry_count: nextRetry,
      disposition: 'handoff_failed',
      state_updates: { handoff_failed: true, handoff_exhausted: true, handoff_retry_count: nextRetry },
      flags: { handoff_failed: true, handoff_exhausted: true, pending_human_handoff: true },
      context_payload: contextPayload
    };
  }

  if (/continue|keep going|never mind|actually|wait/.test(msg) && step !== 'offer') {
    return {
      reply: 'No problem — I am still here to help. What would you like to do?',
      active_subrail: null,
      handoff_step: 'resume',
      disposition: 'completed',
      flags: { pending_human_handoff: false, handoff_exhausted: false },
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

module.exports = { handleHandoffSubrail, HANDOFF_STEPS, HANDOFF_RETRY_CEILING };
