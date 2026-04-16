'use strict';

const crypto = require('crypto');
const db = require('../database');
const PaymentProcessorService = require('./payment-processor-service');
const FinancialIntegrityService = require('./financial-integrity-service');

const MAX_AGE_DAYS = Math.max(1, parseInt(process.env.REFUND_MAX_AGE_DAYS || '120', 10) || 120);

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    return '{}';
  }
}

/**
 * Full vs partial eligibility: completed Stripe checkout, within age window,
 * requested amount ≤ available (captured − already refunded on the PaymentIntent).
 */
async function evaluateRefundEligibility({ checkout, amount = null, stripe }) {
  const result = {
    eligible: false,
    refund_kind: amount != null && amount > 0 ? 'partial' : 'full',
    codes: [],
    available_to_refund: null,
    payment_intent_id: null
  };

  if (!checkout) {
    result.codes.push('MISSING_CHECKOUT');
    return result;
  }
  if (checkout.status !== 'completed') {
    result.codes.push('CHECKOUT_NOT_COMPLETED');
    return result;
  }
  if (checkout.payment_method === 'wallet') {
    result.codes.push('WALLET_NOT_SUPPORTED');
    return result;
  }
  const piId = checkout.payment_intent_id;
  if (!piId) {
    result.codes.push('NO_PAYMENT_INTENT');
    return result;
  }
  result.payment_intent_id = piId;

  if (!stripe) {
    result.codes.push('STRIPE_UNAVAILABLE');
    return result;
  }

  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(piId);
  } catch (e) {
    result.codes.push('PI_RETRIEVE_FAILED');
    result.stripe_error = e.message;
    return result;
  }

  const createdSec = pi.created ? Number(pi.created) * 1000 : null;
  if (createdSec) {
    const ageDays = (Date.now() - createdSec) / (24 * 60 * 60 * 1000);
    if (ageDays > MAX_AGE_DAYS) {
      result.codes.push('REFUND_WINDOW_EXPIRED');
      result.max_age_days = MAX_AGE_DAYS;
      return result;
    }
  }

  const paid = (Number(pi.amount_received || 0) || 0) / 100;
  const alreadyRefunded = (Number(pi.amount_refunded || 0) || 0) / 100;
  const available = Math.round((paid - alreadyRefunded) * 100) / 100;
  result.available_to_refund = available;

  if (available <= 0) {
    result.codes.push('NOTHING_LEFT_TO_REFUND');
    return result;
  }

  const want =
    amount != null && Number(amount) > 0
      ? Math.round(Number(amount) * 100) / 100
      : available;

  if (want > available + 0.001) {
    result.codes.push('AMOUNT_EXCEEDS_AVAILABLE');
    result.requested = want;
    return result;
  }

  if (want < 0.01 && available >= 0.01) {
    result.codes.push('AMOUNT_TOO_SMALL');
    return result;
  }

  result.eligible = true;
  result.codes.push('OK');
  return result;
}

function recordRefundAudit(row) {
  return db.insertPaymentRefundAudit(row);
}

function updateRefundAudit(id, updates) {
  return db.updatePaymentRefundAudit(id, updates);
}

/**
 * Standardized refund: eligibility → audit row → Stripe refund → financial integrity + audit update.
 */
async function executeRefundWorkflow({
  checkout,
  amount = null,
  reason = 'requested_by_customer',
  actor_type = 'system',
  actor_id = null
}) {
  const workflow_id = `rfw_${crypto.randomBytes(8).toString('hex')}`;
  let stripe;
  try {
    const stripeConfig = require('../utils/stripe-config');
    stripe = stripeConfig.initializeStripe();
  } catch (e) {
    const id = `pra_${crypto.randomBytes(8).toString('hex')}`;
    recordRefundAudit({
      id,
      workflow_id,
      checkout_id: checkout?.id || null,
      payment_intent_id: checkout?.payment_intent_id || null,
      actor_type,
      actor_id,
      refund_kind: amount != null ? 'partial' : 'full',
      amount_requested: amount,
      amount_refunded: null,
      eligibility_json: safeJson({ error: 'stripe_unconfigured' }),
      stripe_refund_id: null,
      status: 'failed',
      error_message: 'Stripe not configured'
    });
    return { success: false, workflow_id, error: 'Stripe not configured' };
  }

  const eligibility = await evaluateRefundEligibility({ checkout, amount, stripe });
  const auditId = `pra_${crypto.randomBytes(8).toString('hex')}`;
  recordRefundAudit({
    id: auditId,
    workflow_id,
    checkout_id: checkout?.id || null,
    payment_intent_id: eligibility.payment_intent_id || checkout?.payment_intent_id || null,
    actor_type,
    actor_id,
    refund_kind: eligibility.refund_kind,
    amount_requested: amount,
    amount_refunded: null,
    eligibility_json: safeJson(eligibility),
    stripe_refund_id: null,
    status: eligibility.eligible ? 'approved' : 'rejected',
    error_message: eligibility.eligible ? null : eligibility.codes.join(',')
  });

  if (!eligibility.eligible) {
    return {
      success: false,
      workflow_id,
      eligibility,
      error: eligibility.codes.join(', ')
    };
  }

  const execAmount =
    eligibility.refund_kind === 'partial' && amount != null && Number(amount) > 0
      ? Number(amount)
      : null;

  const refundResult = await PaymentProcessorService.refundCheckout(checkout, {
    reason,
    amount: execAmount
  });

  if (!refundResult.success) {
    updateRefundAudit(auditId, {
      status: 'failed',
      error_message: refundResult.error || 'refund_failed'
    });
    return { success: false, workflow_id, eligibility, ...refundResult };
  }

  try {
    FinancialIntegrityService.recordStripeRefundReconciliation({
      refundId: refundResult.refund_id,
      paymentIntentId: checkout.payment_intent_id,
      amount: refundResult.amount_refunded,
      checkoutId: checkout.id,
      currency: 'USD'
    });
  } catch (e) {
    console.warn('[RefundWorkflow] financial integrity (non-fatal):', e.message);
  }

  updateRefundAudit(auditId, {
    status: 'executed',
    amount_refunded: refundResult.amount_refunded,
    stripe_refund_id: refundResult.refund_id,
    error_message: null
  });

  return {
    success: true,
    workflow_id,
    eligibility,
    refund_id: refundResult.refund_id,
    amount_refunded: refundResult.amount_refunded
  };
}

module.exports = {
  evaluateRefundEligibility,
  executeRefundWorkflow,
  MAX_AGE_DAYS
};
