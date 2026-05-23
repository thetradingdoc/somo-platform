'use strict';

const db = require('../database');
const { FALLBACK_CLINIC_ID, resolveClinicIdFromRequest } = require('../lib/resolve-clinic-id');

// POST /api/patient/checkout-chat/turn — Kelly agent for retail checkout (commerce tools only)
function _isMidFlightCheckout(sessionId, message) {
  const hasVerificationCode = /\b\d{6}\b/.test(String(message || ''));
  let hasCheckoutProgress = false;
  try {
    const progress = db?.getCommerceCheckoutProgress?.(sessionId) || null;
    hasCheckoutProgress = !!(progress?.checkout_id || progress?.checkout_intent);
  } catch (_) {}
  return hasVerificationCode || hasCheckoutProgress;
}

async function _runCheckoutGraphWithCircuitBreaker(CheckoutGraph, payload, timeoutMs = 2000) {
  try {
    return await Promise.race([
      CheckoutGraph.processTurn(payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CHECKOUT_GRAPH_TIMEOUT')), timeoutMs))
    ]);
  } catch (e) {
    return { success: false, error: e.message || 'checkout_graph_failed' };
  }
}

function _safeCheckoutDegradeResponse() {
  return {
    success: true,
    safe_degraded: true,
    human_handoff_recommended: true,
    reply:
      "I'm having trouble processing this securely right now. Please try again in a moment, and if needed I can connect you to a specialist to complete checkout safely.",
    toolsUsed: [],
    next_chips: [],
    chips_display: null,
    next_step: 'safe_retry_or_handoff'
  };
}

function _looksLikeCardOrCvv(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  const hasCvv = /\b(cvv|cvc|security code)\b/i.test(s);
  const digits = s.replace(/\D/g, '');
  const hasLongCardLike = digits.length >= 13 && digits.length <= 19;
  return hasCvv || hasLongCardLike;
}

function _getCheckoutStage(sessionId) {
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    return String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage') || '');
  } catch (_) {
    return '';
  }
}

function _normalizeResumeDecision(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'continue' || v === 'resume') return 'continue';
  if (v === 'start_over' || v === 'restart' || v === 'reset') return 'start_over';
  return '';
}

function _applyCheckoutResumeDecision(sessionId, decision, source = 'checkout_resume_decision') {
  try {
    const normalized = _normalizeResumeDecision(decision);
    if (!sessionId || !normalized) return { applied: false, decision: '' };
    const KellyToolExecutor = require('./kelly-tool-executor');
    if (normalized === 'start_over') {
      const reset = KellyToolExecutor.hardResetCheckoutContext?.(sessionId, `${source}:start_over`);
      KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision', 'start_over');
      KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision_at_ms', String(Date.now()));
      return { applied: true, decision: normalized, reset: !!reset?.success };
    }
    KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision', 'continue');
    KellyToolExecutor._setSessionMeta?.(sessionId, 'checkout_resume_decision_at_ms', String(Date.now()));
    return { applied: true, decision: normalized };
  } catch (_) {
    return { applied: false, decision: '' };
  }
}

function _applyProductScopeForSession(sessionId, productId, source = 'product_scope') {
  try {
    const sid = String(sessionId || '').trim();
    const pid = String(productId || '').trim();
    if (!sid || !pid) return { applied: false, changed: false };
    const lastPid = String(KellyToolExecutor._getSessionMeta?.(sid, 'checkout_product_id') || '').trim();
    if (!lastPid) {
      KellyToolExecutor._setSessionMeta?.(sid, 'checkout_product_id', pid);
      return { applied: true, changed: false };
    }
    if (lastPid !== pid) {
      const reset = KellyToolExecutor.hardResetCheckoutContext?.(sid, `${source}:product_switch`);
      KellyToolExecutor._setSessionMeta?.(sid, 'checkout_product_id', pid);
      KellyToolExecutor._setSessionMeta?.(sid, 'checkout_product_switched_at_ms', String(Date.now()));
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_product_switch_reset'); } catch (_) {}
      return { applied: true, changed: true, reset: !!reset?.success };
    }
    return { applied: true, changed: false };
  } catch (_) {
    return { applied: false, changed: false };
  }
}

async function _runCheckoutContextBackfillOnce() {
  try {
    const rows = db.db.prepare(`
      SELECT DISTINCT session_id
      FROM kelly_session_meta_kv
      WHERE meta_key IN ('checkout_stage','commerce_email_verified','commerce_shipping_complete')
    `).all();
    if (!Array.isArray(rows) || rows.length < 1) return;
    for (const r of rows) {
      const sid = String(r?.session_id || '').trim();
      if (!sid) continue;
      const currentVersion = String(KellyToolExecutor._getSessionMeta?.(sid, 'checkout_context_version') || '').trim();
      if (!currentVersion) KellyToolExecutor._setSessionMeta?.(sid, 'checkout_context_version', '1');
      const shipComplete = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_shipping_complete') || '0') === '1';
      if (shipComplete) {
        const shipVersion = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_shipping_context_version') || '').trim();
        if (!shipVersion) KellyToolExecutor._setSessionMeta?.(sid, 'commerce_shipping_context_version', '1');
        const shipUpdated = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_shipping_updated_at_ms') || '').trim();
        if (!shipUpdated) KellyToolExecutor._setSessionMeta?.(sid, 'commerce_shipping_updated_at_ms', String(Date.now()));
      }
      const verifiedEmail = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_email_verified') || '').trim();
      if (verifiedEmail) {
        const vctx = String(KellyToolExecutor._getSessionMeta?.(sid, 'commerce_email_verified_context_version') || '').trim();
        if (!vctx) KellyToolExecutor._setSessionMeta?.(sid, 'commerce_email_verified_context_version', '1');
      }
    }
    try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_context_backfill_applied'); } catch (_) {}
  } catch (_) {}
}

const CHECKOUT_PREPARED_STALE_MS = Math.max(
  60000,
  parseInt(process.env.CHECKOUT_PREPARED_STALE_MS || '1800000', 10) || 1800000
);
const CHECKOUT_RAIL_GUARDS_ENABLED =
  String(process.env.CHECKOUT_RAIL_GUARDS_ENABLED || 'true').toLowerCase() !== 'false';
const CHECKOUT_STAGE_SYNC_INTENT_AWARE =
  String(process.env.CHECKOUT_STAGE_SYNC_INTENT_AWARE || 'true').toLowerCase() !== 'false';
const CHECKOUT_STALE_INFLIGHT_TTL_MS = Math.max(
  30000,
  parseInt(process.env.CHECKOUT_STALE_INFLIGHT_TTL_MS || '120000', 10) || 120000
);

async function _syncCheckoutPaymentStatusIfPrepared(sessionId, source = 'server_sync') {
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    const CheckoutPaymentStatusService = require('./checkout-payment-status-service');
    const stage = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage') || '');
    if (stage !== 'checkout_prepared') return { stage };

    const updatedAtMs = parseInt(
      String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_updated_at_ms') || '0'),
      10
    );
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0 && Date.now() - updatedAtMs > CHECKOUT_PREPARED_STALE_MS) {
      const merchantId = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
      KellyToolExecutor._setCheckoutStage(sessionId, 'failed', { reason: 'checkout_prepared_stale_timeout' });
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', 'stale_timeout');
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', 'failed');
      if (merchantId && db?.clearCommerceCartCheckoutLock) {
        try { db.clearCommerceCartCheckoutLock(sessionId, merchantId); } catch (_) {}
      }
      return { stage: 'failed', stale: true };
    }

    const paymentIntentId = String(
      KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_payment_intent_id') || ''
    ).trim();
    if (!paymentIntentId) {
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', `${source}:missing_pi`);
      return { stage };
    }

    const status = await CheckoutPaymentStatusService.getCheckoutPaymentStatus({ payment_intent_id: paymentIntentId });
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_last_checked_at', String(Date.now()));
    KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', String(status?.source || source));
    if (!status?.success) return { stage };
    const confirmAttempted = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'payment_confirm_attempted') || '0') === '1';
    if (String(status.stripe_status || '') === 'requires_payment_method' && !confirmAttempted) {
      // Before any confirm attempt, requires_payment_method is expected for a fresh PI.
      KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', 'pending_card_entry');
      return { stage: 'checkout_prepared', stripe_status: 'requires_payment_method' };
    }

    KellyToolExecutor._setSessionMeta(sessionId, 'payment_outcome_status', String(status.stripe_status || 'unknown'));
    const mappedStage = String(status.checkout_stage || 'checkout_prepared');
    if (mappedStage === 'payment_confirmed') {
      // Do not announce confirmation until receipt/order can be retrieved.
      let receiptOrOrderRetrievable = false;
      try {
        const hasReceipt = db.db.prepare(
          `SELECT 1 FROM payment_receipts WHERE external_payment_id = ? AND deleted_at IS NULL LIMIT 1`
        ).get(paymentIntentId);
        const hasOrder = db.db.prepare(
          `SELECT 1 FROM voice_checkouts WHERE payment_intent_id = ? AND merchant_order_id IS NOT NULL LIMIT 1`
        ).get(paymentIntentId);
        receiptOrOrderRetrievable = !!(hasReceipt || hasOrder);
      } catch (_) {}
      if (receiptOrOrderRetrievable) {
        KellyToolExecutor._setCheckoutStage(sessionId, 'payment_confirmed', {
          payment_intent_id: paymentIntentId
        });
      } else {
        KellyToolExecutor._setSessionMeta(sessionId, 'payment_status_source', `${source}:awaiting_reconciliation`);
        try {
          db.enqueueToolCallDLQ && db.enqueueToolCallDLQ({
            call_id: `checkout_reconcile_${sessionId}_${Date.now()}`,
            function_name: 'checkout_payment_reconciliation',
            parameters: { session_id: sessionId, payment_intent_id: paymentIntentId },
            error_message: 'payment_succeeded_but_receipt_or_order_unavailable'
          });
        } catch (_) {}
        return { stage: 'checkout_prepared', stripe_status: status.stripe_status };
      }
    } else if (mappedStage === 'failed') {
      const merchantId = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
      KellyToolExecutor._setCheckoutStage(sessionId, 'failed', {
        reason: String(status.stripe_status || 'payment_failed'),
        payment_intent_id: paymentIntentId
      });
      if (merchantId && db?.clearCommerceCartCheckoutLock) {
        try { db.clearCommerceCartCheckoutLock(sessionId, merchantId); } catch (_) {}
      }
    }
    return { stage: mappedStage, stripe_status: status.stripe_status };
  } catch (_) {
    return { stage: _getCheckoutStage(sessionId) || 'collecting_details' };
  }
}

function _runCheckoutStaleInFlightRecoveryOnce() {
  try {
    const CheckoutWorkflowService = require('./checkout-workflow-service');
    const out = CheckoutWorkflowService.recoverStaleInFlightSessions({
      ttlMs: CHECKOUT_STALE_INFLIGHT_TTL_MS,
      limit: 200
    });
    if (out?.recovered > 0) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_stale_inflight_recovered'); } catch (_) {}
    }
    return out;
  } catch (_) {
    return { scanned: 0, recovered: 0 };
  }
}

function buildStageContract(sessionId) {
  const stage = _getCheckoutStage(sessionId) || 'collecting_details';
  let paymentStatus = '';
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    paymentStatus = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'payment_outcome_status') || '').toLowerCase();
  } catch (_) {}
  const nextActionsByStage = {
    collecting_details: ['provide_email'],
    code_sent: ['enter_code'],
    code_verified: ['continue_secure_checkout'],
    checkout_prepared: ['complete_payment_form'],
    payment_confirmed: ['view_receipt', 'track_delivery'],
    failed: ['retry_current_context', 'start_over_new_context']
  };
  let paymentFailureReason = '';
  let stageMeta = {};
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    paymentFailureReason = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_reason') || '');
    stageMeta = {
      source: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_source') || ''),
      actor: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_actor') || ''),
      reason: paymentFailureReason,
      context_version: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_context_version') || ''),
      timestamp_ms: String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_timestamp_ms') || '')
    };
  } catch (_) {}
  let commerceCheckout = null;
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    const rawLast = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'last_commerce_checkout_chat') || '').trim();
    const checkoutIdMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_checkout_id') || '').trim();
    const paymentIntentIdMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_payment_intent_id') || '').trim();
    const merchantIdMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
    let parsed = null;
    if (rawLast) {
      try {
        parsed = JSON.parse(rawLast);
      } catch (_) {
        parsed = null;
      }
    }
    const parsedCheckout = parsed && parsed.commerce_checkout && typeof parsed.commerce_checkout === 'object'
      ? parsed.commerce_checkout
      : null;
    const parsedPa = parsedCheckout && parsedCheckout.payment_action && typeof parsedCheckout.payment_action === 'object'
      ? parsedCheckout.payment_action
      : null;
    const parsedPi = parsedPa && parsedPa.payment_intent_id ? String(parsedPa.payment_intent_id) : '';
    const parsedCs = parsedPa && parsedPa.client_secret ? String(parsedPa.client_secret) : '';
    const pi = paymentIntentIdMeta || parsedPi;
    const cs = parsedCs;
    if ((stage === 'checkout_prepared' || stage === 'payment_confirmed') && (pi || cs || checkoutIdMeta)) {
      commerceCheckout = {
        success: true,
        checkout_id: checkoutIdMeta || (parsedCheckout && parsedCheckout.checkout_id) || null,
        payment_intent_id: pi || null,
        merchant_id: merchantIdMeta || null,
        payment_action: pi
          ? {
              type: 'stripe_payment_intent',
              payment_intent_id: pi,
              client_secret: cs || null,
              requires_action: false
            }
          : null
      };
    }
  } catch (_) {}
  return {
    checkout_stage: stage,
    allowed_next_actions: nextActionsByStage[stage] || ['provide_email'],
    policy_flags: {
      can_show_payment_form: stage === 'checkout_prepared',
      can_show_receipt: stage === 'payment_confirmed',
      verification_required: stage === 'collecting_details' || stage === 'code_sent',
      payment_pending: stage === 'checkout_prepared' || paymentStatus === 'processing',
      payment_failed: stage === 'failed' || ['requires_payment_method', 'canceled', 'failed'].includes(paymentStatus),
      can_retry_payment: stage === 'failed',
      can_start_over: stage === 'failed'
    },
    commerce_checkout: commerceCheckout,
    stage_meta: stageMeta,
    payment_failure_reason: stage === 'failed' ? paymentFailureReason || paymentStatus || 'payment_failed' : null
  };
}

function _checkoutStageTemplate(stage, email = null) {
  if (stage === 'code_sent') {
    const e = String(email || '').trim();
    return e
      ? `We sent a 6-digit verification code to ${e}. Please enter that code in chat to continue to secure checkout.`
      : 'We sent a 6-digit verification code to your email. Please enter that code in chat to continue to secure checkout.';
  }
  if (stage === 'code_verified') {
    return 'Email verified. Continue secure checkout and I will prepare secure payment now.';
  }
  if (stage === 'checkout_prepared') {
    return 'Secure checkout is prepared. Complete payment in the secure checkout form.';
  }
  if (stage === 'payment_confirmed') {
    return 'Payment confirmed. Your order is complete and receipt details are available.';
  }
  if (stage === 'failed') {
    return 'Payment was not completed. Please retry secure checkout to continue.';
  }
  return null;
}

function _canonicalRailCopy(key, data = {}) {
  const email = String(data.email || '').trim();
  const byKey = {
    provide_email: 'Please share your email address so I can send a 6-digit verification code.',
    enter_code: email
      ? `We sent a 6-digit verification code to ${email}. Please enter that code to continue.`
      : 'We sent a 6-digit verification code to your email. Please enter that code to continue.',
    shipping_required: 'Please share your full shipping address (street, city, state, ZIP) before secure checkout.',
    stale_verification: 'Your verification state expired for this checkout. Please request and verify a new 6-digit code.',
    cart_changed: 'Your cart changed, so verification details were reset for safety. Please verify email and shipping again.',
    prepared_ready: 'Secure checkout is ready. Please complete payment in the secure checkout form.',
    payment_confirmed: 'Payment confirmed. Your order is complete and receipt details are available.',
    payment_failed: 'Payment was not completed. Say "**continue secure checkout**" to retry secure payment.'
  };
  return byKey[key] || '';
}

function _estimateCheckoutLLMCostUsd(usage = null) {
  const prompt = Number(usage?.prompt_tokens || 0);
  const completion = Number(usage?.completion_tokens || 0);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || (prompt <= 0 && completion <= 0)) return null;
  // Conservative estimate for checkout logs; exact billing source remains provider invoices.
  const primary = String(process.env.KELLY_PRIMARY_PROVIDER || 'anthropic').toLowerCase();
  const inRatePerM = primary === 'groq' ? 0.59 : 3.0;
  const outRatePerM = primary === 'groq' ? 0.79 : 15.0;
  const usd = ((prompt / 1_000_000) * inRatePerM) + ((completion / 1_000_000) * outRatePerM);
  return Number.isFinite(usd) ? Number(usd.toFixed(6)) : null;
}

function _logCheckoutLLMUsage(sessionId, usage) {
  if (!usage || typeof usage !== 'object') return;
  try {
    const estimated_cost_usd = _estimateCheckoutLLMCostUsd(usage);
    console.info('[checkout-llm-usage]', {
      session_id: String(sessionId || ''),
      prompt_tokens: Number(usage.prompt_tokens || 0),
      completion_tokens: Number(usage.completion_tokens || 0),
      total_tokens: Number(usage.total_tokens || 0),
      estimated_cost_usd
    });
  } catch (_) {}
}

function _isExplicitCheckoutResetIntent(message) {
  return /\b(reset checkout|reset|start over|new order|cancel checkout)\b/i.test(String(message || ''));
}

function _mapAlreadyInProgressCopyByStage(sessionId) {
  const stage = _getCheckoutStage(sessionId) || 'collecting_details';
  if (stage === 'payment_confirmed') {
    try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_in_progress_after_confirmed'); } catch (_) {}
    return 'Payment is already confirmed for this session. Your receipt details are available.';
  }
  if (stage === 'failed') {
    return _canonicalRailCopy('payment_failed');
  }
  if (stage === 'checkout_prepared') {
    return _canonicalRailCopy('prepared_ready');
  }
  if (stage === 'code_verified') {
    return 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.';
  }
  return _canonicalRailCopy('provide_email');
}

/**
 * If shipping meta is complete and version-aligned but only the TTL expired, refresh the
 * timestamp so prepare_commerce_checkout can proceed (matches tool path behavior).
 */
function _refreshStaleShippingTtlIfEligible(sessionId) {
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    if (KellyToolExecutor._isShippingReadyForCurrentContext?.(sessionId)) return;
    const complete = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
    if (!complete) return;
    const line1 = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_line1') || '').trim();
    const city = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_city') || '').trim();
    const state = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_state') || '').trim();
    const postal = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_postal_code') || '').trim();
    if (!line1 || !city || !state || !postal) return;
    const cv = KellyToolExecutor._getCheckoutContextVersion?.(sessionId) ?? 1;
    const sv = parseInt(String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_context_version') || '0'), 10);
    if (!Number.isFinite(sv) || sv !== cv) return;
    KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_updated_at_ms', String(Date.now()));
  } catch (_) {}
}

function _extractShippingAddressParts(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const scrubbed = raw.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig, ' ').replace(/\s+/g, ' ').trim();
  const zipMatch = scrubbed.match(/\b(\d{5})(?:-\d{4})?\b/);
  const stateMatch = scrubbed.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|DC)\b/i);
  const nyHint = /\b(nyc|new york city|new york|bronx|brooklyn|queens|staten island|manhattan)\b/i.test(scrubbed);
  const hasStreetNumber = /\b\d{1,6}\b/.test(scrubbed);
  const hasStreetWord = /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place)\b/i.test(scrubbed);
  const parts = scrubbed.split(',').map((s) => s.trim()).filter(Boolean);
  const city = parts.length >= 2 ? parts[parts.length - 2] : '';
  const state = stateMatch ? String(stateMatch[1]).toUpperCase() : (nyHint ? 'NY' : '');
  return {
    raw: scrubbed || raw,
    line1: parts[0] || raw,
    city: city || '',
    state,
    postal_code: zipMatch ? zipMatch[1] : '',
    complete: !!(zipMatch && state && hasStreetNumber && hasStreetWord)
  };
}

async function _maybeHandleDeterministicCommerceVerificationTurn({
  message,
  sessionId,
  clinicId,
  patientId,
  channel
}) {
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    const msg = String(message || '').trim();
    const emailMatch = msg.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    const codeMatch = msg.match(/\b(\d{6})\b/);
    const pendingEmail = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') || '').trim();
    let stage = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage') || '');
    const verifiedEmailMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_verified') || '').trim().toLowerCase();
    const shippingCompleteMeta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
    const shippingLine1Meta = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_line1') || '').trim();
    // Reconcile drifted resume state so verified sessions do not regress to email prompts.
    if ((stage === 'collecting_details' || stage === 'code_sent') && verifiedEmailMeta) {
      KellyToolExecutor._setCheckoutStage?.(sessionId, 'code_verified', {
        reason: 'resume_state_reconciliation',
        source: 'deterministic_handler'
      });
      stage = 'code_verified';
    }
    if (stage === 'code_verified' && shippingCompleteMeta && shippingLine1Meta) {
      KellyToolExecutor._setSessionMeta?.(sessionId, 'commerce_email_pending', verifiedEmailMeta || String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') || ''));
    }
    const shipping = _extractShippingAddressParts(msg);
    const continueIntent = /\b(continue|proceed|secure checkout|checkout now|continue checkout)\b/i.test(msg);
    const paymentHelpIntent = /\b(how do i pay|how to pay|pay now|where do i pay|payment (form|screen|link)|ready to pay)\b/i.test(msg);
    const visibilityHelpIntent = /\b(i can'?t see|cant see|cannot see|don'?t see|where is (the )?(payment|checkout)|nothing shows|not showing)\b/i.test(msg);
    const checkoutRailIntent = /\b(confirm cart|checkout|pay|payment|verify|verification|code|email|secure checkout)\b/i.test(msg);
    const railLockedStage = stage === 'checkout_prepared' || stage === 'payment_confirmed' || stage === 'failed';
    const resetIntent = _isExplicitCheckoutResetIntent(msg);
    let shippingCaptured = false;

    // Hard rail lock: once payment is prepared/terminal, never drift back to verification prompts.
    if (railLockedStage && !resetIntent && (emailMatch || codeMatch || continueIntent || paymentHelpIntent || visibilityHelpIntent || checkoutRailIntent)) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }

    if (shipping && shipping.complete) {
      const saveViaTool = await KellyToolExecutor.execute(
        'save_shipping_address',
        {
          line1: shipping.line1,
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.postal_code,
          country: 'US'
        },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (!saveViaTool?.success) {
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_address', shipping.raw);
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_line1', shipping.line1);
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_city', shipping.city);
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_state', shipping.state);
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_postal_code', shipping.postal_code);
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_complete', '1');
        KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_updated_at_ms', String(Date.now()));
        KellyToolExecutor._setSessionMeta(
          sessionId,
          'commerce_shipping_context_version',
          String(KellyToolExecutor._getCheckoutContextVersion?.(sessionId) || '1')
        );
        try {
          const merchantIdForFp = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'checkout_stage_meta_merchant_id') || '').trim();
          if (merchantIdForFp) {
            const cartForFp = db.getCommerceCart(sessionId, merchantIdForFp);
            const fpItems = Array.isArray(cartForFp?.items) ? [...cartForFp.items] : [];
            fpItems.sort((a, b) => String(a.product_id || '').localeCompare(String(b.product_id || '')));
            const fp = JSON.stringify(
              fpItems.map((it) => ({
                product_id: String(it.product_id || ''),
                quantity: Number(it.quantity || 0),
                unit_price: Number(it.unit_price || 0)
              }))
            );
            KellyToolExecutor._setSessionMeta(sessionId, 'commerce_shipping_cart_fingerprint', fp);
          }
        } catch (_) {}
      }
      shippingCaptured = true;
      if (stage !== 'code_verified') {
        if (emailMatch && !codeMatch) {
          // Continue into deterministic email handler below so mixed email+address
          // in one turn sends code and persists shipping together.
        } else {
          const pending = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') || '').trim();
          if (pending) {
            return {
              handled: true,
              result: {
                reply: _canonicalRailCopy('enter_code', { email: pending }),
                endCall: false,
                toolsUsed: ['save_shipping_address']
              }
            };
          }
          return {
            handled: true,
            result: {
              reply: _canonicalRailCopy('provide_email'),
              endCall: false,
              toolsUsed: ['save_shipping_address']
            }
          };
        }
      } else {
        return {
          handled: true,
          result: {
            reply: 'Shipping address saved. Say "**continue secure checkout**" and I will prepare secure payment now.',
            endCall: false,
            toolsUsed: ['save_shipping_address']
          }
        };
      }
    }

    // Never restart verification while payment is in progress or already confirmed.
    if (emailMatch && !codeMatch && (stage === 'checkout_prepared' || stage === 'payment_confirmed')) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }

    // Deterministic email intercept: always send verification code on first email capture.
    if (emailMatch && !codeMatch) {
      const email = String(emailMatch[0]).toLowerCase();
      const sent = await KellyToolExecutor.execute(
        'send_commerce_verification_code',
        { email },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (sent?.success) {
        return {
          handled: true,
          result: {
            reply: shippingCaptured
            ? `I saved your shipping address. ${_canonicalRailCopy('enter_code', { email })}`
            : _canonicalRailCopy('enter_code', { email }),
            endCall: false,
            toolsUsed: ['send_commerce_verification_code']
          }
        };
      }
      return {
        handled: true,
        result: {
          reply: 'I could not send the verification code just now. Please confirm your email and try again.',
          endCall: false,
          toolsUsed: ['send_commerce_verification_code']
        }
      };
    }

    // Deterministic code intercept: verify code as soon as user provides 6 digits.
    if (codeMatch && pendingEmail) {
      const code = codeMatch[1];
      const verify = await KellyToolExecutor.execute(
        'verify_commerce_code',
        { email: pendingEmail, code },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (verify?.success) {
        return {
          handled: true,
          result: {
            reply: 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.',
            endCall: false,
            toolsUsed: ['verify_commerce_code']
          }
        };
      }
      return {
        handled: true,
        result: {
          reply: 'That verification code did not match. Please try the 6-digit code again or ask me to resend.',
          endCall: false,
          toolsUsed: ['verify_commerce_code']
        }
      };
    }

    // Deterministic post-prepare/terminal continue intercepts should never fall back to LLM.
    if (continueIntent && (stage === 'checkout_prepared' || stage === 'payment_confirmed' || stage === 'failed')) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }
    // Deterministic payment-help intercept for prepared/terminal stages.
    if (paymentHelpIntent && (stage === 'checkout_prepared' || stage === 'payment_confirmed' || stage === 'failed')) {
      return {
        handled: true,
        result: {
          reply: _mapAlreadyInProgressCopyByStage(sessionId),
          endCall: false,
          toolsUsed: []
        }
      };
    }

    // Deterministic continue-checkout intercept: only after verified stage + complete shipping.
    if (continueIntent && stage === 'code_verified') {
      const verifiedEmail =
        String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_verified') || pendingEmail || '').trim().toLowerCase();
      const shippingComplete = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
      const shippingRaw = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_address') || '').trim();
      if (!verifiedEmail) {
        return {
          handled: true,
          result: {
            reply: 'Please share your email so I can send a 6-digit verification code first.',
            endCall: false,
            toolsUsed: []
          }
        };
      }
      if (!shippingComplete || !shippingRaw) {
        const storedLine1 = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_line1') || '').trim();
        const storedCity = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_city') || '').trim();
        const storedState = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_state') || '').trim();
        const storedZip = String(KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_shipping_postal_code') || '').trim();
        const missing = [];
        if (!storedLine1) missing.push('street address');
        if (!storedCity) missing.push('city');
        if (!storedState) missing.push('state');
        if (!storedZip) missing.push('ZIP code');
        return {
          handled: true,
          result: {
            reply: missing.length
              ? `I still need your ${missing.join(', ')} before secure checkout.`
              : _canonicalRailCopy('shipping_required'),
            endCall: false,
            toolsUsed: []
          }
        };
      }
      _refreshStaleShippingTtlIfEligible(sessionId);
      const prep = await KellyToolExecutor.execute(
        'prepare_commerce_checkout',
        { customer_email: verifiedEmail, shipping_address: shippingRaw, use_cart: true },
        { sessionId, clinicId, patientId, callerPhone: null, channel }
      );
      if (prep?.success) {
        return {
          handled: true,
          result: {
            reply: 'Secure checkout is prepared. Complete payment in the secure checkout interface below.',
            endCall: false,
            toolsUsed: ['prepare_commerce_checkout'],
            commerce_checkout: prep?.commerce_checkout || null
          }
        };
      }
      if (String(prep?.error || '') === 'checkout_already_in_progress') {
        return {
          handled: true,
          result: {
            reply: _mapAlreadyInProgressCopyByStage(sessionId),
            endCall: false,
            toolsUsed: ['prepare_commerce_checkout']
          }
        };
      }
      return {
        handled: true,
        result: {
          reply: String(prep?.message || 'I could not prepare checkout yet. Please try again.'),
          endCall: false,
          toolsUsed: ['prepare_commerce_checkout']
        }
      };
    }
  } catch (_) {}
  return { handled: false, result: null };
}

async function handlePatientCheckoutChatMessage(req) {
  const PatientPortalService = require('./patient-portal-service');
  const KellyAgentService = require('./kelly-agent-service');
  const CheckoutGraph = require('./checkout-graph');
  const { resolveMerchantIdForCheckoutChat, applyCommerceQuantityIntentIfEligible } = require('../utils/public-commerce-helpers');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  let clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
  if (!clinicId && mappedPatientId && db?.getPatientClinicIds) {
    try {
      const patientClinics = db.getPatientClinicIds(mappedPatientId);
      clinicId = patientClinics?.[0] || null;
    } catch (_) {}
  }
  if (!clinicId) {
    return {
      status: 400,
      json: {
        success: false,
        error: 'clinic_id required. Set DEFAULT_CLINIC_ID in .env, include clinic_id in request, or ensure patient has appointments.',
        request_id: req.id
      }
    };
  }
  const message = (req.body?.message || '').toString().trim();
  const productId = (req.body?.product_id || '').toString().trim();
  const providerId = (req.body?.provider_id || '').toString().trim();
  let session_id = (req.body?.session_id || '').toString().trim() || null;
  if (!session_id) session_id = require('uuid').v4();
  if (_getCheckoutStage(session_id) === 'checkout_prepared') {
    await _syncCheckoutPaymentStatusIfPrepared(session_id, 'turn_pre_reply');
  }
  if (_looksLikeCardOrCvv(message)) {
    return {
      status: 200,
      json: {
        success: true,
        reply: 'For your security, please do not enter card numbers or CVV in chat. Use the secure payment form only.',
        session_id,
        ...buildStageContract(session_id),
        toolsUsed: [],
        request_id: req.id
      }
    };
  }
  const deterministic = await _maybeHandleDeterministicCommerceVerificationTurn({
    message,
    sessionId: session_id,
    clinicId,
    patientId: mappedPatientId,
    channel: 'chat'
  });
  if (deterministic.handled) {
    return {
      status: 200,
      json: {
        success: true,
        reply: deterministic.result.reply,
        session_id,
        ...buildStageContract(session_id),
        toolsUsed: Array.isArray(deterministic.result.toolsUsed) ? deterministic.result.toolsUsed : [],
        request_id: req.id
      }
    };
  }

  const merchantIdEarly = resolveMerchantIdForCheckoutChat({ providerId, clinicId });
  if (merchantIdEarly && message) {
    try {
      await applyCommerceQuantityIntentIfEligible({
        message,
        sessionId: session_id,
        merchantId: merchantIdEarly,
        productId: productId || undefined
      });
    } catch (e) {
      console.warn('⚠️  commerce quantity intent:', e.message);
    }
  }

  const graphPayload = {
    message,
    sessionId: session_id,
    clinicId,
    patientId: mappedPatientId,
    patientEmail: email,
    productId,
    providerId
  };
  let result = await _runCheckoutGraphWithCircuitBreaker(CheckoutGraph, graphPayload, 2000);
  if (!result?.success) {
    if (_isMidFlightCheckout(session_id, message)) {
      result = _safeCheckoutDegradeResponse();
    } else {
    result = await KellyAgentService.processTurn({
      message,
      sessionId: session_id,
      channel: 'chat',
      clinicId,
      patientId: mappedPatientId,
      patientName: null,
      patientEmail: email,
      portalSessionId: sid,
      commerceCheckout: { productId, providerId }
    });
    }
  }

  const row = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
  let conversationHistory = Array.isArray(row?.conversation_history) ? row.conversation_history : [];
  // Commerce flow does not use triage wipe rules — persist turns for continuity.
  if (db?.upsertOrchestrateSession) {
    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: result.reply }
    ];
    const newTurnCount = (row?.turn_count || 0) + 1;
    try {
      db.upsertOrchestrateSession({
        session_id,
        channel: 'chat',
        patient_id: mappedPatientId,
        portal_session_id: sid,
        clinic_id: clinicId,
        conversation_history: updatedHistory,
        flow_state: { ...(row?.flow_state || {}), commerce_checkout: { product_id: productId, provider_id: providerId } },
        turn_count: newTurnCount,
        preferred_language: row?.preferred_language || 'en'
      });
    } catch (e) {
      console.warn('⚠️  Failed to persist checkout chat session:', e.message);
    }
  }

  const reply = normalizeCheckoutVerificationReply(
    (result.reply && String(result.reply).trim()) || "I'm here. How can I help you today?",
    session_id
  );
  return {
    status: 200,
    json: {
      success: true,
      reply,
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      redirect_to: result.redirect_to || null,
      next_chips: result.next_chips || [],
      chips_display: result.chips_display,
      next_step: result.next_step,
      quote_id: result.quote_id || null,
      commerce_checkout: result.commerce_checkout || null,
      llm_usage: result.llm_usage || null,
      provider_cards: Array.isArray(result.provider_cards) ? result.provider_cards : undefined,
      literature_snippets: Array.isArray(result.literature_snippets) ? result.literature_snippets : undefined,
      safe_degraded: !!result.safe_degraded,
      human_handoff_recommended: !!result.human_handoff_recommended,
      request_id: req.id
    }
  };
}

function normalizeCheckoutVerificationReply(text, sessionId = null) {
  const s = String(text || '').trim();
  if (!s) return s;
  const stage = _getCheckoutStage(sessionId) || 'collecting_details';
  if (
    stage === 'checkout_prepared' &&
    /\b(email address|6-?digit verification code|send (a )?code|verify your email|what'?s your email|shipping address|street, city, state, ZIP)\b/i.test(s)
  ) {
    return 'Secure checkout is prepared. Complete payment in the secure checkout form.';
  }
  try {
    const KellyToolExecutor = require('./kelly-tool-executor');
    const shippingComplete =
      String(KellyToolExecutor?._getSessionMeta?.(sessionId, 'commerce_shipping_complete') || '') === '1';
    if (
      stage === 'code_verified' &&
      /\b(6-digit verification code|send code|enter (the )?6-digit code|verification code)\b/i.test(s)
    ) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_duplicate_otp_prompt'); } catch (_) {}
      return 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.';
    }
    if (
      stage === 'code_verified' &&
      shippingComplete &&
      /\b(share|provide).{0,30}(full )?shipping address\b/i.test(s)
    ) {
      try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_shipping_reask_after_capture'); } catch (_) {}
      return 'Shipping address saved. Say "**continue secure checkout**" and I will prepare secure payment now.';
    }
  } catch (_) {}
  if (/checkout (is )?already in progress|already in progress/i.test(s)) {
    return _mapAlreadyInProgressCopyByStage(sessionId);
  }
  const forbiddenByStage = {
    collecting_details: /\b(checkout is ready|secure payment is now ready|checkout (is )?already in progress|already in progress|payment form|order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order|enter your card|card details)\b/i,
    code_sent: /\b(checkout is ready|secure payment is now ready|checkout (is )?already in progress|already in progress|payment form|order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order|enter your card|card details)\b/i,
    code_verified: /\b(order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order|receipt)\b/i,
    checkout_prepared: /\b(order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order)\b/i,
    payment_confirmed: null,
    failed: /\b(order confirmed|purchase complete|payment (has been )?(processed|completed|confirmed)|thank you for your order)\b/i
  };
  const templateByStage = {
    collecting_details: () => 'Please share your email address so I can send a 6-digit verification code to continue to secure checkout.',
    code_sent: (email) =>
      email
        ? `We sent a 6-digit verification code to ${email}. Please enter that code to continue to secure checkout.`
        : 'We sent a 6-digit verification code to your email. Please enter that code to continue to secure checkout.',
    code_verified: () => 'Email verified. Say "**continue secure checkout**" and I will prepare secure payment now.',
    checkout_prepared: () => 'Secure checkout is prepared. Complete payment in the secure checkout form.',
    payment_confirmed: () => 'Payment confirmed. Your order is complete and receipt details are available.',
    failed: () => 'Payment was not completed. Please say "**continue secure checkout**" to retry.'
  };
  const forbidden = Object.prototype.hasOwnProperty.call(forbiddenByStage, stage)
    ? forbiddenByStage[stage]
    : forbiddenByStage.collecting_details;
  if (forbidden && forbidden.test(s)) {
    try {
      db.incrementOpsCounter && db.incrementOpsCounter('checkout_forbidden_payment_ready_phrase');
    } catch (_) {}
    try {
      console.warn('[checkout-stage] policy_violation_replaced', {
        session_id: String(sessionId || ''),
        stage,
        snippet: s.slice(0, 220)
      });
    } catch (_) {}
    const templateFn = templateByStage[stage];
    if (templateFn) {
      let email = null;
      try {
        const KellyToolExecutor = require('./kelly-tool-executor');
        email =
          KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_pending') ||
          KellyToolExecutor._getSessionMeta?.(sessionId, 'commerce_email_verified') ||
          null;
      } catch (_) {}
      const canonical = templateFn(email);
      if (canonical) return canonical;
    }
  }

  if (stage === 'code_sent' || stage === 'collecting_details') {
    const looksLikeHandoff =
      /(secure payment page|secure payment form|taken to .*secure payment|complete your purchase|enter your card details)/i.test(s);
    const mentionsVerification = /(verification code|6-?digit code|verify your email)/i.test(s);
    if (looksLikeHandoff && !mentionsVerification) {
      return `${s} Before payment, please enter the 6-digit verification code we emailed you.`;
    }
  }
  return s;
}

async function _runCheckoutPreparedBackfillOnce() {
  try {
    const rows = db.db.prepare(`
      SELECT session_id, value AS updated_at_ms
      FROM kelly_session_meta_kv
      WHERE meta_key = 'checkout_stage_updated_at_ms'
        AND session_id IN (
          SELECT session_id FROM kelly_session_meta_kv
          WHERE meta_key = 'checkout_stage' AND value = 'checkout_prepared'
        )
    `).all();
    const stale = (rows || []).filter((r) => {
      const ts = parseInt(String(r?.updated_at_ms || '0'), 10);
      return Number.isFinite(ts) && ts > 0 && (Date.now() - ts > CHECKOUT_PREPARED_STALE_MS);
    });
    if (!stale.length) return;
    const KellyToolExecutor = require('./kelly-tool-executor');
    for (const row of stale) {
      const sid = String(row?.session_id || '').trim();
      if (!sid) continue;
      KellyToolExecutor._setCheckoutStage(sid, 'failed', { reason: 'legacy_stuck_checkout_prepared_backfill' });
      KellyToolExecutor._setSessionMeta(sid, 'payment_outcome_status', 'failed');
      KellyToolExecutor._setSessionMeta(sid, 'payment_status_source', 'startup_backfill');
      KellyToolExecutor._setSessionMeta(sid, 'payment_status_last_checked_at', String(Date.now()));
      try {
        db.enqueueToolCallDLQ && db.enqueueToolCallDLQ({
          call_id: `checkout_backfill_${sid}`,
          function_name: 'checkout_backfill_reconciliation',
          parameters: { session_id: sid },
          error_message: 'legacy_stuck_checkout_prepared_session_recovered'
        });
      } catch (_) {}
    }
    try { db.incrementOpsCounter && db.incrementOpsCounter('checkout_stale_prepared_backfill_recovered'); } catch (_) {}
  } catch (_) {}
}

// POST /api/patient/checkout-chat/turn/stream — Same as /turn but streams Groq token deltas (SSE).
async function handlePatientCheckoutChatMessageStream(req, res) {
  const PatientPortalService = require('./patient-portal-service');
  const KellyAgentService = require('./kelly-agent-service');
  const CheckoutGraph = require('./checkout-graph');
  const { resolveMerchantIdForCheckoutChat, applyCommerceQuantityIntentIfEligible } = require('../utils/public-commerce-helpers');
  const sid = req.patientSessionId;
  const sessionValidation = PatientPortalService.validateSession(sid);
  const email = sessionValidation?.email || null;
  const mappedPatientId = sessionValidation?.patient_id || null;
  let clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
  if (!clinicId && mappedPatientId && db?.getPatientClinicIds) {
    try {
      const patientClinics = db.getPatientClinicIds(mappedPatientId);
      clinicId = patientClinics?.[0] || null;
    } catch (_) {}
  }
  const sseWrite = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  if (!clinicId) {
    sseWrite({
      type: 'error',
      success: false,
      error:
        'clinic_id required. Set DEFAULT_CLINIC_ID in .env, include clinic_id in request, or ensure patient has appointments.',
      request_id: req.id
    });
    return res.end();
  }
  const message = (req.body?.message || '').toString().trim();
  const productId = (req.body?.product_id || '').toString().trim();
  const providerId = (req.body?.provider_id || '').toString().trim();
  let session_id = (req.body?.session_id || '').toString().trim() || null;
  if (!session_id) session_id = require('uuid').v4();
  if (_getCheckoutStage(session_id) === 'checkout_prepared') {
    await _syncCheckoutPaymentStatusIfPrepared(session_id, 'stream_pre_reply');
  }
  if (_looksLikeCardOrCvv(message)) {
    sseWrite({
      type: 'done',
      success: true,
      reply: 'For your security, please do not enter card numbers or CVV in chat. Use the secure payment form only.',
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: [],
      request_id: req.id
    });
    return res.end();
  }
  const deterministic = await _maybeHandleDeterministicCommerceVerificationTurn({
    message,
    sessionId: session_id,
    clinicId,
    patientId: mappedPatientId,
    channel: 'chat'
  });
  if (deterministic.handled) {
    sseWrite({
      type: 'done',
      success: true,
      reply: deterministic.result.reply,
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: Array.isArray(deterministic.result.toolsUsed) ? deterministic.result.toolsUsed : [],
      commerce_checkout: deterministic.result.commerce_checkout || null,
      request_id: req.id
    });
    return res.end();
  }

  const onStreamDelta = (text) => {
    if (text) sseWrite({ type: 'delta', text: String(text) });
  };

  try {
    const merchantIdEarly = resolveMerchantIdForCheckoutChat({ providerId, clinicId });
    if (merchantIdEarly && message) {
      try {
        await applyCommerceQuantityIntentIfEligible({
          message,
          sessionId: session_id,
          merchantId: merchantIdEarly,
          productId: productId || undefined
        });
      } catch (e) {
        console.warn('⚠️  commerce quantity intent (stream):', e.message);
      }
    }

    const graphPayload = {
      message,
      sessionId: session_id,
      clinicId,
      patientId: mappedPatientId,
      patientEmail: email,
      productId,
      providerId
    };
    let result = await _runCheckoutGraphWithCircuitBreaker(CheckoutGraph, graphPayload, 2000);
    if (!result?.success) {
      if (_isMidFlightCheckout(session_id, message)) {
        result = _safeCheckoutDegradeResponse();
      } else {
      result = await KellyAgentService.processTurn({
        message,
        sessionId: session_id,
        channel: 'chat',
        clinicId,
        patientId: mappedPatientId,
        patientName: null,
        patientEmail: email,
        portalSessionId: sid,
        commerceCheckout: { productId, providerId },
        onStreamDelta,
        onToolStatus: (toolName, text) => {
          sseWrite({ type: 'tool_status', tool: toolName, text: text || '…' });
        }
      });
      }
    }

    const row = db?.getOrchestrateSessionBySessionId?.(session_id) || null;
    let conversationHistory = Array.isArray(row?.conversation_history) ? row.conversation_history : [];
    if (db?.upsertOrchestrateSession) {
      const updatedHistory = [
        ...conversationHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: result.reply }
      ];
      const newTurnCount = (row?.turn_count || 0) + 1;
      try {
        db.upsertOrchestrateSession({
          session_id,
          channel: 'chat',
          patient_id: mappedPatientId,
          portal_session_id: sid,
          clinic_id: clinicId,
          conversation_history: updatedHistory,
          flow_state: {
            ...(row?.flow_state || {}),
            commerce_checkout: { product_id: productId, provider_id: providerId }
          },
          turn_count: newTurnCount,
          preferred_language: row?.preferred_language || 'en'
        });
      } catch (e) {
        console.warn('⚠️  Failed to persist checkout chat session (stream):', e.message);
      }
    }

    const reply = normalizeCheckoutVerificationReply(
      (result.reply && String(result.reply).trim()) || "I'm here. How can I help you today?"
      , session_id);
    sseWrite({
      type: 'done',
      success: true,
      reply,
      session_id,
      ...buildStageContract(session_id),
      toolsUsed: Array.isArray(result.toolsUsed) ? result.toolsUsed : [],
      redirect_to: result.redirect_to || null,
      next_chips: result.next_chips || [],
      chips_display: result.chips_display,
      next_step: result.next_step,
      quote_id: result.quote_id || null,
      commerce_checkout: result.commerce_checkout || null,
      llm_usage: result.llm_usage || null,
      provider_cards: Array.isArray(result.provider_cards) ? result.provider_cards : undefined,
      literature_snippets: Array.isArray(result.literature_snippets) ? result.literature_snippets : undefined,
      safe_degraded: !!result.safe_degraded,
      human_handoff_recommended: !!result.human_handoff_recommended,
      request_id: req.id
    });
    return res.end();
  } catch (e) {
    console.error('checkout-chat stream error:', e);
    sseWrite({ type: 'error', success: false, error: e.message || 'stream_failed', request_id: req.id });
    return res.end();
  }
}

module.exports = {
  handlePatientCheckoutChatMessage,
  handlePatientCheckoutChatMessageStream,
  _getCheckoutStage,
  buildStageContract,
  _isMidFlightCheckout,
};
