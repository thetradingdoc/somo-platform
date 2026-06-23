#!/usr/bin/env node
/**
 * Scheduled Escrow Recovery Job
 * 
 * Runs periodically (every 15 minutes recommended) to find and recover stuck escrows.
 * 
 * Usage:
 *   node scripts/scheduled-recover-escrow.js [olderThanHours]
 * 
 * Or add to cron:
 *   Cron example (every 15 min):
 *   15,30,45,0 * * * * cd /path/to/middleware-platform && node scripts/scheduled-recover-escrow.js
 */

const EscrowRecoveryService = require('../services/platform/escrow-recovery-service');

const olderThanHours = parseFloat(process.argv[2] || '1');

async function runRecovery() {
  console.log(`🔍 Starting scheduled escrow recovery (older than ${olderThanHours} hour(s))...`);
  
  try {
    const result = await EscrowRecoveryService.recoverAllStuckEscrows(olderThanHours);
    
    console.log(`✅ Recovery complete:`);
    console.log(`   Found: ${result.found} stuck escrows`);
    console.log(`   Recovered: ${result.recovered}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
      result.errors.forEach(err => {
        console.log(`     - ${err.claimId || 'unknown'}: ${err.error}`);
      });
    }
    
    process.exit(result.found > 0 && result.recovered < result.found ? 1 : 0);
  } catch (error) {
    console.error('❌ Recovery job failed:', error);
    process.exit(1);
  }
}

runRecovery();
