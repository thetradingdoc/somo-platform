'use strict';

const { CALL_TYPE_CONSUMER_NAVIGATION } = require('../services/voice-call-context');
const { ROUTING_WORLD_NAVIGATION } = require('../services/voice-routing-world');
const { isNavigationEnabled } = require('../services/navigation/navigation-config');
const { processNavigationTurn } = require('../services/navigation/navigation-orchestrator');
const { executeNavigationTool, isNavigationTool } = require('../services/navigation/navigation-tool-executor');

const NAVIGATION_GREETING = "Hi, I'm Kelly. How can I help you today?";

function getCallType(connection) {
  const meta = connection.callMetadata || {};
  const dv =
    meta.dynamic_variables ||
    meta.retell_llm_dynamic_variables ||
    (meta.metadata && meta.metadata.dynamic_variables) ||
    {};
  return (
    meta.metadata?.call_type ||
    dv.call_type ||
    connection.call_type ||
    connection._navigationCallType ||
    null
  );
}

function isNavigationConnection(connection) {
  if (!isNavigationEnabled()) return false;
  if (!connection) return false;
  if (connection._isNavigationConnection === true) return true;
  if (connection._isNavigationConnection === false) return false;

  if (connection.routing_world === ROUTING_WORLD_NAVIGATION) {
    connection._isNavigationConnection = true;
    connection._navigationCallType = CALL_TYPE_CONSUMER_NAVIGATION;
    return true;
  }

  const callType = getCallType(connection);
  if (callType === CALL_TYPE_CONSUMER_NAVIGATION) {
    connection._isNavigationConnection = true;
    connection._navigationCallType = CALL_TYPE_CONSUMER_NAVIGATION;
    return true;
  }

  const meta = connection.callMetadata || {};
  const dv =
    meta.dynamic_variables ||
    meta.retell_llm_dynamic_variables ||
    (meta.metadata && meta.metadata.dynamic_variables) ||
    {};
  const customerType =
    meta.metadata?.customer_type || dv.customer_type || connection.customer_type || null;
  if (String(customerType || '').toLowerCase() === 'navigation') {
    connection._isNavigationConnection = true;
    connection._navigationCallType = CALL_TYPE_CONSUMER_NAVIGATION;
    return true;
  }

  connection._isNavigationConnection = false;
  return false;
}

function emitNavigationTrace(db, callId, payload) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: callId,
      call_id: callId,
      event_type: 'orchestration_trace',
      payload_json: { runtime: 'navigation_handler_v1', ...payload }
    });
  } catch (_) {}
}

function sendFunctionResponse(ws, functionCall, result) {
  if (!ws) return;
  ws.send(
    JSON.stringify({
      type: 'function_call_response',
      function_call_id: functionCall.id || functionCall.function_call_id,
      result
    })
  );
}

function sendNavigationInitialGreeting(callId, connection, callMeta, responseId, sendFn) {
  if (!connection || connection.sentInitialGreeting) return;
  if (!isNavigationEnabled()) {
    sendFn(connection.ws, 'Navigation is temporarily unavailable.', responseId);
    return;
  }
  sendFn(connection.ws, NAVIGATION_GREETING, responseId);
  connection.sentInitialGreeting = true;
  connection.conversation_mode = 'navigation_member';
  connection.routing_world = ROUTING_WORLD_NAVIGATION;
  connection.awaitingName = false;
  connection.conversationHistory.push({
    role: 'assistant',
    content: NAVIGATION_GREETING,
    timestamp: Date.now()
  });
  emitNavigationTrace(connection._db, callId, { stage: 'greeting' });
}

async function handleNavigationTranscript(callId, connection, userSaid, message, sendFn) {
  if (!isNavigationEnabled()) {
    sendFn(connection.ws, 'Navigation is temporarily unavailable. Please try again later.', message.response_id);
    return;
  }
  const reply = await processNavigationTurn({
    callId,
    connection,
    userSaid,
    db: connection._db
  });
  sendFn(connection.ws, reply, message.response_id);
  connection.conversationHistory.push({
    role: 'assistant',
    content: reply,
    timestamp: Date.now()
  });
  emitNavigationTrace(connection._db, callId, {
    stage: 'transcript',
    user_excerpt: String(userSaid || '').slice(0, 120),
    navigation_state: connection._navigationState || null
  });
}

async function handleNavigationFunctionCall(callId, connection, message) {
  const functionCall = message.function_call || message;
  const name = functionCall.name;
  const args = functionCall.parameters || functionCall.arguments || {};
  if (!isNavigationTool(name)) {
    sendFunctionResponse(connection.ws, functionCall, {
      success: false,
      error: `Tool ${name} is not enabled on the navigation line.`
    });
    return;
  }
  const result = await executeNavigationTool(name, args, {
    db: connection._db,
    callId,
    clinicId: connection.clinic_id,
    customerId: connection.customer_id
  });
  sendFunctionResponse(connection.ws, functionCall, result);
}

async function handleNavigationMessage(callId, connection, message, opts) {
  const { sendRetellResponse, interactionType } = opts;
  const sendFn = sendRetellResponse;
  const callMeta = connection.callMetadata || {};

  if (!connection.sentInitialGreeting) {
    sendNavigationInitialGreeting(callId, connection, callMeta, message.response_id, sendFn);
    if (interactionType === 'response_required' && !message.transcript) {
      return true;
    }
  }

  if (interactionType === 'function_call') {
    await handleNavigationFunctionCall(callId, connection, message);
    return true;
  }

  if (interactionType === 'response_required' || interactionType === 'reminder_required') {
    let userSaid = null;
    if (Array.isArray(message.transcript)) {
      const last = [...message.transcript].reverse().find((t) => t?.role === 'user' && t?.content);
      userSaid = last?.content;
    } else if (message.transcript) {
      userSaid = message.transcript;
    }
    if (userSaid) {
      connection.conversationHistory.push({
        role: 'user',
        content: userSaid,
        timestamp: Date.now()
      });
      await handleNavigationTranscript(callId, connection, userSaid, message, sendFn);
    }
    return true;
  }

  return false;
}

module.exports = {
  NAVIGATION_GREETING,
  isNavigationConnection,
  sendNavigationInitialGreeting,
  handleNavigationMessage,
  handleNavigationTranscript,
  handleNavigationFunctionCall,
  getCallType
};
