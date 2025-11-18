/**
 * Quick Stripe Issuing Test
 * Tests if Stripe Issuing service works with current configuration
 */

require('dotenv').config();
const StripeIssuingService = require('../services/stripe-issuing-service');
const db = require('../database');

async function testStripeIssuing() {
  console.log('\n🧪 STRIPE ISSUING QUICK TEST');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check configuration
  console.log('📋 Configuration Check:');
  const hasSecretKey = !!process.env.STRIPE_SECRET_KEY;
  const hasPublishableKey = !!process.env.STRIPE_PUBLISHABLE_KEY;
  
  console.log(`   STRIPE_SECRET_KEY: ${hasSecretKey ? '✅ Set' : '❌ Missing'}`);
  console.log(`   STRIPE_PUBLISHABLE_KEY: ${hasPublishableKey ? '✅ Set' : '❌ Missing'}`);
  
  if (!hasSecretKey) {
    console.log('\n⚠️  STRIPE_SECRET_KEY not set. Service will run in mock mode.');
    console.log('   Add to .env: STRIPE_SECRET_KEY=sk_test_...\n');
  }

  // Test 1: Initialize service
  console.log('\n📦 Test 1: Service Initialization');
  console.log('───────────────────────────────────────────────────────────');
  try {
    const service = new StripeIssuingService();
    console.log(`   Service initialized: ✅`);
    console.log(`   Enabled: ${service.isEnabled ? '✅ Yes' : '❌ No (mock mode)'}`);
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    return;
  }

  // Test 2: Create test patient data
  console.log('\n👤 Test 2: Create Test Patient Data');
  console.log('───────────────────────────────────────────────────────────');
  const testPatientData = {
    id: `test-patient-${Date.now()}`,
    resource_id: `test-patient-${Date.now()}`,
    name: 'Test Patient',
    firstName: 'Test',
    lastName: 'Patient',
    email: 'test@example.com',
    phone: '+15555551234',
    address: [{
      line: ['123 Test St'],
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US'
    }]
  };
  console.log(`   Patient Name: ${testPatientData.name}`);
  console.log(`   Email: ${testPatientData.email}`);
  console.log(`   Phone: ${testPatientData.phone}`);

  // Test 3: Create cardholder
  console.log('\n💳 Test 3: Create Cardholder');
  console.log('───────────────────────────────────────────────────────────');
  const service = new StripeIssuingService();
  
  try {
    const cardholderResult = await service.createCardholder(testPatientData, {
      clinic_id: 'test-clinic-001'
    });

    if (cardholderResult.success) {
      console.log(`   ✅ Cardholder created: ${cardholderResult.cardholder_id}`);
      console.log(`   Name: ${cardholderResult.cardholder.name}`);
      console.log(`   Status: ${cardholderResult.cardholder.status}`);
    } else if (cardholderResult.mock) {
      console.log(`   ⚠️  Mock mode: ${cardholderResult.error}`);
      console.log(`   (This is expected if STRIPE_SECRET_KEY is not set)`);
    } else {
      console.log(`   ❌ Failed: ${cardholderResult.error}`);
      if (cardholderResult.error_details) {
        console.log(`   Details: ${cardholderResult.error_details}`);
      }
      return;
    }

    // Test 4: Issue virtual card
    if (cardholderResult.success) {
      console.log('\n💳 Test 4: Issue Virtual Card');
      console.log('───────────────────────────────────────────────────────────');
      
      try {
        const cardResult = await service.issueVirtualCard(cardholderResult.cardholder_id, {
          patient_id: testPatientData.id,
          spending_limit: 100000, // $1,000
          spending_interval: 'all_time',
          currency: 'usd'
        });

        if (cardResult.success) {
          console.log(`   ✅ Card issued: ${cardResult.card_id}`);
          console.log(`   Last 4: ${cardResult.last4}`);
          console.log(`   Brand: ${cardResult.brand}`);
          console.log(`   Expiry: ${cardResult.expiry_month}/${cardResult.expiry_year}`);
          console.log(`   Type: virtual`);
          console.log(`   Status: active`);
        } else if (cardResult.mock) {
          console.log(`   ⚠️  Mock mode: ${cardResult.error}`);
        } else {
          console.log(`   ❌ Failed: ${cardResult.error}`);
          if (cardResult.error_details) {
            console.log(`   Details: ${cardResult.error_details}`);
          }
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }

    // Test 5: Combined operation (create cardholder + card)
    console.log('\n🔄 Test 5: Combined Operation (Cardholder + Card)');
    console.log('───────────────────────────────────────────────────────────');
    
    const testPatientData2 = {
      ...testPatientData,
      id: `test-patient-2-${Date.now()}`,
      resource_id: `test-patient-2-${Date.now()}`,
      name: 'Test Patient 2'
    };

    try {
      const combinedResult = await service.createCardholderAndCard(testPatientData2, {
        clinic_id: 'test-clinic-001',
        spending_limit: 50000, // $500
        spending_interval: 'monthly'
      });

      if (combinedResult.success) {
        console.log(`   ✅ Cardholder created: ${combinedResult.cardholder_id}`);
        console.log(`   ✅ Card issued: ${combinedResult.card_id}`);
        console.log(`   Last 4: ${combinedResult.last4}`);
        console.log(`   Brand: ${combinedResult.brand}`);
      } else if (combinedResult.mock) {
        console.log(`   ⚠️  Mock mode: ${combinedResult.error}`);
      } else {
        console.log(`   ❌ Failed: ${combinedResult.error}`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  
  if (hasSecretKey) {
    console.log('✅ Stripe Issuing is configured');
    console.log('✅ Service should work in live mode');
    console.log('\n💡 Next steps:');
    console.log('   1. Enable Stripe Issuing in dashboard');
    console.log('   2. Fund your Issuing balance');
    console.log('   3. Test with real patient creation');
  } else {
    console.log('⚠️  Stripe Issuing is in mock mode');
    console.log('💡 To enable live mode:');
    console.log('   1. Add STRIPE_SECRET_KEY to .env');
    console.log('   2. Enable Stripe Issuing in dashboard');
    console.log('   3. Fund your Issuing balance');
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Run test
testStripeIssuing()
  .then(() => {
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });




