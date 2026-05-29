#!/usr/bin/env node
'use strict';

/**
 * Release trial numbers when expired (7d) or inactive (21d).
 * Usage: node scripts/trial-expiry-sweep.cjs [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../database');
const { expireTrial, getTrialInactivityReleaseDays } = require('../services/trial-lifecycle');
const { maybeSendTrialLifecycleNudges } = require('../services/trial-alerts');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[trial-expiry-sweep] dryRun=${dryRun}`);

  const expired = db.listCustomersForTrialExpirySweep();
  console.log(`[trial-expiry-sweep] time-expired candidates: ${expired.length}`);

  for (const customer of expired) {
    const result = await expireTrial(db, customer.id, 'time_expired', { releaseNumber: true, dryRun });
    console.log(`  expire ${customer.id} (${customer.email}):`, JSON.stringify(result));
    if (!dryRun) {
      maybeSendTrialLifecycleNudges(customer.id, 'trial_expired').catch(() => {});
    }
  }

  const inactivityDays = getTrialInactivityReleaseDays();
  const inactive = db.listCustomersForTrialInactivitySweep(inactivityDays);
  console.log(`[trial-expiry-sweep] inactivity (${inactivityDays}d) candidates: ${inactive.length}`);

  for (const customer of inactive) {
    if (customer.trial_expires_at && new Date(customer.trial_expires_at) > new Date()) {
      continue;
    }
    const result = await expireTrial(db, customer.id, 'inactive_21d', { releaseNumber: true, dryRun });
    console.log(`  inactive ${customer.id}:`, JSON.stringify(result));
    if (!dryRun) {
      maybeSendTrialLifecycleNudges(customer.id, 'trial_expired').catch(() => {});
    }
  }

  if (!dryRun) {
    const { runScheduledTrialNudges } = require('../services/trial-alerts');
    await runScheduledTrialNudges();
  }

  console.log('[trial-expiry-sweep] done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
