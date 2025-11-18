/**
 * UHC FHIR API Test Script
 * Tests pulling all available data from UHC FHIR sandbox
 * 
 * Usage:
 *   node tests/test-uhc-fhir.js
 * 
 * Environment Variables Required:
 *   UHC_CLIENT_ID - OAuth client ID from UHC
 *   UHC_CLIENT_SECRET - OAuth client secret from UHC
 *   UHC_FHIR_SANDBOX - Sandbox endpoint (optional, has default)
 */

const UHCFHIRService = require('../services/uhc-fhir-service');

async function testUHCFHIR() {
  console.log('\n🧪 UHC FHIR API TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check if credentials are configured
  if (!process.env.UHC_CLIENT_ID || !process.env.UHC_CLIENT_SECRET) {
    console.log('⚠️  WARNING: UHC OAuth credentials not configured');
    console.log('   Set UHC_CLIENT_ID and UHC_CLIENT_SECRET environment variables');
    console.log('   Some tests will fail without credentials, but we can still test public endpoints\n');
  }

  const results = {
    connectionTest: null,
    providerDirectory: null,
    patientClinical: null,
    coverage: null,
    claims: null,
    priorAuth: null,
    allData: null
  };

  // Test 1: Connection Test (Public Metadata)
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 1: Connection Test (Public Metadata)');
  console.log('═══════════════════════════════════════════════════════════');
  results.connectionTest = await UHCFHIRService.testConnection(true);
  console.log('Result:', results.connectionTest.success ? '✅ PASS' : '❌ FAIL');
  if (results.connectionTest.error) {
    console.log('Error:', results.connectionTest.error);
  }
  console.log('');

  // Test 2: Provider Directory (No patient ID needed)
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 2: Provider Directory');
  console.log('═══════════════════════════════════════════════════════════');
  results.providerDirectory = await UHCFHIRService.pullProviderDirectory({
    useSandbox: true,
    zipCode: '10001', // New York zip code for testing
    limit: 10
  });
  console.log('Result:', results.providerDirectory.success ? '✅ PASS' : '⚠️  PARTIAL/FAIL');
  if (results.providerDirectory.data) {
    console.log('   Organizations:', results.providerDirectory.data.organizations.length);
    console.log('   Practitioners:', results.providerDirectory.data.practitioners.length);
    console.log('   Locations:', results.providerDirectory.data.locations.length);
    console.log('   PractitionerRoles:', results.providerDirectory.data.practitionerRoles.length);
  }
  if (results.providerDirectory.errors && results.providerDirectory.errors.length > 0) {
    console.log('   Errors:', results.providerDirectory.errors.length);
    results.providerDirectory.errors.forEach(err => console.log('     -', err));
  }
  console.log('');

  // Test 3: Patient Clinical Data (Requires patient ID)
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 3: Patient Clinical Data');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('⚠️  NOTE: This requires a valid patient ID from UHC sandbox');
  console.log('   Using test patient ID: "test-patient-001" (may not exist)\n');
  
  const testPatientId = process.env.UHC_TEST_PATIENT_ID || 'test-patient-001';
  results.patientClinical = await UHCFHIRService.pullPatientClinicalData(testPatientId, {
    useSandbox: true
  });
  console.log('Result:', results.patientClinical.success ? '✅ PASS' : '⚠️  PARTIAL/FAIL');
  if (results.patientClinical.data) {
    const cd = results.patientClinical.data;
    console.log('   Conditions:', cd.conditions.length);
    console.log('   Medications:', cd.medications.length);
    console.log('   Allergies:', cd.allergies.length);
    console.log('   Immunizations:', cd.immunizations.length);
    console.log('   Observations:', cd.observations.length);
    console.log('   Procedures:', cd.procedures.length);
    console.log('   Care Plans:', cd.carePlans.length);
  }
  if (results.patientClinical.errors && results.patientClinical.errors.length > 0) {
    console.log('   Errors:', results.patientClinical.errors.length);
    results.patientClinical.errors.forEach(err => console.log('     -', err));
  }
  console.log('');

  // Test 4: Coverage Data
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 4: Coverage Data');
  console.log('═══════════════════════════════════════════════════════════');
  results.coverage = await UHCFHIRService.pullCoverageData(testPatientId, {
    useSandbox: true
  });
  console.log('Result:', results.coverage.success ? '✅ PASS' : '⚠️  PARTIAL/FAIL');
  if (results.coverage.data) {
    console.log('   Coverage Records:', results.coverage.data.coverage.length);
    console.log('   Eligibility Responses:', results.coverage.data.eligibilityResponses.length);
  }
  if (results.coverage.errors && results.coverage.errors.length > 0) {
    console.log('   Errors:', results.coverage.errors.length);
    results.coverage.errors.forEach(err => console.log('     -', err));
  }
  console.log('');

  // Test 5: Claims & EOB Data
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 5: Claims & EOB Data');
  console.log('═══════════════════════════════════════════════════════════');
  results.claims = await UHCFHIRService.pullClaimsData(testPatientId, {
    useSandbox: true
  });
  console.log('Result:', results.claims.success ? '✅ PASS' : '⚠️  PARTIAL/FAIL');
  if (results.claims.data) {
    console.log('   Claims:', results.claims.data.claims.length);
    console.log('   Claim Responses:', results.claims.data.claimResponses.length);
    console.log('   EOBs:', results.claims.data.eobs.length);
  }
  if (results.claims.errors && results.claims.errors.length > 0) {
    console.log('   Errors:', results.claims.errors.length);
    results.claims.errors.forEach(err => console.log('     -', err));
  }
  console.log('');

  // Test 6: Prior Authorization Data
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 6: Prior Authorization Data');
  console.log('═══════════════════════════════════════════════════════════');
  results.priorAuth = await UHCFHIRService.pullPriorAuthData(testPatientId, {
    useSandbox: true
  });
  console.log('Result:', results.priorAuth.success ? '✅ PASS' : '⚠️  PARTIAL/FAIL');
  if (results.priorAuth.data) {
    console.log('   Service Requests:', results.priorAuth.data.serviceRequests.length);
    console.log('   Tasks:', results.priorAuth.data.tasks.length);
  }
  if (results.priorAuth.errors && results.priorAuth.errors.length > 0) {
    console.log('   Errors:', results.priorAuth.errors.length);
    results.priorAuth.errors.forEach(err => console.log('     -', err));
  }
  console.log('');

  // Test 7: Pull ALL Data
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TEST 7: Pull ALL Patient Data (Comprehensive)');
  console.log('═══════════════════════════════════════════════════════════');
  results.allData = await UHCFHIRService.pullAllPatientData(testPatientId, {
    useSandbox: true
  });
  console.log('Result:', results.allData.success ? '✅ PASS' : '⚠️  PARTIAL/FAIL');
  if (results.allData.summary) {
    console.log('   Total Resources:', results.allData.summary.totalResources);
    console.log('   Total Errors:', results.allData.summary.errors.length);
  }
  console.log('');

  // Final Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Connection Test:', results.connectionTest.success ? '✅' : '❌');
  console.log('Provider Directory:', results.providerDirectory.success ? '✅' : '❌');
  console.log('Patient Clinical:', results.patientClinical.success ? '✅' : '❌');
  console.log('Coverage:', results.coverage.success ? '✅' : '❌');
  console.log('Claims:', results.claims.success ? '✅' : '❌');
  console.log('Prior Auth:', results.priorAuth.success ? '✅' : '❌');
  console.log('All Data Pull:', results.allData.success ? '✅' : '❌');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Return results for programmatic use
  return results;
}

// Run tests if called directly
if (require.main === module) {
  testUHCFHIR()
    .then(results => {
      console.log('✅ Test suite completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { testUHCFHIR };




