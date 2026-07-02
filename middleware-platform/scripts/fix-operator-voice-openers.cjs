#!/usr/bin/env node

/**

 * Fix operator tenant voice openers (legacy inbound greeting + outbound opener).

 * Run against the same DB as production middleware / CALLSOMO_OPERATOR_CUSTOMER_ID.

 *

 *   node scripts/fix-operator-voice-openers.cjs

 *   node scripts/fix-operator-voice-openers.cjs --dry-run

 */

'use strict';



require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../database');

const { getOperatorCustomerId } = require('../services/voice-account-resolution');

const {

  buildDefaultInboundGreeting,

  buildDefaultOutboundOpener,

  isLegacyGenericGreeting,

  isManagedDefaultGreeting,

  resolvePracticeDisplayName

} = require('../services/call-opener-resolver');

const { ensureOperatorTenantBootstrap } = require('../services/operator-tenant-bootstrap');



const dryRun = process.argv.includes('--dry-run');



function main() {

  const operatorId = getOperatorCustomerId();

  if (!operatorId) {

    console.error('Set CALLSOMO_OPERATOR_CUSTOMER_ID');

    process.exit(1);

  }

  const customer = db.getCustomer(operatorId);

  if (!customer) {

    console.error(`Operator customer not found in DB: ${operatorId}`);

    process.exit(1);

  }



  const practiceName = resolvePracticeDisplayName(db, { customer });

  const settings = db.getVoiceAgentSettingsForProvider({

    merchantId: customer.merchant_id,

    customerId: customer.id

  });



  const inboundDefault = buildDefaultInboundGreeting(practiceName, 'warm');

  const outboundDefault = buildDefaultOutboundOpener(practiceName, 'warm');

  const currentGreeting = settings?.greeting || '';

  const currentOutbound = settings?.outbound_opener || '';

  const patch = {};



  if (
    !currentGreeting ||
    isLegacyGenericGreeting(currentGreeting) ||
    /somo owner/i.test(currentGreeting) ||
    /our office/i.test(currentGreeting) ||
    isManagedDefaultGreeting(currentGreeting)
  ) {
    // Idempotent: only patch when the result actually differs from what is stored.
    if (String(currentGreeting || '').trim() !== inboundDefault) {
      patch.greeting = inboundDefault;
    }
  }

  if (
    !currentOutbound ||
    !String(currentOutbound).trim() ||
    !/somo/i.test(currentOutbound) ||
    /our office/i.test(currentOutbound)
  ) {
    if (String(currentOutbound || '').trim() !== outboundDefault) {
      patch.outbound_opener = outboundDefault;
    }
  }

  if (Number(settings?.outbound_enabled) !== 1) {
    patch.outbound_enabled = 1;
  }



  const customerPatch = {};

  if (!customer.company_name || /somo owner/i.test(customer.company_name)) {

    customerPatch.company_name = 'Somo';

  }



  console.log(`Operator: ${operatorId} (${customer.email || 'no email'})`);

  console.log(`Practice name: ${practiceName}`);

  console.log(`Current greeting: ${currentGreeting.slice(0, 80) || '(empty)'}`);

  console.log(`Current outbound: ${currentOutbound.slice(0, 80) || '(empty)'}`);

  console.log(`Customer patch:`, customerPatch);

  console.log(`Settings patch:`, patch);



  if (dryRun) {

    console.log('Dry run — no writes.');

    return;

  }



  if (Object.keys(customerPatch).length) {

    db.updateCustomer(operatorId, customerPatch);

  }

  ensureOperatorTenantBootstrap(db, operatorId);

  if (Object.keys(patch).length) {

    const refreshed = db.getCustomer(operatorId);

    const merchantKey =

      refreshed.merchant_id || db.customerVoiceSettingsMerchantKey(operatorId);

    const latest = db.getVoiceAgentSettingsForProvider({

      merchantId: merchantKey,

      customerId: operatorId

    });

    db.upsertVoiceAgentSettings(merchantKey, { ...(latest || {}), ...patch }, operatorId);

  }

  const changedSettings = Object.keys(patch);
  const changedCustomer = Object.keys(customerPatch);
  if (!changedSettings.length && !changedCustomer.length) {
    console.log('✅ Operator tenant already up to date — no changes applied.');
  } else {
    console.log(
      `✅ Updated operator tenant. customer: [${changedCustomer.join(', ') || 'none'}], ` +
        `settings: [${changedSettings.join(', ') || 'none'}].`
    );
  }

}



main();

