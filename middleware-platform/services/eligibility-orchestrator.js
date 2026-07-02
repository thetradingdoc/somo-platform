'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { mergeByoCredentialing } = require('./byo-credentialing');
const InsuranceService = require('./insurance-service');
const { buildPpoReadback } = require('./ppo-readback-service');

/**
 * Eligibility orchestrator spine — single entry for voice/RCM eligibility (EO-P0-4).
 */
async function runEligibilityOrchestration(input = {}) {
  const enriched = mergeByoCredentialing(input);
  const result = await InsuranceService.checkEligibility(enriched);

  const eventId = `elig_complete_${uuidv4()}`;
  const payload = {
    customer_id: input.customerId || null,
    clinic_id: input.clinicId || null,
    session_id: input.sessionId || input.callId || null,
    call_id: input.callId || null,
    payer_id: input.payerId || enriched.payerId || null,
    eligibility_quality: result.eligibility_quality || null,
    amount_due: result.copay ?? result.patientResponsibility ?? null,
    rail: result.rail || 'stedi',
    eligible: result.eligible
  };

  if (db.db) {
    try {
      db.db.prepare(`
        INSERT INTO eligibility_complete_events (
          id, customer_id, clinic_id, session_id, call_id, payer_id,
          eligibility_quality, amount_due, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        payload.customer_id,
        payload.clinic_id,
        payload.session_id,
        payload.call_id,
        payload.payer_id,
        payload.eligibility_quality,
        payload.amount_due,
        JSON.stringify(payload)
      );
    } catch (e) {
      console.warn('[eligibility-orchestrator] event insert failed:', e.message);
    }
  }

  return {
    ...result,
    eligibility_complete: true,
    eligibility_event_id: eventId,
    ppo_readback: buildPpoReadback(result),
    handoff: {
      type: 'eligibility_complete',
      session_id: payload.session_id,
      amount_due: payload.amount_due,
      eligible: payload.eligible,
      ppo_readback: buildPpoReadback(result)
    }
  };
}

module.exports = { runEligibilityOrchestration };
