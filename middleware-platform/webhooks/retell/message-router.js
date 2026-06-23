'use strict';

/**
 * Kelly turn routing when voice-routing-world blocks or emergency applies.
 * Extracted from retell-websocket.js (Phase 4c).
 */

function resolveBlockedKellyTurn({ db, connection, userSaid, callId }) {
  const { shouldBlockKellyTurn } = require('../../services/voice/voice-routing-world');
  if (!shouldBlockKellyTurn(connection?.routing_world)) {
    return null;
  }

  try {
    const { getEmergencyResponseIfNeeded } = require('../../services/shared/emergency-safety');
    const locale =
      db?.getKellySessionLanguage?.(callId) || connection?.preferred_language || 'en';
    const emergency = getEmergencyResponseIfNeeded(userSaid, locale);
    if (emergency?.reply) {
      return {
        agentReply: emergency.reply,
        kellyResult: {
          reply: emergency.reply,
          blocked: true,
          routing_world: connection.routing_world,
          end_call: emergency.endCall
        },
        escalation: null
      };
    }
  } catch (_) {}

  const { attemptEscalation } = require('../../services/platform/escalation-service');
  const esc = attemptEscalation(db, {
    sessionId: callId,
    callId,
    reason: 'kelly_blocked',
    routing_world: connection.routing_world,
    clinic_id: connection.clinic_id,
    customer_id: connection.customer_id
  });
  const agentReply =
    esc.reply ||
    'Thanks for calling Somo. I am having trouble loading your account. Let me connect you with our team.';
  return {
    agentReply,
    kellyResult: {
      reply: agentReply,
      blocked: true,
      routing_world: connection.routing_world,
      transfer_number: esc.transfer_number || null,
      end_call: esc.end_call || false
    },
    escalation: esc
  };
}

module.exports = { resolveBlockedKellyTurn };
