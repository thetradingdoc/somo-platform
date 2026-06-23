#!/usr/bin/env node
'use strict';

/**
 * Compare voice_agent_settings greeting vs call_opener_used for a session.
 *
 * Usage:
 *   SESSION_ID=call_xxx DB_PATH=<db> node scripts/verify/verify-call-opener-parity.cjs
 */

const {
  requireSessionId,
  openReadonlyDb,
  resolveDbPath,
  fetchKellyEvents,
  parsePayload,
  printReportAndExit
} = require('./verify-live-shared');

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function main() {
  const sessionId = requireSessionId('scripts/verify/verify-call-opener-parity.cjs');
  const dbPath = resolveDbPath();
  const db = openReadonlyDb(dbPath);
  const events = fetchKellyEvents(db, sessionId);

  const openerEvent = events.find((e) => e.event_type === 'call_opener_used');
  const openerPayload = parsePayload(openerEvent);
  const openerText = openerPayload.opener_text || openerPayload.greeting || '';

  const customerId = openerPayload.customer_id || null;
  let settingsGreeting = null;
  let merchantId = null;

  if (customerId) {
    const customer = db.prepare('SELECT merchant_id FROM customers WHERE id = ?').get(customerId);
    merchantId = customer?.merchant_id || null;
    const settingsRow = merchantId
      ? db.prepare('SELECT greeting FROM voice_agent_settings WHERE merchant_id = ?').get(merchantId)
      : db.prepare('SELECT greeting FROM voice_agent_settings WHERE customer_id = ?').get(customerId);
    settingsGreeting = settingsRow?.greeting || null;
  }

  const normOpener = normalizeText(openerText);
  const normSettings = normalizeText(settingsGreeting);
  const parity =
    normOpener && normSettings && (normOpener === normSettings || normOpener.includes(normSettings.slice(0, 40)));

  printReportAndExit({
    session_id: sessionId,
    db_path: dbPath,
    customer_id: customerId,
    merchant_id: merchantId,
    call_opener_used: openerText || null,
    voice_agent_settings_greeting: settingsGreeting,
    parity,
    pass: !!openerEvent && parity
  });
}

main();
