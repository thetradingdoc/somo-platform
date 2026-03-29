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
      const call = await retellService.getCall(CALL_ID);

      if (call) {
        const status = call.call_status || call.status || 'unknown';
        console.log(`[${(i + 1) * 2}s] Status: ${status}`);
        if (call.disconnection_reason) {
          console.log(`    Reason: ${call.disconnection_reason}`);
        }
        
        if (status === 'ended' || status === 'ended_by_user' || status === 'not_connected' || status === 'failed') {
          console.log(`\n✅ Call ended`);
          console.log(`   Duration: ${call.duration_ms ? `${Math.round(call.duration_ms / 1000)}s` : (call.duration || 'N/A')}`);
          break;
        }
        
        if (status === 'on_hold' || status === 'speaking' || status === 'in_progress' || status === 'connected') {
          console.log(`\n✅ Call is active!`);
          break;
        }
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

