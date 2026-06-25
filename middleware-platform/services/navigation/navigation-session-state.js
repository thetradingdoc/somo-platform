'use strict';

function defaultState() {
  return {
    payor_entity_id: null,
    payer_id: null,
    plan_display_name: null,
    zip: null,
    region: null,
    last_specialty: null,
    last_providers: [],
    selected_provider_id: null,
    selected_slot: null,
    appointment_id: null,
    member_id: null,
    employer_id: null,
    flow_stage: 'greeting'
  };
}

function getState(connection) {
  if (!connection._navigationState) {
    connection._navigationState = defaultState();
  }
  return connection._navigationState;
}

function mergeState(connection, patch) {
  const state = getState(connection);
  Object.assign(state, patch);
  connection._navigationState = state;
  return state;
}

function emitNavigationEvent(db, callId, eventType, payload = {}) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: callId,
      call_id: callId,
      event_type: 'navigation_event',
      payload_json: { event: eventType, ...payload }
    });
  } catch (_) {}
}

function emitToolEvent(db, callId, phase, toolName, payload = {}) {
  try {
    db?.insertKellyCallEvent?.({
      session_id: callId,
      call_id: callId,
      event_type: phase === 'completed' ? 'tool_completed' : 'tool_invoked',
      payload_json: { tool_name: toolName, routing_world: 'navigation', ...payload }
    });
  } catch (_) {}
}

module.exports = {
  defaultState,
  getState,
  mergeState,
  emitNavigationEvent,
  emitToolEvent
};
