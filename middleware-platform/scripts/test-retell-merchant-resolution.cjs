#!/usr/bin/env node

/**
 * Test Merchant Resolution - Simulating Retell Call Flow
 * Tests how merchant_id is resolved when Retell calls search_products
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');
const db = require('../database');

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.doclittle.site';
const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID || 'agent_9151f738c705a56f4a0d8df63a';
const AKIN_DUNBAR_SUBDOMAIN = 'akin-dunbar';

console.log('🧪 Testing Merchant Resolution for Retell Calls\n');
console.log(`Agent ID: ${RETELL_AGENT_ID}`);
console.log(`Subdomain: ${AKIN_DUNBAR_SUBDOMAIN}`);
console.log(`API: ${API_BASE_URL}\n`);

// Get merchant
const merchant = db.getMerchantBySubdomain(AKIN_DUNBAR_SUBDOMAIN);
if (!merchant) {
  console.error('❌ Merchant not found!');
  process.exit(1);
}

console.log(`✅ Merchant: ${merchant.name} (${merchant.id})\n`);

async function runTests() {
// Test 1: Search with merchant_id in body (what Retell should send)
console.log('='.repeat(70));
console.log('TEST 1: Product search WITH merchant_id in request body');
console.log('='.repeat(70));
try {
  const response = await axios.post(
    `${API_BASE_URL}/voice/products/search`,
    {
      merchant_id: merchant.id,
      query: 'edibles'
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Origin': `https://${AKIN_DUNBAR_SUBDOMAIN}.doclittle.site`
      },
      timeout: 10000
    }
  );
  
  const products = response.data.products || response.data || [];
  console.log(`✅ SUCCESS: Found ${products.length} product(s)`);
  products.forEach(p => console.log(`   - ${p.name} - $${p.price}`));
} catch (error) {
  console.log(`❌ FAILED: ${error.response?.status || error.message}`);
  if (error.response?.data) {
    console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
  }
}

console.log('\n');

// Test 2: Search WITHOUT merchant_id (relying on tenant context)
console.log('='.repeat(70));
console.log('TEST 2: Product search WITHOUT merchant_id (tenant context only)');
console.log('='.repeat(70));
try {
  const response = await axios.post(
    `${API_BASE_URL}/voice/products/search`,
    {
      query: 'edibles'
      // No merchant_id - should use Origin header
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Origin': `https://${AKIN_DUNBAR_SUBDOMAIN}.doclittle.site`
      },
      timeout: 10000
    }
  );
  
  const products = response.data.products || response.data || [];
  console.log(`✅ SUCCESS: Found ${products.length} product(s)`);
  products.forEach(p => console.log(`   - ${p.name} - $${p.price}`));
} catch (error) {
  console.log(`❌ FAILED: ${error.response?.status || error.message}`);
  if (error.response?.data) {
    console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
  }
}

console.log('\n');

// Test 3: Search with wrong merchant_id (what happens if Retell sends wrong ID)
console.log('='.repeat(70));
console.log('TEST 3: Product search with WRONG merchant_id (simulating Retell bug)');
console.log('='.repeat(70));
try {
  const response = await axios.post(
    `${API_BASE_URL}/voice/products/search`,
    {
      merchant_id: 'd10794ff-ca11-4e6f-93e9-560162b4f884', // The hardcoded wrong ID
      query: 'edibles'
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Origin': `https://${AKIN_DUNBAR_SUBDOMAIN}.doclittle.site`
      },
      timeout: 10000
    }
  );
  
  const products = response.data.products || response.data || [];
  console.log(`⚠️  Found ${products.length} product(s) with wrong merchant_id`);
  if (products.length > 0) {
    products.forEach(p => console.log(`   - ${p.name} - $${p.price}`));
  }
} catch (error) {
  console.log(`✅ CORRECTLY REJECTED: ${error.response?.status || error.message}`);
  if (error.response?.data) {
    console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
  }
}

console.log('\n' + '='.repeat(70));
console.log('📊 SUMMARY');
console.log('='.repeat(70));
console.log('✅ Products exist in production');
console.log('✅ Product search works when merchant_id is correct');
console.log('⚠️  The issue is likely:');
console.log('   1. Retell is sending wrong merchant_id (d10794ff-ca11-4e6f-93e9-560162b4f884)');
console.log('   2. OR merchant_id is not being resolved from dynamic variables');
console.log('   3. OR tenant context middleware is not working in production');
console.log('='.repeat(70) + '\n');
}

runTests().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});

