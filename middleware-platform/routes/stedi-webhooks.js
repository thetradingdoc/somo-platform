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
const orchestrator = require('../services/rcm-journey-orchestrator');

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
      try {
        const clinicId = claim.clinic_id || payload?.clinicId;
        if (clinicId) {
          orchestrator.onClaimAdjudication({
            clinicId,
            claimId: claim.id,
            status,
            payload: { source: 'stedi_webhook', stedi: true },
          });
        }
      } catch (e) {
        console.warn('[StediWebhook] onClaimAdjudication:', e.message);
      }
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

/**
 * Placeholder: Prior auth status webhook.
 *
 * Stedi does not currently support X12 278 submission, so this endpoint is a stub until:
 * - a PA partner platform emits events, or
 * - a future Stedi product adds prior auth case notifications.
 *
 * Mount: POST /webhooks/stedi/prior-auth-status
 */
function normalize835Payload(payload) {
  const claimId =
    payload?.claimId ||
    payload?.claim_id ||
    payload?.patientControlNumber ||
    payload?.claim?.id;
  const paidAmount =
    typeof payload?.paidAmount === 'number'
      ? payload.paidAmount
      : typeof payload?.paymentAmount === 'number'
        ? payload.paymentAmount
        : null;
  return {
    claimId,
    paidAmount,
    adjustmentReason: payload?.adjustmentReason || payload?.reasonCode || null,
    remark: payload?.remark || payload?.note || null,
    patientName: payload?.patientName || null,
    payerName: payload?.payerName || payload?.payer_name || null,
    // Keep the full raw payload for audit/ERA reconstruction.
    // (We also store a summary in insurance_claims.response_data.)
    rawPayload: payload
  };
}

/**
 * X12 835 remittance advice webhook (ERA payment / adjustment).
 * Mount: POST /webhooks/stedi/remittance-advice
 */
router.post('/remittance-advice', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const sig = req.headers['x-stedi-signature'] || req.headers['stedi-signature'];
    if (process.env.STEDI_WEBHOOK_SECRET && sig) {
      const raw = JSON.stringify(req.body);
      if (!verifySignature(raw, sig)) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const remittance = normalize835Payload(req.body || {});
    const claim = remittance.claimId ? findClaim({ claimId: remittance.claimId }) : null;
    let applied = null;
    if (claim) {
      applied = InsuranceService.applyRemittanceFrom835(claim, remittance);
    }

    return res.json({
      ok: true,
      matched: Boolean(claim),
      applied: Boolean(applied)
    });
  } catch (e) {
    console.error('[StediWebhook] remittance error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * X12 275 unsolicited attachments — not supported on Stedi rail today.
 * Returns 501 so integrators know to use partner upload path.
 */
router.post('/attachments', express.json({ limit: '10mb' }), (_req, res) => {
  return res.status(501).json({
    ok: false,
    code: 'STEDI_275_UNSUPPORTED',
    error: 'Unsolicited attachments (X12 275) are not implemented. Use portal upload or a PA partner attachment API.'
  });
});

router.post('/prior-auth-status', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const sig = req.headers['x-stedi-signature'] || req.headers['stedi-signature'];
    if (process.env.STEDI_WEBHOOK_SECRET && sig) {
      const raw = JSON.stringify(req.body);
      if (!verifySignature(raw, sig)) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const payload = req.body || {};

    // Best-effort mapping for a “human in the loop / partner” decision payload.
    // We persist the webhook into the matching `prior_auth_requests` row and keep
    // the raw payload for audit & UI reconstruction.
    const mapStatus = (raw) => {
      const s = String(raw || '').toLowerCase();
      if (['approved', 'approve', 'approved_success', 'accepted'].some((x) => s.includes(x))) return 'approved';
      if (['denied', 'deny', 'rejected', 'refused'].some((x) => s.includes(x))) return 'denied';
      if (['more_info_needed', 'more-info-needed', 'more info needed', 'need_more_info', 'pending_more_info'].some((x) =>
        s.includes(x)
      )) {
        return 'more_info_needed';
      }
      if (['cancelled', 'canceled'].some((x) => s.includes(x))) return 'cancelled';
      if (['not_required', 'not-required', 'no_pa_required', 'exempt'].some((x) => s.includes(x))) return 'not_required';
      if (['unknown'].some((x) => s.includes(x))) return 'unknown';
      if (['pending', 'processing'].some((x) => s.includes(x))) return 'pending';
      return null;
    };

    const requestId =
      payload?.priorAuthRequestId ||
      payload?.prior_auth_request_id ||
      payload?.requestId ||
      payload?.request_id ||
      payload?.id ||
      null;

    const appointmentId =
      payload?.appointmentId ||
      payload?.appointment_id ||
      payload?.appointment?.id ||
      null;

    const claimId = payload?.claimId || payload?.claim_id || payload?.claim?.id || null;

    const trackingNumber =
      payload?.trackingNumber || payload?.tracking_number || payload?.tracking || null;

    const stediCorrelationId =
      payload?.stediCorrelationId || payload?.stedi_correlation_id || payload?.correlationId || payload?.correlation_id || null;

    const authNumber =
      payload?.authNumber || payload?.auth_number || payload?.authorizationNumber || payload?.authorization_number || null;

    const expiryDate = payload?.expiryDate || payload?.expiry_date || payload?.expirationDate || payload?.expiration_date || null;

    const denialReason =
      payload?.denialReason || payload?.denial_reason || payload?.reason || payload?.reason_code || null;

    const decisionRaw =
      payload?.status ||
      payload?.decision_status ||
      payload?.decision ||
      payload?.outcome ||
      payload?.result ||
      null;

    const mappedStatus = mapStatus(decisionRaw);

    const sqlite = db.db;
    const findPriorAuthRequest = () => {
      if (!sqlite) return null;
      if (requestId) return db.getPriorAuthRequest(requestId);
      if (trackingNumber) {
        return sqlite
          .prepare(
            `SELECT * FROM prior_auth_requests WHERE tracking_number = ? ORDER BY datetime(created_at) DESC LIMIT 1`
          )
          .get(String(trackingNumber));
      }
      if (stediCorrelationId) {
        return sqlite
          .prepare(
            `SELECT * FROM prior_auth_requests WHERE stedi_correlation_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`
          )
          .get(String(stediCorrelationId));
      }
      if (appointmentId) {
        return sqlite
          .prepare(
            `SELECT * FROM prior_auth_requests WHERE appointment_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`
          )
          .get(String(appointmentId));
      }
      if (claimId) {
        return sqlite
          .prepare(`SELECT * FROM prior_auth_requests WHERE claim_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`)
          .get(String(claimId));
      }
      return null;
    };

    const priorAuthReq = findPriorAuthRequest();
    if (!priorAuthReq) {
      console.log('[stedi-webhook][prior-auth-status] no matching prior_auth_requests row found.');
      return res.json({ ok: true, received: true, matched: false });
    }

    const finalStatus = mappedStatus || priorAuthReq.status || 'pending';
    const requiresPriorAuth = !['not_required', 'unknown'].includes(String(finalStatus).toLowerCase());

    // Persist the raw webhook payload for audit + UI.
    const patch = {
      status: finalStatus,
      auth_number: authNumber != null ? String(authNumber).trim() : priorAuthReq.auth_number || null,
      expiry_date: expiryDate != null ? String(expiryDate) : priorAuthReq.expiry_date || null,
      denial_reason: denialReason != null ? String(denialReason) : priorAuthReq.denial_reason || null,
      tracking_number: trackingNumber != null ? String(trackingNumber) : priorAuthReq.tracking_number || null,
      stedi_correlation_id: stediCorrelationId != null ? String(stediCorrelationId) : priorAuthReq.stedi_correlation_id || null,
      raw_response_json: payload
    };

    if (finalStatus === 'denied') {
      patch.auth_number = null;
      patch.expiry_date = null;
    }
    if (finalStatus === 'not_required' || finalStatus === 'unknown') {
      patch.auth_number = null;
      patch.expiry_date = null;
    }

    db.updatePriorAuthRequest(priorAuthReq.id, patch);

    // Sync linked appointment so the PA gate can evaluate correctly.
    if (priorAuthReq.appointment_id && db.updateAppointment) {
      db.updateAppointment(priorAuthReq.appointment_id, {
        requires_prior_auth: requiresPriorAuth,
        auth_status: finalStatus,
        prior_auth_request_id: priorAuthReq.id
      });
    }

    return res.json({
      ok: true,
      received: true,
      matched: true,
      prior_auth_request_id: priorAuthReq.id,
      status: finalStatus
    });
  } catch (e) {
    console.error('❌ Error handling prior-auth-status webhook:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = { stediWebhookRouter: router };
