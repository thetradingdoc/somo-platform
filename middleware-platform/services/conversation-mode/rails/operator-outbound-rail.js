'use strict';

const OPERATOR_STAGES = ['callback_intro', 'update', 'confirm', 'handoff_offer', 'close'];

function loadAppointmentSummary(appointmentId) {
  if (!appointmentId) return null;
  try {
    const db = require('../../../database');
    const row = db.db
      ?.prepare(
        `SELECT appointment_type, specialty, appointment_date, date, appointment_time, time, patient_name
         FROM appointments WHERE id = ? OR appointment_id = ? LIMIT 1`
      )
      ?.get(appointmentId, appointmentId);
    if (!row) return null;
    const when = [row.appointment_date || row.date, row.appointment_time || row.time].filter(Boolean).join(' at ');
    return {
      type: row.appointment_type || row.specialty || 'appointment',
      when: when || 'soon',
      patientName: row.patient_name
    };
  } catch (_) {
    return null;
  }
}

function stageReply(stage, ctx) {
  const name = ctx.patientName || ctx.leadName || 'there';
  const isReminder = ctx.outbound_purpose === 'appointment_reminder' || !!ctx.appointment_id;
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
  let step = ctx.operator_stage || ctx.active_subrail_step || 'callback_intro';
  const apptSummary = loadAppointmentSummary(ctx.appointment_id);
  if (apptSummary) ctx._apptSummary = apptSummary;

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

  return {
    reply,
    endCall,
    toolsUsed: [],
    conversation_mode: 'operator_outbound',
    operator_stage: nextStage,
    active_subrail_step: nextStage
  };
}

module.exports = { handleOperatorOutboundTurn, OPERATOR_STAGES, stageReply };
