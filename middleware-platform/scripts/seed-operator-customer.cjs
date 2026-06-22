#!/usr/bin/env node

/**

 * Seed or upgrade the Somo operator customer row for unified voice billing.

 *

 * Usage (from middleware-platform/):

 *   node scripts/seed-operator-customer.cjs

 *

 * Env: CALLSOMO_OPERATOR_CUSTOMER_ID (optional — uses existing or creates with this ID)

 *      SOMO_OWNER_EMAIL (required when creating a new row)

 *      DB_PATH (required when seeding a non-default database, e.g. capstone preseed)

 */

'use strict';



const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.chdir(path.join(__dirname, '..'));



const db = require('../database');

const { OPERATOR_CAPABILITIES } = require('../services/customer-capabilities');



function ensureOperatorRow(explicitId, ownerEmail) {

  let customer = explicitId ? db.getCustomer(explicitId) : null;



  if (!customer && ownerEmail) {

    const byEmail = db.getCustomerByEmail(ownerEmail);

    if (byEmail) {

      if (explicitId && byEmail.id !== explicitId) {

        console.error(

          `Owner email ${ownerEmail} exists as ${byEmail.id} but CALLSOMO_OPERATOR_CUSTOMER_ID=${explicitId}.`

        );

        console.error('Consolidate to one ID (Twilio URL is source of truth) before seeding.');

        process.exit(1);

      }

      customer = byEmail;

    }

  }



  if (!customer && explicitId && ownerEmail) {

    db.createCustomer({

      id: explicitId,

      name: (process.env.SOMO_OWNER_NAME || 'Somo Operator').trim(),

      email: ownerEmail,

      phone_number:

        (process.env.SOMO_OWNER_CLINIC_PHONE || process.env.STAGING_OWNER_TWILIO_PHONE || '+13639990205').replace(

          /\s+/g,

          ''

        ),

      plan_tier: 'practice',

      status: 'active',

      email_verified: true,

      email_verified_at: new Date().toISOString()

    });

    customer = db.getCustomer(explicitId);

    console.log(`Created operator customer row: ${explicitId} (${ownerEmail})`);

  }



  return customer;

}



function main() {

  const explicitId = process.env.CALLSOMO_OPERATOR_CUSTOMER_ID || process.env.CALLSOMO_VOICE_CUSTOMER_ID;

  const ownerEmail = (process.env.SOMO_OWNER_EMAIL || '').trim();



  const customer = ensureOperatorRow(explicitId, ownerEmail);



  if (!customer) {

    console.error('No operator customer found.');

    console.error('Set CALLSOMO_OPERATOR_CUSTOMER_ID + SOMO_OWNER_EMAIL to create the row,');

    console.error('or run: npm run ensure:somo-owner');

    process.exit(1);

  }



  const patch = {

    customer_type: 'operator',

    capabilities: JSON.stringify(OPERATOR_CAPABILITIES),

    billing_enforcement_paused: 1,

    kelly_status: customer.kelly_status || 'active',

    retell_agent_status: customer.retell_agent_status || 'active'

  };

  db.updateCustomer(customer.id, patch);

  const { ensureOperatorTenantBootstrap } = require('../services/operator-tenant-bootstrap');
  ensureOperatorTenantBootstrap(db, customer.id);
  const refreshed = db.getCustomer(customer.id);
  if (!refreshed?.merchant_id) {
    console.error(`❌ Operator bootstrap did not set merchant_id for ${customer.id}`);
    process.exit(1);
  }

  const credits = db.getCustomerCredits(refreshed.id);
  if (!credits) {
    db.allocateFreeCredits(refreshed.id, 10000);
    console.log('Allocated 10000 operator minutes (enforcement paused — metering only).');
  }

  console.log('✅ Operator customer ready:');
  console.log(`   customer_id: ${refreshed.id}`);
  console.log(`   email:       ${refreshed.email}`);
  console.log(`   merchant_id: ${refreshed.merchant_id}`);
  console.log(`   Set CALLSOMO_OPERATOR_CUSTOMER_ID=${refreshed.id} on Cloud Run`);

}



main();


