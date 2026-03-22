/**
 * Payment page API for Kelly/voice checkout flow.
 *
 * GET /payment/:token — returns client_secret for Stripe Elements.
 *   Creates PaymentIntent with metadata: appointment_id, patient_email,
 *   patient_name, practitioner_id, session_id for webhook reconciliation.
 *
 * GET /payment/:token/status — poll for payment status after 3DS redirect.
 *
 * Mount in server.js:
 *   app.use('/payment', paymentPageRouter);
 */

'use strict';

const express = require('express');
const Stripe = require('stripe');
const db = require('../database');
const PaymentService = require('../services/payment-service');

const router = express.Router();

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  _stripe = new Stripe(key, { apiVersion: '2024-04-10' });
  return _stripe;
}

function getSessionIdForToken(token) {
  try {
    const row = db.db.prepare(`
      SELECT session_id FROM kelly_session_meta WHERE key = 'payment_token' AND value = ? LIMIT 1
    `).get(token);
    return row?.session_id || null;
  } catch (_) {
    return null;
  }
}

router.get('/:token', async (req, res) => {
  const { token } = req.params;

  const result = await PaymentService.getCheckoutByToken(token);
  if (!result.success) {
    return res.status(404).json({ error: result.error || 'Payment session not found or expired.' });
  }

  const checkout = result.checkout;
  if (checkout.status === 'completed' || result.token?.status === 'used') {
    return res.status(200).json({ status: 'already_paid', message: 'This appointment has already been paid.' });
  }

  let clientSecret = checkout.stripe_client_secret;
  let paymentIntentId = checkout.stripe_payment_intent_id;

  if (!clientSecret || !paymentIntentId) {
    const appointment = checkout.appointment_id
      ? (db.getAppointment ? await db.getAppointment(checkout.appointment_id) : null)
      : null;

    const amountDollars = parseFloat(checkout.amount) || 0;
    const amountCents = Math.round(amountDollars * 100) || 15000;
    const sessionId = checkout.session_id || getSessionIdForToken(token);
    const practitionerId = appointment?.practitioner_id || null;

    try {
      const intent = await getStripe().paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          appointment_id: checkout.appointment_id || '',
          patient_email: checkout.customer_email || appointment?.patient_email || '',
          patient_name: checkout.customer_name || appointment?.patient_name || '',
          practitioner_id: practitionerId || '',
          session_id: sessionId || '',
          payment_token: token,
          checkout_id: checkout.id
        },
        receipt_email: checkout.customer_email || appointment?.patient_email || undefined
      });

      clientSecret = intent.client_secret;
      paymentIntentId = intent.id;

      try {
        db.db.prepare(`
          UPDATE voice_checkouts
          SET stripe_payment_intent_id = ?, stripe_client_secret = ?
          WHERE id = ?
        `).run(paymentIntentId, clientSecret, checkout.id);
      } catch (err) {
        console.warn('[PaymentPage] Could not persist Stripe data:', err.message);
      }
    } catch (err) {
      console.error('[PaymentPage] Failed to create PaymentIntent:', err.message);
      return res.status(500).json({ error: 'Could not initialize payment. Please try again.' });
    }
  }

  const appt = checkout.appointment_id && db.getAppointment
    ? await db.getAppointment(checkout.appointment_id)
    : null;

  return res.status(200).json({
    clientSecret,
    paymentIntentId,
    appointmentId: checkout.appointment_id,
    amount: Math.round((parseFloat(checkout.amount) || 0) * 100),
    publishableKey: (() => {
      try {
        return PaymentService.getStripePublishableKey ? PaymentService.getStripePublishableKey() : process.env.STRIPE_PUBLISHABLE_KEY;
      } catch (_) {
        return process.env.STRIPE_PUBLISHABLE_KEY;
      }
    })(),
    appointmentType: appt?.appointment_type || checkout.product_name || 'Medical consultation'
  });
});

router.get('/:token/status', async (req, res) => {
  const { token } = req.params;
  const result = await PaymentService.getCheckoutByToken(token);
  if (!result.success) return res.status(404).json({ error: 'Not found' });

  const checkout = result.checkout;
  const paymentIntentId = checkout.stripe_payment_intent_id;
  if (!paymentIntentId) {
    return res.status(200).json({ status: checkout.status || 'pending' });
  }

  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    const stripeStatus = intent.status;
    const status = stripeStatus === 'succeeded' ? 'paid' : stripeStatus;

    if (stripeStatus === 'succeeded' && checkout.status !== 'completed') {
      try {
        if (db.updateVoiceCheckout) {
          await db.updateVoiceCheckout(checkout.id, { status: 'completed' });
        } else {
          db.db.prepare(`UPDATE voice_checkouts SET status = 'completed' WHERE id = ?`).run(checkout.id);
        }
      } catch (_) {}
    }

    return res.status(200).json({ status, stripeStatus });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:token/success', (req, res) => {
  res.redirect(302, `/payment/${req.params.token}?redirect_status=succeeded`);
});

module.exports = { paymentPageRouter: router };
