/**
 * Test Stedi Patient Sync
 * 
 * Tests that patients are automatically synced from Stedi eligibility checks
 * when the patient list is empty.
 */

require('dotenv').config();
const FHIRService = require('../services/fhir-service');
const db = require('../database');

async function testStediPatientSync() {
  console.log('\n🧪 TESTING STEDI PATIENT SYNC');
  console.log('━'.repeat(60));
  console.log('');

  try {
    // Step 1: Check current patient count
    console.log('📊 Step 1: Checking current patient count...');
    const initialPatients = db.searchFHIRPatients({});
    console.log(`   Found ${initialPatients.length} patients in database`);

    // Step 2: Check eligibility_checks count
    console.log('\n📋 Step 2: Checking eligibility_checks...');
    const eligibilityChecks = db.prepare(`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN patient_id IS NULL THEN 1 END) as orphaned
      FROM eligibility_checks
    `).get();
    console.log(`   Total eligibility checks: ${eligibilityChecks.total}`);
    console.log(`   Orphaned (no patient_id): ${eligibilityChecks.orphaned}`);

    // Step 3: Test manual sync
    console.log('\n🔄 Step 3: Testing manual sync from Stedi...');
    const syncResult = await FHIRService.syncPatientsFromStedi();
    console.log(`   ✅ Created ${syncResult.created} new patients`);
    console.log(`   ✅ Linked ${syncResult.linked} eligibility checks`);

    // Step 4: Check patient count after sync
    console.log('\n📊 Step 4: Checking patient count after sync...');
    const patientsAfterSync = db.searchFHIRPatients({});
    console.log(`   Found ${patientsAfterSync.length} patients in database`);
    console.log(`   Net increase: ${patientsAfterSync.length - initialPatients.length}`);

    // Step 5: Test automatic sync via searchPatients
    console.log('\n🔍 Step 5: Testing automatic sync via searchPatients...');
    const patients = await FHIRService.searchPatients({});
    console.log(`   Found ${patients.length} patients via searchPatients`);

    // Step 6: Display sample patients
    if (patients.length > 0) {
      console.log('\n👥 Sample patients:');
      patients.slice(0, 5).forEach((patient, index) => {
        const name = patient.name?.[0];
        const displayName = name 
          ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim()
          : 'Unknown';
        console.log(`   ${index + 1}. ${displayName} (ID: ${patient.id || patient.resource_id})`);
      });
    }

    console.log('\n' + '━'.repeat(60));
    console.log('✅ TEST COMPLETE');
    console.log('━'.repeat(60));
    console.log('');

    if (patients.length > 0) {
      console.log('✅ SUCCESS: Patients are now available for claim creation!');
    } else {
      console.log('⚠️  WARNING: No patients found. Make sure you have eligibility_checks in the database.');
    }

    return {
      success: true,
      initialCount: initialPatients.length,
      finalCount: patientsAfterSync.length,
      created: syncResult.created,
      linked: syncResult.linked
    };

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    console.error(error.stack);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run test if called directly
if (require.main === module) {
  testStediPatientSync()
    .then(result => {
      if (result.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = { testStediPatientSync };

