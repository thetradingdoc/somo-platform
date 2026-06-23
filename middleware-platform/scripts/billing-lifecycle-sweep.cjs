#!/usr/bin/env node
/**
 * Daily voice billing lifecycle: past_due grace expiry → suspend ingress,
 * release Twilio numbers after retention window (D9).
 *
 * Usage: node scripts/billing-lifecycle-sweep.cjs [--dry-run]
 */

'use strict';

const db = require('../database');
const { isPastDueGraceExpired, getNumberRetentionDays } = require('../services/rcm/billing-access');
const TwilioPhoneService = require('../services/voice/twilio-phone-service');

const dryRun = process.argv.includes('--dry-run');

async function pauseRetellAgent(customer) {
  if (!customer.retell_agent_id) return;
  try {
    const RetellService = require('../services/voice/retell-service');
    await new RetellService().applyAgentSettings({
      agentId: customer.retell_agent_id,
      enabled: false
    });
    console.log(`[Lifecycle] Paused Retell agent ${customer.retell_agent_id}`);
  } catch (e) {
    console.warn(`[Lifecycle] Retell pause failed for ${customer.id}:`, e.message);
  }
}

async function releaseNumber(customer) {
  if (!customer.twilio_phone_sid) return;
  const twilio = new TwilioPhoneService();
  if (!twilio.isAvailable()) {
    console.warn('[Lifecycle] Twilio not configured — skip release');
    return;
  }
  if (dryRun) {
    console.log(`[Lifecycle] DRY RUN would release ${customer.twilio_phone_number}`);
    return;
  }
  await twilio.releasePhoneNumber(customer.twilio_phone_sid);
  db.updateCustomer(customer.id, {
    twilio_phone_number: null,
    twilio_phone_sid: null
  });
  console.log(`[Lifecycle] Released number for ${customer.id}`);
}

async function main() {
  if (typeof db.runMigrations === 'function') {
    db.runMigrations();
  }

  const customers = db.db.prepare(`
    SELECT * FROM customers
    WHERE customer_type = 'saas' OR customer_type IS NULL
  `).all();

  let graceSuspended = 0;
  let numbersReleased = 0;

  for (const customer of customers) {
    if (customer.subscription_status === 'past_due' && isPastDueGraceExpired(customer)) {
      console.log(`[Lifecycle] Grace expired → suspended: ${customer.id}`);
      if (!dryRun) {
        db.updateCustomerSubscriptionFields(customer.id, { subscription_status: 'suspended' });
        await pauseRetellAgent(customer);
      }
      graceSuspended++;
    }

    if (
      customer.number_retention_until &&
      customer.twilio_phone_sid &&
      new Date(customer.number_retention_until).getTime() <= Date.now()
    ) {
      await releaseNumber(customer);
      numbersReleased++;
    }
  }

  console.log(JSON.stringify({
    dry_run: dryRun,
    grace_suspended: graceSuspended,
    numbers_released: numbersReleased,
    retention_days: getNumberRetentionDays()
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
