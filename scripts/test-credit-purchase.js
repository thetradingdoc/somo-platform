/**
 * Test Credit Purchase Flow
 * Tests that users can buy credits and they combine correctly with existing credits
 */

require('dotenv').config({ path: require('path').join(__dirname, '../middleware-platform/.env') });
const db = require('../middleware-platform/database');

async function testCreditPurchase() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           TEST CREDIT PURCHASE & TRACKING                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    // Test email
    const testEmail = 'richiej87@gmail.com';
    
    // Get or create test customer
    let customer = db.getCustomerByEmail(testEmail);
    
    if (!customer) {
        console.log(`❌ Customer ${testEmail} not found. Please sign up first.`);
        return;
    }

    console.log(`✅ Found customer: ${customer.email} (ID: ${customer.id})`);
    
    // Get current credits
    const creditsBefore = db.getCustomerCredits(customer.id);
    const beforePaid = creditsBefore ? creditsBefore.paid_credits_purchased : 0;
    const beforeBalance = creditsBefore ? creditsBefore.credits_balance_minutes : 0;
    const beforeFree = creditsBefore ? creditsBefore.free_credits_allocated : 0;
    const beforeFreeUsed = creditsBefore ? creditsBefore.free_credits_used : 0;
    
    console.log('\n📊 CREDITS BEFORE PURCHASE:');
    console.log(`   Free Credits Allocated: ${beforeFree} minutes`);
    console.log(`   Free Credits Used: ${beforeFreeUsed} minutes`);
    console.log(`   Free Credits Remaining: ${beforeFree - beforeFreeUsed} minutes`);
    console.log(`   Paid Credits Purchased: ${beforePaid} minutes`);
    console.log(`   Total Balance: ${beforeBalance} minutes`);
    
    // Test adding credits (simulating a purchase)
    const testPackage = { id: 'starter', name: 'Starter Pack', minutes: 100, price: 5.00 };
    const creditsToAdd = testPackage.minutes;
    
    console.log(`\n🛒 SIMULATING PURCHASE: ${testPackage.name} (${creditsToAdd} minutes)`);
    
    // Add paid credits (this is what happens after successful Stripe payment)
    db.addPaidCredits(customer.id, creditsToAdd);
    
    console.log(`✅ Added ${creditsToAdd} paid credits to customer account`);
    
    // Get credits after purchase
    const creditsAfter = db.getCustomerCredits(customer.id);
    const afterPaid = creditsAfter ? creditsAfter.paid_credits_purchased : 0;
    const afterBalance = creditsAfter ? creditsAfter.credits_balance_minutes : 0;
    
    console.log('\n📊 CREDITS AFTER PURCHASE:');
    console.log(`   Paid Credits Purchased: ${afterPaid} minutes`);
    console.log(`   Total Balance: ${afterBalance} minutes`);
    
    // Verify credits combined correctly
    console.log('\n🔍 VERIFICATION:');
    const expectedPaid = beforePaid + creditsToAdd;
    const expectedBalance = beforeBalance + creditsToAdd;
    
    const paidCorrect = afterPaid === expectedPaid;
    const balanceCorrect = afterBalance === expectedBalance;
    
    console.log(`   Expected Paid Credits: ${expectedPaid} minutes`);
    console.log(`   Actual Paid Credits: ${afterPaid} minutes`);
    console.log(`   ${paidCorrect ? '✅' : '❌'} Paid credits combined correctly: ${paidCorrect}`);
    
    console.log(`   Expected Total Balance: ${expectedBalance} minutes`);
    console.log(`   Actual Total Balance: ${afterBalance} minutes`);
    console.log(`   ${balanceCorrect ? '✅' : '❌'} Total balance combined correctly: ${balanceCorrect}`);
    
    // Test multiple purchases
    console.log('\n🔄 TESTING MULTIPLE PURCHASES:');
    const secondPurchase = { minutes: 500, name: 'Professional Pack' };
    const balanceBeforeSecond = creditsAfter.credits_balance_minutes;
    const paidBeforeSecond = creditsAfter.paid_credits_purchased;
    
    console.log(`   Before 2nd purchase - Paid: ${paidBeforeSecond}, Balance: ${balanceBeforeSecond}`);
    
    db.addPaidCredits(customer.id, secondPurchase.minutes);
    
    const creditsAfterSecond = db.getCustomerCredits(customer.id);
    const balanceAfterSecond = creditsAfterSecond.credits_balance_minutes;
    const paidAfterSecond = creditsAfterSecond.paid_credits_purchased;
    
    console.log(`   After 2nd purchase - Paid: ${paidAfterSecond}, Balance: ${balanceAfterSecond}`);
    
    const secondPaidCorrect = paidAfterSecond === (paidBeforeSecond + secondPurchase.minutes);
    const secondBalanceCorrect = balanceAfterSecond === (balanceBeforeSecond + secondPurchase.minutes);
    
    console.log(`   ${secondPaidCorrect ? '✅' : '❌'} Second purchase paid credits: ${secondPaidCorrect}`);
    console.log(`   ${secondBalanceCorrect ? '✅' : '❌'} Second purchase balance: ${secondBalanceCorrect}`);
    
    // Check credit purchases table
    const purchases = db.getCustomerCreditPurchases(customer.id);
    console.log(`\n📋 Credit Purchase Records: ${purchases.length} total`);
    if (purchases.length > 0) {
        purchases.slice(0, 5).forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.package_name} - ${p.credits_amount} min - $${p.amount_paid} - ${p.status}`);
        });
    }
    
    // Test the balance endpoint response
    console.log('\n🌐 TESTING /api/credits/balance ENDPOINT STRUCTURE:');
    const finalCredits = db.getCustomerCredits(customer.id);
    const freeAllocated = finalCredits ? finalCredits.free_credits_allocated : 0;
    const freeUsed = finalCredits ? finalCredits.free_credits_used : 0;
    const paidPurchased = finalCredits ? finalCredits.paid_credits_purchased : 0;
    const paidUsed = finalCredits ? finalCredits.paid_credits_used : 0;
    const balance = finalCredits ? finalCredits.credits_balance_minutes : 0;
    
    const balanceResponse = {
        success: true,
        credits: {
            balance: balance,
            free: {
                allocated: freeAllocated,
                used: freeUsed,
                remaining: freeAllocated - freeUsed
            },
            paid: {
                purchased: paidPurchased,
                used: paidUsed,
                remaining: paidPurchased - paidUsed
            }
        }
    };
    
    console.log('   Response structure:');
    console.log(`   - Total Balance: ${balanceResponse.credits.balance} minutes`);
    console.log(`   - Free: ${balanceResponse.credits.free.remaining}/${balanceResponse.credits.free.allocated} remaining`);
    console.log(`   - Paid: ${balanceResponse.credits.paid.remaining}/${balanceResponse.credits.paid.purchased} remaining`);
    
    // Final summary
    const allTestsPassed = paidCorrect && balanceCorrect && secondPaidCorrect && secondBalanceCorrect;
    
    console.log('\n' + '='.repeat(60));
    if (allTestsPassed) {
        console.log('✅ ALL TESTS PASSED - Credit purchase and tracking working correctly!');
        console.log('✅ Credits combine properly with previous purchases');
        console.log('✅ Profile should display combined credits correctly');
    } else {
        console.log('❌ SOME TESTS FAILED - Review the output above');
    }
    console.log('='.repeat(60) + '\n');
}

testCreditPurchase().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});

