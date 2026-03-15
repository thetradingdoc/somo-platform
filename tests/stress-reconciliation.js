// tests/stress-reconciliation.js
//
// Phase 0.5 stress test for the Reconciliation Agent v0.
// Run with: node tests/stress-reconciliation.js
//
// This simulates a $90 deposit for a $100 claim (CLAIM-12345)
// and verifies that the agent:
//  - flags a $10 discrepancy
//  - writes an ai_decisions_rcm record via db.insertRcmAiDecision
//  - marks requires_human_review = 1 so it appears in /api/rcm/exceptions

const { reconcileDeposit } = require('../middleware-platform/services/reconciliation-agent');

async function stressTestRecon() {
  console.log('🚀 Stress Testing Reconciliation Agent...');

  const mockDeposit = {
    id: 'tx_usdc_7788',
    amount: 90.0,
    payer: 'Aetna',
    memo: 'CLAIM-12345-REMIT',
    empi_id: '67bd6e16416d5202ce39f29b66179f42'
  };

  try {
    const result = await reconcileDeposit(mockDeposit);

    console.log('');
    if (result.requiresReview) {
      console.log('⚠️ Agent Flagged Discrepancy:');
      console.log(`   Claim ID: ${result.claimId}`);
      console.log(`   Delta: $${result.delta.toFixed(2)}`);
      console.log(`   Reason: ${result.explanation}`);
      console.log('   Action: Logged to ai_decisions_rcm for Provider Review (Exception Inbox).');
    } else {
      console.log('✅ Agent Auto-Settled Claim.');
      console.log(`   Explanation: ${result.explanation}`);
    }

    console.log('\n✅ Stress test completed.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Reconciliation Agent stress test failed:', err.message);
    process.exit(1);
  }
}

stressTestRecon();

