#!/usr/bin/env node
'use strict';

/**
 * Stedi sandbox integration audit — exercises 270/271, 837, 276/277, PA stub, 835/275 routes.
 * Usage: node scripts/stedi-sandbox-integration.cjs
 * Requires: middleware-platform/.env with STEDI_API_KEY
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
process.chdir(require('path').resolve(__dirname, '..'));

const { stediArchLog } = require('../lib/stedi-arch-debug');
const InsuranceService = require('../services/insurance-service');
const PayerGatewayService = require('../services/payer-gateway-service');
const PriorAuthService = require('../services/prior-auth-service');

const PAYER_ID = process.env.STEDI_TEST_PAYER_ID || '60054';
const MEMBER_ID = process.env.STEDI_TEST_MEMBER_ID || 'TEST123456';
const SUB_FIRST = process.env.STEDI_TEST_SUBSCRIBER_FIRST || 'Jane';
const SUB_LAST = process.env.STEDI_TEST_SUBSCRIBER_LAST || 'Doe';
const SUB_DOB = process.env.STEDI_TEST_DOB || '2004-04-04'; // YYYY-MM-DD
const SERVICE_CODE = process.env.STEDI_TEST_SERVICE_CODE || '99213';
const DOS = process.env.STEDI_TEST_DOS || new Date().toISOString().split('T')[0];

const report = { at: new Date().toISOString(), checks: [] };

function resolveSandboxPatientId() {
  const database = require('../database');
  const sqlite = database.db;
  if (!sqlite) return null;
  try {
    const row = sqlite.prepare(`
      SELECT resource_id FROM fhir_patients
      WHERE is_deleted = 0 OR is_deleted IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    return row?.resource_id || null;
  } catch (_) {
    return null;
  }
}

function record(name, ok, detail) {
  report.checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  stediArchLog(ok ? 'PASS' : 'FAIL', 'stedi-sandbox-integration.cjs', name, { ok, detail });
}

async function main() {
  const apiKey = (process.env.STEDI_API_KEY || '').trim();
  const keyType = !apiKey ? 'missing' : apiKey.startsWith('test_') ? 'test_prefix' : 'live_like';
  record('env.STEDI_API_KEY', Boolean(apiKey), { keyType, mode: InsuranceService.getStediClaimSubmissionMode() });

  // --- 270/271 Eligibility (patient + provider share InsuranceService) ---
  let elig;
  try {
    elig = await InsuranceService.checkEligibility({
      patientId: null,
      memberId: MEMBER_ID,
      payerId: PAYER_ID,
      serviceCode: SERVICE_CODE,
      dateOfService: DOS,
      patientName: `${SUB_FIRST} ${SUB_LAST}`,
      dateOfBirth: SUB_DOB,
      surface: 'sandbox_audit'
    });
    const real271 = elig.success && !elig.stediFallback;
    record('270/271 eligibility', real271, {
      eligible: elig.eligible,
      stediFallback: Boolean(elig.stediFallback),
      priorAuthIndicator: elig.priorAuthIndicator || null,
      copay: elig.copay
    });
  } catch (e) {
    record('270/271 eligibility', false, e.message);
  }

  const sandboxPatientId = resolveSandboxPatientId();

  // --- Reverify at submit (uses checkEligibility when no recent row) ---
  try {
    const rev = await InsuranceService.reverifyEligibilityIfNeeded({
      patientId: sandboxPatientId,
      memberId: MEMBER_ID,
      payerId: PAYER_ID,
      serviceCode: SERVICE_CODE,
      dateOfService: DOS,
      patientName: `${SUB_FIRST} ${SUB_LAST}`,
      dateOfBirth: SUB_DOB,
      surface: 'sandbox_reverify'
    });
    record('reverify eligibility at submit', true, rev);
  } catch (e) {
    record('reverify eligibility at submit', false, e.message);
  }

  // --- 837 submit (voice path) ---
  let x12ClaimId = null;
  try {
    const sub = await InsuranceService.submitClaim({
      patientId: sandboxPatientId,
      memberId: MEMBER_ID,
      payerId: PAYER_ID,
      serviceCode: SERVICE_CODE,
      diagnosisCode: 'Z00.00',
      totalAmount: 150,
      copayPaid: 25,
      dateOfService: DOS,
      patientName: `${SUB_FIRST} ${SUB_LAST}`,
      dateOfBirth: SUB_DOB,
      surface: 'sandbox_voice_submit'
    });
    x12ClaimId = sub.x12ClaimId || null;
    const claimOk = sub.success && (sub.healthcareSubmitted || sub.testModeClaimBlocked || Boolean(sub.claimId));
    record('837 claim submit (submitClaim)', claimOk, {
      healthcareSubmitted: Boolean(sub.healthcareSubmitted),
      testModeClaimBlocked: Boolean(sub.testModeClaimBlocked),
      stediFallback: Boolean(sub.stediFallback),
      x12ClaimId: x12ClaimId ? String(x12ClaimId).slice(0, 12) + '…' : null,
      eligibilityReverified: Boolean(sub.eligibilityReverified),
      sandboxPatientId: sandboxPatientId ? 'set' : 'null'
    });
  } catch (e) {
    record('837 claim submit (submitClaim)', false, e.message);
  }

  // --- 276/277 status ---
  if (x12ClaimId || sandboxPatientId) {
    try {
      const claims = require('../database');
      let row = null;
      if (sandboxPatientId && claims.getInsuranceClaimsByPatient) {
        const rows = claims.getInsuranceClaimsByPatient(sandboxPatientId) || [];
        row = rows.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))[0];
      }
      if (!row && claims.db) {
        row = claims.db.prepare(
          `SELECT * FROM insurance_claims ORDER BY submitted_at DESC LIMIT 1`
        ).get();
      }
      const claimId = row?.id;
      if (claimId) {
        const st = await InsuranceService.checkClaimStatus(claimId);
        record('276/277 claim status', st.success, {
          status: st.status,
          paymentAmount: st.paymentAmount
        });
      } else {
        record('276/277 claim status', false, 'no claim row for status poll');
      }
    } catch (e) {
      record('276/277 claim status', false, e.message);
    }
  } else {
    record('276/277 claim status', false, 'skipped — no x12ClaimId from submit');
  }

  // --- Payor gateway ---
  try {
    const gw = await PayerGatewayService.checkEligibility({
      payerId: PAYER_ID,
      memberId: MEMBER_ID,
      serviceCode: SERVICE_CODE,
      dateOfService: DOS
    });
    record('payor gateway eligibility', Boolean(gw?.primary?.success), { backend: gw.backend });
  } catch (e) {
    record('payor gateway eligibility', false, e.message);
  }

  // --- 278 PA (expected unsupported) ---
  try {
    const pa = await PriorAuthService.submitPriorAuth({
      patient_id: 'sandbox_patient_audit',
      payer_id: PAYER_ID,
      procedure_code: SERVICE_CODE
    });
    const expected = pa.code === 'STEDI_278_UNSUPPORTED';
    record('278 prior auth (expect unsupported)', expected, { code: pa.code });
  } catch (e) {
    record('278 prior auth (expect unsupported)', false, e.message);
  }

  // --- 835 / 275 route smoke (in-process) ---
  try {
    const express = require('express');
    const request = require('supertest');
    const { stediWebhookRouter } = require('../routes/stedi-webhooks');
    const app = express();
    app.use('/webhooks/stedi', stediWebhookRouter);
    const rem = await request(app)
      .post('/webhooks/stedi/remittance-advice')
      .send({ claimId: 'nonexistent', paidAmount: 100 });
    record('835 remittance webhook route', rem.status === 200, { status: rem.status, body: rem.body });
    const att = await request(app).post('/webhooks/stedi/attachments').send({});
    record('275 attachments route (expect 501)', att.status === 501, { status: att.status, code: att.body?.code });
  } catch (e) {
    record('835/275 webhook smoke', false, e.message);
  }

  const passed = report.checks.filter((c) => c.ok).length;
  const total = report.checks.length;
  console.log(`\nSummary: ${passed}/${total} checks passed`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
