/**
 * Find Tenant Script
 * Queries database to find tenant details by subdomain or email
 * 
 * Usage:
 *   node scripts/find-tenant.js doctor-little
 *   node scripts/find-tenant.js doctorjay254+1000@gmail.com
 */

const db = require('../database');
const subdomainOrEmail = process.argv[2];

if (!subdomainOrEmail) {
  console.error('❌ Please provide a subdomain or email');
  console.log('Usage: node scripts/find-tenant.js <subdomain|email>');
  process.exit(1);
}

console.log('\n🔍 SEARCHING FOR TENANT');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(`Search term: ${subdomainOrEmail}\n`);

let found = false;

// Try as subdomain (merchant)
const merchant = db.getMerchantBySubdomain(subdomainOrEmail);
if (merchant) {
  found = true;
  console.log('✅ FOUND MERCHANT:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ID:           ${merchant.id}`);
  console.log(`  Name:         ${merchant.name}`);
  console.log(`  Subdomain:     ${merchant.subdomain || 'N/A'}`);
  console.log(`  Tenant Type:   ${merchant.tenant_type || 'N/A (defaults to clinic)'}`);
  console.log(`  Status:        ${merchant.status || 'N/A'}`);
  console.log(`  API URL:       ${merchant.api_url || 'N/A'}`);
  console.log(`  Created:       ${merchant.created_at || 'N/A'}`);
  console.log('');
  
  // Find associated customer
  const customers = db.db.prepare('SELECT * FROM customers WHERE merchant_id = ?').all(merchant.id);
  if (customers.length > 0) {
    console.log(`  Associated Customers (${customers.length}):`);
    customers.forEach(customer => {
      console.log(`    - ${customer.email} (${customer.name})`);
      console.log(`      ID: ${customer.id}`);
      console.log(`      Status: ${customer.status}`);
      console.log(`      Created: ${customer.created_at}`);
    });
    console.log('');
  }
}

// Try as clinic slug
const clinic = db.getClinicBySlug(subdomainOrEmail);
if (clinic) {
  found = true;
  console.log('✅ FOUND CLINIC:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Clinic ID:     ${clinic.clinic_id}`);
  console.log(`  Name:          ${clinic.name}`);
  console.log(`  Slug:          ${clinic.slug}`);
  console.log(`  Email:         ${clinic.email || 'N/A'}`);
  console.log(`  Phone:         ${clinic.phone_number || 'N/A'}`);
  console.log(`  Merchant ID:   ${clinic.merchant_id || 'N/A'}`);
  console.log(`  Retell Agent:  ${clinic.retell_agent_id || 'N/A'} (${clinic.retell_agent_status || 'N/A'})`);
  console.log(`  Active:        ${clinic.is_active ? 'Yes' : 'No'}`);
  console.log(`  Created:       ${clinic.created_at || 'N/A'}`);
  console.log('');
  
  // Find associated merchant
  if (clinic.merchant_id) {
    const clinicMerchant = db.getMerchant(clinic.merchant_id);
    if (clinicMerchant) {
      console.log('  Associated Merchant:');
      console.log(`    - ${clinicMerchant.name} (${clinicMerchant.subdomain || 'N/A'})`);
      console.log(`      Tenant Type: ${clinicMerchant.tenant_type || 'N/A'}`);
    }
    console.log('');
  }
  
  // Find phone numbers
  const phoneNumbers = db.getClinicPhoneNumbers(clinic.clinic_id);
  if (phoneNumbers && phoneNumbers.length > 0) {
    console.log(`  Phone Numbers (${phoneNumbers.length}):`);
    phoneNumbers.forEach(phone => {
      console.log(`    - ${phone.phone_number} ${phone.is_primary ? '(Primary)' : ''}`);
    });
    console.log('');
  }
}

// Try as email (customer)
const customer = db.getCustomerByEmail(subdomainOrEmail);
if (customer) {
  found = true;
  console.log('✅ FOUND CUSTOMER:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ID:            ${customer.id}`);
  console.log(`  Name:          ${customer.name}`);
  console.log(`  Email:         ${customer.email}`);
  console.log(`  Company:       ${customer.company_name || 'N/A'}`);
  console.log(`  Phone:         ${customer.phone_number || 'N/A'}`);
  console.log(`  Merchant ID:   ${customer.merchant_id || 'N/A'}`);
  console.log(`  Customer Type: ${customer.customer_type || 'N/A'}`);
  console.log(`  Status:        ${customer.status || 'N/A'}`);
  console.log(`  Plan Tier:     ${customer.plan_tier || 'N/A'}`);
  console.log(`  Email Verified: ${customer.email_verified ? 'Yes' : 'No'}`);
  console.log(`  Retell Agent:  ${customer.retell_agent_id || 'N/A'} (${customer.retell_agent_status || 'N/A'})`);
  console.log(`  Created:       ${customer.created_at || 'N/A'}`);
  console.log('');
  
  // Find associated merchant
  if (customer.merchant_id) {
    const customerMerchant = db.getMerchant(customer.merchant_id);
    if (customerMerchant) {
      console.log('  Associated Merchant:');
      console.log(`    - ${customerMerchant.name} (${customerMerchant.subdomain || 'N/A'})`);
      console.log(`      Tenant Type: ${customerMerchant.tenant_type || 'N/A'}`);
      console.log(`      Status: ${customerMerchant.status || 'N/A'}`);
    }
    console.log('');
  }
  
  // Get credits
  const credits = db.getCustomerCredits(customer.id);
  if (credits) {
    console.log('  Credits:');
    console.log(`    Balance: ${credits.credits_balance_minutes || 0} minutes`);
    console.log(`    Free Allocated: ${credits.free_credits_allocated || 0}`);
    console.log(`    Free Used: ${credits.free_credits_used || 0}`);
    console.log(`    Paid Purchased: ${credits.paid_credits_purchased || 0}`);
    console.log(`    Paid Used: ${credits.paid_credits_used || 0}`);
    console.log('');
  }
}

if (!found) {
  console.log('❌ TENANT NOT FOUND');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`No merchant, clinic, or customer found with: ${subdomainOrEmail}`);
  console.log('');
  console.log('💡 Try searching by:');
  console.log('   - Subdomain (e.g., doctor-little)');
  console.log('   - Email address (e.g., doctorjay254+1000@gmail.com)');
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');


