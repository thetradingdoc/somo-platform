/**
 * Comprehensive Test: Credit Purchase Flow
 * Tests the full flow from purchase to profile display
 * 
 * This test simulates:
 * 1. Initial credits state
 * 2. Purchasing additional credits
 * 3. Verifying credits combine correctly
 * 4. Checking profile display would show correct values
 */

require('dotenv').config({ path: require('path').join(__dirname, '../middleware-platform/.env') });
const db = require('../middleware-platform/database');

async function testCreditPurchaseFlow() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║        COMPREHENSIVE CREDIT PURCHASE FLOW TEST                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    // Create a test customer or use existing
    const testEmail = 'test-credit-purchase@example.com';
    let customer = db.getCustomerByEmail(testEmail);
    
    if (!customer) {
        console.log(`Creating test customer: ${testEmail}`);
        const { v4: uuidv4 } = require('uuid');
        const customerId = uuidv4();
        
        db.db.prepare(`
            INSERT INTO customers (id, email, name, email_verified, created_at, updated_at)
            VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
        `).run(customerId, testEmail, 'Test Customer');
        
        customer = db.getCustomerByEmail(testEmail);
        console.log(`✅ Created test customer: ${customer.id}`);
    } else {
        console.log(`✅ Using existing test customer: ${customer.id}`);
    }
    
    // Step 1: Allocate free credits (simulating terms acceptance)
    console.log('\n📋 STEP 1: Allocating free credits (100 minutes)');
    db.allocateFreeCredits(customer.id, 100);
    let credits = db.getCustomerCredits(customer.id);
    console.log(`   Free Credits Allocated: ${credits.free_credits_allocated} minutes`);
    console.log(`   Total Balance: ${credits.credits_balance_minutes} minutes`);
    
    // Step 2: Simulate some usage by directly updating the database
    console.log('\n📋 STEP 2: Simulating voice call usage (30 minutes)');
    db.db.prepare(`
        UPDATE customer_credits 
        SET free_credits_used = free_credits_used + ?,
            credits_balance_minutes = credits_balance_minutes - ?,
            updated_at = datetime('now')
        WHERE customer_id = ?
    `).run(30, 30, customer.id);
    credits = db.getCustomerCredits(customer.id);
    console.log(`   Free Credits Used: ${credits.free_credits_used} minutes`);
    console.log(`   Free Credits Remaining: ${credits.free_credits_allocated - credits.free_credits_used} minutes`);
    console.log(`   Total Balance: ${credits.credits_balance_minutes} minutes`);
    
    // Step 3: First purchase
    console.log('\n📋 STEP 3: FIRST CREDIT PURCHASE - Starter Pack (100 minutes, $5)');
    const beforeFirstPurchase = {
        freeAllocated: credits.free_credits_allocated,
        freeUsed: credits.free_credits_used,
        paidPurchased: credits.paid_credits_purchased,
        paidUsed: credits.paid_credits_used,
        balance: credits.credits_balance_minutes
    };
    
    console.log(`   Before Purchase:`);
    console.log(`     Free: ${beforeFirstPurchase.freeAllocated - beforeFirstPurchase.freeUsed}/${beforeFirstPurchase.freeAllocated} remaining`);
    console.log(`     Paid: ${beforeFirstPurchase.paidPurchased - beforeFirstPurchase.paidUsed}/${beforeFirstPurchase.paidPurchased} purchased`);
    console.log(`     Total Balance: ${beforeFirstPurchase.balance} minutes`);
    
    // Simulate purchase
    const firstPurchase = { id: 'starter', name: 'Starter Pack', minutes: 100, price: 5.00 };
    db.addPaidCredits(customer.id, firstPurchase.minutes);
    
    // Create purchase record
    db.createCreditPurchase(
        customer.id,
        firstPurchase.name,
        firstPurchase.minutes,
        firstPurchase.price,
        'test_session_1',
        null
    );
    db.updateCreditPurchaseStatus(
        db.getCustomerCreditPurchases(customer.id)[0].id,
        'completed',
        'test_pi_1',
        new Date().toISOString()
    );
    
    credits = db.getCustomerCredits(customer.id);
    const afterFirstPurchase = {
        freeAllocated: credits.free_credits_allocated,
        freeUsed: credits.free_credits_used,
        paidPurchased: credits.paid_credits_purchased,
        paidUsed: credits.paid_credits_used,
        balance: credits.credits_balance_minutes
    };
    
    console.log(`   After Purchase:`);
    console.log(`     Free: ${afterFirstPurchase.freeAllocated - afterFirstPurchase.freeUsed}/${afterFirstPurchase.freeAllocated} remaining`);
    console.log(`     Paid: ${afterFirstPurchase.paidPurchased - afterFirstPurchase.paidUsed}/${afterFirstPurchase.paidPurchased} purchased`);
    console.log(`     Total Balance: ${afterFirstPurchase.balance} minutes`);
    
    // Verify first purchase
    const firstPurchaseCorrect = 
        afterFirstPurchase.paidPurchased === (beforeFirstPurchase.paidPurchased + firstPurchase.minutes) &&
        afterFirstPurchase.balance === (beforeFirstPurchase.balance + firstPurchase.minutes);
    
    console.log(`   ${firstPurchaseCorrect ? '✅' : '❌'} First purchase credits added correctly: ${firstPurchaseCorrect}`);
    
    // Step 4: Second purchase (testing multiple purchases)
    console.log('\n📋 STEP 4: SECOND CREDIT PURCHASE - Professional Pack (500 minutes, $20)');
    const beforeSecondPurchase = { ...afterFirstPurchase };
    
    console.log(`   Before Purchase:`);
    console.log(`     Paid: ${beforeSecondPurchase.paidPurchased - beforeSecondPurchase.paidUsed}/${beforeSecondPurchase.paidPurchased} purchased`);
    console.log(`     Total Balance: ${beforeSecondPurchase.balance} minutes`);
    
    const secondPurchase = { id: 'professional', name: 'Professional Pack', minutes: 500, price: 20.00 };
    db.addPaidCredits(customer.id, secondPurchase.minutes);
    
    // Create purchase record
    db.createCreditPurchase(
        customer.id,
        secondPurchase.name,
        secondPurchase.minutes,
        secondPurchase.price,
        'test_session_2',
        null
    );
    const purchases = db.getCustomerCreditPurchases(customer.id);
    db.updateCreditPurchaseStatus(
        purchases[0].id, // Most recent
        'completed',
        'test_pi_2',
        new Date().toISOString()
    );
    
    credits = db.getCustomerCredits(customer.id);
    const afterSecondPurchase = {
        freeAllocated: credits.free_credits_allocated,
        freeUsed: credits.free_credits_used,
        paidPurchased: credits.paid_credits_purchased,
        paidUsed: credits.paid_credits_used,
        balance: credits.credits_balance_minutes
    };
    
    console.log(`   After Purchase:`);
    console.log(`     Paid: ${afterSecondPurchase.paidPurchased - afterSecondPurchase.paidUsed}/${afterSecondPurchase.paidPurchased} purchased`);
    console.log(`     Total Balance: ${afterSecondPurchase.balance} minutes`);
    
    // Verify second purchase
    const secondPurchaseCorrect = 
        afterSecondPurchase.paidPurchased === (beforeSecondPurchase.paidPurchased + secondPurchase.minutes) &&
        afterSecondPurchase.balance === (beforeSecondPurchase.balance + secondPurchase.minutes);
    
    console.log(`   ${secondPurchaseCorrect ? '✅' : '❌'} Second purchase credits combined correctly: ${secondPurchaseCorrect}`);
    
    // Step 5: Test the API response format (what profile would receive)
    console.log('\n📋 STEP 5: TESTING API RESPONSE FORMAT (/api/credits/balance)');
    const finalCredits = db.getCustomerCredits(customer.id);
    const freeAllocated = finalCredits.free_credits_allocated || 0;
    const freeUsed = finalCredits.free_credits_used || 0;
    const paidPurchased = finalCredits.paid_credits_purchased || 0;
    const paidUsed = finalCredits.paid_credits_used || 0;
    const balance = finalCredits.credits_balance_minutes || 0;
    
    const apiResponse = {
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
    
    console.log('   API Response Structure:');
    console.log(JSON.stringify(apiResponse, null, 2));
    
    // Step 6: Verify profile display values
    console.log('\n📋 STEP 6: VERIFYING PROFILE DISPLAY VALUES');
    console.log('   Profile should display:');
    console.log(`     Total Balance: ${apiResponse.credits.balance} minutes`);
    console.log(`     Free Voice Credits: ${apiResponse.credits.free.remaining}/${apiResponse.credits.free.allocated} remaining`);
    console.log(`     Paid Voice Credits: ${apiResponse.credits.paid.remaining}/${apiResponse.credits.paid.purchased} remaining`);
    
    // Verify the math
    const expectedTotalBalance = 
        (freeAllocated - freeUsed) + // Free credits remaining
        (paidPurchased - paidUsed);   // Paid credits remaining
    
    const balanceMathCorrect = balance === expectedTotalBalance;
    console.log(`   ${balanceMathCorrect ? '✅' : '❌'} Total balance calculation correct: ${balanceMathCorrect}`);
    console.log(`     Expected: ${expectedTotalBalance}, Actual: ${balance}`);
    
    // Step 7: Check purchase history
    console.log('\n📋 STEP 7: PURCHASE HISTORY');
    const allPurchases = db.getCustomerCreditPurchases(customer.id);
    console.log(`   Total purchases: ${allPurchases.length}`);
    allPurchases.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.package_name} - ${p.credits_amount} min - $${p.amount_paid} - ${p.status} - ${p.purchased_at || p.created_at}`);
    });
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    const allTestsPassed = firstPurchaseCorrect && secondPurchaseCorrect && balanceMathCorrect;
    
    if (allTestsPassed) {
        console.log('✅ ALL TESTS PASSED!');
        console.log('');
        console.log('✅ Credit purchase flow is working correctly:');
        console.log('   - Users can purchase additional credits');
        console.log('   - New credits combine with existing credits');
        console.log('   - Paid credits are tracked separately from free credits');
        console.log('   - Total balance reflects all credits');
        console.log('   - Profile will display combined credits correctly');
        console.log('');
        console.log('📊 Final State:');
        console.log(`   Free Credits: ${apiResponse.credits.free.remaining}/${apiResponse.credits.free.allocated} remaining`);
        console.log(`   Paid Credits: ${apiResponse.credits.paid.remaining}/${apiResponse.credits.paid.purchased} purchased`);
        console.log(`   Total Balance: ${apiResponse.credits.balance} minutes`);
    } else {
        console.log('❌ SOME TESTS FAILED');
        console.log(`   First purchase: ${firstPurchaseCorrect ? '✅' : '❌'}`);
        console.log(`   Second purchase: ${secondPurchaseCorrect ? '✅' : '❌'}`);
        console.log(`   Balance math: ${balanceMathCorrect ? '✅' : '❌'}`);
    }
    console.log('='.repeat(60) + '\n');
    
    // Cleanup test customer
    console.log('🧹 Cleaning up test customer...');
    const testCustomerId = customer.id;
    db.db.prepare('DELETE FROM credit_purchases WHERE customer_id = ?').run(testCustomerId);
    db.db.prepare('DELETE FROM customer_credits WHERE customer_id = ?').run(testCustomerId);
    db.db.prepare('DELETE FROM customers WHERE id = ?').run(testCustomerId);
    console.log('✅ Test customer cleaned up');
}

testCreditPurchaseFlow().catch(error => {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
});

