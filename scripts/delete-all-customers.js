#!/usr/bin/env node
/**
 * Delete all API signup customers from database
 * WARNING: This will delete all customer data
 * Run with: node scripts/delete-all-customers.js
 */

require('dotenv').config();
const db = require('../middleware-platform/database.js');

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║           DELETE ALL API SIGNUP CUSTOMERS                      ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// Get all customers
const customers = db.db.prepare('SELECT id, email, name, customer_type FROM customers').all();

console.log(`Found ${customers.length} customers in database\n`);

if (customers.length === 0) {
  console.log('No customers to delete.');
  process.exit(0);
}

// Show what will be deleted
console.log('Customers to be deleted:');
customers.forEach((c, i) => {
  console.log(`  ${i + 1}. ${c.email} (${c.name}) - ${c.id}`);
});

console.log('\n⚠️  WARNING: This will delete:');
console.log('  - All customers');
console.log('  - All customer sessions');
console.log('  - All email verification codes');
console.log('  - All API keys');
console.log('  - All customer credits');
console.log('  - All monthly usage records');
console.log('  - All invoices');
console.log('  - Related data\n');

// Ask for confirmation
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Type "DELETE ALL" to confirm: ', (answer) => {
  if (answer !== 'DELETE ALL') {
    console.log('\n❌ Deletion cancelled.');
    rl.close();
    process.exit(0);
  }

  console.log('\n🗑️  Deleting customers and related data...\n');

  try {
    // Delete in correct order to respect foreign keys
    const customerIds = customers.map(c => c.id);
    const customerEmails = customers.map(c => c.email);

    // Delete customer sessions
    customerIds.forEach(id => {
      db.deleteCustomerSessions(id);
    });
    console.log('✅ Deleted customer sessions');

    // Delete email verification codes
    const deleteCodes = db.db.prepare('DELETE FROM email_verification_codes WHERE email IN (' + customerEmails.map(() => '?').join(',') + ')');
    deleteCodes.run(...customerEmails);
    console.log('✅ Deleted email verification codes');

    // Delete API keys
    const deleteApiKeys = db.db.prepare('DELETE FROM api_keys WHERE customer_id IN (' + customerIds.map(() => '?').join(',') + ')');
    deleteApiKeys.run(...customerIds);
    console.log('✅ Deleted API keys');

    // Delete customer credits
    const deleteCredits = db.db.prepare('DELETE FROM customer_credits WHERE customer_id IN (' + customerIds.map(() => '?').join(',') + ')');
    deleteCredits.run(...customerIds);
    console.log('✅ Deleted customer credits');

    // Delete monthly usage
    const deleteUsage = db.db.prepare('DELETE FROM monthly_usage WHERE customer_id IN (' + customerIds.map(() => '?').join(',') + ')');
    deleteUsage.run(...customerIds);
    console.log('✅ Deleted monthly usage');

    // Delete invoices
    const deleteInvoices = db.db.prepare('DELETE FROM monthly_invoices WHERE customer_id IN (' + customerIds.map(() => '?').join(',') + ')');
    deleteInvoices.run(...customerIds);
    console.log('✅ Deleted invoices');

    // Delete terms acceptance
    const deleteTerms = db.db.prepare('DELETE FROM terms_acceptance WHERE customer_id IN (' + customerIds.map(() => '?').join(',') + ')');
    deleteTerms.run(...customerIds);
    console.log('✅ Deleted terms acceptance');

    // Finally delete customers
    const deleteCustomers = db.db.prepare('DELETE FROM customers WHERE id IN (' + customerIds.map(() => '?').join(',') + ')');
    const result = deleteCustomers.run(...customerIds);
    console.log(`✅ Deleted ${result.changes} customers\n`);

    console.log('✅ All API signup customers deleted successfully!');
    console.log('\nYou can now use gigtogigdev@gmail.com for testing.');

  } catch (error) {
    console.error('❌ Error deleting customers:', error.message);
    process.exit(1);
  }

  rl.close();
  process.exit(0);
});
