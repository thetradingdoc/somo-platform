'use strict';

const {
  handlePatientCheckoutChatMessage,
  handlePatientCheckoutChatMessageStream,
  _getCheckoutStage,
  buildStageContract,
} = require('../services/patient-checkout-chat-service');

function registerPatientCheckoutChatRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    requirePatientSession,
    requireCsrfForCookieAuth,
    validatePatientCheckoutChatBody,
    rotatePatientSessionIfNeeded,
    blockChatWhenDisabled,
    db,
  } = deps;

app.post(
  '/api/patient/checkout-chat/turn',
  apiLimiter,
  requirePatientSession,
  requireCsrfForCookieAuth,
  validatePatientCheckoutChatBody,
  express.json(),
  async (req, res) => {
    try {
      await rotatePatientSessionIfNeeded(req, res);
      const out = await handlePatientCheckoutChatMessage(req);
      return res.status(out.status).json(out.json);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message, request_id: req.id });
    }
  }
);

app.post(
  '/api/patient/checkout-chat/turn/stream',
  apiLimiter,
  requirePatientSession,
  requireCsrfForCookieAuth,
  validatePatientCheckoutChatBody,
  express.json(),
  async (req, res) => {
    try {
      await rotatePatientSessionIfNeeded(req, res);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      await handlePatientCheckoutChatMessageStream(req, res);
    } catch (e) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: e.message, request_id: req.id });
      }
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', success: false, error: e.message })}\n\n`);
      } catch (_) {}
      return res.end();
    }
  }
);

// Public checkout-chat routes (guest chat-first commerce, no patient session required)
app.post('/api/public/checkout-chat/turn', apiLimiter, validatePatientCheckoutChatBody, express.json(), async (req, res) => {
  const { startTrace, endTrace } = require('./services/langsmith-trace-service');
  const requestedSessionId = (req.body?.session_id || '').toString().trim() || null;
  const requestedProductId = (req.body?.product_id || '').toString().trim() || null;
  const resumeDecision = _normalizeResumeDecision(req.body?.resume_decision);
  const stageBefore = requestedSessionId ? _getCheckoutStage(requestedSessionId) : null;
  const traceCtx = await startTrace({
    name: 'public_checkout_chat_turn',
    inputs: {
      session_id: requestedSessionId,
      message: String(req.body?.message || ''),
      product_id: (req.body?.product_id || '').toString().trim() || null,
      provider_id: (req.body?.provider_id || '').toString().trim() || null
    },
    metadata: {
      route: '/api/public/checkout-chat/turn',
      source: 'landing_page',
      checkout_stage_before: stageBefore
    },
    tags: ['landing-page', 'checkout', 'kelly']
  });
  try {
    if (!req.patientSessionId) {
      req.patientSessionId = (req.headers['x-session-id'] || '').toString().trim() || null;
    }
    if (CHECKOUT_RAIL_GUARDS_ENABLED && requestedSessionId && requestedProductId) {
      _applyProductScopeForSession(requestedSessionId, requestedProductId, 'public_turn');
    }
    if (requestedSessionId && resumeDecision) {
      _applyCheckoutResumeDecision(requestedSessionId, resumeDecision, 'public_turn');
    }
    const out = await handlePatientCheckoutChatMessage(req);
    const traceSessionId = out?.json?.session_id || requestedSessionId;
    const stageAfter = traceSessionId ? _getCheckoutStage(traceSessionId) : null;
    await endTrace(traceCtx, {
      outputs: {
        success: !!out?.json?.success,
        status: out?.status || 200,
        session_id: traceSessionId,
        terminal_state: out?.json?.terminal_state || null,
        checkout_stage_before: stageBefore,
        checkout_stage_after: stageAfter
      },
      usage: out?.json?.llm_usage || null
    });
    _logCheckoutLLMUsage(traceSessionId, out?.json?.llm_usage || null);
    return res.status(out.status).json(out.json);
  } catch (e) {
    await endTrace(traceCtx, { error: e?.message || 'public_checkout_chat_turn_failed' });
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/checkout-chat/turn/stream', apiLimiter, validatePatientCheckoutChatBody, express.json(), async (req, res) => {
  const { startTrace, endTrace } = require('./services/langsmith-trace-service');
  const requestedSessionId = (req.body?.session_id || '').toString().trim() || null;
  const requestedProductId = (req.body?.product_id || '').toString().trim() || null;
  const resumeDecision = _normalizeResumeDecision(req.body?.resume_decision);
  const stageBefore = requestedSessionId ? _getCheckoutStage(requestedSessionId) : null;
  const traceCtx = await startTrace({
    name: 'public_checkout_chat_turn_stream',
    inputs: {
      session_id: requestedSessionId,
      message: String(req.body?.message || ''),
      product_id: (req.body?.product_id || '').toString().trim() || null,
      provider_id: (req.body?.provider_id || '').toString().trim() || null
    },
    metadata: {
      route: '/api/public/checkout-chat/turn/stream',
      source: 'landing_page',
      checkout_stage_before: stageBefore
    },
    tags: ['landing-page', 'checkout', 'kelly', 'stream']
  });
  try {
    if (!req.patientSessionId) {
      req.patientSessionId = (req.headers['x-session-id'] || '').toString().trim() || null;
    }
    if (CHECKOUT_RAIL_GUARDS_ENABLED && requestedSessionId && requestedProductId) {
      _applyProductScopeForSession(requestedSessionId, requestedProductId, 'public_turn_stream');
    }
    if (requestedSessionId && resumeDecision) {
      _applyCheckoutResumeDecision(requestedSessionId, resumeDecision, 'public_turn_stream');
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    await handlePatientCheckoutChatMessageStream(req, res);
    const stageAfter = requestedSessionId ? _getCheckoutStage(requestedSessionId) : null;
    await endTrace(traceCtx, {
      outputs: {
        success: true,
        session_id: requestedSessionId,
        checkout_stage_before: stageBefore,
        checkout_stage_after: stageAfter
      }
    });
  } catch (e) {
    await endTrace(traceCtx, { error: e?.message || 'public_checkout_chat_stream_failed' });
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: e.message, request_id: req.id });
    }
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', success: false, error: e.message })}\n\n`);
    } catch (_) {}
    return res.end();
  }
});

// Lightweight stage-sync endpoint for deterministic checkout UI restore.
app.get('/api/public/checkout-chat/stage', apiLimiter, async (req, res) => {
  try {
    const session_id = String(req.query.session_id || '').trim();
    const productId = String(req.query.product_id || '').trim();
    const resumeDecision = _normalizeResumeDecision(req.query.resume_decision);
    const uiMode = String(req.query.ui_mode || '').trim().toLowerCase();
    const checkoutIntent = String(req.query.checkout_intent || '').trim() === '1';
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    if (resumeDecision) {
      _applyCheckoutResumeDecision(session_id, resumeDecision, 'public_stage_sync');
    }
    if (CHECKOUT_RAIL_GUARDS_ENABLED && productId) {
      _applyProductScopeForSession(session_id, productId, 'public_stage_sync');
    }
    await _syncCheckoutPaymentStatusIfPrepared(session_id, 'public_stage_sync');
    const contract = buildStageContract(session_id);
    let effectiveContract = contract;
    let resumeRequired = false;
    if (CHECKOUT_STAGE_SYNC_INTENT_AWARE && String(contract.checkout_stage) === 'checkout_prepared') {
      let storedDecision = '';
      try {
        storedDecision = String(KellyToolExecutor._getSessionMeta?.(session_id, 'checkout_resume_decision') || '').trim();
      } catch (_) {}
      const resumeAllowed =
        resumeDecision === 'continue' ||
        storedDecision === 'continue' ||
        checkoutIntent;
      if (!resumeAllowed) {
        try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_resume_required'); } catch (_) {}
        effectiveContract = {
          checkout_stage: 'collecting_details',
          allowed_next_actions: ['resume_or_start_over'],
          policy_flags: {
            can_show_payment_form: false,
            can_show_receipt: false,
            verification_required: false,
            payment_pending: false,
            payment_failed: false,
            resume_required: true
          }
        };
        resumeRequired = true;
      }
    }
    if (
      String(effectiveContract?.checkout_stage || '') === 'checkout_prepared' &&
      effectiveContract?.commerce_checkout &&
      effectiveContract.commerce_checkout.payment_action &&
      String(effectiveContract.commerce_checkout.payment_action.type || '') === 'stripe_payment_intent' &&
      !effectiveContract.commerce_checkout.payment_action.client_secret
    ) {
      try {
        const piId = String(effectiveContract.commerce_checkout.payment_action.payment_intent_id || '').trim();
        if (piId && process.env.STRIPE_SECRET_KEY) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const pi = await stripe.paymentIntents.retrieve(piId);
          const cs = String(pi?.client_secret || '').trim();
          if (cs) {
            effectiveContract = {
              ...effectiveContract,
              commerce_checkout: {
                ...effectiveContract.commerce_checkout,
                payment_action: {
                  ...effectiveContract.commerce_checkout.payment_action,
                  client_secret: cs
                }
              }
            };
          }
        }
      } catch (_) {}
    }
    return res.json({
      success: true,
      session_id,
      resume_decision_applied: resumeDecision || null,
      checkout_stage: effectiveContract.checkout_stage,
      policy_flags: effectiveContract.policy_flags,
      allowed_next_actions: effectiveContract.allowed_next_actions,
      commerce_checkout: effectiveContract.commerce_checkout || null,
      resume_required: resumeRequired,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.get('/api/public/checkout-chat/invariants', apiLimiter, async (req, res) => {
  try {
    const session_id = String(req.query.session_id || '').trim();
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    const CheckoutWorkflowService = require('./services/checkout-workflow-service');
    const report = CheckoutWorkflowService.validateCheckoutInvariants(session_id);
    return res.json({
      success: true,
      session_id,
      valid: !!report?.valid,
      stage: report?.stage || null,
      violations: Array.isArray(report?.violations) ? report.violations : [],
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/checkout-chat/reset', apiLimiter, express.json(), async (req, res) => {
  try {
    const session_id = String(req.body?.session_id || '').trim();
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    const reason = String(req.body?.reason || 'explicit_user_reset').trim() || 'explicit_user_reset';
    const reset = KellyToolExecutor.hardResetCheckoutContext?.(session_id, reason);
    const contract = buildStageContract(session_id);
    return res.json({
      success: !!reset?.success,
      error: reset?.success ? null : reset?.error || 'checkout_reset_failed',
      session_id,
      checkout_context_version: reset?.checkout_context_version || null,
      checkout_stage: contract.checkout_stage,
      policy_flags: contract.policy_flags,
      allowed_next_actions: contract.allowed_next_actions,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/public/checkout-chat/payment-session/refresh', apiLimiter, express.json(), async (req, res) => {
  try {
    const { resolveMerchantIdForCheckoutChat } = require('./utils/public-commerce-helpers');
    const session_id = String(req.body?.session_id || '').trim();
    const provider_id = String(req.body?.provider_id || '').trim();
    if (!session_id) {
      return res.status(400).json({ success: false, error: 'session_id_required', request_id: req.id });
    }
    const stage = String(_getCheckoutStage(session_id) || '').trim();
    if (stage !== 'checkout_prepared' && stage !== 'code_verified') {
      return res.status(409).json({
        success: false,
        error: 'checkout_not_refreshable',
        checkout_stage: stage || 'collecting_details',
        request_id: req.id
      });
    }
    const merchantId = resolveMerchantIdForCheckoutChat({
      providerId: provider_id || undefined,
      clinicId: process.env.DEFAULT_CLINIC_ID || 'clinic-default'
    });
    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'merchant_required', request_id: req.id });
    }
    const cart = db.getCommerceCart(session_id, merchantId);
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
      return res.status(400).json({ success: false, error: 'cart_empty', request_id: req.id });
    }
    const email = String(
      KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_email_verified') ||
      KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_pending_email') ||
      req.body?.email ||
      ''
    ).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'email_required', request_id: req.id });
    }
    const phone = String(req.body?.phone || KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_customer_phone') || '').trim();
    const shippingLine1 = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_line1') || '').trim();
    const shippingCity = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_city') || '').trim();
    const shippingState = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_state') || '').trim();
    const shippingPostal = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_postal_code') || '').trim();
    const shippingLine2 = String(KellyToolExecutor._getSessionMeta?.(session_id, 'commerce_shipping_line2') || '').trim();
    const shippingAddress = shippingLine1 && shippingCity && shippingState && shippingPostal
      ? {
          line1: shippingLine1,
          line2: shippingLine2 || undefined,
          city: shippingCity,
          state: shippingState,
          postal_code: shippingPostal,
          country: 'US'
        }
      : undefined;
    try { db.clearCommerceCartCheckoutLock(session_id, merchantId); } catch (_) {}
    const checkoutResult = await PaymentOrchestrator.createCheckout({
      merchant_id: merchantId,
      customer: {
        name: String(req.body?.name || String(email).split('@')[0] || 'Customer'),
        phone: phone || '',
        email
      },
      items: cart.items.map((it) => ({
        product_id: it.product_id,
        name: it.name,
        unit_price: Number(it.unit_price),
        quantity: Number(it.quantity),
        total: Number(it.total)
      })),
      payment: { method: 'direct_stripe', currency: 'USD' },
      shipping_address: shippingAddress,
      metadata: {
        kelly_session_id: session_id,
        cart_session_id: session_id,
        refresh_reason: String(req.body?.reason || 'stale_payment_intent')
      }
    });
    if (!checkoutResult || checkoutResult.success === false) {
      return res.status(502).json({
        success: false,
        error: checkoutResult?.error || 'checkout_refresh_failed',
        message: checkoutResult?.message || 'Unable to refresh payment session',
        request_id: req.id
      });
    }
    try {
      if (checkoutResult.checkout_id) db.setCommerceCartCheckoutLock(session_id, merchantId, checkoutResult.checkout_id);
    } catch (_) {}
    KellyToolExecutor._setCheckoutStage(session_id, 'checkout_prepared', {
      checkout_id: checkoutResult.checkout_id || '',
      payment_intent_id: checkoutResult.payment?.payment_intent_id || checkoutResult.payment_intent_id || '',
      merchant_id: merchantId,
      source: 'refresh_payment_session'
    });
    const normalized = KellyToolExecutor._normalizePrepareCommerceCheckoutForChat({
      success: true,
      checkout: {
        checkout_id: checkoutResult.checkout_id || null,
        payment_link: checkoutResult.payment_link || null,
        payment_token: checkoutResult.payment_token || null,
        payment_intent_id: checkoutResult.payment?.payment_intent_id || checkoutResult.payment_intent_id || null,
        client_secret: checkoutResult.payment?.client_secret || checkoutResult.client_secret || null,
        requires_action: !!checkoutResult.requires_action,
        payment: checkoutResult.payment || null,
        message: checkoutResult.message || 'Checkout payment session refreshed'
      },
      cart
    });
    try {
      KellyToolExecutor._setSessionMeta(session_id, 'last_commerce_checkout_chat', JSON.stringify(normalized.commerce_checkout || {}));
    } catch (_) {}
    const contract = buildStageContract(session_id);
    return res.json({
      success: true,
      session_id,
      checkout_stage: contract.checkout_stage,
      policy_flags: contract.policy_flags,
      allowed_next_actions: contract.allowed_next_actions,
      commerce_checkout: normalized.commerce_checkout || contract.commerce_checkout || null,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'refresh_failed', request_id: req.id });
  }
});
}

module.exports = { registerPatientCheckoutChatRoutes };
