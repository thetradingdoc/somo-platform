#!/usr/bin/env node
'use strict';

/**
 * Kelly collect_insurance HTTP contract — POST must omit service_code.
 * Run: DB_PATH=./var/db/middleware-dev.db node scripts/verify-kelly-http-collect.cjs
 */

const path = require('path');
const { bootstrapVerifyEnv } = require('./lib/verify-env.cjs');
bootstrapVerifyEnv({ codingSpineOnly: true });

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { openAppDb } = require('./lib/verify-db.cjs');
const { seedTriage } = require('./lib/seed-triage.cjs');
const { seedPayerRules } = require('./lib/seed-payer-rules.cjs');
const { withMockPost } = require('./lib/kelly-test-harness.cjs');

const { db } = openAppDb();

async function main() {
  seedPayerRules(path.join(__dirname, '..'));

  const sessionId = `verify_http_collect_${Date.now()}`;
  seedTriage(db, sessionId);

  const posted = [];
  const result = await withMockPost(
    KellyToolExecutor,
    async (url, body) => {
      posted.push({ url, body });
      if (body.service_code) {
        return {
          success: false,
          error_code: 'CLIENT_SERVICE_CODE_REJECTED',
          message: 'simulated rejection'
        };
      }
      return { success: true, patient_id: 'p_http', quote: { status: 'hard_number' } };
    },
    () =>
      KellyToolExecutor._collectInsurance(
        { payer_id: 'BCBS_PILOT', plan_id: 'plan_x', member_id: 'MBR123' },
        { sessionId, patientId: 'p_http', callerPhone: '+15555550199' }
      )
  );

  const checks = [
    { name: 'collect_success', pass: result?.success === true, actual: result?.success },
    { name: 'not_client_rejected', pass: result?.error_code !== 'CLIENT_SERVICE_CODE_REJECTED', actual: result?.error_code },
    { name: 'post_called', pass: posted.length === 1, actual: posted.length },
    { name: 'no_service_code_in_post', pass: posted[0] && posted[0].body.service_code == null, actual: posted[0]?.body?.service_code },
    { name: 'primary_cpt_in_post', pass: posted[0]?.body?.primary_cpt === '99213', actual: posted[0]?.body?.primary_cpt }
  ];
  const failed = checks.filter((c) => !c.pass);
  console.log(JSON.stringify({ checks, success: failed.length === 0 }, null, 2));
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
