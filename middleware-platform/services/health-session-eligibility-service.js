'use strict';

const InsuranceService = require('./insurance-service');
const routingRepo = require('../database/repos/health-session-routing');
const healthSessionService = require('./health-session-service');

function mockEnabled() {
  const flag = String(process.env.HEALTH_SESSION_PAYMENT_MOCK || '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

function financeEnabled() {
  const flag = String(process.env.HEALTH_SESSION_FINANCE_ENABLED || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  return mockEnabled() || flag === '1' || flag === 'true';
}

function defaultCopayCents() {
  const raw = parseInt(process.env.HEALTH_SESSION_MOCK_COPAY_CENTS || '2500', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2500;
}

function mockEligibilityResult() {
  const copayCents = defaultCopayCents();
  return {
    eligible: true,
    copay_cents: copayCents,
    network_status: 'in_network',
    payer_id: 'MOCK_PAYER',
    source: 'mock'
  };
}

async function runEligibilityCheck(sessionId, input = {}) {
  if (!financeEnabled()) {
    const err = new Error('Health session finance rails are disabled');
    err.statusCode = 503;
    throw err;
  }

  const session = healthSessionService.getById(sessionId);
  if (!session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  routingRepo.upsertRow({
    sessionId,
    eligibilityStatus: 'running',
    routingStatus: 'eligibility_running'
  });

  const metadata = session.metadata || {};
  const urgency = input.urgency || metadata.care_pathway?.urgency || metadata.urgency || 'routine_visit';
  const pathwaySummary = input.pathway_summary || metadata.care_pathway?.summary || null;

  let result;
  if (mockEnabled() || !input.member_id || !input.payer_id) {
    result = mockEligibilityResult();
  } else {
    try {
      const elig = await InsuranceService.checkEligibility({
        patientName: input.patient_name || metadata.display_name || 'Health Session Patient',
        memberId: input.member_id,
        payerId: input.payer_id,
        serviceCode: input.service_code || '99213',
        dateOfService: input.date_of_service || new Date().toISOString().slice(0, 10),
        patientId: input.patient_id || null
      });
      const copayCents = Math.round(Number(elig.copay_amount || elig.copay || 0) * 100);
      result = {
        eligible: !!elig.eligible,
        copay_cents: copayCents > 0 ? copayCents : defaultCopayCents(),
        network_status: elig.eligible ? 'in_network' : 'unknown',
        payer_id: input.payer_id,
        member_id: input.member_id,
        source: 'stedi'
      };
    } catch (e) {
      result = { ...mockEligibilityResult(), source: 'stedi_fallback', error: e.message };
    }
  }

  const row = routingRepo.upsertRow({
    sessionId,
    eligibilityStatus: 'complete',
    eligible: result.eligible,
    copayCents: result.copay_cents,
    payerId: result.payer_id,
    memberId: result.member_id || input.member_id || null,
    networkStatus: result.network_status,
    urgency,
    pathwaySummary,
    paymentStatus: 'quoted',
    routingStatus: 'quoted',
    routingPayloadJson: JSON.stringify({ eligibility: result })
  });

  healthSessionService.updateMetadata(sessionId, {
    routing: {
      copay_cents: result.copay_cents,
      eligible: result.eligible,
      network_status: result.network_status,
      payment_status: 'quoted'
    }
  });

  return routingRepo.formatPublic(row);
}

module.exports = {
  financeEnabled,
  mockEnabled,
  runEligibilityCheck,
  mockEligibilityResult
};
