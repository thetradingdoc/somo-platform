#!/usr/bin/env node
'use strict';

/**
 * Stedi production cutover helper — validates local key and prints Cloud Run steps.
 *
 * Usage:
 *   node scripts/setup-phase2-prod-stedi.cjs --dry-run
 *   node scripts/setup-phase2-prod-stedi.cjs --apply   # prints gcloud command (does not auto-run)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--check-only') || !process.argv.includes('--apply');
const checkOnly = process.argv.includes('--check-only');

function main() {
  console.log('\n=== Phase 2 Stedi Production Cutover ===\n');
  console.log(`mode: ${checkOnly ? 'check-only (fd-* mapping)' : dryRun ? 'dry-run (checklist only)' : 'apply (print gcloud update)'}\n`);

  console.log('Ordered steps:\n');
  const steps = [
    { todo: 'fd2-prod-stedi', text: '1. Fund Stedi pay-as-you-go production account' },
    { todo: 'fd2-stedi-baa-enrollment', text: '2. Sign Stedi BAA (docs/compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md)' },
    { todo: 'fd2-stedi-baa-enrollment', text: '3. Enroll pilot office NPI + top 5 payers in Stedi Transaction Enrollment' },
    { todo: 'fd-prod-stedi-cloudrun', text: '4. Store production STEDI_API_KEY in GCP Secret Manager' },
    { todo: 'fd-prod-stedi-cloudrun', text: '5. Set STEDI_TEST_MODE=0 and VOICE_ELIGIBILITY_SIMULATE=0 on Cloud Run' },
    { todo: 'fd2-prod-stedi', text: '6. Run live 271 tests: npm run verify:phase2-ops -- --clinic-id <pilot_clinic_id>' },
    { todo: 'fd2-prod-stedi', text: '7. Run npm run verify:pilot-prod-readiness with PILOT_PROD_STRICT=1' }
  ];
  for (const s of steps) console.log(`   [${s.todo}] ${s.text}`);

  console.log('\n── Local Stedi env ──\n');
  const verify = spawnSync('node', ['scripts/verify-stedi-env.cjs'], { cwd: ROOT, stdio: 'inherit' });
  if (verify.status !== 0 && !checkOnly) {
    console.warn('\n⚠️  verify-stedi-env failed — fix STEDI_CLAIM_SUBMISSION_MODE before prod cutover.\n');
  }

  const apiKey = (process.env.STEDI_API_KEY || '').trim();
  const hasProdKey = Boolean(apiKey && !apiKey.startsWith('test_'));
  console.log(`STEDI_API_KEY: ${apiKey ? (hasProdKey ? 'production-like ✅' : 'test key only ⚠️') : 'missing ⚠️'}`);
  console.log(`STEDI_TEST_MODE: ${process.env.STEDI_TEST_MODE || '(unset)'}`);
  console.log(`VOICE_ELIGIBILITY_SIMULATE: ${process.env.VOICE_ELIGIBILITY_SIMULATE || '(unset)'}`);

  if (checkOnly) {
    console.log('\n── Check-only summary (no gcloud) ──\n');
    console.log(`   fd2-prod-stedi: ${hasProdKey ? 'key ready' : 'blocked on prod key'}`);
    console.log(`   fd-prod-stedi-cloudrun: STEDI_TEST_MODE=0 required before live 271`);
    console.log('\nDocs: docs/voice-agent/PROD_VENDOR_GATES.md\n');
    process.exit(0);
  }

  const service = process.env.CLOUDRUN_SERVICE || 'somo-middleware';
  const region = process.env.GCP_REGION || 'us-central1';
  const project = process.env.GCP_PROJECT || 'somo-callsomo';

  const gcloudCmd = [
    'gcloud run services update',
    service,
    `--region=${region}`,
    `--project=${project}`,
    '--update-env-vars=STEDI_TEST_MODE=0,VOICE_ELIGIBILITY_SIMULATE=0',
    '--set-secrets=STEDI_API_KEY=STEDI_API_KEY:latest'
  ].join(' ');

  console.log('\n── Cloud Run update (after prod key in Secret Manager) ──\n');
  console.log(gcloudCmd);
  console.log('\nOr merge into generate-cloudrun-env-yaml.cjs + redeploy with CLOUDRUN_PRESERVE_ENV=0.\n');

  if (!dryRun) {
    console.log('ℹ️  --apply does not run gcloud automatically. Copy the command above.\n');
  }

  console.log('Docs: docs/voice-agent/phase2-pilot-checklist.md\n');
  process.exit(hasProdKey || dryRun ? 0 : 1);
}

main();
