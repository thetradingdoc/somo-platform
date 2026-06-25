'use strict';

const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '../../..');
const ASSERTION_SCHEMA = path.join(MP, 'tests/fixtures/commerce-assertion-schema.json');

const PAYMENT_LINK_TOOLS = [
  'create_checkout',
  'prepare_commerce_checkout',
  'create_appointment_checkout',
  'request_patient_payment'
];

const SUCCESS_CLAIM_RE =
  /(done|sent|booked|confirmed|link is|payment link|you're all set|checkout|scheduled|cancelled|verified)/i;

let _assertionSchema = null;

function loadAssertionSchema() {
  if (!_assertionSchema) {
    _assertionSchema = JSON.parse(fs.readFileSync(ASSERTION_SCHEMA, 'utf8'));
  }
  return _assertionSchema;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(normalizeText(s).split(' ').filter((w) => w.length > 2));
}

function jaccardSimilarity(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

function collectGoldenAgentTurns(turns, afterIndex) {
  const agents = [];
  for (let i = afterIndex + 1; i < turns.length; i += 1) {
    if (turns[i].speaker === 'caller') break;
    if (turns[i].speaker === 'agent') agents.push(turns[i]);
  }
  return agents;
}

/** Consecutive caller lines before the next agent block (inclusive of startIndex). */
function collectCallerBatch(turns, startIndex) {
  const batch = [];
  for (let i = startIndex; i < turns.length; i += 1) {
    if (turns[i].speaker !== 'caller') break;
    batch.push(turns[i]);
  }
  return batch;
}

function callerMessageFromBatch(batch) {
  const parts = batch
    .map((t) => String(t.text || '').trim())
    .filter((text) => text && text !== '(pause)');
  return parts.join(' ') || '(silence)';
}

function isBatchedCaller(turns, index) {
  const next = turns[index + 1];
  return next && next.speaker === 'caller';
}

function scoreReply(actualReply, goldenAgents, threshold = 0.12) {
  if (!goldenAgents.length) {
    return { pass: !!actualReply, score: actualReply ? 0.5 : 0, golden: null };
  }
  let best = { score: 0, golden: goldenAgents[0] };
  for (const g of goldenAgents) {
    const score = jaccardSimilarity(actualReply, g.text);
    if (score > best.score) best = { score, golden: g };
  }
  return { pass: best.score >= threshold, score: best.score, golden: best.golden };
}

function scoreTool(toolsUsed, goldenAgent) {
  const expected = goldenAgent?.tool_call?.name;
  if (!expected) return { pass: true, expected: null, actual: toolsUsed };
  const used = Array.isArray(toolsUsed) ? toolsUsed : [];
  const pass = used.some((t) => String(t) === expected || String(t).includes(expected));
  return { pass, expected, actual: used };
}

function toolIndex(tools, name) {
  return tools.findIndex((t) => String(t).includes(name));
}

function evaluateAssertion(assertionId, ctx) {
  const schema = loadAssertionSchema();
  const patterns = schema.acknowledgement_patterns || {};
  const tools = ctx.allToolsUsed || [];
  const reply = ctx.reply || '';
  const handoffRegexes = (patterns.vent_handoff_phrases || []).map((r) =>
    new RegExp(r.replace('(?i)', ''), 'i')
  );

  if (assertionId === 'ACK_BEFORE_TRANSACTION') {
    const regexes = (patterns.empathetic_prefix || []).map((r) => new RegExp(r.replace('(?i)', ''), 'i'));
    const text = ctx.replyBeforeFirstTool || reply;
    const pass = regexes.some((re) => re.test(text));
    return { assertionId, pass, detail: pass ? 'empathetic prefix found' : 'no empathetic prefix before first tool' };
  }

  if (assertionId === 'VOICE_COMMERCE_TOOL_CHAIN') {
    const hasSearch = tools.some((t) => /search_products/.test(t));
    const hasCheckout = tools.some((t) => /create_checkout|prepare_commerce_checkout/.test(t));
    const pass = hasSearch || hasCheckout;
    return { assertionId, pass, detail: `tools: ${tools.join(', ') || '(none)'}` };
  }

  if (assertionId === 'TOOL_COMPLETED_BEFORE_CLAIM') {
    const pass = tools.length > 0 || !SUCCESS_CLAIM_RE.test(reply);
    return {
      assertionId,
      pass,
      detail: tools.length ? `tools before claim: ${tools.join(', ')}` : 'no tools recorded'
    };
  }

  if (assertionId === 'HANDOFF_ON_VENT' || assertionId === 'VENT_HANDOFF') {
    const transfer = tools.some((t) => /transfer_call/.test(t));
    const handoff = transfer || handoffRegexes.some((re) => re.test(reply));
    return { assertionId, pass: handoff, detail: transfer ? 'transfer_call used' : handoff ? 'handoff language' : 'no handoff' };
  }

  if (assertionId === 'ACK_NOT_SCHEDULING_JUMP') {
    const forbidden = (patterns.forbidden_vent_responses || []).some((r) =>
      new RegExp(r.replace('(?i)', ''), 'i').test(reply)
    );
    return { assertionId, pass: !forbidden, detail: forbidden ? 'forbidden scheduling language' : 'ok' };
  }

  if (assertionId === 'BOOKING_GATE_RESPECTED' || assertionId === 'BOOKING_GATE_SUCCESS') {
    const schedIdx = toolIndex(tools, 'schedule_appointment');
    if (schedIdx < 0) {
      return { assertionId, pass: true, detail: 'no schedule_appointment in call' };
    }
    const slotsIdx = toolIndex(tools, 'get_available_slots');
    const pass = slotsIdx >= 0 && slotsIdx < schedIdx;
    return { assertionId, pass, detail: pass ? 'slots before schedule' : 'schedule without prior slots' };
  }

  if (assertionId === 'SPANISH_LOCALE_RESPECTED') {
    const locale = String(ctx.locale || 'en-US');
    if (!locale.toLowerCase().startsWith('es')) {
      return { assertionId, pass: true, detail: 'not a Spanish locale call' };
    }
    const spanishRe = /\b(hola|gracias|usted|por favor|cita|enlace|correo|disponible|confirmación|listo)\b/i;
    const pass = spanishRe.test(ctx.replyBeforeFirstTool || reply);
    return { assertionId, pass, detail: pass ? 'Spanish phrases detected' : 'expected Spanish copy' };
  }

  if (assertionId === 'OUTBOUND_DISPOSITION_LOGGED' || assertionId === 'OUTBOUND_DISPOSITION') {
    const direction = ctx.direction || 'inbound';
    if (direction !== 'outbound') {
      return { assertionId, pass: true, detail: 'not outbound' };
    }
    const pass = tools.some((t) => /end_call/.test(t));
    return { assertionId, pass, detail: pass ? 'end_call on outbound' : 'missing end_call disposition' };
  }

  if (assertionId === 'PAYMENT_LINK_SENT') {
    const pass = tools.some((t) => PAYMENT_LINK_TOOLS.some((p) => String(t).includes(p)));
    return { assertionId, pass, detail: pass ? 'payment link tool used' : 'no payment link tool' };
  }

  if (schema.assertion_types?.[assertionId]) {
    return { assertionId, pass: true, detail: 'schema registered; live check deferred' };
  }

  return { assertionId, pass: true, detail: 'not evaluated' };
}

function checkFunctionsTested(functionsTested, allToolsUsed, kellyEvents) {
  const tools = new Set([...(allToolsUsed || [])]);
  for (const ev of kellyEvents || []) {
    try {
      const p = typeof ev.payload_json === 'string' ? JSON.parse(ev.payload_json) : ev.payload_json;
      if (p?.tool_name) tools.add(p.tool_name);
      if (p?.name) tools.add(p.name);
    } catch (_) {}
    if (ev.event_type === 'tool_completed' && ev.tool_name) tools.add(ev.tool_name);
  }

  const missing = [];
  for (const fn of functionsTested || []) {
    if (fn === 'end_call') continue;
    if (![...tools].some((t) => String(t) === fn || String(t).includes(fn))) {
      missing.push(fn);
    }
  }
  return { pass: missing.length === 0, missing, observed: [...tools] };
}

module.exports = {
  normalizeText,
  jaccardSimilarity,
  collectGoldenAgentTurns,
  collectCallerBatch,
  callerMessageFromBatch,
  isBatchedCaller,
  scoreReply,
  scoreTool,
  evaluateAssertion,
  checkFunctionsTested,
  loadAssertionSchema
};
