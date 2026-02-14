#!/usr/bin/env node
/**
 * Test verify-card endpoint locally
 * Usage: node scripts/test-verify-card.js
 *
 * Requires: server running on localhost:4000
 *
 * Tests:
 * 1. skip_stripe path (no PaymentMethod - saves placeholder)
 * 2. resource_missing path (invalid pm_ - triggers dev fallback)
 */

require('dotenv').config();
const db = require('../database');

// Find or create a test customer with email_verified
function getOrCreateTestCustomer() {
  const testEmail = `test-verify-${Date.now()}@example.com`;
  db.createCustomer({
    email: testEmail,
    name: 'Test Verify',
    company_name: 'Test Verify Card',
    email_verified: true,
    status: 'active',
  });
  const customer = db.getCustomerByEmail(testEmail);
  if (!customer) throw new Error('Failed to create test customer');
  console.log('Using test customer:', customer.email, '(id:', customer.id + ')');
  return customer;
}

async function runTest() {
  console.log('\n🧪 Testing verify-card endpoint...\n');

  const customer = getOrCreateTestCustomer();
  const sessionId = db.createCustomerSession(customer.id, '127.0.0.1', 'test-verify-card-script');

  const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  const apiUrl = `${baseUrl}/api/signup/verify-card`;

  // Test 1: skip_stripe path (no payment_method_id)
  console.log('Test 1: skip_stripe path (no Stripe PM)...');
  try {
    const res1 = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `customer_session=${sessionId}`,
      },
      body: JSON.stringify({
        skip_stripe: true,
        card_details: { brand: 'visa', last4: '4242' },
      }),
    });
    const body1 = await res1.json();
    if (res1.ok && body1.success) {
      console.log('  ✅ skip_stripe: SUCCESS');
    } else {
      console.log('  ❌ skip_stripe: FAILED', res1.status, body1);
    }
  } catch (err) {
    console.log('  ❌ skip_stripe: ERROR', err.message);
  }

  // Test 2: resource_missing path (fake pm_ - simulates test/live mode mismatch)
  const testEmail2 = `test-verify-2-${Date.now()}@example.com`;
  db.createCustomer({
    email: testEmail2,
    name: 'Test Verify 2',
    company_name: 'Test Verify 2',
    email_verified: true,
    status: 'active',
  });
  const customer2 = db.getCustomerByEmail(testEmail2);
  if (!customer2) throw new Error('Failed to create customer2');
  const sessionId2 = db.createCustomerSession(customer2.id, '127.0.0.1', 'test-script');

  console.log('\nTest 2: resource_missing path (fake pm_ - dev fallback)...');
  try {
    const res2 = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `customer_session=${sessionId2}`,
      },
      body: JSON.stringify({
        payment_method_id: 'pm_1T06lyCPd7jDemnq7Q0JOmjD', // Invalid - triggers resource_missing
        card_details: { brand: 'visa', last4: '4242' },
      }),
    });
    const body2 = await res2.json();
    if (res2.ok && body2.success) {
      console.log('  ✅ resource_missing handler: SUCCESS (dev fallback worked)');
    } else {
      console.log('  ❌ resource_missing: FAILED', res2.status, body2);
    }
  } catch (err) {
    console.log('  ❌ resource_missing: ERROR', err.message);
  }

  console.log('\n✅ Test complete. If both passed, verify-card is working.\n');
}

runTest().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
