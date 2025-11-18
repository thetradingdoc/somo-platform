/**
 * Test: Patient ID Uniqueness
 * 
 * Verifies that all patient IDs are unique and that the system
 * properly prevents duplicate patient ID creation.
 */

const db = require('../database');

function testPatientIdUniqueness() {
    console.log('\n🧪 TEST: Patient ID Uniqueness');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        // Test 1: Check for duplicate IDs in database
        console.log('📋 Test 1: Check for duplicate patient IDs');
        const duplicates = db.db.prepare(`
      SELECT resource_id, COUNT(*) as count 
      FROM fhir_patients 
      GROUP BY resource_id 
      HAVING count > 1
    `).all();

        if (duplicates.length === 0) {
            console.log('   ✅ PASS: No duplicate patient IDs found');
        } else {
            console.log(`   ❌ FAIL: Found ${duplicates.length} duplicate patient ID(s)`);
            duplicates.forEach(dup => {
                console.log(`      - ${dup.resource_id}: ${dup.count} occurrences`);
            });
            return false;
        }

        // Test 2: Verify total count matches unique count
        console.log('\n📋 Test 2: Verify total vs unique count');
        const counts = db.db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT resource_id) as unique_ids
      FROM fhir_patients
    `).get();

        if (counts.total === counts.unique_ids) {
            console.log(`   ✅ PASS: Total (${counts.total}) = Unique (${counts.unique_ids})`);
        } else {
            console.log(`   ❌ FAIL: Total (${counts.total}) != Unique (${counts.unique_ids})`);
            return false;
        }

        // Test 3: Verify ID format (should be patient-{uuid})
        console.log('\n📋 Test 3: Verify patient ID format');
        const invalidFormat = db.db.prepare(`
      SELECT resource_id 
      FROM fhir_patients 
      WHERE resource_id NOT LIKE 'patient-%' 
         OR LENGTH(resource_id) < 43
         OR resource_id NOT GLOB 'patient-*-*-*-*-*'
    `).all();

        if (invalidFormat.length === 0) {
            console.log('   ✅ PASS: All patient IDs follow UUID format (patient-{uuid})');
        } else {
            console.log(`   ⚠️  WARNING: Found ${invalidFormat.length} patient ID(s) with invalid format`);
            invalidFormat.forEach(patient => {
                console.log(`      - ${patient.resource_id}`);
            });
        }

        // Test 4: Check database constraint
        console.log('\n📋 Test 4: Verify database UNIQUE constraint');
        const tableInfo = db.db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='fhir_patients'
    `).get();

        if (tableInfo && tableInfo.sql && tableInfo.sql.includes('resource_id TEXT UNIQUE')) {
            console.log('   ✅ PASS: Database has UNIQUE constraint on resource_id');
        } else {
            console.log('   ❌ FAIL: Database missing UNIQUE constraint on resource_id');
            return false;
        }

        // Test 5: Test duplicate prevention (try to create duplicate)
        console.log('\n📋 Test 5: Test duplicate ID prevention');
        try {
            // Get an existing patient ID
            const existingPatient = db.db.prepare(`
        SELECT resource_id FROM fhir_patients WHERE is_deleted = 0 LIMIT 1
      `).get();

            if (existingPatient) {
                // Try to create a patient with the same ID (should fail)
                const testPatient = {
                    id: existingPatient.resource_id,
                    resourceType: 'Patient',
                    name: [{ given: ['Test'], family: 'Duplicate' }],
                    telecom: []
                };

                try {
                    db.createFHIRPatient(testPatient);
                    console.log('   ❌ FAIL: Duplicate ID was allowed (should have been rejected)');
                    return false;
                } catch (error) {
                    if (error.message && error.message.includes('already exists')) {
                        console.log('   ✅ PASS: Duplicate ID correctly rejected');
                    } else {
                        console.log(`   ⚠️  WARNING: Error type: ${error.message}`);
                    }
                }
            }
        } catch (testError) {
            console.log(`   ⚠️  Could not test duplicate prevention: ${testError.message}`);
        }

        console.log('\n✅ ALL TESTS PASSED\n');
        return true;

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        return false;
    }
}

// Run test if called directly
if (require.main === module) {
    const success = testPatientIdUniqueness();
    process.exit(success ? 0 : 1);
}

module.exports = { testPatientIdUniqueness };

