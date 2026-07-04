'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const settlement = require('../services/rcm-payment-settlement');
const { pilotRateLimit } = require('../middleware/pilot-rate-limit');

router.get('/pay/:token', pilotRateLimit('pay_link_lookup'), async (req, res) => {
  try {
    const ctx = await settlement.getPaymentContext(req.params.token);
    if (!ctx.success) {
      return res.status(ctx.status || 400).json({ success: false, error: ctx.error, code: ctx.code });
    }
    if (ctx.zero_balance) {
      return res.json({
        success: true,
        zero_balance: true,
        code: 'zero_balance',
        payment: ctx.payment,
        rails: ctx.rails
      });
    }
    if (ctx.alreadyPaid) {
      return res.json({
        success: true,
        already_paid: true,
        payment: ctx.payment,
        rails: ctx.rails,
      });
    }
    return res.json({
      success: true,
      already_paid: false,
      payment: ctx.payment,
      clinic: ctx.payment?.clinic_name
        ? { name: ctx.payment.clinic_name, phone: ctx.payment.clinic_phone || null }
        : null,
      rails: ctx.rails,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pay/:token/create-intent', pilotRateLimit('pay_link_lookup'), async (req, res) => {
  try {
    const { requireSmsConsentForPayment, recordRcmSmsConsent } = require('../services/tcpa-consent-service');
    const row = db.db?.prepare('SELECT * FROM rcm_payments WHERE pay_token = ?').get(req.params.token);
    const consent = requireSmsConsentForPayment({
      smsConsent: req.body?.sms_consent,
      phone: row?.patient_phone || req.body?.phone
    });
    if (!consent.ok) {
      return res.status(400).json({ success: false, error: consent.error, code: consent.code });
    }
    if (consent.consented_at) recordRcmSmsConsent(req.params.token);

    const result = await settlement.createStripeIntent(req.params.token);
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pay/:token/complete', async (req, res) => {
  try {
    const method = String(req.body?.method || '').toLowerCase();
    if (method === 'usdc') {
      const result = await settlement.settleUsdc(req.params.token);
      if (!result.success) {
        return res.status(result.status || 400).json({
          success: false,
          error: result.error,
          current_balance: result.current_balance,
          required: result.required,
        });
      }
      return res.json(result);
    }
    if (method === 'stripe') {
      const result = await settlement.settleStripe(req.params.token, req.body?.payment_intent_id);
      if (!result.success) {
        return res.status(result.status || 400).json({
          success: false,
          error: result.error,
          payment_status: result.payment_status,
        });
      }
      return res.json(result);
    }
    return res.status(400).json({
      success: false,
      error: 'method must be "usdc" or "stripe". Stub card completion is not supported.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
