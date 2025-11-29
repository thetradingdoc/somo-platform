#!/usr/bin/env node

/**
 * Script to delete all test leads from the database
 * 
 * Usage:
 *   node scripts/delete-test-leads.js
 * 
 * This script identifies and deletes test leads based on:
 * - is_test = 1
 * - Clinic names containing "Test", "Debug", "Webhook"
 * - Test email patterns (test@example.com, drlittlekids, gigtogigdev, doctorjay254)
 */

const path = require('path');
const db = require('../database');

console.log('🧹 Starting test leads cleanup...\n');

try {
  const result = db.deleteTestLeads();
  
  console.log('✅ Test leads deletion complete!');
  console.log(`   Deleted ${result.leads} test leads`);
  console.log(`   Deleted ${result.calls} related call records`);
  console.log(`   Deleted ${result.activities} related activity records`);
  console.log('\n✨ Database cleanup finished!');
  
  process.exit(0);
} catch (error) {
  console.error('❌ Error deleting test leads:', error);
  process.exit(1);
}

