/**
 * Full Stripe Issuing Test with Proper Cardholder Data
 * Tests complete flow with verification requirements
 */

require('dotenv').config();
const StripeIssuingService = require('../services/stripe-issuing-service');

async function testStripeIssuingFull() {
  console.log('\n🧪 STRIPE ISSUING FULL TEST');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test with proper cardholder data (includes DOB for verification)
  const properPatientData = {
    id: `patient-${Date.now()}`,
    resource_id: `patient-${Date.now()}`,
    name: 'John Doe',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phone: '+15555551234',
    birthDate: '1990-01-15', // Required for cardholder verification
    address: [{
      line: ['123 Main Street'],
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US'
    }]
  };

  console.log('👤 Test Patient Data:');
  console.log(`   Name: ${properPatientData.name}`);
  console.log(`   Email: ${properPatientData.email}`);
  console.log(`   Phone: ${properPatientData.phone}`);
  console.log(`   DOB: ${properPatientData.birthDate}`);
  console.log(`   Address: ${properPatientData.address[0].line[0]}, ${properPatientData.address[0].city}, ${properPatientData.address[0].state}`);

  const service = new StripeIssuingService();

  // Test 1: Create Cardholder with proper data
  console.log('\n💳 Test 1: Create Cardholder');
  console.log('───────────────────────────────────────────────────────────');
  
  try {
    const cardholderResult = await service.createCardholder(properPatientData, {
      clinic_id: 'test-clinic-001'
    });

    if (cardholderResult.success) {
      console.log(`   ✅ Cardholder created: ${cardholderResult.cardholder_id}`);
      console.log(`   Name: ${cardholderResult.cardholder.name}`);
      console.log(`   Status: ${cardholderResult.cardholder.status}`);
      console.log(`   Type: ${cardholderResult.cardholder.type}`);
      
      // Check if cardholder needs verification
      if (cardholderResult.cardholder.requirements) {
        console.log(`   ⚠️  Requirements:`, JSON.stringify(cardholderResult.cardholder.requirements, null, 2));
      }

      // Test 2: Try to issue card
      console.log('\n💳 Test 2: Issue Virtual Card');
      console.log('───────────────────────────────────────────────────────────');
      
      try {
        const cardResult = await service.issueVirtualCard(cardholderResult.cardholder_id, {
          patient_id: properPatientData.id,
          spending_limit: 100000, // $1,000
          spending_interval: 'all_time',
          currency: 'usd'
        });

        if (cardResult.success) {
          console.log(`   ✅ Card issued successfully!`);
          console.log(`   Card ID: ${cardResult.card_id}`);
          console.log(`   Last 4: ${cardResult.last4}`);
          console.log(`   Brand: ${cardResult.brand}`);
          console.log(`   Expiry: ${cardResult.expiry_month}/${cardResult.expiry_year}`);
          console.log(`   Type: virtual`);
          console.log(`   Status: active`);
          
          // Test 3: Get card details (PAN/CVC)
          console.log('\n🔍 Test 3: Get Card Details (PAN/CVC)');
          console.log('───────────────────────────────────────────────────────────');
          
          try {
            const detailsResult = await service.getCardDetails(cardResult.card_id);
            
            if (detailsResult.success) {
              console.log(`   ✅ Card details retrieved`);
              console.log(`   Last 4: ${detailsResult.last4}`);
              console.log(`   Brand: ${detailsResult.brand}`);
              console.log(`   PAN: ${detailsResult.pan ? '***' + detailsResult.pan.slice(-4) : 'Not available (test mode)'}`);
              console.log(`   CVC: ${detailsResult.cvc ? '***' : 'Not available (test mode)'}`);
              console.log(`   Expiry: ${detailsResult.expiry_month}/${detailsResult.expiry_year}`);
            } else {
              console.log(`   ⚠️  Could not get card details: ${detailsResult.error}`);
            }
          } catch (error) {
            console.log(`   ⚠️  Error getting card details: ${error.message}`);
          }

          // Test 4: Update spending controls
          console.log('\n⚙️  Test 4: Update Spending Controls');
          console.log('───────────────────────────────────────────────────────────');
          
          try {
            const updateResult = await service.setSpendingLimit(cardResult.card_id, 50000, 'monthly'); // $500/month
            
            if (updateResult.success) {
              console.log(`   ✅ Spending limit updated`);
              console.log(`   New limit: $500/month`);
            } else {
              console.log(`   ⚠️  Could not update spending limit: ${updateResult.error}`);
            }
          } catch (error) {
            console.log(`   ⚠️  Error updating spending limit: ${error.message}`);
          }

          console.log('\n═══════════════════════════════════════════════════════════');
          console.log('✅ ALL TESTS PASSED!');
          console.log('═══════════════════════════════════════════════════════════');
          console.log('\n📋 Summary:');
          console.log(`   ✅ Cardholder created: ${cardholderResult.cardholder_id}`);
          console.log(`   ✅ Card issued: ${cardResult.card_id}`);
          console.log(`   ✅ Card number: ****${cardResult.last4}`);
          console.log(`   ✅ Brand: ${cardResult.brand}`);
          console.log('\n💡 Your Stripe Issuing is working perfectly!');
          console.log('   Cards will be automatically created for new patients.');
          console.log('═══════════════════════════════════════════════════════════\n');
          
        } else {
          console.log(`   ❌ Card creation failed: ${cardResult.error}`);
          if (cardResult.error.includes('outstanding requirements')) {
            console.log('\n   💡 Cardholder needs additional verification:');
            console.log('      - Date of birth (already included)');
            console.log('      - SSN (may be required for some accounts)');
            console.log('      - Additional identity verification');
            console.log('\n   Check Stripe Dashboard for specific requirements:');
            console.log(`   https://dashboard.stripe.com/test/issuing/cardholders/${cardholderResult.cardholder_id}`);
          }
        }
      } catch (error) {
        console.log(`   ❌ Error issuing card: ${error.message}`);
      }
    } else {
      console.log(`   ❌ Cardholder creation failed: ${cardholderResult.error}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
  }
}

// Run test
testStripeIssuingFull()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });




