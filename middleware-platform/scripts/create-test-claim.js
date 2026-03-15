/**
 * Create Test Claim Script
 * Creates a test claim for testing instant settlement
 * 
 * Usage: node scripts/create-test-claim.js [claimId]
 */

const db = require('../database');

const claimId = process.argv[2] || 'CLAIM-12345';

// Check if claim already exists
const existing = db.getClaimById(claimId);
if (existing) {
  console.log(`⚠️  Claim ${claimId} already exists:`);
  console.log(`   Status: ${existing.status}`);
  console.log(`   Payment Status: ${existing.payment_status}`);
  console.log(`   Total Amount: $${existing.total_amount}`);
  console.log(`   Insurance Amount: $${existing.insurance_amount || 0}`);
  process.exit(0);
}

// Get a test patient (or create minimal data)
let patientId = null;
const patients = db.db.prepare('SELECT resource_id FROM fhir_patients LIMIT 1').get();
if (patients) {
  patientId = patients.resource_id;
}

// Get a test payer (or use default)
let payerId = 'AETNA';
const payers = db.db.prepare('SELECT payer_id FROM insurance_payers LIMIT 1').get();
if (payers) {
  payerId = payers.payer_id;
}

// Create test claim
const testClaim = {
  id: claimId,
  appointment_id: null,
  patient_id: patientId,
  member_id: 'TEST-MEMBER-12345',
  payer_id: payerId,
  service_code: '90837', // CPT code for psychotherapy
  diagnosis_code: 'F41.1', // ICD-10 for generalized anxiety
  total_amount: 200.00,
  copay_amount: 40.00,
  insurance_amount: 160.00,
  status: 'submitted', // Will be changed to 'approved' by simulate-stedi-approval
  payment_status: 'pending',
  submitted_at: new Date().toISOString(),
  response_data: JSON.stringify({
    claimId: claimId,
    status: 'submitted',
    totalAmount: 200.00,
    copayAmount: 40.00,
    insuranceAmount: 160.00
  })
};

try {
  db.createInsuranceClaim(testClaim);
  console.log(`✅ Test claim created: ${claimId}`);
  console.log(`   Patient ID: ${patientId || 'N/A'}`);
  console.log(`   Payer ID: ${payerId}`);
  console.log(`   Total Amount: $${testClaim.total_amount}`);
  console.log(`   Insurance Amount: $${testClaim.insurance_amount}`);
  console.log(`   Status: ${testClaim.status}`);
  console.log(`\n📋 Next step: Test instant settlement with:`);
  console.log(`   curl -X POST "http://localhost:4000/api/test/simulate-stedi-approval" \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"claimId":"${claimId}"}'`);
} catch (error) {
  console.error(`❌ Failed to create test claim: ${error.message}`);
  process.exit(1);
}
