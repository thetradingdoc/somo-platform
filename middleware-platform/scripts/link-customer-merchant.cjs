#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { provisionSaasTenant } = require('../services/shared/saas-tenant-provision');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      out[a.slice(2, eq).replace(/-/g, '_')] = a.slice(eq + 1);
    }
  }
  return out;
}

async function main() {
  const { customer_id: customerId, phone } = parseArgs();
  if (!customerId) {
    console.error('Required: --customer-id=');
    process.exit(1);
  }
  const customer = db.getCustomer(customerId);
  if (!customer) {
    console.error('Customer not found');
    process.exit(1);
  }
  const result = provisionSaasTenant(db, {
    customerId,
    phone: phone || customer.phone_number,
    clinicName: customer.company_name || customer.name
  });
  console.log(`Linked ${customer.email}: merchant=${result.merchantId} clinic=${result.clinicId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
