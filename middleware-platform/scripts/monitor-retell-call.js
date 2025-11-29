#!/usr/bin/env node
/**
 * Monitor Retell Call Status
 * 
 * Usage:
 *   node scripts/monitor-retell-call.js call_3d1b4b797abcaaa6ec9c82157d0
 */

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false
});

const RetellService = require('../services/retell-service');

const CALL_ID = process.argv[2];

if (!CALL_ID) {
  console.error('Usage: node scripts/monitor-retell-call.js <call_id>');
  process.exit(1);
}

async function monitor() {
  console.log('\n📞 MONITORING RETELL CALL');
  console.log('='.repeat(70));
  console.log(`Call ID: ${CALL_ID}\n`);

  const retellService = new RetellService();

  for (let i = 0; i < 30; i++) {
    try {
      const calls = await retellService.listCalls({ limit: 100 });
      const call = calls.find(c => c.call_id === CALL_ID);

      if (call) {
        console.log(`[${(i + 1) * 2}s] Status: ${call.status || 'unknown'}`);
        
        if (call.status === 'ended' || call.status === 'ended_by_user') {
          console.log(`\n✅ Call ended`);
          console.log(`   Duration: ${call.duration || 'N/A'}`);
          break;
        }
        
        if (call.status === 'on_hold' || call.status === 'speaking') {
          console.log(`\n✅ Call is active!`);
          break;
        }
      } else {
        console.log(`[${(i + 1) * 2}s] Call not found in recent calls...`);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('💡 Check Retell dashboard for full call details');
  console.log('='.repeat(70) + '\n');
}

monitor().catch(error => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});

