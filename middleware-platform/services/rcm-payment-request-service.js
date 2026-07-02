'use strict';

const crypto = require('crypto');
const db = require('../database');
const orchestrator = require('./rcm-journey-orchestrator');
const PaymentFlowService = require('./payment-flow-service');

function publicPayBaseFromEnv(req) {
  if (req) {
    const base =
      process.env.PUBLIC_PAY_BASE_URL ||
      process.env.APP_PUBLIC_URL ||
      `${req.protocol}://${req.get('host')}`;
    return String(base).replace(/\/$/, '');
  }
  return String(
    process.env.PUBLIC_PAY_BASE_URL ||
      process.env.APP_PUBLIC_URL ||
      process.env.API_BASE_URL ||
      process.env.BASE_URL ||
      'http://localhost:4000'
  ).replace(/\/$/, '');
}

function payUrlFromToken(base, token) {
  if (!token) return null;
  return `${base}/patients/pay.html?token=${encodeURIComponent(token)}`;
}

/** @deprecated use resolveCheckoutAmount */
async function resolveCopayAmount({ amount, patientId, clinicId, journeyId, sessionId, appointmentId }) {
  const r = await PaymentFlowService.resolveCheckoutAmount({
    amount,
    patientId,
    appointmentId,
    sessionId,
    journeyId,
    requireHardNumber: true
  });
  return r.ok ? r.amount : null;
}

/**
 * Create an RCM payment request (shared by provider API and Kelly tool).
 */
async function createRcmPaymentRequest({
  clinicId,
  amount,
  journeyId = null,
  patientId = null,
  sessionId = null,
  appointmentId = null,
  method = 'manual',
  req = null,
  publicPayBase = null,
}) {
  orchestrator.ensureKellyRcmTables();
  const clinic = String(clinicId || '').trim();
  if (!clinic) {
    return { success: false, error: 'clinic_id is required', status: 400 };
  }

  const resolution = await PaymentFlowService.resolveCheckoutAmount({
    amount,
    patientId,
    appointmentId,
    sessionId,
    journeyId,
    requireHardNumber: true
  });
  if (!resolution.ok) {
    return {
      success: false,
      error: resolution.error || 'quote_required',
      message: resolution.message || 'Unable to resolve copay amount for payment.',
      amount_resolution: resolution.amountDue || null,
      status: resolution.error === 'amount_pending_verification' ? 409 : 400
    };
  }
  const amt = resolution.amount;

  const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payToken = crypto.randomBytes(24).toString('hex');

  db.db
    .prepare(
      `INSERT INTO rcm_payments (id, clinic_id, journey_id, patient_id, amount, method, pay_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, clinic, journeyId, patientId, amt, method, payToken);

  db.db
    .prepare(
      `INSERT INTO rcm_ledger_entries (id, clinic_id, journey_id, direction, amount, category, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `led_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      clinic,
      journeyId,
      'incoming',
      amt,
      'patient_request',
      'Payment request created'
    );

  PaymentFlowService.logAmountResolution({
    patient_id: patientId,
    appointment_id: appointmentId,
    session_id: sessionId,
    quoted_amount: resolution.amountDue?.amount ?? amt,
    charged_amount: amt,
    source: resolution.source || resolution.amountDue?.source || 'rcm_payment',
    status: resolution.amountDue?.status || 'hard_number',
    details: { route: 'createRcmPaymentRequest', payment_id: id }
  });

  if (journeyId) {
    try {
      orchestrator.advanceStage({
        journeyId,
        clinicId: clinic,
        stageTo: 'patient_collection',
        eventType: 'payment_requested',
        payload: { payment_id: id, amount: amt },
        options: { skipGates: true },
      });
    } catch (_) {
      /* journey may already be past collection */
    }
  }

  const base = publicPayBase || publicPayBaseFromEnv(req);
  const payUrl = payUrlFromToken(base, payToken);

  return {
    success: true,
    payment_id: id,
    pay_token: payToken,
    pay_url: payUrl,
    amount: amt,
    clinic_id: clinic,
    journey_id: journeyId,
    patient_id: patientId,
    amount_resolution: resolution.amountDue || null
  };
}

async function notifyPatientPaymentLink({
  payUrl,
  amount,
  patientEmail,
  patientPhone,
  delivery = 'both',
  clinicId = null,
}) {
  const order = {
    product_name: 'Copay / balance due',
    amount: Number(amount) || 0,
  };
  const mode = String(delivery || 'both').toLowerCase();
  const results = { email: null, sms: null };

  if ((mode === 'email' || mode === 'both') && patientEmail) {
    try {
      const EmailService = require('./email-service');
      results.email = await EmailService.sendPaymentLinkEmail(patientEmail, payUrl, order);
    } catch (err) {
      results.email = { success: false, error: err.message };
    }
  }

  if ((mode === 'sms' || mode === 'both') && patientPhone) {
    try {
      const SMSService = require('./sms-service');
      results.sms = await SMSService.sendPaymentLink(
        patientPhone,
        payUrl,
        order,
        null,
        clinicId
      );
    } catch (err) {
      results.sms = { success: false, error: err.message };
    }
  }

  if (
    results.sms?.success === false &&
    (mode === 'both' || mode === 'sms') &&
    patientEmail &&
    !results.email
  ) {
    try {
      const EmailService = require('./email-service');
      results.email = await EmailService.sendPaymentLinkEmail(patientEmail, payUrl, order);
    } catch (err) {
      results.email = { success: false, error: err.message };
    }
  }

  return results;
}

module.exports = {
  createRcmPaymentRequest,
  notifyPatientPaymentLink,
  payUrlFromToken,
  publicPayBaseFromEnv,
  resolveCopayAmount,
};
