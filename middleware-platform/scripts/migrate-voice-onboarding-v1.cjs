#!/usr/bin/env node
'use strict';

/**
 * Migrate existing tenants to voice onboarding v1 model.
 * Usage: node scripts/migrate-voice-onboarding-v1.cjs [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../database');
const {
  deriveStateFromLegacy,
  transitionState
} = require('../services/voice/voice-onboarding-state');
const {
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  isLegacyGenericGreeting,
  resolvePracticeDisplayName
} = require('../services/voice/call-opener-resolver');
const { normalizeSettingsRow } = require('../services/voice/voice-settings-sync');

const dryRun = process.argv.includes('--dry-run');

function main() {
  const customers = db.db.prepare(`SELECT * FROM customers WHERE customer_type = 'saas' OR customer_type IS NULL`).all();
  const report = {
    dry_run: dryRun,
    total: customers.length,
    updated_state: 0,
    updated_greeting: 0,
    needs_review: []
  };

  for (const customer of customers) {
    const state = customer.onboarding_state || deriveStateFromLegacy(customer);
    const settings = normalizeSettingsRow(
      db.getVoiceAgentSettingsForProvider({
        merchantId: customer.merchant_id,
        customerId: customer.id
      })
    );
    const practiceName = resolvePracticeDisplayName(db, { customer });
    const patch = {};

    if (!customer.onboarding_state) {
      report.updated_state++;
      if (!dryRun) {
        transitionState(db, customer.id, state);
      }
    }

    const greetingPatch = {};
    if (!settings?.greeting || isLegacyGenericGreeting(settings.greeting)) {
      greetingPatch.greeting = buildDefaultInboundGreeting(practiceName, settings?.tone_preset || 'warm');
      report.updated_greeting++;
      if (/owner/i.test(practiceName) || practiceName === 'our office') {
        report.needs_review.push({ customer_id: customer.id, reason: 'practice_name', practiceName });
      }
    }
    if (!settings?.outbound_opener) {
      greetingPatch.outbound_opener = buildDefaultOutboundOpener(practiceName, settings?.tone_preset || 'warm');
    }
    if (settings && settings.outbound_enabled == null) {
      greetingPatch.outbound_enabled = 0;
    }

    if (Object.keys(greetingPatch).length) {
      if (!dryRun) {
        db.upsertVoiceAgentSettings(customer.merchant_id || null, greetingPatch, customer.id);
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
