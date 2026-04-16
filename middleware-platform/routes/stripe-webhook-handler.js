/**
 * Stripe webhook handler for payment settlement pipeline.
 *
 * On payment_intent.succeeded:
 *   1. reconcileMerchantOrderPaymentSucceeded — create/update merchant_orders (always first).
 *   2. Mark checkout_sessions quote row paid when commerce_quote_id is in PI metadata.
 *   3. If no appointment_id: skip telehealth (Circle, receipt, case summary) — commerce retail.
 *   4. Telehealth: appointment paid, Circle payout, receipt email, case summary.
 *
 * Mount in server.js BEFORE express.json() (Stripe requires raw body):
 *   app.use('/webhooks/stripe', stripeWebhookRouter);
 *
 * .env: STRIPE_WEBHOOK_SECRET, CIRCLE_API_KEY, CIRCLE_MASTER_WALLET_ID, APP_BASE_URL
 */

'use strict';

const express = require('express');
const Stripe = require('stripe');
const axios = require('axios');
const db = require('../database');
const PaymentFlowService = require('../services/payment-flow-service');
const { parseCheckoutSessionData } = require('../utils/public-commerce-helpers');
const {
  reconcileMerchantOrderPaymentSucceeded,
  finalizeCommerceRetailPayment
} = require('../services/commerce-payment-settlement');
const FinancialIntegrityService = require('../services/financial-integrity-service');

const router = express.Router();

const CIRCLE_BASE = process.env.CIRCLE_SANDBOX !== '0'
  ? 'https://api-sandbox.circle.com'
  : 'https://api.circle.com';

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  _stripe = new Stripe(key, { apiVersion: '2024-04-10' });
  return _stripe;
}

async function circlePost(path, body) {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error('CIRCLE_API_KEY not set');
  const resp = await axios.post(`${CIRCLE_BASE}${path}`, body, {
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    timeout: 15000
  });
  return resp.data;
}

async function sendPatientReceiptEmail({ to, name, appointmentType, amount, appointmentDate, appointmentId }) {
  console.log('[StripeWebhook] Sending receipt email to', to, { amount, appointmentId });
  const EmailService = require('../services/email-service');
  if (EmailService && typeof EmailService.sendPatientBillingEmail === 'function') {
    try {
      await EmailService.sendPatientBillingEmail(to, {
        patientName: name,
        amount,
        appointmentType: appointmentType || 'Medical consultation',
        appointmentDate: appointmentDate || '',
        appointmentId
      });
      return { sent: true };
    } catch (err) {
      console.warn('[StripeWebhook] Receipt email failed:', err.message);
    }
  }
  return { sent: false };
}

function getProviderWalletId({ practitionerId, clinicId, merchantId }) {
  const { walletId } = PaymentFlowService.resolveProviderWalletId({
    clinicId: clinicId || null,
    merchantId: merchantId || null
  });
  return walletId || null;
}

function calculateProviderPayout(totalAmountCents) {
  const platformFeePct = parseFloat(process.env.PLATFORM_FEE_PCT || '0.20');
  const fee = Math.round(totalAmountCents * platformFeePct);
  return totalAmountCents - fee;
}

router.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[StripeWebhook] STRIPE_WEBHOOK_SECRET not set — rejecting');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[StripeWebhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
    }

    console.log('[StripeWebhook] Received event:', event.type, event.id);

    const replayWindowSec = parseInt(process.env.STRIPE_WEBHOOK_REPLAY_WINDOW_SEC || '600', 10);
    if (Number.isFinite(replayWindowSec) && replayWindowSec > 0 && Number.isFinite(event?.created)) {
      const ageSec = Math.floor(Date.now() / 1000) - Number(event.created);
      if (ageSec > replayWindowSec) {
        console.warn('[StripeWebhook] Rejected stale event outside replay window:', { eventId: event.id, ageSec, replayWindowSec });
        return res.status(200).json({ received: true, stale: true });
      }
    }

    try {
      const existing = db.db.prepare(`
        SELECT id FROM stripe_webhook_events WHERE stripe_event_id = ? LIMIT 1
      `).get(event.id);
      if (existing) {
        console.log('[StripeWebhook] Already processed, skipping:', event.id);
        return res.status(200).json({ received: true, skipped: true });
      }
    } catch (_) {}

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await handlePaymentSucceeded(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;
        case 'refund.created':
        case 'refund.updated':
        case 'charge.refunded':
          await handleRefundEvent(event);
          break;
        case 'charge.dispute.created':
        case 'charge.dispute.updated':
        case 'charge.dispute.closed':
          await handleChargeDispute(event.data.object);
          break;
        default:
          console.log('[StripeWebhook] Unhandled event type:', event.type);
      }
      _recordWebhookEvent(event.id, event.type, 'processed');
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('[StripeWebhook] Handler error:', err.message);
      _recordWebhookEvent(event.id, event.type, 'failed', err.message);
      return res.status(200).json({ received: true, error: err.message });
    }
  }
);

async function handleChargeDispute(dispute) {
  try {
    const PaymentDisputeService = require('../services/payment-dispute-service');
    PaymentDisputeService.upsertFromStripeDispute(dispute);
  } catch (e) {
    console.warn('[StripeWebhook] dispute intake (non-fatal):', e.message);
  }
}

async function handleRefundEvent(event) {
  try {
    const obj = event?.data?.object || {};
    const refund = obj.object === 'refund' ? obj : null;
    if (refund && refund.id) {
      FinancialIntegrityService.recordStripeRefundReconciliation({
        refundId: refund.id,
        paymentIntentId: refund.payment_intent || null,
        amount: (Number(refund.amount || 0) || 0) / 100,
        checkoutId: null,
        currency: (refund.currency || 'usd').toUpperCase()
      });
      return;
    }

    // charge.refunded shape can contain an array of refund objects
    if (obj.object === 'charge' && obj.refunds && Array.isArray(obj.refunds.data)) {
      for (const r of obj.refunds.data) {
        if (!r || !r.id) continue;
        FinancialIntegrityService.recordStripeRefundReconciliation({
          refundId: r.id,
          paymentIntentId: obj.payment_intent || null,
          amount: (Number(r.amount || 0) || 0) / 100,
          checkoutId: null,
          currency: (r.currency || obj.currency || 'usd').toUpperCase()
        });
      }
    }
  } catch (e) {
    console.warn('[StripeWebhook] refund reconciliation ingest (non-fatal):', e.message);
  }
}

async function handlePaymentSucceeded(paymentIntent) {
  const { id: stripePaymentIntentId, amount, metadata } = paymentIntent;

  await reconcileMerchantOrderPaymentSucceeded(paymentIntent);

  try {
    FinancialIntegrityService.recordStripePaymentIntentReconciliation(paymentIntent);
  } catch (e) {
    console.warn('[StripeWebhook] financial integrity ingest (non-fatal):', e.message);
  }

  const appointmentId = metadata?.appointment_id;
  const patientEmail = metadata?.patient_email;
  const patientName = metadata?.patient_name;
  const practitionerId = metadata?.practitioner_id;
  const sessionId = metadata?.session_id;
  const commerceQuoteId = metadata?.commerce_quote_id;
  const checkoutIdMeta = metadata?.checkout_id;

  console.log('[StripeWebhook] Payment succeeded:', {
    stripePaymentIntentId,
    amount,
    appointmentId: appointmentId || null,
    practitionerId: practitionerId || null,
    commerce_quote_id: commerceQuoteId || null,
    checkout_id: checkoutIdMeta || null
  });

  if (commerceQuoteId && db.getCheckoutSession && db.updateCheckoutSession) {
    try {
      const row = db.getCheckoutSession(commerceQuoteId);
      if (row && row.platform === 'commerce_quote') {
        const prev = parseCheckoutSessionData(row.session_data) || {};
        const next = {
          ...prev,
          kind: 'commerce_quote',
          stripe_payment_intent_id: stripePaymentIntentId,
          paid_at: new Date().toISOString()
        };
        if (checkoutIdMeta) next.voice_checkout_id = checkoutIdMeta;
        db.updateCheckoutSession(commerceQuoteId, 'paid', next);
        console.log('[StripeWebhook] Commerce quote session marked paid:', commerceQuoteId);
      }
    } catch (e) {
      console.warn('[StripeWebhook] Commerce quote session update failed (non-fatal):', e.message);
    }
  }

  if (!appointmentId) {
    if (commerceQuoteId) {
      console.log('[StripeWebhook] Commerce order reconciled. Skipping telehealth path for:', stripePaymentIntentId);
      await finalizeCommerceRetailPayment(paymentIntent, amount);
      return;
    }
    if (checkoutIdMeta) {
      await finalizeCommerceRetailPayment(paymentIntent, amount);
      return;
    }
    console.warn(
      '[StripeWebhook] No appointment_id, commerce_quote_id, or checkout_id in PI metadata:',
      stripePaymentIntentId,
      '— order may still exist if reconcile used checkout_id from metadata.'
    );
    return;
  }

  const appt = _getAppointmentRow(appointmentId);
  const clinicId = appt?.clinic_id || null;
  const merchantId = appt ? (await _getMerchantIdForAppointment(appt)) : null;

  try {
    db.db.prepare(`
      UPDATE appointments
      SET payment_status = 'paid',
          stripe_payment_intent_id = ?,
          paid_at = datetime('now'),
          payment_amount_cents = ?
      WHERE id = ?
    `).run(stripePaymentIntentId, amount, appointmentId);
    console.log('[StripeWebhook] Appointment marked paid:', appointmentId);
  } catch (err) {
    console.error('[StripeWebhook] Failed to update appointment:', err.message);
  }

  const providerWalletId = getProviderWalletId({
    practitionerId,
    clinicId,
    merchantId
  });
  if (providerWalletId) {
    await _transferToProvider({
      practitionerId,
      appointmentId,
      amountCents: amount,
      providerWalletId,
      clinicId,
      merchantId
    });
  } else if (practitionerId || clinicId || merchantId) {
    console.warn('[StripeWebhook] No Circle wallet for provider — set CIRCLE_PROVIDER_WALLET_ID or circle_wallet_id');
    _recordPayoutEvent({
      appointmentId,
      practitionerId,
      status: 'no_wallet',
      amountCents: calculateProviderPayout(amount)
    });
  }

  if (patientEmail) {
    try {
      await sendPatientReceiptEmail({
        to: patientEmail,
        name: patientName || 'Patient',
        appointmentType: appt?.appointment_type || 'Medical consultation',
        amount: `$${(amount / 100).toFixed(2)}`,
        appointmentDate: appt?.date ? `${appt.date} ${appt.time || ''}`.trim() : '',
        appointmentId
      });
    } catch (err) {
      console.error('[StripeWebhook] Receipt email failed (non-fatal):', err.message);
    }
  }

  try {
    await _buildCaseSummary({ appointmentId, sessionId, practitionerId });
  } catch (err) {
    console.error('[StripeWebhook] Case summary build failed (non-fatal):', err.message);
  }
}

async function handlePaymentFailed(paymentIntent) {
  await reconcileMerchantOrderPaymentFailed(paymentIntent);
  try {
    FinancialIntegrityService.recordStripePaymentIntentReconciliation(paymentIntent);
  } catch (e) {
    console.warn('[StripeWebhook] financial integrity ingest (non-fatal):', e.message);
  }
  const cartSessionId = paymentIntent.metadata?.cart_session_id;
  const merchantId = paymentIntent.metadata?.merchant_id;
  if (cartSessionId && merchantId && db.clearCommerceCartCheckoutLock) {
    try {
      db.clearCommerceCartCheckoutLock(cartSessionId, merchantId);
    } catch (_) {}
  }
  const appointmentId = paymentIntent.metadata?.appointment_id;
  if (!appointmentId) return;
  try {
    db.db.prepare(`
      UPDATE appointments SET payment_status = 'failed' WHERE id = ?
    `).run(appointmentId);
    console.log('[StripeWebhook] Payment failed recorded for:', appointmentId);
  } catch (_) {}
}

async function reconcileMerchantOrderPaymentFailed(paymentIntent) {
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

    if (!orderId) return;
    const order = db.getOrder(orderId);
    if (!order) return;

    db.updateOrder(orderId, { payment_status: 'failed' });
    try {
      db.incrementOpsCounter && db.incrementOpsCounter('merchant_order_payment_failed');
    } catch (_) {}
    console.log('[StripeWebhook] merchant order payment failed', {
      order_id: orderId,
      payment_intent_id: paymentIntent?.id
    });
  } catch (error) {
    console.error('[StripeWebhook] merchant order reconcile (failed) failed:', error.message);
  }
}

async function _transferToProvider({
  practitionerId,
  appointmentId,
  amountCents,
  providerWalletId,
  clinicId,
  merchantId
}) {
  const masterWalletId = process.env.CIRCLE_MASTER_WALLET_ID;
  if (!masterWalletId) {
    console.warn('[StripeWebhook] CIRCLE_MASTER_WALLET_ID not set — skipping payout');
    return;
  }

  const payoutCents = calculateProviderPayout(amountCents);
  const usdcAmount = (payoutCents / 100).toFixed(2);

  try {
    const idempotencyKey = `payout-${appointmentId}-${practitionerId || clinicId || merchantId || 'default'}`;
    const transfer = await circlePost('/v1/transfers', {
      idempotencyKey,
      source: { type: 'wallet', id: masterWalletId },
      destination: { type: 'wallet', id: providerWalletId },
      amount: { amount: usdcAmount, currency: 'USD' }
    });

    const transferId = transfer?.data?.id;
    console.log('[StripeWebhook] Circle transfer initiated:', transferId, 'Amount:', usdcAmount);

    _recordPayoutEvent({
      appointmentId,
      practitionerId,
      status: 'initiated',
      amountCents: payoutCents,
      circleTransferId: transferId
    });

    try {
      db.db.prepare(`
        UPDATE appointments
        SET circle_transfer_id = ?, payout_status = 'initiated', payout_amount_cents = ?
        WHERE id = ?
      `).run(transferId, payoutCents, appointmentId);
    } catch (_) {}
  } catch (err) {
    console.error('[StripeWebhook] Circle transfer failed:', err.message);
    _recordPayoutEvent({
      appointmentId,
      practitionerId,
      status: 'failed',
      amountCents: payoutCents,
      error: err.message
    });
    throw err;
  }
}

async function _buildCaseSummary({ appointmentId, sessionId, practitionerId }) {
  if (!sessionId) return;

  const session = db.getTriageSession ? db.getTriageSession(sessionId) : null;
  if (!session) return;

  const appt = _getAppointmentRow(appointmentId);
  const summary = {
    appointment_id: appointmentId,
    session_id: sessionId,
    practitioner_id: practitionerId,
    built_at: new Date().toISOString(),
    chief_complaint: appt?.notes || session.soap_note || '',
    target_specialty: session.target_specialty,
    urgency: session.urgency,
    safety_level: session.safety_level,
    soap_note: session.soap_note,
    opqrst: {
      onset: session.onset,
      provocation: session.provocation,
      quality: session.quality,
      radiation: session.radiation,
      severity: session.severity,
      timing: session.timing,
      associated_sx: session.associated_sx
    },
    intake: {
      medications: session.medications,
      allergies: session.allergies,
      prior_diagnoses: session.prior_diagnoses,
      prior_workups: session.prior_workups,
      family_history: session.family_history,
      alcohol_use: session.alcohol_use,
      smoking_status: session.smoking_status
    },
    scores: {
      phq2: session.phq2_score,
      gad2: session.gad2_score,
      safety_screen: session.safety_screen,
      alcohol_cage: session.alcohol_cage_score
    }
  };

  try {
    db.db.prepare(`
      INSERT OR REPLACE INTO case_summaries
        (appointment_id, session_id, practitioner_id, summary_json, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(appointmentId, sessionId, practitionerId, JSON.stringify(summary));
    console.log('[StripeWebhook] Case summary stored for:', appointmentId);
  } catch (err) {
    try {
      db.db.prepare(`
        CREATE TABLE IF NOT EXISTS case_summaries (
          appointment_id  TEXT PRIMARY KEY,
          session_id      TEXT,
          practitioner_id TEXT,
          summary_json    TEXT,
          created_at      TEXT DEFAULT (datetime('now'))
        )
      `).run();
      db.db.prepare(`
        INSERT OR REPLACE INTO case_summaries
          (appointment_id, session_id, practitioner_id, summary_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(appointmentId, sessionId, practitionerId, JSON.stringify(summary));
    } catch (err2) {
      console.error('[StripeWebhook] Could not store case summary:', err2.message);
    }
  }
}

function _getAppointmentRow(appointmentId) {
  try {
    return db.db.prepare(`SELECT * FROM appointments WHERE id = ? LIMIT 1`).get(appointmentId);
  } catch (_) {
    return null;
  }
}

async function _getMerchantIdForAppointment(appt) {
  if (appt.clinic_id) {
    try {
      const row = db.db.prepare(`
        SELECT merchant_id FROM clinics WHERE clinic_id = ? LIMIT 1
      `).get(appt.clinic_id);
      return row?.merchant_id || null;
    } catch (_) {}
  }
  return null;
}

function _recordWebhookEvent(stripeEventId, eventType, status, error = null) {
  try {
    db.db.prepare(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        stripe_event_id  TEXT NOT NULL UNIQUE,
        event_type       TEXT NOT NULL,
        status           TEXT NOT NULL,
        error            TEXT,
        processed_at     TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.db.prepare(`
      INSERT OR IGNORE INTO stripe_webhook_events (stripe_event_id, event_type, status, error)
      VALUES (?, ?, ?, ?)
    `).run(stripeEventId, eventType, status, error);
  } catch (_) {}
}

function _recordPayoutEvent({
  appointmentId,
  practitionerId,
  status,
  amountCents,
  circleTransferId = null,
  error = null
}) {
  try {
    db.db.prepare(`
      CREATE TABLE IF NOT EXISTS payout_events (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id      TEXT NOT NULL,
        practitioner_id     TEXT,
        status              TEXT NOT NULL,
        amount_cents        INTEGER,
        circle_transfer_id  TEXT,
        error               TEXT,
        created_at          TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.db.prepare(`
      INSERT INTO payout_events (appointment_id, practitioner_id, status, amount_cents, circle_transfer_id, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(appointmentId, practitionerId, status, amountCents, circleTransferId, error);
  } catch (_) {}
}

module.exports = { stripeWebhookRouter: router };
