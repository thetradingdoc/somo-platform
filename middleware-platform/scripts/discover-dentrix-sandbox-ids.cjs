#!/usr/bin/env node
'use strict';

/**
 * Discover Dentrix Ascend sandbox organization + location IDs.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { DentrixClient } = require('../services/pms/dentrix-client');

async function main() {
  const clientId = process.env.DENTRIX_CLIENT_ID;
  const clientSecret = process.env.DENTRIX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('❌ DENTRIX_CLIENT_ID and DENTRIX_CLIENT_SECRET required in .env');
    process.exit(1);
  }

  const client = new DentrixClient({}, null);
  console.log('\n=== Dentrix sandbox discovery ===\n');

  const linked = await client.get('/LinkedOrgs', null, { orgmapper: true });
  const orgs = linked?.organizations || [];
  if (!orgs.length) {
    console.error('❌ No linked organizations for this client_id');
    process.exit(1);
  }
  console.log('Linked organizations:');
  for (const org of orgs) console.log(`  - ${org}`);

  const orgId = process.env.DENTRIX_ORGANIZATION_ID || orgs[0];
  client.config.organization_id = orgId;

  let locationId = process.env.DENTRIX_LOCATION_ID || null;
  try {
    const locRaw = await client.get('/v1/locations', { pageSize: 10, responseFields: 'name' });
    const locations = client.unwrap(locRaw) || [];
    const list = Array.isArray(locations) ? locations : [locations].filter(Boolean);
    if (list.length) {
      console.log('\nLocations:');
      for (const loc of list) {
        console.log(`  - ${loc.id}${loc.name ? ` (${loc.name})` : ''}`);
      }
      locationId = locationId || list[0].id;
    }
  } catch (e) {
    console.warn('⚠️  Could not list locations:', e.message);
  }

  console.log('\n── Add to .env ──\n');
  console.log(`DENTRIX_ORGANIZATION_ID=${orgId}`);
  if (locationId) console.log(`DENTRIX_LOCATION_ID=${locationId}`);
  console.log('\nThen: npm run setup:phase3-dentrix-pilot && npm run verify:phase3-dentrix\n');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
