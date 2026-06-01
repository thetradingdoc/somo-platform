#!/usr/bin/env node
'use strict';

/**
 * F1c — Pay-from-fixture E2E (Sprint 2). Starts from seedPayReady, copay + pay turns only.
 *
 * Usage:
 *   RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:kelly:pay-fixture
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const MP = path.join(__dirname, '..');
process.chdir(MP);
process.env.DB_PATH = process.env.DB_PATH || path.join(MP, 'middleware-dev.db');

const API_BASE = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = process.env.TEST_CLINIC_ID || 'clinic-default';
const PATIENT_PHONE = process.env.TEST_PATIENT_PHONE || '+15550009991';

const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');

async function main() {
  if (!process.env.RCM_E2E_USE_EXISTING_SERVER) {
    console.error('Set RCM_E2E_USE_EXISTING_SERVER=1');
    process.exit(1);
  }
  if (!(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY)) {
    console.error('No LLM API key');
    process.exit(1);
  }

  const health = await new Promise((resolve, reject) => {
    http.get(`${API_BASE}/health`, (r) => resolve(r.statusCode)).on('error', reject);
  });
  if (health !== 200) process.exit(1);

  const { dbModule } = fixtures.loadDb();
  let patient = dbModule.getFHIRPatientByPhone?.(PATIENT_PHONE);
  if (!patient) {
    const resourceId = `Patient/e2e-pay-${crypto.randomBytes(4).toString('hex')}`;
    dbModule.createFHIRPatient({
      resourceType: 'Patient',
      id: resourceId,
      name: [{ given: ['E2E'], family: 'PayFixture' }],
      telecom: [
        { system: 'phone', value: PATIENT_PHONE },
        { system: 'email', value: 'e2e-pay-fixture@somo.test' },
      ],
    });
    patient = dbModule.getFHIRPatient(resourceId);
  }

  const sessionId = fixtures.newE2eSessionId('e2e_pay');
  const KellyAgent = require('../services/kelly-agent-service');
  const KellyToolExecutor = fixtures.getKellyToolExecutor();

  const paySeed = fixtures.seedPayReady(sessionId, patient.resource_id, CLINIC_ID);
  fixtures.assertKellyState(sessionId, { phase: 'BILLING' });

  const turn = async (msg) => {
    const result = await KellyAgent.processTurn({
      sessionId,
      clinicId: CLINIC_ID,
      patientId: patient.resource_id,
      callerPhone: PATIENT_PHONE,
      channel: 'voice',
      message: msg,
    });
    return {
      reply: result?.reply || '',
      toolsUsed: result?.toolsUsed || [],
    };
  };

  const t5 = await turn('I have BlueCross insurance. What will my copay be for this visit?');
  if (!/\$|copay|25|insurance|benefit/i.test(t5.reply)) {
    console.error('Turn 5 copay discussion failed:', t5.reply.slice(0, 120));
    process.exit(1);
  }

  const t6 = await turn(
    'OK, I would like to pay $25 now before the appointment. Please send me a secure payment link.'
  );
  const calledPay = t6.toolsUsed.some((t) => /request_patient_payment/i.test(t));
  const payToken =
    KellyToolExecutor._getSessionMeta(sessionId, 'rcm_pay_token') ||
    dbModule.db
      ?.prepare(
        `SELECT pay_token FROM rcm_payments WHERE patient_id = ? ORDER BY requested_at DESC LIMIT 1`
      )
      ?.get(patient.resource_id)?.pay_token;

  if (!calledPay && !payToken) {
    console.error('request_patient_payment not invoked:', t6.toolsUsed, t6.reply.slice(0, 120));
    process.exit(1);
  }

  console.log('F1c PASS pay_token=', payToken?.slice(0, 8));
  fixtures.teardownKellySession(sessionId);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
