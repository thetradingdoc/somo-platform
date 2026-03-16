/**
 * PAYMENT PROCESSOR SERVICE
 * Shared logic for /process-payment and /api/payment/process (Task 11).
 * Handles: amount validation from checkout, financial audit, ledger, receipt email.
 */

const db = require('../database');
const LedgerService = require('./ledger-service');

/**
 * Resolve checkout from request body (supports payment_token or checkout_id)
 * Task 14: Always derive amount from checkout, never trust req.body.amount
 */
async function resolveCheckout(body) {
  const { payment_token, checkout_id } = body || {};
  let checkout = null;
  if (payment_token) {
    const tokenRecord = db.getPaymentToken(payment_token);
    if (tokenRecord) {
      checkout = db.getVoiceCheckout ? await db.getVoiceCheckout(tokenRecord.checkout_id) : null;
    }
  }
  if (!checkout && checkout_id) {
    checkout = db.getVoiceCheckout ? await db.getVoiceCheckout(checkout_id) : null;
  }
  return checkout;
}

/**
 * Task 12, 15, 16: Post-payment completion - financial audit, ledger, receipt email
 */
async function completePaymentSuccess({ checkout, amount, paymentMethod, paymentIntentId, transferId }) {
  const results = { financialEvent: null, ledgerSettled: 0 };
  const amt = parseFloat(amount) || parseFloat(checkout.amount) || 0;
  const currency = 'USD';
  const extId = paymentIntentId || transferId || checkout.id;

  const patientId = (checkout.patient_id) ||
      (checkout.customer_email && (() => {
        const p = db.getFHIRPatientByEmail && db.getFHIRPatientByEmail(checkout.customer_email);
        return p ? p.resource_id : null;
      })()) ||
      (checkout.customer_phone && (() => {
        const p = db.getFHIRPatientByPhone && db.getFHIRPatientByPhone(checkout.customer_phone);
        return p ? p.resource_id : null;
      })()) ||
      null;
  const providerId = checkout.clinic_id || checkout.merchant_id || 'system';

  try {
    db.insertFinancialEvent({
      event_type: paymentMethod === 'wallet' ? 'circle_transfer' : 'payment_intent',
      actor_type: 'patient',
      actor_id: patientId,
      amount: amt,
      currency,
      rail_type: paymentMethod === 'wallet' ? 'circle' : 'stripe',
      status: 'succeeded',
      cause: 'voice_or_web_checkout',
      metadata: {
        checkout_id: checkout.id,
        payment_intent_id: paymentIntentId || null,
        transfer_id: transferId || null
      }
    });
    results.financialEvent = true;
  } catch (e) {
    console.warn('⚠️  insertFinancialEvent failed:', e.message);
  }

  try {
    const patientAcct = LedgerService.ensureAccount({
      ownerType: 'patient',
      ownerId: patientId || `checkout-${checkout.id}`,
      currency,
      railType: paymentMethod === 'wallet' ? 'circle' : 'stripe'
    });
    const providerAcct = LedgerService.ensureAccount({
      ownerType: 'provider',
      ownerId: providerId,
      currency,
      railType: paymentMethod === 'wallet' ? 'circle' : 'stripe'
    });
    LedgerService.transfer({
      fromAccount: patientAcct,
      toAccount: providerAcct,
      amount: amt,
      currency,
      externalRefType: 'checkout',
      externalRefId: extId,
      description: `Payment for ${checkout.product_name || 'appointment'} - ${checkout.id}`
    });
    results.ledgerSettled = LedgerService.settleByExternalRef('checkout', extId);
  } catch (e) {
    console.warn('⚠️  Ledger transfer failed:', e.message);
  }

  if (checkout.customer_email) {
    try {
      const EmailService = require('./email-service');
      if (typeof EmailService.sendPaymentReceipt === 'function') {
        let appointment = null;
        if (checkout.appointment_id && db.getAppointment) {
          appointment = await db.getAppointment(checkout.appointment_id);
        }
        await EmailService.sendPaymentReceipt(checkout, amt, paymentIntentId || transferId, appointment);
      }
    } catch (e) {
      console.warn('⚠️  Receipt email failed:', e.message);
    }
  }

  return results;
}

/**
 * Record refund event for audit (Task 17/22)
 */
async function recordRefundEvent({ checkout, amount, refundId }) {
  try {
    db.insertFinancialEvent({
      event_type: 'refund',
      actor_type: 'system',
      actor_id: null,
      amount: -amount,
      currency: 'USD',
      rail_type: 'stripe',
      status: 'succeeded',
      cause: 'refund',
      metadata: { checkout_id: checkout.id, refund_id: refundId }
    });
  } catch (e) {
    console.warn('insertFinancialEvent refund failed:', e.message);
  }
}

/**
 * Refund a completed checkout (e.g. on appointment cancellation).
 * Stripe only; wallet (USDC) refund not implemented.
 * @param {Object} checkout - voice_checkout row (status 'completed', with payment_intent_id for Stripe)
 * @param {Object} options - { reason?: string, amount?: number } full refund if amount omitted
 * @returns {Promise<{ success: boolean, refund_id?: string, amount_refunded?: number, error?: string }>}
 */
async function refundCheckout(checkout, options = {}) {
  const reason = options.reason || 'requested_by_customer';
  const amount = options.amount != null ? parseFloat(options.amount) : null;

  if (!checkout || checkout.status !== 'completed') {
    return { success: false, error: 'Checkout not found or not completed' };
  }

  if (checkout.payment_method === 'wallet') {
    console.warn('⚠️  Wallet (USDC) refund not implemented for checkout:', checkout.id);
    return { success: false, error: 'Wallet refund not implemented' };
  }

  const piId = checkout.payment_intent_id;
  if (!piId) {
    return { success: false, error: 'No payment intent to refund' };
  }

  let stripe;
  try {
    const stripeConfig = require('../utils/stripe-config');
    stripe = stripeConfig.initializeStripe();
  } catch (e) {
    return { success: false, error: 'Stripe not configured' };
  }

  try {
    const refundCents = amount != null && amount > 0 ? Math.round(amount * 100) : undefined;
    const refundOpts = {
      payment_intent: piId,
      reason: ['requested_by_customer', 'duplicate', 'fraudulent'].includes(reason) ? reason : 'requested_by_customer'
    };
    if (refundCents) refundOpts.amount = refundCents;

    const refund = await stripe.refunds.create(refundOpts);
    const amtRefunded = (refund.amount || 0) / 100;

    await recordRefundEvent({ checkout, amount: amtRefunded, refundId: refund.id });

    if (db.updateVoiceCheckout) {
      try {
        await db.updateVoiceCheckout(checkout.id, { status: 'refunded' });
      } catch (_) {
        // Schema may not have 'refunded'; leave status as 'completed'
      }
    }

    return {
      success: true,
      refund_id: refund.id,
      amount_refunded: amtRefunded,
      status: refund.status
    };
  } catch (e) {
    console.error('Refund error:', e.message);
    return {
      success: false,
      error: e.message,
      stripe_error_code: e.code
    };
  }
}

module.exports = {
  resolveCheckout,
  completePaymentSuccess,
  recordRefundEvent,
  refundCheckout
};
