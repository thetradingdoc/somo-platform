#!/usr/bin/env node
'use strict';

/**
 * Staging deploy checklist for coding layer — run after Cloud Run deploy.
 * Usage: CODING_STAGING_URL=https://... node scripts/verify/verify-staging-coding-deploy.cjs
 */

const { REQUIRED_ENV, FORBIDDEN_ENV, fetchHealth, envChecklistCheck } = require('../lib/deploy-readiness.cjs');

async function main() {
  const url = process.env.CODING_STAGING_URL || process.env.STAGING_API_URL;
  const checks = [envChecklistCheck()];

  if (!url) {
    console.log(JSON.stringify({
      success: true,
      note: 'Set CODING_STAGING_URL to hit live staging /health after deploy.',
      checks
    }, null, 2));
    process.exit(0);
  }

  try {
    const health = await fetchHealth(url);
    checks.push({ name: 'staging_health', pass: health.ok, ...health });
  } catch (e) {
    checks.push({ name: 'staging_health', pass: false, error: e.message, url });
  }

  const failed = checks.filter((c) => c.pass === false);
  console.log(JSON.stringify({ checks, required_env: REQUIRED_ENV, forbidden_env: FORBIDDEN_ENV, success: failed.length === 0 }, null, 2));
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
