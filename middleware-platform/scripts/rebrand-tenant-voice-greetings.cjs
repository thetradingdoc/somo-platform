#!/usr/bin/env node

/**
 * Rebrand voice openers for ALL tenants (not just the operator).
 *
 * Fixes legacy / generic / cross-brand greetings so each tenant's Kelly greets
 * with its OWN practice name (the operator keeps "Somo" branding). Uses the same
 * default builders as runtime (call-opener-resolver) so DB values match live behavior.
 *
 * Usage (from middleware-platform/):
 *   node scripts/rebrand-tenant-voice-greetings.cjs            # dry-run (default)
 *   node scripts/rebrand-tenant-voice-greetings.cjs --apply-db # write changes
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../database');
const {
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  isLegacyGenericGreeting,
  isManagedDefaultGreeting,
  resolvePracticeDisplayName
} = require('../services/call-opener-resolver');

const apply = process.argv.includes('--apply-db');

function isOperatorCustomer(customer) {
  return String(customer?.customer_type || '').toLowerCase() === 'operator';
}

// Cross-brand leak: a non-operator tenant whose greeting names Somo as the receptionist.
function hasCrossBrandLeak(text, isOperator) {
  if (isOperator) return false;
  return /Somo's front desk receptionist/i.test(String(text || ''));
}

function inboundNeedsRebrand(current, isOperator) {
  const text = String(current || '');
  if (!text.trim()) return true;
  if (isLegacyGenericGreeting(text)) return true;
  if (/our office/i.test(text)) return true;
  if (/somo owner/i.test(text)) return true;
  if (hasCrossBrandLeak(text, isOperator)) return true;
  // Refresh old auto-generated intent-first defaults to the name-first default.
  if (isManagedDefaultGreeting(text)) return true;
  return false;
}

function outboundNeedsRebrand(current, isOperator, practiceName) {
  const text = String(current || '');
  if (!text.trim()) return true;
  if (/our office/i.test(text)) return true;
  if (/somo owner/i.test(text)) return true;
  // Non-operator outbound openers should not claim to be calling "from Somo"
  // unless that IS the tenant's own (Somo-prefixed) practice name.
  if (
    !isOperator &&
    /\bfrom Somo\b/i.test(text) &&
    !text.includes(String(practiceName || '__none__'))
  ) {
    return true;
  }
  return false;
}

function main() {
  const rows = db.db
    .prepare(
      'SELECT id, merchant_id, clinic_id, customer_id, greeting, outbound_opener, tone_preset FROM voice_agent_settings'
    )
    .all();

  console.log(`Found ${rows.length} voice_agent_settings row(s). Mode: ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  let changed = 0;
  for (const row of rows) {
    const customer = row.customer_id ? db.getCustomer(row.customer_id) : null;
    const isOperator = isOperatorCustomer(customer);
    const practiceName = resolvePracticeDisplayName(db, {
      customerId: row.customer_id || undefined,
      merchantId: row.merchant_id || undefined,
      clinicId: row.clinic_id || undefined,
      customer
    });
    const tone = row.tone_preset || 'warm';

    const patch = {};
    if (inboundNeedsRebrand(row.greeting, isOperator)) {
      patch.greeting = buildDefaultInboundGreeting(practiceName, tone);
    }
    if (outboundNeedsRebrand(row.outbound_opener, isOperator, practiceName)) {
      patch.outbound_opener = buildDefaultOutboundOpener(practiceName, tone);
    }

    const label = `${practiceName}${isOperator ? ' (operator)' : ''} [cust=${row.customer_id || '-'} clinic=${row.clinic_id || '-'}]`;
    if (!Object.keys(patch).length) {
      console.log(`• OK    ${label}`);
      continue;
    }

    changed += 1;
    console.log(`• FIX   ${label}`);
    if (patch.greeting) {
      console.log(`        greeting:  ${String(row.greeting || '(empty)').slice(0, 70)}`);
      console.log(`              ->   ${patch.greeting.slice(0, 70)}`);
    }
    if (patch.outbound_opener) {
      console.log(`        outbound:  ${String(row.outbound_opener || '(empty)').slice(0, 70)}`);
      console.log(`              ->   ${patch.outbound_opener.slice(0, 70)}`);
    }

    if (apply) {
      const merchantKey =
        row.merchant_id ||
        (row.customer_id ? db.customerVoiceSettingsMerchantKey(row.customer_id) : null);
      const latest = db.getVoiceAgentSettingsForProvider({
        merchantId: merchantKey,
        customerId: row.customer_id || undefined,
        clinicId: row.clinic_id || undefined
      });
      db.upsertVoiceAgentSettings(
        merchantKey,
        { ...(latest || {}), ...patch },
        row.customer_id || null,
        { clinicId: row.clinic_id || null }
      );
    }
  }

  console.log(`\n${changed} row(s) ${apply ? 'updated' : 'would be updated'}.`);
  if (!apply && changed) {
    console.log('Re-run with --apply-db to write changes.');
  }
}

main();
