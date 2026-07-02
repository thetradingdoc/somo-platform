#!/usr/bin/env node
'use strict';

/**
 * Exchange Athena preview OAuth creds from .env and print token metadata.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { AthenaClient } = require('../services/pms/athena-client');
const { resolveAthenaConfig, hasAthenaCredentials } = require('../services/pms/athena-config');

async function main() {
  const config = resolveAthenaConfig({}, null);
  if (!config.client_id || !config.client_secret) {
    console.error('❌ Set ATHENA_CLIENT_ID and ATHENA_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const client = new AthenaClient({}, null);

  try {
    const token = await client.getAccessToken();
    console.log('✅ Athena OAuth token acquired');
    console.log(`   client_id: ${config.client_id}`);
    console.log(`   token prefix: ${token.slice(0, 12)}...`);
    console.log(`   api_base: ${config.api_base}`);

    if (config.practice_id) {
      const info = await client.get('/practiceinfo', { practiceid: config.practice_id });
      console.log(`✅ practice_id ${config.practice_id}:`, info?.name || JSON.stringify(info).slice(0, 120));
    } else {
      console.log('\n⚠️  ATHENA_PRACTICE_ID not set — run: node scripts/discover-athena-sandbox-ids.cjs');
    }
  } catch (e) {
    console.error('❌ Athena token failed:', e.message);
    if (e.details) console.error('   details:', e.details);
    process.exit(1);
  }
}

main();
