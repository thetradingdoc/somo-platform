/**
 * Single place to create/update merchant_orders from a paid voice_checkouts row.
 * Used by Stripe webhooks and PaymentOrchestrator (sync PI success) to avoid duplicate logic.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const db = require('../database');
const VoiceAdapter = require('../adapters/voice-adapter');
const { notifyCommerceCritical } = require('./commerce-alerts');

function isSqliteConstraint(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (err.errno === 19) return true;
  return String(err.message || '').includes('UNIQUE constraint failed');
}

/**
 * @param {{ id?: string }} paymentIntent — needs id (Stripe PaymentIntent id)
 * @param {object} checkout — voice_checkouts row
 * @param {{ source?: 'webhook'|'orchestrator' }} [options]
 * @returns {Promise<string|null>} merchant order id or null
 */
async function ensureMerchantOrderFromVoiceCheckout(paymentIntent, checkout, options = {}) {
  const source = options.source || 'unknown';
  const piId = paymentIntent?.id || null;
  const metadata = paymentIntent?.metadata || {};
  const commerceQuoteId =
    metadata.commerce_quote_id || checkout?.commerce_quote_id || null;
  if (!checkout?.id) return null;

  const bumpIdempotent = () => {
    try {
      db.incrementOpsCounter && db.incrementOpsCounter('commerce_order_ensure_idempotent');
    } catch (_) {}
  };

  const bumpCreated = () => {
    try {
      if (source === 'webhook') {
        db.incrementOpsCounter && db.incrementOpsCounter('commerce_order_created_from_webhook');
      } else if (source === 'orchestrator') {
        db.incrementOpsCounter && db.incrementOpsCounter('commerce_order_created_from_orchestrator');
      }
      db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_payment_paid');
    } catch (_) {}
  };

  async function completeCheckout(orderId) {
    await db.updateVoiceCheckout(checkout.id, {
      status: 'completed',
      payment_intent_id: piId || checkout.payment_intent_id || null,
      merchant_order_id: orderId,
      completed_at: new Date().toISOString()
    });
  }

  if (piId && db.getMerchantOrderByStripePaymentIntentId) {
    const byPi = db.getMerchantOrderByStripePaymentIntentId(piId);
    if (byPi?.id) {
      const updates = { payment_status: 'paid' };
      if (!byPi.status || byPi.status === 'pending') updates.status = 'confirmed';
      db.updateOrder(byPi.id, updates);
      await completeCheckout(byPi.id);
      bumpIdempotent();
      console.log('[MerchantOrderFromCheckout] idempotent hit (stripe_payment_intent_id)', {
        order_id: byPi.id,
        checkout_id: checkout.id,
        payment_intent_id: piId
      });
      return byPi.id;
    }
  }

  if (db.getMerchantOrderByVoiceCheckoutId) {
    const byVc = db.getMerchantOrderByVoiceCheckoutId(checkout.id);
    if (byVc?.id) {
      const updates = { payment_status: 'paid' };
      if (!byVc.status || byVc.status === 'pending') updates.status = 'confirmed';
      db.updateOrder(byVc.id, updates);
      await completeCheckout(byVc.id);
      bumpIdempotent();
      console.log('[MerchantOrderFromCheckout] idempotent hit (voice_checkout_id)', {
        order_id: byVc.id,
        checkout_id: checkout.id,
        payment_intent_id: piId
      });
      return byVc.id;
    }
  }

  if (checkout.merchant_order_id) {
    const existing = db.getOrder(checkout.merchant_order_id);
    if (existing) {
      const updates = { payment_status: 'paid' };
      if (!existing.status || existing.status === 'pending') updates.status = 'confirmed';
      db.updateOrder(checkout.merchant_order_id, updates);
      try {
        db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_payment_paid');
      } catch (_) {}
      await completeCheckout(checkout.merchant_order_id);
      console.log('[MerchantOrderFromCheckout] order paid (existing)', {
        order_id: checkout.merchant_order_id,
        payment_intent_id: piId
      });
      return checkout.merchant_order_id;
    }
  }

  const merchant = db.getMerchant(checkout.merchant_id);
  if (!merchant) {
    console.error('[MerchantOrderFromCheckout] merchant missing', checkout.merchant_id);
    await notifyCommerceCritical({
      event: 'commerce_merchant_missing',
      detail: `merchant_id=${checkout.merchant_id}`,
      payment_intent_id: piId,
      checkout_id: checkout.id
    });
    return null;
  }

  const orderDataPayload = VoiceAdapter.toMerchantOrderFormat(checkout);
  let externalRef = null;

  if (merchant.api_url) {
    try {
      const orderResponse = await axios.post(`${merchant.api_url}/api/orders`, orderDataPayload, {
        timeout: 10000,
        headers: {
          'Idempotency-Key': `voice_${checkout.id}_${piId || 'nopi'}`
        }
      });
      const extOrder = orderResponse.data?.order;
      if (extOrder && extOrder.id != null) {
        externalRef = String(extOrder.id);
      }
    } catch (apiError) {
      console.error('[MerchantOrderFromCheckout] external merchant API failed:', apiError.message);
      await notifyCommerceCritical({
        event: 'commerce_external_api_failed',
        detail: apiError.message,
        payment_intent_id: piId,
        checkout_id: checkout.id
      });
    }
  }

  const shippingAddress = checkout.shipping_address || checkout.customer_address || null;
  const dropPoint = shippingAddress;

  const baseOrder = {
    merchant_id: checkout.merchant_id,
    product_id: checkout.product_id,
    quantity: checkout.quantity,
    customer_email: checkout.customer_email || 'guest@example.com',
    customer_name: checkout.customer_name,
    customer_phone: checkout.customer_phone,
    shipping_address: shippingAddress,
    pickup_address: checkout.pickup_address || null,
    pickup_latitude: checkout.pickup_latitude || null,
    pickup_longitude: checkout.pickup_longitude || null,
    drop_point: dropPoint,
    total_amount: checkout.amount,
    status: 'paid',
    payment_status: 'paid',
    source: 'voice',
    commerce_quote_id: commerceQuoteId,
    voice_checkout_id: checkout.id,
    stripe_payment_intent_id: piId,
    external_order_id: externalRef
  };

  const applyInventoryDecrement = () => {
    if (checkout.product_id && checkout.quantity) {
      try {
        const product = db.getProduct(checkout.product_id);
        if (product && product.merchant_id === checkout.merchant_id && product.inventory >= checkout.quantity) {
          db.updateInventory(checkout.product_id, checkout.quantity);
        }
      } catch (inventoryError) {
        console.error('[MerchantOrderFromCheckout] inventory decrement error:', inventoryError.message);
      }
    }
  };

  const orderId = uuidv4();
  try {
    db.createOrder({
      id: orderId,
      ...baseOrder
    });
  } catch (err) {
    if (isSqliteConstraint(err)) {
      const again = (piId && db.getMerchantOrderByStripePaymentIntentId && db.getMerchantOrderByStripePaymentIntentId(piId))
        || (db.getMerchantOrderByVoiceCheckoutId && db.getMerchantOrderByVoiceCheckoutId(checkout.id));
      if (again?.id) {
        await completeCheckout(again.id);
        bumpIdempotent();
        return again.id;
      }
    }
    console.error('[MerchantOrderFromCheckout] createOrder failed:', err.message);
    await notifyCommerceCritical({
      event: 'commerce_create_order_failed',
      detail: err.message,
      payment_intent_id: piId,
      checkout_id: checkout.id
    });
    return null;
  }

  applyInventoryDecrement();

  await completeCheckout(orderId);
  bumpCreated();
  console.log('[MerchantOrderFromCheckout] order created from voice checkout', {
    order_id: orderId,
    checkout_id: checkout.id,
    payment_intent_id: piId,
    external_order_id: externalRef,
    source
  });

  return orderId;
}

module.exports = { ensureMerchantOrderFromVoiceCheckout };
