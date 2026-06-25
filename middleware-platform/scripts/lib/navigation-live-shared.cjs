#!/usr/bin/env node
'use strict';

const { parsePayload, fetchKellyEvents } = require('./verify-live-shared.cjs');
const { METRO_ENTITY_ID } = require('./lib/navigation-demo-config.cjs');

function findNavigationEvents(events, eventName) {
  return events.filter((e) => {
    if (e.event_type !== 'navigation_event') return false;
    const p = parsePayload(e);
    return p.event === eventName;
  });
}

function findToolEvents(events, toolName) {
  return events.filter((e) => {
    if (e.event_type !== 'tool_completed' && e.event_type !== 'tool_invoked') return false;
    const p = parsePayload(e);
    return String(p.tool_name || p.tool || '') === toolName;
  });
}

function hasNoClinicalBleed(events) {
  const opqrst = events.filter((e) => {
    if (e.event_type !== 'tool_completed' && e.event_type !== 'tool_invoked') return false;
    const p = parsePayload(e);
    return /store_triage_opqrst|run_triage_rag/.test(String(p.tool_name || p.tool || ''));
  });
  const kellyRails = events.filter((e) => {
    const p = parsePayload(e);
    return e.event_type === 'orchestration_trace' && p.runtime === 'kelly_rails_v2';
  });
  return { opqrst: opqrst.length, kellyRails: kellyRails.length, pass: opqrst.length === 0 && kellyRails.length === 0 };
}

function planResolvedPayload(events) {
  const row = findNavigationEvents(events, 'plan_resolved')[0];
  return row ? parsePayload(row) : null;
}

function assertMetroPlan(events) {
  const p = planResolvedPayload(events);
  return {
    pass: p?.payor_entity_id === METRO_ENTITY_ID,
    payload: p
  };
}

module.exports = {
  findNavigationEvents,
  findToolEvents,
  hasNoClinicalBleed,
  planResolvedPayload,
  assertMetroPlan,
  parsePayload,
  fetchKellyEvents
};
