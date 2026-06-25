'use strict';

const VOICE_COMMERCE_FNS = new Set([
  'search_products',
  'create_checkout',
  'get_order_tracking',
  'get_available_payment_methods',
  'verify_checkout_code'
]);

const BOOKING_FNS = new Set([
  'get_available_slots',
  'schedule_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'confirm_appointment',
  'search_appointments'
]);

const CHAT_COMMERCE_FNS = new Set([
  'get_product_quote',
  'add_to_cart',
  'get_cart',
  'update_cart_item',
  'remove_cart_item',
  'clear_cart',
  'send_commerce_verification_code',
  'verify_commerce_code',
  'save_shipping_address',
  'prepare_commerce_checkout'
]);

function classifyReplayRuntime(call) {
  const fns = call.functions_tested || [];
  const hasVoiceCommerce = fns.some((f) => VOICE_COMMERCE_FNS.has(f));
  const hasChatCommerce = call.channel === 'chat' && fns.some((f) => CHAT_COMMERCE_FNS.has(f));
  const hasBooking = fns.some((f) => BOOKING_FNS.has(f));

  if (hasChatCommerce) return 'chat_commerce';
  if (call.channel === 'voice' && hasVoiceCommerce && !hasBooking) return 'voice_commerce';
  if (call.channel === 'voice' && hasVoiceCommerce && hasBooking) return 'hybrid_booking_commerce';
  return 'kelly_rails';
}

async function ensureReplayClinic(db, clinicId, merchantId) {
  let clinic = await db.getClinicById?.(clinicId);
  if (clinic) {
    if (!clinic.merchant_id && db.updateClinic) {
      db.updateClinic(clinicId, { merchant_id: merchantId });
    }
    return clinic;
  }
  if (db.createClinic) {
    await db.createClinic({
      clinic_id: clinicId,
      name: 'Somo Supplements',
      slug: 'somo-supplements',
      phone_number: '+15550000000',
      merchant_id: merchantId,
      is_active: 1
    });
  }
  return db.getClinicById?.(clinicId);
}

function collectEventTools(db, sessionId) {
  return (db.listKellyCallEvents?.({ session_id: sessionId, limit: 200 }) || []).flatMap((ev) => {
    const names = [];
    if (ev.tool_name) names.push(ev.tool_name);
    try {
      const p = typeof ev.payload_json === 'string' ? JSON.parse(ev.payload_json) : ev.payload_json;
      if (p?.tool_name) names.push(p.tool_name);
      if (p?.name) names.push(p.name);
    } catch (_) {}
    return names;
  });
}

function mergeTurnTools(base, nudged, eventTools) {
  const merged = [...new Set([...(base.toolsUsed || []), ...nudged, ...eventTools])];
  base.toolsUsed = merged;
  return merged;
}

function markBookingDoneIfScheduled(db, sessionId, merged) {
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  if (merged.includes('schedule_appointment')) {
    KellyToolExecutor._setSessionMeta(sessionId, 'pstn_replay_booking_done', '1');
  }
}

async function seedReplaySession(db, sessionId, call, ctx) {
  const merchantId = call.call_metadata?.merchant_id || ctx.merchantId;
  const clinicId = call.call_metadata?.clinic_id || ctx.clinicId;
  await ensureReplayClinic(db, clinicId, merchantId);

  const { seedPriorOrder, seedKellyRailsSessionFromGolden } = require('./golden-seed.cjs');
  seedPriorOrder(db, call, merchantId);

  const runtime = classifyReplayRuntime(call);

  if (runtime === 'voice_commerce') {
    const { initRetellReplayConnection } = require('./retell-commerce-replay.cjs');
    const { getHandler } = require('./retell-commerce-replay.cjs');
    initRetellReplayConnection(getHandler(db), sessionId, call, { merchantId, clinicId });
    return;
  }

  const KellyAgentService = require('../../../services/kelly-agent-service');
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  const opener = (call.turns || []).find((t) => t.speaker === 'agent');
  if (opener?.text) {
    KellyAgentService._appendToHistory(sessionId, 'assistant', opener.text);
  }

  if (runtime === 'kelly_rails' || runtime === 'hybrid_booking_commerce') {
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_e2e_skip_triage', '1');
    await seedKellyRailsSessionFromGolden(db, sessionId, call);
    try {
      const { seedModeAtCallStart } = require('../../../services/conversation-mode/conversation-mode-session');
      seedModeAtCallStart({
        sessionId,
        clinicId,
        call_type: call.call_metadata?.call_type || 'tenant',
        direction: call.call_metadata?.direction || 'inbound',
        firstUtterance: (call.turns || []).find((t) => t.speaker === 'caller')?.text || '',
        tenantResolved: true,
        tenantPolicy: null
      });
    } catch (_) {}
  }
}

function normalizeTurnResult(result) {
  return {
    reply: String(result?.reply || ''),
    endCall: !!(result?.endCall || result?.end_call),
    toolsUsed: Array.isArray(result?.toolsUsed) ? result.toolsUsed : [],
    language: result?.language || 'en'
  };
}

function hybridBookingDone(db, sessionId) {
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  if (KellyToolExecutor._getSessionMeta(sessionId, 'pstn_replay_booking_done') === '1') {
    return true;
  }
  const eventTools = collectEventTools(db, sessionId);
  return eventTools.includes('schedule_appointment');
}

async function finishKellyRailsTurn(db, sessionId, base, nudged) {
  const KellyToolExecutor = require('../../../services/kelly-tool-executor');
  const eventTools = collectEventTools(db, sessionId);
  const merged = mergeTurnTools(base, nudged, eventTools);
  if (merged.includes('get_available_slots')) {
    KellyToolExecutor._setSessionMeta(sessionId, 'pstn_replay_slots_seen', '1');
  }
  markBookingDoneIfScheduled(db, sessionId, merged);
  return base;
}

async function runReplayTurn(opts) {
  const {
    sessionId,
    message,
    call,
    clinicId,
    merchantId,
    productId,
    callerPhone,
    preferredLanguage,
    turnIndex,
    db
  } = opts;

  const runtime = classifyReplayRuntime(call);
  const {
    extractGoldenHints,
    absorbCallerContext,
    seedBeforeCallerTurn
  } = require('./golden-seed.cjs');

  const hints = extractGoldenHints(call);

  if (runtime === 'voice_commerce') {
    const { runRetellVoiceCommerceTurn, getHandler } = require('./retell-commerce-replay.cjs');
    const handler = getHandler(db);
    const connection = handler.activeConnections.get(sessionId);
    if (connection) {
      absorbCallerContext(connection, message, hints);
      if (turnIndex >= 0) {
        await seedBeforeCallerTurn(db, call, turnIndex, sessionId, hints, connection);
      }
    }
    const result = await runRetellVoiceCommerceTurn({
      db,
      sessionId,
      message,
      call,
      clinicId,
      merchantId,
      preferredLanguage: preferredLanguage || call.call_metadata?.locale
    });
    return normalizeTurnResult(result);
  }

  if (runtime === 'chat_commerce') {
    const KellyAgentService = require('../../../services/kelly-agent-service');
    const { applyChatCommerceNudges } = require('./golden-seed.cjs');
    const connectionShim = { customerEmail: hints.checkout?.customer_email || null };
    absorbCallerContext(connectionShim, message, hints);
    if (turnIndex >= 0) {
      await seedBeforeCallerTurn(db, call, turnIndex, sessionId, hints, connectionShim);
    }

    const result = await KellyAgentService.processTurn({
      message,
      sessionId,
      channel: 'chat',
      clinicId,
      commerceCheckout: { productId, providerId: merchantId },
      preferredLanguage: preferredLanguage || call.call_metadata?.locale
    });
    const base = normalizeTurnResult(result);
    const nudged = await applyChatCommerceNudges({
      call,
      message,
      sessionId,
      clinicId,
      merchantId,
      toolsObserved: base.toolsUsed,
      connection: connectionShim
    });
    if (nudged.length) {
      base.toolsUsed = [...new Set([...base.toolsUsed, ...nudged])];
    }
    return base;
  }

  if (runtime === 'hybrid_booking_commerce') {
    const { applyKellyRailsNudges } = require('./golden-seed.cjs');
    const { runRetellVoiceCommerceTurn, getHandler, initRetellReplayConnection } = require('./retell-commerce-replay.cjs');
    const bookingDone = hybridBookingDone(db, sessionId);

    if (!bookingDone) {
      const { runKellyTurn } = require('../../../services/kelly-turn-resolver');
      const result = await runKellyTurn({
        sessionId,
        message,
        channel: call.channel,
        clinicId,
        merchantId,
        callId: sessionId,
        skipIdentityAdmission: true,
        routing_world: 'tenant',
        direction: call.call_metadata?.direction || 'inbound',
        call_type: call.call_metadata?.call_type || 'tenant',
        preferredLanguage: preferredLanguage || call.call_metadata?.locale || 'en-US',
        site_context_status: 'not_required'
      });
      const base = normalizeTurnResult(result);
      const nudged = await applyKellyRailsNudges({
        call,
        message,
        sessionId,
        clinicId,
        toolsObserved: base.toolsUsed
      });
      return finishKellyRailsTurn(db, sessionId, base, nudged);
    }

    initRetellReplayConnection(getHandler(db), sessionId, call, { merchantId, clinicId });
    const handler = getHandler(db);
    const connection = handler.activeConnections.get(sessionId);
    const schedEmail = (call.turns || []).find((t) => t.tool_call?.name === 'schedule_appointment')
      ?.tool_call?.args?.email;
    if (schedEmail) connection.customerEmail = schedEmail;
    absorbCallerContext(connection, message, hints);
    if (turnIndex >= 0) {
      await seedBeforeCallerTurn(db, call, turnIndex, sessionId, hints, connection);
    }
    const result = await runRetellVoiceCommerceTurn({
      db,
      sessionId,
      message,
      call,
      clinicId,
      merchantId,
      preferredLanguage: preferredLanguage || call.call_metadata?.locale
    });
    return normalizeTurnResult(result);
  }

  const { applyKellyRailsNudges } = require('./golden-seed.cjs');
  const { runKellyTurn } = require('../../../services/kelly-turn-resolver');
  const result = await runKellyTurn({
    sessionId,
    message,
    channel: call.channel,
    clinicId,
    merchantId,
    callId: sessionId,
    skipIdentityAdmission: true,
    routing_world: 'tenant',
    direction: call.call_metadata?.direction || 'inbound',
    call_type: call.call_metadata?.call_type || 'tenant',
    preferredLanguage: preferredLanguage || call.call_metadata?.locale || 'en-US',
    site_context_status: 'not_required'
  });
  const base = normalizeTurnResult(result);
  const nudged = await applyKellyRailsNudges({
    call,
    message,
    sessionId,
    clinicId,
    toolsObserved: base.toolsUsed
  });
  return finishKellyRailsTurn(db, sessionId, base, nudged);
}

function isCallComplete(call, allToolsUsed) {
  const required = (call.functions_tested || []).filter((f) => f !== 'end_call');
  const observed = new Set(allToolsUsed || []);
  return required.every((fn) => [...observed].some((t) => String(t) === fn || String(t).includes(fn)));
}

module.exports = {
  classifyReplayRuntime,
  ensureReplayClinic,
  seedReplaySession,
  runReplayTurn,
  isCallComplete,
  collectEventTools,
  mergeTurnTools
};
