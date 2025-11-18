/**
 * Test: Patient Selection Fix for Duplicate Records
 * 
 * This test verifies that when multiple patients have the same member_id,
 * the system correctly selects the patient with the most claims and billing history.
 * 
 * Test Scenario:
 * - Two patients with same name and member_id
 * - One patient has 4 claims ($4,200 billed)
 * - One patient has 1 claim ($0 billed)
 * - System should select patient with 4 claims
 */

const axios = require('axios');
const db = require('../database');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';
const MEMBER_ID = 'CIGNA901234';
const PATIENT_NAME = 'Emily Davis';

async function testPatientSelection() {
  console.log('\n🧪 TEST: Patient Selection Fix');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Member ID: ${MEMBER_ID}`);
  console.log(`   Patient Name: ${PATIENT_NAME}\n`);

  try {
    // Test 1: Query by member_id
    console.log('📋 Test 1: Query by member_id');
    const response = await axios.get(`${API_BASE}/api/patient/benefits`, {
      params: {
        memberId: MEMBER_ID,
        patientName: PATIENT_NAME
      }
    });

    if (response.data.success) {
      const patient = response.data.patient;
      const stats = response.data.stats;
      const eligibility = response.data.eligibility;

      console.log(`   ✅ Patient ID: ${patient.id}`);
      console.log(`   ✅ Patient Name: ${patient.name}`);
      console.log(`   ✅ Phone: ${patient.phone || 'N/A'}`);
      console.log(`   ✅ Claims: ${stats.total_claims}`);
      console.log(`   ✅ Total Billed: $${stats.total_bills}`);
      console.log(`   ✅ Deductible: $${eligibility.deductible_total || 'N/A'} / $${eligibility.deductible_remaining || 'N/A'}`);

      // Verify correct patient is returned
      const expectedPatientId = 'patient-cbbf4d35-e90b-42a5-a058-338f00e6e35f';
      if (patient.id === expectedPatientId) {
        console.log('   ✅ CORRECT: Selected patient with most claims');
      } else {
        console.log(`   ❌ WRONG: Expected ${expectedPatientId}, got ${patient.id}`);
        return false;
      }

      // Verify patient has phone number (more reliable identity)
      if (patient.phone) {
        console.log('   ✅ CORRECT: Patient has phone number');
      } else {
        console.log('   ⚠️  WARNING: Patient does not have phone number');
      }

      // Verify claims count
      if (stats.total_claims >= 4) {
        console.log('   ✅ CORRECT: Patient has multiple claims');
      } else {
        console.log(`   ❌ WRONG: Expected at least 4 claims, got ${stats.total_claims}`);
        return false;
      }

      // Verify billing amount
      if (stats.total_bills >= 4000) {
        console.log('   ✅ CORRECT: Patient has substantial billing history');
      } else {
        console.log(`   ❌ WRONG: Expected at least $4,000 billed, got $${stats.total_bills}`);
        return false;
      }

    } else {
      console.log(`   ❌ ERROR: ${response.data.error}`);
      return false;
    }

    // Test 2: Verify duplicate patient is soft deleted
    console.log('\n📋 Test 2: Verify duplicate patient is soft deleted');
    const duplicatePatient = db.db.prepare(`
      SELECT resource_id, name, phone, is_deleted FROM fhir_patients
      WHERE resource_id = 'patient-7a69438d-ad83-491d-8fb9-b52e5c3a6cee'
    `).get();

    if (duplicatePatient && duplicatePatient.is_deleted === 1) {
      console.log('   ✅ CORRECT: Duplicate patient is soft deleted');
    } else {
      console.log('   ⚠️  WARNING: Duplicate patient is not deleted');
    }

    // Test 3: Verify all data is linked to correct patient
    console.log('\n📋 Test 3: Verify data integrity');
    const correctPatientClaims = db.db.prepare(`
      SELECT COUNT(*) as count FROM insurance_claims
      WHERE patient_id = 'patient-cbbf4d35-e90b-42a5-a058-338f00e6e35f' AND member_id = ?
    `).get(MEMBER_ID);

    const correctPatientEligibility = db.db.prepare(`
      SELECT COUNT(*) as count FROM eligibility_checks
      WHERE patient_id = 'patient-cbbf4d35-e90b-42a5-a058-338f00e6e35f' AND member_id = ?
    `).get(MEMBER_ID);

    console.log(`   ✅ Claims linked to correct patient: ${correctPatientClaims.count}`);
    console.log(`   ✅ Eligibility records linked to correct patient: ${correctPatientEligibility.count}`);

    // Test 4: Verify no duplicate patients with same member_id (active)
    console.log('\n📋 Test 4: Verify no duplicate active patients');
    const duplicateCount = db.db.prepare(`
      SELECT COUNT(DISTINCT p.resource_id) as count
      FROM fhir_patients p
      INNER JOIN patient_insurance i ON p.resource_id = i.patient_id
      WHERE i.member_id = ? AND p.is_deleted = 0
    `).get(MEMBER_ID);

    if (duplicateCount.count <= 1) {
      console.log(`   ✅ CORRECT: Only ${duplicateCount.count} active patient(s) with member_id ${MEMBER_ID}`);
    } else {
      console.log(`   ❌ WRONG: Found ${duplicateCount.count} active patients with same member_id`);
      return false;
    }

    console.log('\n✅ ALL TESTS PASSED\n');
    return true;

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
    return false;
  }
}

// Run test if called directly
if (require.main === module) {
  testPatientSelection()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test error:', error);
      process.exit(1);
    });
}

module.exports = { testPatientSelection };

