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

const { getOperatorCustomerId } = require('../services/voice/voice-account-resolution');

const {

  buildDefaultInboundGreeting,

  buildDefaultOutboundOpener,

  isLegacyGenericGreeting,

  resolvePracticeDisplayName

} = require('../services/voice/call-opener-resolver');

const { ensureOperatorTenantBootstrap } = require('../services/shared/operator-tenant-bootstrap');



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



  if (!currentGreeting || isLegacyGenericGreeting(currentGreeting) || /somo owner/i.test(currentGreeting)) {

    patch.greeting = inboundDefault;

  }

  if (

    !currentOutbound ||

    !String(currentOutbound).trim() ||

    /our office/i.test(currentOutbound)

  ) {

    patch.outbound_opener = outboundDefault;

  }

  patch.outbound_enabled = 1;



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

  console.log('✅ Updated operator tenant (company_name + voice_agent_settings).');

}



main();

