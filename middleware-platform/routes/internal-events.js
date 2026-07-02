'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { runEligibilityOrchestration } = require('../services/eligibility-orchestrator');
const { applyEligibilityUsage } = require('../services/apply-eligibility-usage');

function requireInternalAuth(req, res, next) {
  const jobTok = process.env.INTERNAL_JOB_TOKEN || null;
  const apiKey = process.env.INTERNAL_API_KEY || null;
  if (jobTok && req.headers['x-internal-job-token'] === jobTok) return next();
  if (apiKey && req.headers['x-internal-api-key'] === apiKey) return next();
  return res.status(401).json({ success: false, error: 'unauthorized' });
}

/**
 * POST /api/internal/events/eligibility-complete
 * Thin ARCH-3 wrapper — eligibility_complete → billing pivot (not meta_kv scatter).
 */
router.post('/eligibility-complete', requireInternalAuth, express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const input = {
      customerId: body.customer_id || body.customerId || null,
      clinicId: body.clinic_id || body.clinicId || null,
      sessionId: body.session_id || body.sessionId || null,
      callId: body.call_id || body.callId || body.session_id || null,
      payerId: body.payer_id || body.payerId || null,
      memberId: body.member_id || body.memberId || null,
      serviceCode: body.service_code || body.serviceCode || 'D1110',
      dateOfBirth: body.date_of_birth || body.dateOfBirth || null
    };

    const result = await runEligibilityOrchestration(input);

    let billing = null;
    if (input.customerId) {
      billing = applyEligibilityUsage(db, {
        customerId: input.customerId,
        eventId: result.eligibility_event_id,
        payerId: input.payerId,
        quality: result.eligibility_quality || body.eligibility_quality || null,
        source: body.source || 'stedi'
      });
    }

    return res.json({
      success: true,
      event_type: 'eligibility_complete',
      eligibility_event_id: result.eligibility_event_id,
      eligible: result.eligible,
      amount_due: result.copay ?? result.patientResponsibility ?? null,
      handoff: result.handoff || null,
      billing
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || 'internal_error' });
  }
});

module.exports = router;
