/**
 * Check what merchants exist in the database
 */

require('dotenv').config();

const path = require('path');
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

const db = require('../database');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔍 Checking Merchants in Database');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Get all merchants
const merchants = db.db.prepare('SELECT id, name, subdomain, api_url FROM merchants').all();

if (merchants.length === 0) {
    console.log('⚠️  No merchants found in database.');
    console.log('\n💡 To create a merchant, you can:');
    console.log('   1. Use the admin dashboard');
    console.log('   2. Create via API');
    console.log('   3. Run create-tenant-customer.js which creates merchants automatically');
} else {
    console.log(`✅ Found ${merchants.length} merchant(s):\n`);
    merchants.forEach((merchant, idx) => {
        console.log(`${idx + 1}. ${merchant.name || 'Unnamed'}`);
        console.log(`   ID: ${merchant.id}`);
        console.log(`   Subdomain: ${merchant.subdomain || 'N/A'}`);
        console.log(`   API URL: ${merchant.api_url || 'N/A'}`);
        console.log('');
    });
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');


