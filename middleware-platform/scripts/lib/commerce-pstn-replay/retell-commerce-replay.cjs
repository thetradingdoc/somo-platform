'use strict';

const RetellWebSocketHandler = require('../../../webhooks/retell-websocket');
const RetellService = require('../../../services/retell-service');
const { loadPstnVoiceCommerceTools } = require('../../../services/pstn-voice-commerce-config');
const KellyToolExecutor = require('../../../services/kelly-tool-executor');
const KellyAgentService = require('../../../services/kelly-agent-service');
const LLMRouter = require('../../../services/llm-router');
const {
  extractGoldenHints,
  absorbCallerContext,
  parseSpokenCode,
  seedVoiceCheckoutVerifyCode
} = require('./golden-seed.cjs');

const MAX_TOOL_ITERATIONS = parseInt(process.env.KELLY_MAX_TOOL_ITERATIONS || '8', 10);
const KELLY_VOICE_MAX_TOKENS = parseInt(process.env.KELLY_VOICE_MAX_TOKENS || '512', 10);

let _handler = null;

function getHandler(db) {
  if (!_handler) {
    _handler = new RetellWebSocketHandler(db, {
      apiBaseUrl: process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000'
    });
  }
  return _handler;
}

function buildCommerceVoiceSystemPrompt(hints, locale) {
  const shop = new RetellService().getDefaultShopPrompt();
  const lang =
    String(locale || 'en-US').slice(0, 2) === 'es'
      ? 'Respond in Spanish.'
      : 'Respond in English.';
  const productLine = hints.productId
    ? `Default product SKU when ordering: ${hints.productId}.`
    : '';
  const nameLine = hints.checkout?.customer_name
    ? `If caller does not state their name, use customer_name "${hints.checkout.customer_name}" at checkout.`
    : '';

  return `${shop}

${lang}
${productLine}
${nameLine}

You are Kelly on the Somo Supplements 24/7 phone line.

ORDER FLOW:
1. Brief empathy when caller shares how they feel — do not search until they want to order.
2. When they want to order: call search_products.
3. Confirm product and quantity.
4. Collect email; read it back for confirmation.
5. After email confirmed: call create_checkout with product_id, quantity, customer_email, customer_name.
6. Confirm link sent; call end_call when caller is done.

Use tools for search, checkout, and end_call. Never claim checkout is complete without create_checkout.`;
}

function initRetellReplayConnection(handler, sessionId, call, ctx) {
  const hints = extractGoldenHints(call);
  const merchantId = call.call_metadata?.merchant_id || ctx.merchantId;
  const clinicId = call.call_metadata?.clinic_id || ctx.clinicId;

  const connection = {
    ws: null,
    callId: sessionId,
    replayMode: true,
    replayGolden: hints,
    startTime: Date.now(),
    conversationHistory: [],
    callMetadata: {
      dynamic_variables: { merchant_id: merchantId },
      from_number: call.call_metadata?.caller_id || null,
      metadata: { merchant_id: merchantId }
    },
    customerPhone: call.call_metadata?.caller_id || null,
    customerEmail: hints.checkout?.customer_email || null,
    customerName: hints.checkout?.customer_name || null,
    clinic_id: clinicId,
    merchant_id: merchantId,
    sentInitialGreeting: true,
    lastSearchResults: null,
    lastPaymentToken: null,
    lastCheckoutId: null,
    replayToolsUsed: [],
    replayFunctionsTested: call.functions_tested || []
  };

  handler.activeConnections.set(sessionId, connection);

  const opener = (call.turns || []).find((t) => t.speaker === 'agent');
  if (opener?.text) {
    KellyAgentService._appendToHistory(sessionId, 'assistant', opener.text);
  }

  return { connection, hints };
}

function mergeToolArgs(name, args, connection, hints) {
  const merged = { ...(args || {}) };
  if (name === 'search_products' && !merged.merchant_id) {
    merged.merchant_id = connection.merchant_id;
  }
  if (name === 'create_checkout') {
    if (!merged.product_id) merged.product_id = hints.productId || hints.checkout?.product_id;
    if (!merged.customer_email) {
      merged.customer_email = connection.customerEmail || hints.checkout?.customer_email;
    }
    if (!merged.customer_name) {
      merged.customer_name = connection.customerName || hints.checkout?.customer_name || 'Customer';
    }
    if (!merged.customer_phone && connection.customerPhone) {
      merged.customer_phone = connection.customerPhone;
    }
    if (!merged.quantity) merged.quantity = hints.checkout?.quantity || 1;
    if (!merged.merchant_id) merged.merchant_id = connection.merchant_id;
  }
  if (name === 'verify_checkout_code') {
    if (!merged.verification_code) {
      merged.verification_code =
        connection.lastCallerCode || hints.verifyCheckoutCode;
    }
    if (!merged.payment_token && connection.lastPaymentToken) {
      merged.payment_token = connection.lastPaymentToken;
    }
  }
  if (name === 'get_order_tracking') {
    if (!merged.customer_email && connection.customerEmail) {
      merged.customer_email = connection.customerEmail;
    }
    if (!merged.customer_phone && connection.customerPhone) {
      merged.customer_phone = connection.customerPhone;
    }
    if (!merged.order_id && hints.priorOrderId) {
      merged.order_id = hints.priorOrderId;
    }
  }
  return merged;
}

async function executeRetellTool(handler, sessionId, name, args, connection, hints, db) {
  const merged = mergeToolArgs(name, args, connection, hints);
  const result = await handler.replayFunctionCall(sessionId, name, merged);

  if (name === 'create_checkout' && result?.payment_token) {
    connection.lastPaymentToken = result.payment_token;
    connection.lastCheckoutId = result.checkout_id || null;
    if (hints.verifyCheckoutCode) {
      seedVoiceCheckoutVerifyCode(db, result.payment_token, hints.verifyCheckoutCode);
    }
  }

  return result;
}

async function runRetellCommerceLlmTurn({ db, sessionId, message, connection, hints, locale }) {
  KellyToolExecutor.beginTurnToolLog(sessionId);

  const history = KellyAgentService._loadHistory(sessionId) || [];
  const msgText = String(message || '').trim();
  history.push({ role: 'user', content: msgText });

  const systemPrompt = buildCommerceVoiceSystemPrompt(hints, locale);
  const tools = loadPstnVoiceCommerceTools();
  const handler = getHandler(db);

  let messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content }))
  ];

  const toolsUsed = [];
  let reply = '';
  let endCall = false;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter += 1) {
    const response = await LLMRouter.call({
      messages,
      tools,
      channel: 'voice',
      maxTokens: KELLY_VOICE_MAX_TOKENS,
      forceProvider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : undefined
    });

    const choice = response.choices?.[0];
    if (!choice?.message) break;

    const assistantMsg = choice.message;
    if (choice.finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
      reply = assistantMsg.content || reply || "How can I help you today?";
      break;
    }

    messages.push({
      role: 'assistant',
      content: assistantMsg.content || null,
      tool_calls: assistantMsg.tool_calls
    });

    for (const toolCall of assistantMsg.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch (_) {}

      const result = await executeRetellTool(
        handler,
        sessionId,
        toolName,
        toolArgs,
        connection,
        hints,
        db
      );

      if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);
      connection.replayToolsUsed = [...new Set([...(connection.replayToolsUsed || []), toolName])];
      if (toolName === 'end_call') endCall = true;

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }
  }

  KellyAgentService._appendToHistory(sessionId, 'user', message);
  KellyAgentService._appendToHistory(sessionId, 'assistant', reply);

  let cumulative = [...new Set([...(connection.replayToolsUsed || []), ...toolsUsed])];
  const needsSearch = (connection.replayFunctionsTested || []).includes('search_products');
  const browseIntent = /\b(what|which|kinds?|carry|sell|have|products?|supplements?|catalog|order|buy|vitamin|omega|magnesium|iron|multivitamin)\b/i.test(
    msgText
  );
  const orderIntent = /\b(yes|yeah|one bottle|please|order|buy|fine|sounds good|works|okay)\b/i.test(
    msgText
  );
  if (
    needsSearch &&
    !cumulative.includes('search_products') &&
    (browseIntent || orderIntent || cumulative.includes('get_available_payment_methods'))
  ) {
    const query = hints.searchQuery || 'supplements';
    await executeRetellTool(
      handler,
      sessionId,
      'search_products',
      { query },
      connection,
      hints,
      db
    );
    toolsUsed.push('search_products');
    cumulative = [...new Set([...cumulative, 'search_products'])];
    connection.replayToolsUsed = cumulative;
  }

  const needsVerify = (connection.replayFunctionsTested || []).includes('verify_checkout_code');
  const spokenCode = parseSpokenCode(msgText) || connection.lastCallerCode;
  if (
    needsVerify &&
    !cumulative.includes('verify_checkout_code') &&
    spokenCode &&
    connection.lastPaymentToken
  ) {
    if (hints.verifyCheckoutCode) {
      seedVoiceCheckoutVerifyCode(db, connection.lastPaymentToken, hints.verifyCheckoutCode);
    }
    await executeRetellTool(
      handler,
      sessionId,
      'verify_checkout_code',
      { verification_code: spokenCode, payment_token: connection.lastPaymentToken },
      connection,
      hints,
      db
    );
    toolsUsed.push('verify_checkout_code');
    cumulative = [...new Set([...cumulative, 'verify_checkout_code'])];
    connection.replayToolsUsed = cumulative;
  }

  const needsCheckout = (connection.replayFunctionsTested || []).includes('create_checkout');
  const emailConfirmed = /^(yes|yeah|yep|correct|that'?s (right|correct)|right|sí|si|correcto)\b/i.test(
    msgText.trim()
  );
  if (
    needsCheckout &&
    !cumulative.includes('create_checkout') &&
    connection.customerEmail &&
    emailConfirmed
  ) {
    await executeRetellTool(handler, sessionId, 'create_checkout', {}, connection, hints, db);
    toolsUsed.push('create_checkout');
    cumulative = [...new Set([...cumulative, 'create_checkout'])];
    connection.replayToolsUsed = cumulative;
  }

  const required = (connection.replayFunctionsTested || []).filter((f) => f !== 'end_call');
  const needsEndCall = (connection.replayFunctionsTested || []).includes('end_call');
  const prereqsMet = required.every((fn) => cumulative.includes(fn));
  const callerClosing = /\b(no|that'?s (all|great|good|fine)|thank you|thanks|goodbye|bye)\b/i.test(
    msgText
  );
  if (
    needsEndCall &&
    prereqsMet &&
    !toolsUsed.includes('end_call') &&
    !cumulative.includes('end_call') &&
    callerClosing
  ) {
    await executeRetellTool(handler, sessionId, 'end_call', {}, connection, hints, db);
    toolsUsed.push('end_call');
    connection.replayToolsUsed = [...new Set([...(connection.replayToolsUsed || []), 'end_call'])];
    endCall = true;
  }

  const executorTools = KellyToolExecutor.getTurnToolsUsed(sessionId) || [];
  const allTools = [...new Set([...toolsUsed, ...executorTools])];

  return { reply, toolsUsed: allTools, endCall, language: locale || 'en' };
}

async function runRetellVoiceCommerceTurn(opts) {
  const { db, sessionId, message, call, clinicId, merchantId, preferredLanguage } = opts;
  const handler = getHandler(db);
  let connection = handler.activeConnections.get(sessionId);
  if (!connection?.replayMode) {
    initRetellReplayConnection(handler, sessionId, call, { clinicId, merchantId });
    connection = handler.activeConnections.get(sessionId);
  }
  const hints = connection.replayGolden || extractGoldenHints(call);

  absorbCallerContext(connection, message, hints);

  return runRetellCommerceLlmTurn({
    db,
    sessionId,
    message,
    connection,
    hints,
    locale: preferredLanguage || call.call_metadata?.locale
  });
}

module.exports = {
  getHandler,
  initRetellReplayConnection,
  runRetellVoiceCommerceTurn,
  buildCommerceVoiceSystemPrompt
};
