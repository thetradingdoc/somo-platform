'use strict';

const crypto = require('crypto');
const db = require('../../database');
const orchestrator = require('./rcm-journey-orchestrator');

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

function resolveCopayAmount({ amount, patientId, clinicId, journeyId }) {
  if (amount != null && Number(amount) > 0) {
    return Number(amount);
  }

  if (journeyId) {
    try {
      orchestrator.ensureKellyRcmTables();
      const journey = db.db
        .prepare(`SELECT amount_due FROM rcm_journeys WHERE id = ? AND clinic_id = ?`)
        .get(String(journeyId), String(clinicId));
      if (journey?.amount_due != null && Number(journey.amount_due) > 0) {
        return Number(journey.amount_due);
      }
    } catch (_) {}
  }

  if (patientId) {
    try {
      const row = db.db
        .prepare(
          `SELECT copay_amount FROM eligibility_checks
           WHERE patient_id = ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(String(patientId));
      if (row?.copay_amount != null && Number(row.copay_amount) > 0) {
        return Number(row.copay_amount);
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Create an RCM payment request (shared by provider API and Kelly tool).
 */
function createRcmPaymentRequest({
  clinicId,
  amount,
  journeyId = null,
  patientId = null,
  method = 'manual',
  req = null,
  publicPayBase = null,
}) {
  orchestrator.ensureKellyRcmTables();
  const clinic = String(clinicId || '').trim();
  if (!clinic) {
    return { success: false, error: 'clinic_id is required', status: 400 };
  }

  const resolvedAmount = resolveCopayAmount({ amount, patientId, clinicId: clinic, journeyId });
  const amt = Number(resolvedAmount ?? amount ?? 0);
  if (!(amt > 0)) {
    return { success: false, error: 'amount must be > 0', status: 400 };
  }

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
      const EmailService = require('../platform/email-service');
      results.email = await EmailService.sendPaymentLinkEmail(patientEmail, payUrl, order);
    } catch (err) {
      results.email = { success: false, error: err.message };
    }
  }

  if ((mode === 'sms' || mode === 'both') && patientPhone) {
    try {
      const SMSService = require('../platform/sms-service');
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

  return results;
}

module.exports = {
  createRcmPaymentRequest,
  notifyPatientPaymentLink,
  payUrlFromToken,
  publicPayBaseFromEnv,
  resolveCopayAmount,
};
