'use strict';

const OPERATOR_STAGES = ['callback_intro', 'update', 'confirm', 'handoff_offer', 'close'];

function loadAppointmentSummary(appointmentId) {
  if (!appointmentId) return null;
  try {
    const dbModule = require('../../../database');
    const row = dbModule.db
      ?.prepare(
        `SELECT appointment_type, date, time, start_time, patient_name
         FROM appointments WHERE id = ? AND deleted_at IS NULL LIMIT 1`
      )
      ?.get(appointmentId);
    if (!row) return null;
    let time = String(row.time || '').trim();
    if (!time || time === '00:00' || time === '0:00') {
      if (row.start_time) {
        try {
          const d = new Date(row.start_time);
          if (!Number.isNaN(d.getTime())) {
            const hrs = d.getHours();
            const mins = String(d.getMinutes()).padStart(2, '0');
            if (hrs !== 0 || mins !== '00') {
              const h12 = hrs % 12 || 12;
              time = `${h12}:${mins}${hrs >= 12 ? ' PM' : ' AM'}`;
            }
          }
        } catch (_) {}
      }
      if (time === '00:00' || time === '0:00') time = '';
    }
    const when = [row.date, time].filter(Boolean).join(' at ');
    return {
      type: row.appointment_type || 'appointment',
      when: when || 'soon',
      patientName: row.patient_name
    };
  } catch (_) {
    return null;
  }
}

function isReminderContext(ctx = {}) {
  return (
    ctx.outbound_purpose === 'appointment_reminder' ||
    ctx.flags?.outbound_purpose === 'appointment_reminder' ||
    !!ctx.appointment_id ||
    !!ctx.appointmentId
  );
}

function stageReply(stage, ctx) {
  const name = ctx.patientName || ctx.leadName || 'there';
  const isReminder = isReminderContext(ctx);
  const appt = ctx._apptSummary;

  switch (stage) {
    case 'callback_intro':
      if (isReminder && appt) {
        return `Hi ${name}, this is Kelly calling with a reminder about your upcoming ${appt.type} appointment. Do you have a moment?`;
      }
      return `Hi ${name}, this is Kelly calling from Somo with a quick follow-up. Do you have a moment?`;
    case 'update':
      if (isReminder && appt) {
        return `I am calling to remind you about your ${appt.type} appointment${appt.when ? ` on ${appt.when}` : ''}. Will you still be able to make it?`;
      }
      return 'I wanted to share an update on your account. Is there anything specific you would like me to address?';
    case 'confirm':
      return 'Got it. I have noted that. Is there anything else I can help with today?';
    case 'handoff_offer':
      return 'If you would prefer to speak with someone on our team, I can arrange a callback. Would that help?';
    case 'close':
      return 'Thanks for your time. We will follow up if needed. Have a great day.';
    default:
      return 'How can I help you with your Somo account today?';
  }
}

async function handleOperatorOutboundTurn(ctx = {}) {
  const isReminder = isReminderContext(ctx);
  const appointmentId =
    ctx.appointment_id || ctx.appointmentId || ctx.flags?.appointment_id || null;
  ctx.outbound_purpose = ctx.outbound_purpose || ctx.flags?.outbound_purpose || null;

  if (isReminder && !appointmentId) {
    return {
      reply:
        'I am calling with an appointment reminder but I do not have your visit details loaded. I will have a team member follow up with you shortly.',
      endCall: false,
      conversation_mode: 'operator_outbound',
      operator_stage: 'handoff_offer',
      active_subrail: 'handoff',
      disposition: 'handoff_requested',
      flags: { pending_human_handoff: true, reminder_context_missing: true }
    };
  }

  let step = ctx.operator_stage || ctx.active_subrail_step || 'callback_intro';
  const apptSummary = loadAppointmentSummary(appointmentId);
  if (apptSummary) ctx._apptSummary = apptSummary;
  ctx.appointment_id = appointmentId;

  if (ctx.opener_delivered && step === 'callback_intro') {
    step = 'update';
  }

  const idx = OPERATOR_STAGES.indexOf(step);
  const nextStage = OPERATOR_STAGES[Math.min(idx + 1, OPERATOR_STAGES.length - 1)];
  const msg = String(ctx.message || '').toLowerCase();

  let reply = stageReply(step, ctx);
  let endCall = false;

  if (step === 'update' && ctx.opener_delivered && idx === 1 && !msg.trim()) {
    reply = apptSummary
      ? `Thanks for picking up. I wanted to confirm your ${apptSummary.type} appointment${apptSummary.when ? ` on ${apptSummary.when}` : ''}.`
      : 'Thanks for picking up. Is there anything you would like me to help with today?';
  }

  if (/speak to someone|human|callback|representative/.test(msg)) {
    reply =
      'I will have a team member call you back shortly. Is this the best number to reach you?';
    return {
      reply,
      endCall: false,
      toolsUsed: [],
      conversation_mode: 'operator_outbound',
      operator_stage: 'handoff_offer',
      active_subrail: 'handoff',
      disposition: 'handoff_requested'
    };
  }

  if (/no|nothing|all set|goodbye|bye|that's all|thank you/.test(msg) && idx >= 1) {
    reply = stageReply('close', ctx);
    endCall = true;
  }

  if (/cancel|reschedule|change my appointment|move my appointment/.test(msg)) {
    const isCancel = /cancel/.test(msg);
    return {
      reply: isCancel
        ? 'I can help you cancel that appointment. Let me pull up your visit details.'
        : 'I can help you reschedule. Let me pull up your visit details.',
      endCall: false,
      conversation_mode: 'tenant_inbound_admin',
      operator_stage: 'handoff_offer',
      active_subrail: isCancel ? 'cancellation' : 'cancellation',
      active_subrail_step: 'find_booking',
      disposition: isCancel ? 'cancel_requested' : 'reschedule_requested',
      kelly_lane_hint: 'reschedule',
      state_updates: {
        conversation_mode: 'tenant_inbound_admin',
        active_subrail: 'cancellation',
        active_subrail_step: 'find_booking',
        reschedule_pending: !isCancel,
        cancel_pending: isCancel,
        appointment_id: appointmentId || undefined,
        operator_outbound_pivot: true
      },
      toolsUsed: []
    };
  }

  const disposition = endCall
    ? isReminder
      ? 'reminder_delivered'
      : 'completed'
    : null;

  return {
    reply,
    endCall,
    conversation_mode: 'operator_outbound',
    operator_stage: nextStage,
    active_subrail_step: nextStage,
    disposition,
    state_updates: {
      operator_stage: nextStage,
      active_subrail_step: nextStage,
      appointment_id: appointmentId || undefined,
      outbound_purpose: ctx.outbound_purpose || undefined
    }
  };
}

module.exports = { handleOperatorOutboundTurn, OPERATOR_STAGES, stageReply };
