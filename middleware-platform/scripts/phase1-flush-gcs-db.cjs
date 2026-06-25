#!/usr/bin/env node
'use strict';

/**
 * Flush Cloud Run SQLite snapshot to GCS (POSTGRES_PRIMARY instances upload on cycle).
 * Uses rolling env bump — same pattern as capstone-retell-live-verify.cjs.
 */

const { execSync } = require('child_process');

const PROJECT = process.env.GCP_PROJECT || 'somo-callsomo';
const REGION = process.env.GCP_REGION || 'us-central1';
const SERVICE = process.env.CLOUD_RUN_SERVICE || 'somo-middleware';
const WAIT_SEC = Number(process.env.PHASE1_FLUSH_WAIT_SEC || 90);

function main() {
  const stamp = `PHASE1_FLUSH_${Date.now()}`;
  console.log(`==> Rolling restart ${SERVICE} (${stamp})…`);
  execSync(
    `gcloud run services update ${SERVICE} --region ${REGION} --project ${PROJECT} --update-env-vars ${stamp}=1`,
    { stdio: 'inherit' }
  );
  console.log(`==> Waiting ${WAIT_SEC}s for GCS upload on shutdown…`);
  execSync(`sleep ${WAIT_SEC}`);
  execSync(`bash "${require('path').join(__dirname, '..', '..', 'scripts', 'phase1-pull-prod-db.sh')}"`, {
    stdio: 'inherit'
  });
  console.log('==> GCS pull complete');
}

main();
