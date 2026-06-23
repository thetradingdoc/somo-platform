const PaymentService = require('./payment-service');

function mapStripeStatusToCheckoutStage(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'succeeded') return 'payment_confirmed';
  if (s === 'processing') return 'checkout_prepared';
  if (s === 'requires_payment_method' || s === 'canceled' || s === 'failed') return 'failed';
  return 'checkout_prepared';
}

async function getCheckoutPaymentStatus({ payment_intent_id }) {
  const paymentIntentId = String(payment_intent_id || '').trim();
  if (!paymentIntentId) {
    return { success: false, error: 'payment_intent_id_required' };
  }
  try {
    const stripeSecret = PaymentService.getStripeSecretKey();
    const stripe = require('stripe')(stripeSecret);
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const stripe_status = String(pi?.status || '').toLowerCase() || 'unknown';
    return {
      success: true,
      payment_intent_id: paymentIntentId,
      stripe_status,
      checkout_stage: mapStripeStatusToCheckoutStage(stripe_status),
      source: 'stripe_retrieve'
    };
  } catch (e) {
    return {
      success: false,
      error: String(e?.message || 'payment_status_lookup_failed')
    };
  }
}

module.exports = {
  getCheckoutPaymentStatus,
  mapStripeStatusToCheckoutStage
};
