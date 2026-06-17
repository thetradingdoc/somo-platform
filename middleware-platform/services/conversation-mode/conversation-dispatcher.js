'use strict';

const { ConversationMode, Subrail } = require('./conversation-mode-types');
const { shouldEnforceMode } = require('./config');
const { Handoff } = require('./handoff-types');
const { handleOutboundSalesTurn } = require('./rails/outbound-sales-rail');
const { handleOperatorOutboundTurn } = require('./rails/operator-outbound-rail');
const { handleEmergencyTurn } = require('./rails/emergency-rail');
const { handleSubrailTurn } = require('./subrails/subrail-router');

const MODE_SAFE_FALLBACK = {
  [ConversationMode.DEMO_QUAL]:
    'Thanks for trying Somo. I can help you learn about our product demo features.',
  [ConversationMode.OUTBOUND_SALES]:
    'Thanks for your time. I wanted to share how Somo helps clinics with patient communication.',
  [ConversationMode.OPERATOR_OUTBOUND]:
    'I am calling with an update from Somo. How can I help you today?',
  [ConversationMode.TENANT_INBOUND_ADMIN]:
    'I can help with scheduling, billing questions, or general inquiries. What do you need?',
  [ConversationMode.TENANT_INBOUND_CLINICAL]:
    'I can help understand your symptoms and get you the right care. What is going on?',
  [ConversationMode.TENANT_BILLING]:
    'I can help with your copay or balance. Let me look that up for you.',
  [ConversationMode.TENANT_RECORDS]:
    'I can help with questions about your medical records.',
  [ConversationMode.EMERGENCY_SAFETY]:
    'This sounds urgent. I am connecting you with emergency support right away. If this is a life-threatening emergency, please hang up and call 911.'
};

/**
 * Top-level mode dispatch — routes turn to correct rail handler.
 */
async function dispatchConversationTurn(mode, ctx = {}) {
  const enforced = shouldEnforceMode(mode);

  if (mode === ConversationMode.EMERGENCY_SAFETY) {
    const out = await handleEmergencyTurn(ctx);
    return { ...out, handoff: Handoff.SCRIPT_ONLY, conversation_mode: mode, enforced };
  }

  if (mode === ConversationMode.OUTBOUND_SALES) {
    const out = await handleOutboundSalesTurn(ctx);
    return { ...out, handoff: Handoff.SCRIPT_ONLY, conversation_mode: mode, enforced };
  }

  if (mode === ConversationMode.OPERATOR_OUTBOUND) {
    const out = await handleOperatorOutboundTurn(ctx);
    return { ...out, handoff: Handoff.SCRIPT_ONLY, conversation_mode: mode, enforced };
  }

  if (mode === ConversationMode.DEMO_QUAL) {
    if (enforced) {
      return {
        reply: MODE_SAFE_FALLBACK[ConversationMode.TENANT_INBOUND_ADMIN],
        endCall: false,
        toolsUsed: [],
        conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN,
        handoff: Handoff.KELLY_REQUIRED,
        kelly_lane_hint: 'booking',
        enforced
      };
    }
    return {
      reply: MODE_SAFE_FALLBACK[ConversationMode.DEMO_QUAL],
      endCall: false,
      toolsUsed: [],
      conversation_mode: mode,
      handoff: Handoff.SCRIPT_ONLY,
      enforced
    };
  }

  if (ctx.active_subrail) {
    const subrailOut = await handleSubrailTurn(ctx.active_subrail, ctx);
    if (subrailOut) {
      return {
        ...subrailOut,
        conversation_mode: mode,
        enforced,
        handoff: subrailOut.handoff || Handoff.KELLY_OPTIONAL,
        kelly_lane_hint: subrailOut.kelly_lane_hint || modeToKellyLane(mode, ctx.active_subrail)
      };
    }
  }

  if (
    mode === ConversationMode.TENANT_BILLING ||
    mode === ConversationMode.TENANT_RECORDS ||
    mode === ConversationMode.TENANT_INBOUND_ADMIN ||
    mode === ConversationMode.TENANT_INBOUND_CLINICAL
  ) {
    return {
      handoff: Handoff.KELLY_REQUIRED,
      conversation_mode: mode,
      active_subrail: ctx.active_subrail || null,
      enforced,
      kelly_lane_hint: modeToKellyLane(mode, ctx.active_subrail)
    };
  }

  return {
    reply: MODE_SAFE_FALLBACK[mode] || MODE_SAFE_FALLBACK[ConversationMode.TENANT_INBOUND_ADMIN],
    endCall: false,
    toolsUsed: [],
    conversation_mode: mode,
    handoff: Handoff.SCRIPT_ONLY,
    enforced
  };
}

function modeToKellyLane(mode, subrail) {
  if (subrail === Subrail.BOOKING) return 'booking';
  if (subrail === Subrail.CANCELLATION) return 'reschedule';
  if (subrail === Subrail.OPQRST) return 'clinical';
  if (subrail === Subrail.COPAY_LINK || mode === ConversationMode.TENANT_BILLING) return 'payment';
  if (subrail === Subrail.RECORDS_QA || mode === ConversationMode.TENANT_RECORDS) return 'records';
  if (mode === ConversationMode.TENANT_INBOUND_CLINICAL) return 'clinical';
  return 'basic_intake';
}

function getModeSafeFallback(mode) {
  return MODE_SAFE_FALLBACK[mode] || MODE_SAFE_FALLBACK[ConversationMode.TENANT_INBOUND_ADMIN];
}

module.exports = {
  dispatchConversationTurn,
  modeToKellyLane,
  getModeSafeFallback,
  MODE_SAFE_FALLBACK
};
