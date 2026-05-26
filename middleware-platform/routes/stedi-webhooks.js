'use strict';

/**
 * Stedi Healthcare webhooks — claim status / adjudication feedback.
 * Mount: app.use('/webhooks/stedi', stediWebhookRouter);
 *
 * .env: STEDI_WEBHOOK_SECRET (optional HMAC verification)
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const InsuranceService = require('../services/insurance-service');

const router = express.Router();

function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.STEDI_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return !secret;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signatureHeader).trim()));
  } catch (_) {
    return false;
  }
}

function mapStediStatus(payload) {
  const raw =
    payload?.status ||
    payload?.claimStatus ||
    payload?.adjudicationStatus ||
    payload?.outcome ||
  '';
  const s = String(raw).toLowerCase();
  if (['success', 'accepted', 'approved', 'paid'].some((x) => s.includes(x))) {
    return s.includes('paid') ? 'paid' : 'approved';
  }
  if (['denied', 'rejected', 'failed'].some((x) => s.includes(x))) return 'denied';
  if (s.includes('pending') || s.includes('processing')) return 'processing';
  return null;
}

function findClaim(payload) {
  const id =
    payload?.claimId ||
    payload?.correlationId ||
    payload?.x12_claim_id ||
    payload?.claim?.id;
  if (!id) return null;
  let claim = db.getInsuranceClaim?.(id);
  if (claim) return claim;
  const sqlite = db.db;
  if (!sqlite) return null;
  try {
    return sqlite.prepare(
      `SELECT * FROM insurance_claims WHERE x12_claim_id = ? OR id = ? LIMIT 1`
    ).get(String(id), String(id));
  } catch (_) {
    return null;
  }
}

router.post('/claim-status', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const sig = req.headers['x-stedi-signature'] || req.headers['stedi-signature'];
    if (process.env.STEDI_WEBHOOK_SECRET && sig) {
      const raw = JSON.stringify(req.body);
      if (!verifySignature(raw, sig)) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const payload = req.body || {};
    const claim = findClaim(payload);
    const status = mapStediStatus(payload);

    if (claim && status) {
      InsuranceService.applyClaimAdjudicationOutcome(claim, status);
      let responseData = {};
      try {
        responseData = claim.response_data
          ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data)
          : {};
      } catch (_) {}
      responseData.stedi_webhook = { received_at: new Date().toISOString(), status, payload };
      db.updateInsuranceClaim(claim.id, { response_data: JSON.stringify(responseData) });
    }

    return res.json({
      ok: true,
      matched: Boolean(claim),
      status: status || 'unmapped'
    });
  } catch (e) {
    console.error('[StediWebhook] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = { stediWebhookRouter: router };
