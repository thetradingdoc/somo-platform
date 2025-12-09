/**
 * Get Merchant ID for akin-dunbar
 * 
 * Usage:
 *   node scripts/get-akin-dunbar-merchant-id.js
 */

require('dotenv').config();
const db = require('../database');

const subdomain = 'akin-dunbar';

console.log('\n🔍 Finding merchant_id for:', subdomain);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const merchant = db.getMerchantBySubdomain(subdomain);

if (!merchant) {
  console.log('❌ Merchant not found with subdomain:', subdomain);
  console.log('\n📋 All merchants in database:');
  const allMerchants = db.getAllMerchants();
  if (allMerchants.length === 0) {
    console.log('   No merchants found in database');
  } else {
    allMerchants.forEach((m, i) => {
      console.log(`\n${i + 1}. ${m.name || 'Unnamed'}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Subdomain: ${m.subdomain || 'N/A'}`);
    });
  }
  process.exit(1);
}

console.log('✅ Merchant found!');
console.log('\n📦 MERCHANT DETAILS:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Merchant ID: ${merchant.id}`);
console.log(`Name: ${merchant.name || 'N/A'}`);
console.log(`Subdomain: ${merchant.subdomain || 'N/A'}`);
console.log(`Status: ${merchant.status || 'N/A'}`);
console.log(`API URL: ${merchant.api_url || 'N/A'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('🎯 MERCHANT ID FOR AKIN-DUNBAR:');
console.log(`   ${merchant.id}\n`);



