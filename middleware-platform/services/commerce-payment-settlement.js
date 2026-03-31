/**
 * Shared commerce settlement after Stripe PaymentIntent succeeds.
 * Used by: Stripe webhooks, PaymentOrchestrator (sync success), POST /commerce/stripe/confirm-payment (client after Elements).
 */
'use strict';

const db = require('../database');
const PaymentProcessorService = require('./payment-processor-service');
const { ensureMerchantOrderFromVoiceCheckout } = require('./ensure-merchant-order-from-voice-checkout');

function hasReceiptForPaymentIntent(piId) {
  if (!piId) return false;
  try {
    const row = db.db
      .prepare(
        `SELECT id FROM payment_receipts WHERE external_payment_id = ? AND (deleted_at IS NULL OR deleted_at = '') LIMIT 1`
      )
      .get(piId);
    return !!row;
  } catch (_) {
    return false;
  }
}

/**
 * Create/update merchant_orders from a succeeded PI (same logic as Stripe webhook).
 */
async function reconcileMerchantOrderPaymentSucceeded(paymentIntent) {
  try {
    const metadata = paymentIntent?.metadata || {};
    const directOrderId = metadata.order_id || metadata.merchant_order_id || null;
    const checkoutId = metadata.checkout_id || null;
    let orderId = directOrderId;

    if (!orderId && checkoutId && db.getVoiceCheckout) {
      try {
        const checkout = await db.getVoiceCheckout(checkoutId);
        if (checkout?.merchant_order_id) orderId = checkout.merchant_order_id;
      } catch (_) {}
    }

    if (orderId) {
      const order = db.getOrder(orderId);
      if (!order) {
        console.warn('[CommerceSettlement] merchant order not found for payment success:', orderId);
        if (!checkoutId || !db.getVoiceCheckout) return;
      } else {
        const updates = {
          payment_status: 'paid'
        };
        if (!order.status || order.status === 'pending') {
          updates.status = 'confirmed';
        }
        db.updateOrder(orderId, updates);

        try {
          db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_payment_paid');
        } catch (_) {}
        console.log('[CommerceSettlement] merchant order paid (existing):', {
          order_id: orderId,
          payment_intent_id: paymentIntent?.id
        });
        return;
      }
    }

    if (!checkoutId || !db.getVoiceCheckout) {
      console.warn(
        '[CommerceSettlement] No checkout_id in PI metadata and no orderId — cannot create order for:',
        paymentIntent?.id
      );
      return;
    }

    const checkout = await db.getVoiceCheckout(checkoutId);
    if (!checkout) {
      console.warn('[CommerceSettlement] voice checkout not found for PI metadata.checkout_id:', checkoutId);
      return;
    }

    await ensureMerchantOrderFromVoiceCheckout(paymentIntent, checkout, { source: 'commerce_settlement' });
  } catch (error) {
    console.error('[CommerceSettlement] merchant order reconcile (success) failed:', error.message);
  }
}

/**
 * Ledger + receipt email + unlock commerce cart (retail, no appointment).
 */
async function finalizeCommerceRetailPayment(paymentIntent, amountCents) {
  const metadata = paymentIntent?.metadata || {};
  const checkoutId = metadata.checkout_id;
  const cartSessionId = metadata.cart_session_id;
  const merchantId = metadata.merchant_id;
  const piId = paymentIntent?.id;
  if (!db.getVoiceCheckout) return;

  // Resolve checkout even if PI metadata.checkout_id is missing.
  // This prevents “email not sent” when metadata is incomplete.
  let checkout = null;
  if (checkoutId) {
    try {
      checkout = await db.getVoiceCheckout(checkoutId);
    } catch (_) {}
    if (checkout) console.log('[CommerceSettlement] checkout resolved via PI metadata.checkout_id', checkoutId);
  }

  if (!checkout && piId && db.db && typeof db.db.prepare === 'function') {
    try {
      checkout = db.db
        .prepare(
          `SELECT * FROM voice_checkouts
           WHERE payment_intent_id = ?
             AND (deleted_at IS NULL OR deleted_at = '')
           LIMIT 1`
        )
        .get(piId);
    } catch (_) {}
    if (checkout) console.log('[CommerceSettlement] checkout resolved via voice_checkouts.payment_intent_id', piId);
  }

  if (!checkout) return;

  const amountDollars = amountCents != null ? amountCents / 100 : checkout.amount;

  // Idempotency: skip ledger + receipt persistence, but still try email delivery once.
  if (piId && hasReceiptForPaymentIntent(piId)) {
    console.log('[CommerceSettlement] idempotent skip — receipt already exists for PI', piId);
    try {
      if (checkout.customer_email && typeof require('./email-service').sendPaymentReceipt === 'function') {
        let appointment = null;
        if (checkout.appointment_id && db.getAppointment) {
          try {
            appointment = await db.getAppointment(checkout.appointment_id);
          } catch (_) {}
        }
        await require('./email-service').sendPaymentReceipt(checkout, amountDollars, piId, appointment);
      }
    } catch (e) {
      console.warn('[CommerceSettlement] idempotent receipt email resend failed:', e.message);
    }

    if (cartSessionId && merchantId && db.clearCommerceCartCheckoutLock) {
      try {
        db.clearCommerceCartCheckoutLock(cartSessionId, merchantId);
      } catch (e) {
        console.warn('[CommerceSettlement] clearCommerceCartCheckoutLock (idempotent):', e.message);
      }
    }
    return;
  }

  try {
    await PaymentProcessorService.completePaymentSuccess({
      checkout,
      amount: amountDollars,
      paymentMethod: 'stripe',
      paymentIntentId: piId
    });
    console.log('[CommerceSettlement] completePaymentSuccess for checkout', checkout.id, 'PI', piId);
  } catch (e) {
    console.warn('[CommerceSettlement] finalizeCommerceRetailPayment:', e.message);
  }
  if (cartSessionId && merchantId && db.clearCommerceCartCheckoutLock) {
    try {
      db.clearCommerceCartCheckoutLock(cartSessionId, merchantId);
    } catch (e) {
      console.warn('[CommerceSettlement] clearCommerceCartCheckoutLock:', e.message);
    }
  }
}

module.exports = {
  reconcileMerchantOrderPaymentSucceeded,
  finalizeCommerceRetailPayment,
  hasReceiptForPaymentIntent
};
