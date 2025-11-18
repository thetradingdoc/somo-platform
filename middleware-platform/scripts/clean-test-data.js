#!/usr/bin/env node

/**
 * Clean Test Data from Database
 * Removes all test data created during testing
 */

const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'middleware.db');
const db = new Database(dbPath);

console.log('🧹 Cleaning test data from database...\n');

let deletedCount = 0;

try {
  // Patterns to identify test data
  const testPatterns = [
    'test%@example.com',
    'Test User%',
    'TEST%',
    'CLAIMS%',
    'test%@example.com',
    'claimstest%@example.com'
  ];

  // Disable foreign keys temporarily
  db.pragma('foreign_keys = OFF');

  // Clean child records first (FHIR encounters, observations, communications)
  console.log('🏥 Cleaning test FHIR encounters...');
  const testEncounters = db.prepare(`
    DELETE FROM fhir_encounters 
    WHERE patient_id IN (
      SELECT resource_id FROM fhir_patients 
      WHERE name LIKE 'Test User%' 
         OR name LIKE 'Claims Test%'
         OR email LIKE 'test%@example.com'
         OR email LIKE 'claimstest%@example.com'
         OR phone LIKE '+1555%'
    )
  `).run();
  deletedCount += testEncounters.changes;
  console.log(`   Deleted ${testEncounters.changes} test encounters`);

  console.log('📊 Cleaning test FHIR observations...');
  const testObservations = db.prepare(`
    DELETE FROM fhir_observations 
    WHERE patient_id IN (
      SELECT resource_id FROM fhir_patients 
      WHERE name LIKE 'Test User%' 
         OR name LIKE 'Claims Test%'
         OR email LIKE 'test%@example.com'
         OR email LIKE 'claimstest%@example.com'
         OR phone LIKE '+1555%'
    )
  `).run();
  deletedCount += testObservations.changes;
  console.log(`   Deleted ${testObservations.changes} test observations`);

  console.log('💬 Cleaning test FHIR communications...');
  const testCommunications = db.prepare(`
    DELETE FROM fhir_communications 
    WHERE patient_id IN (
      SELECT resource_id FROM fhir_patients 
      WHERE name LIKE 'Test User%' 
         OR name LIKE 'Claims Test%'
         OR email LIKE 'test%@example.com'
         OR email LIKE 'claimstest%@example.com'
         OR phone LIKE '+1555%'
    )
  `).run();
  deletedCount += testCommunications.changes;
  console.log(`   Deleted ${testCommunications.changes} test communications`);

  // Clean appointments (test data) - before patients since they reference patients
  console.log('📋 Cleaning test appointments...');
  const testAppointments = db.prepare(`
    DELETE FROM appointments 
    WHERE patient_name LIKE 'Test User%' 
       OR patient_name LIKE 'Claims Test%'
       OR patient_email LIKE 'test%@example.com'
       OR patient_email LIKE 'claimstest%@example.com'
       OR notes LIKE '%Test appointment%'
       OR notes LIKE '%test%'
  `).run();
  deletedCount += testAppointments.changes;
  console.log(`   Deleted ${testAppointments.changes} test appointments`);

  // Clean FHIR patients (test data) - after child records
  console.log('👤 Cleaning test FHIR patients...');
  const testPatients = db.prepare(`
    DELETE FROM fhir_patients 
    WHERE name LIKE 'Test User%' 
       OR name LIKE 'Claims Test%'
       OR email LIKE 'test%@example.com'
       OR email LIKE 'claimstest%@example.com'
       OR phone LIKE '+1555%'
  `).run();
  deletedCount += testPatients.changes;
  console.log(`   Deleted ${testPatients.changes} test patients`);

  // Clean eligibility checks (test data)
  console.log('🏥 Cleaning test eligibility checks...');
  const testEligibility = db.prepare(`
    DELETE FROM eligibility_checks 
    WHERE member_id LIKE 'TEST%' 
       OR member_id LIKE 'CLAIMS%'
  `).run();
  deletedCount += testEligibility.changes;
  console.log(`   Deleted ${testEligibility.changes} test eligibility checks`);

  // Clean patient insurance (test data)
  console.log('💳 Cleaning test patient insurance...');
  const testInsurance = db.prepare(`
    DELETE FROM patient_insurance 
    WHERE member_id LIKE 'TEST%' 
       OR member_id LIKE 'CLAIMS%'
  `).run();
  deletedCount += testInsurance.changes;
  console.log(`   Deleted ${testInsurance.changes} test insurance records`);

  // Clean voice checkouts (test data)
  console.log('🛒 Cleaning test voice checkouts...');
  const testCheckouts = db.prepare(`
    DELETE FROM voice_checkouts 
    WHERE customer_email LIKE 'test%@example.com'
       OR customer_email LIKE 'claimstest%@example.com'
       OR customer_name LIKE 'Test User%'
       OR customer_name LIKE 'Claims Test%'
       OR customer_phone LIKE '+1555%'
  `).run();
  deletedCount += testCheckouts.changes;
  console.log(`   Deleted ${testCheckouts.changes} test checkouts`);

  // Clean payment tokens (test data)
  console.log('🎫 Cleaning test payment tokens...');
  const testTokens = db.prepare(`
    DELETE FROM payment_tokens 
    WHERE checkout_id IN (
      SELECT id FROM voice_checkouts 
      WHERE customer_email LIKE 'test%@example.com'
         OR customer_email LIKE 'claimstest%@example.com'
    )
  `).run();
  deletedCount += testTokens.changes;
  console.log(`   Deleted ${testTokens.changes} test payment tokens`);

  // Clean insurance claims (test data)
  console.log('📄 Cleaning test insurance claims...');
  const testClaims = db.prepare(`
    DELETE FROM insurance_claims 
    WHERE member_id LIKE 'TEST%' 
       OR member_id LIKE 'CLAIMS%'
  `).run();
  deletedCount += testClaims.changes;
  console.log(`   Deleted ${testClaims.changes} test claims`);


  // Clean transactions (test data)
  console.log('💸 Cleaning test transactions...');
  const testTransactions = db.prepare(`
    DELETE FROM transactions 
    WHERE customer_email LIKE 'test%@example.com'
       OR customer_email LIKE 'claimstest%@example.com'
       OR customer_phone LIKE '+1555%'
  `).run();
  deletedCount += testTransactions.changes;
  console.log(`   Deleted ${testTransactions.changes} test transactions`);

  // Clean fraud checks (test data)
  console.log('🛡️ Cleaning test fraud checks...');
  const testFraud = db.prepare(`
    DELETE FROM fraud_checks 
    WHERE customer_email LIKE 'test%@example.com'
       OR customer_phone LIKE '+1555%'
  `).run();
  deletedCount += testFraud.changes;
  console.log(`   Deleted ${testFraud.changes} test fraud checks`);

  // Clean fraud attempts (test data)
  console.log('🚨 Cleaning test fraud attempts...');
  const testFraudAttempts = db.prepare(`
    DELETE FROM fraud_attempts 
    WHERE patient_phone LIKE '+1555%'
       OR member_id LIKE 'TEST%'
       OR member_id LIKE 'CLAIMS%'
  `).run();
  deletedCount += testFraudAttempts.changes;
  console.log(`   Deleted ${testFraudAttempts.changes} test fraud attempts`);

  // Clean patient portal sessions (test data)
  console.log('🔐 Cleaning test portal sessions...');
  const testSessions = db.prepare(`
    DELETE FROM patient_portal_sessions 
    WHERE email LIKE 'test%@example.com'
       OR email LIKE 'claimstest%@example.com'
       OR phone LIKE '+1555%'
  `).run();
  deletedCount += testSessions.changes;
  console.log(`   Deleted ${testSessions.changes} test portal sessions`);

  console.log(`\n✅ Cleanup complete! Deleted ${deletedCount} test records`);
  
  // Vacuum database to reclaim space
  console.log('🗜️  Vacuuming database...');
  db.exec('VACUUM');
  console.log('✅ Database optimized');

} catch (error) {
  console.error('❌ Error cleaning test data:', error.message);
  process.exit(1);
} finally {
  db.close();
}

