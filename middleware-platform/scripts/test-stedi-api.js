#!/usr/bin/env node
/**
 * Test Stedi API - Eligibility and Payers
 * Run: node scripts/test-stedi-api.js
 * Verifies connectivity and displays sample eligibility (copay, deductible) and payer data
 */

require('dotenv').config();
const InsuranceService = require('../services/insurance-service');

async function main() {
  console.log('\n🧪 STEDI API TEST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Test Eligibility (270/271)
  console.log('1️⃣  Testing Eligibility Check (X12 270/271)...\n');
  const eligibilityData = {
    patientName: 'Jeremiah Richie',
    dateOfBirth: '1985-06-15',
    memberId: 'TEST999888',
    payerId: 'UHC',
    serviceCode: '90834',
    dateOfService: new Date().toISOString().split('T')[0],
    patientId: null
  };

  try {
    const eligResult = await InsuranceService.checkEligibility(eligibilityData);
    console.log('   Result:', eligResult.success ? '✅ Success' : '❌ Failed');
    if (eligResult.success) {
      console.log('   Eligible:', eligResult.eligible);
      console.log('   Copay: $' + (eligResult.copay ?? 0));
      console.log('   Allowed Amount: $' + (eligResult.allowedAmount ?? 0));
      console.log('   Insurance Pays: $' + (eligResult.insurancePays ?? 0));
      console.log('   Deductible Total: $' + (eligResult.deductibleTotal ?? 'N/A'));
      console.log('   Deductible Remaining: $' + (eligResult.deductibleRemaining ?? 'N/A'));
      console.log('   Coinsurance: ' + (eligResult.coinsurancePercent ?? 'N/A') + '%');
      if (eligResult.planSummary) console.log('   Plan Summary:', eligResult.planSummary.substring(0, 80) + '...');
      if (eligResult.stediFallback) console.log('   ⚠️  Used simulation (Stedi unavailable)');
    } else {
      console.log('   Error:', eligResult.error);
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
  }

  // 2. Test Payers endpoint
  console.log('\n2️⃣  Testing Payers List...\n');
  try {
    const payersResult = await InsuranceService.fetchPayers({ limit: 10 });
    console.log('   Result:', payersResult.success ? '✅ Success' : '❌ Failed');
    if (payersResult.success && payersResult.payers && payersResult.payers.length > 0) {
      console.log('   Payers found:', payersResult.count);
      payersResult.payers.slice(0, 5).forEach((p, i) => {
        const name = p.name || p.payer_name || p.id || JSON.stringify(p).substring(0, 40);
        console.log(`   ${i + 1}. ${name}`);
      });
    } else {
      console.log('   No payers returned (or Stedi uses different format). Simulation/fallback may be used for eligibility.');
    }
  } catch (err) {
    console.log('   ❌ Error:', err.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Stedi test complete. Eligibility data (copay, deductible) will be used for demo patients.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
