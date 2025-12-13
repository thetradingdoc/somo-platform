/**
 * Query Tenant Details Script
 * 
 * Usage:
 *   node scripts/query-tenant-details.js akin-dunbar
 * 
 * This script queries all details for a tenant by subdomain
 */

require('dotenv').config();
const db = require('../database');

const subdomain = process.argv[2] || 'akin-dunbar';

async function queryTenant() {

console.log('\n🔍 TENANT DETAILS QUERY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Subdomain: ${subdomain}\n`);

// 1. Get Merchant
console.log('📦 MERCHANT INFORMATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const merchant = db.getMerchantBySubdomain(subdomain);
if (!merchant) {
  console.log('❌ Merchant not found with subdomain:', subdomain);
  process.exit(1);
}

console.log(JSON.stringify(merchant, null, 2));
console.log('');

// 2. Get Associated Clinic
console.log('🏥 CLINIC INFORMATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let clinic = null;
try {
  if (db.getClinicBySlug) {
    clinic = await db.getClinicBySlug(subdomain);
  }
} catch (e) {
  // Try sync version
  clinic = db.prepare('SELECT * FROM clinics WHERE slug = ?').get(subdomain);
}
if (clinic) {
  console.log(JSON.stringify(clinic, null, 2));
} else {
  console.log('⚠️  No clinic found with slug:', subdomain);
}
console.log('');

// 3. Get Products
console.log('🛍️  PRODUCTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const products = db.getProductsByMerchant(merchant.id);
console.log(`Total Products: ${products.length}`);
if (products.length > 0) {
  console.log('\nFirst 5 products:');
  products.slice(0, 5).forEach((p, i) => {
    console.log(`\n${i + 1}. ${p.name || 'Unnamed'}`);
    console.log(`   ID: ${p.id}`);
    console.log(`   Price: $${p.price || 0}`);
    console.log(`   Inventory: ${p.inventory || 0}`);
  });
  if (products.length > 5) {
    console.log(`\n... and ${products.length - 5} more products`);
  }
} else {
  console.log('⚠️  No products found');
}
console.log('');

// 4. Get Customers
console.log('👥 CUSTOMERS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const customers = db.prepare(`
  SELECT * FROM customers 
  WHERE retell_agent_id IN (
    SELECT retell_agent_id FROM clinics WHERE merchant_id = ?
  ) OR id IN (
    SELECT DISTINCT customer_id FROM voice_call_log WHERE customer_id IS NOT NULL
  )
  LIMIT 20
`).all(merchant.id);
console.log(`Total Customers (showing up to 20): ${customers.length}`);
if (customers.length > 0) {
  customers.forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.name || 'Unnamed'}`);
    console.log(`   Email: ${c.email || 'N/A'}`);
    console.log(`   Phone: ${c.phone_number || 'N/A'}`);
    console.log(`   Status: ${c.status || 'N/A'}`);
    console.log(`   Retell Agent ID: ${c.retell_agent_id || 'N/A'}`);
  });
} else {
  console.log('⚠️  No customers found');
}
console.log('');

// 5. Get Appointments
console.log('📅 APPOINTMENTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let appointments = [];
if (clinic) {
  appointments = db.prepare(`
    SELECT * FROM appointments 
    WHERE clinic_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(clinic.clinic_id);
} else {
  // Try to find appointments by merchant
  appointments = db.prepare(`
    SELECT a.* FROM appointments a
    JOIN clinics c ON a.clinic_id = c.clinic_id
    WHERE c.merchant_id = ?
    ORDER BY a.created_at DESC
    LIMIT 20
  `).all(merchant.id);
}
console.log(`Total Appointments (showing last 20): ${appointments.length}`);
if (appointments.length > 0) {
  appointments.forEach((a, i) => {
    console.log(`\n${i + 1}. ${a.patient_name || 'Unnamed'}`);
    console.log(`   Date: ${a.date || 'N/A'} ${a.time || ''}`);
    console.log(`   Status: ${a.status || 'N/A'}`);
    console.log(`   Type: ${a.appointment_type || 'N/A'}`);
  });
} else {
  console.log('⚠️  No appointments found');
}
console.log('');

// 6. Get Orders/Transactions
console.log('💳 TRANSACTIONS/ORDERS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const transactions = db.prepare(`
  SELECT * FROM transactions 
  WHERE merchant_id = ?
  ORDER BY created_at DESC
  LIMIT 20
`).all(merchant.id);
console.log(`Total Transactions (showing last 20): ${transactions.length}`);
if (transactions.length > 0) {
  transactions.forEach((t, i) => {
    console.log(`\n${i + 1}. Transaction ${t.id}`);
    console.log(`   Amount: $${t.amount || 0}`);
    console.log(`   Status: ${t.status || 'N/A'}`);
    console.log(`   Platform: ${t.platform || 'N/A'}`);
    console.log(`   Created: ${t.created_at || 'N/A'}`);
  });
} else {
  console.log('⚠️  No transactions found');
}
console.log('');

// 7. Get Voice Checkouts
console.log('🎙️  VOICE CHECKOUTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const checkouts = db.prepare(`
  SELECT * FROM voice_checkouts 
  WHERE merchant_id = ?
  ORDER BY created_at DESC
  LIMIT 20
`).all(merchant.id);
console.log(`Total Voice Checkouts (showing last 20): ${checkouts.length}`);
if (checkouts.length > 0) {
  checkouts.forEach((c, i) => {
    console.log(`\n${i + 1}. Checkout ${c.id}`);
    console.log(`   Product: ${c.product_name || 'N/A'}`);
    console.log(`   Amount: $${c.amount || 0}`);
    console.log(`   Status: ${c.status || 'N/A'}`);
    console.log(`   Customer: ${c.customer_name || c.customer_phone || 'N/A'}`);
    console.log(`   Created: ${c.created_at || 'N/A'}`);
  });
} else {
  console.log('⚠️  No voice checkouts found');
}
console.log('');

// 8. Get API Keys
console.log('🔑 API KEYS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const apiKeys = db.getMerchantApiKeys(merchant.id);
console.log(`Total API Keys: ${apiKeys.length}`);
if (apiKeys.length > 0) {
  apiKeys.forEach((k, i) => {
    console.log(`\n${i + 1}. ${k.label || 'Unnamed Key'}`);
    console.log(`   Prefix: ${k.key_prefix}...${k.key_suffix}`);
    console.log(`   Status: ${k.status || 'N/A'}`);
    console.log(`   Created: ${k.created_at || 'N/A'}`);
    console.log(`   Last Used: ${k.last_used_at || 'Never'}`);
  });
} else {
  console.log('⚠️  No API keys found');
}
console.log('');

// 9. Summary
console.log('📊 SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Merchant ID: ${merchant.id}`);
console.log(`Merchant Name: ${merchant.name}`);
console.log(`Subdomain: ${merchant.subdomain}`);
console.log(`Status: ${merchant.status || 'active'}`);
console.log(`Products: ${products.length}`);
console.log(`Customers: ${customers.length}`);
console.log(`Appointments: ${appointments.length}`);
console.log(`Transactions: ${transactions.length}`);
console.log(`Voice Checkouts: ${checkouts.length}`);
console.log(`API Keys: ${apiKeys.length}`);
if (clinic) {
  console.log(`Clinic ID: ${clinic.clinic_id}`);
  console.log(`Clinic Name: ${clinic.name}`);
  console.log(`Retell Agent ID: ${clinic.retell_agent_id || 'N/A'}`);
  console.log(`Retell Agent Status: ${clinic.retell_agent_status || 'N/A'}`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

queryTenant().catch(err => {
  console.error('❌ Error querying tenant:', err);
  process.exit(1);
});

