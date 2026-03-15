const assert = require('assert');

const {
  insertRcmAiDecision,
  getEmpiRecord,
  mapEdiToFhirEOB
} = require('../middleware-platform/services/rcm-service');

/**
 * TEST SUITE: FHIR-Native Financial Intelligence Layer
 * Scenario: Process a mock 835 Remittance, link to EMPI,
 *           and log a "Claims Specialist" denial analysis.
 */
async function testFinancialIntelligenceFlow() {
  console.log('🚀 Starting RCM Intelligence Layer Test...');

  // 1. Mock Input: Raw EDI 835 Data Fragment
  const mockEdi835 = {
    claimId: 'CLAIM-12345',
    patientName: 'John Doe',
    dob: '1985-05-12',
    paidAmount: 0,
    adjustmentReason: 'CO-16', // Claim lacks information
    remark: 'Missing NPI on line item 1'
  };

  try {
    // 2. EMPI Lookup (Identity Glue)
    // Ensures we aren't just processing a "string," but a longitudinal patient.
    const empiRecord = await getEmpiRecord({
      name: mockEdi835.patientName,
      dob: mockEdi835.dob
    });
    assert(empiRecord.empi_id, '❌ EMPI ID must be resolved for RCM processing');
    console.log(`✅ Resolved EMPI ID: ${empiRecord.empi_id}`);

    // 3. EDI -> FHIR Mapping (The Core Normalization)
    const fhirEOB = await mapEdiToFhirEOB(mockEdi835, empiRecord.empi_id);

    assert.strictEqual(fhirEOB.resourceType, 'ExplanationOfBenefit');
    assert.strictEqual(fhirEOB.patient.reference, `Patient/${empiRecord.empi_id}`);
    console.log('✅ Successfully mapped EDI to FHIR ExplanationOfBenefit (EOB)');

    // 4. AI Agent Processing & Audit Logging
    // Simulate the "Claims Specialist" analyzing the denial
    const aiAnalysis = {
      agent_type: 'claims_specialist',
      operation: 'denial_classification',
      empi_id: empiRecord.empi_id,
      input_snapshot: fhirEOB,
      output_snapshot: {
        category: 'Administrative Denial',
        action: 'Request provider NPI update',
        priority: 'High'
      },
      explanation:
        "Matched CO-16 reason code with remark text 'Missing NPI'. Automatic resubmission suggested.",
      confidence: 0.98,
      requires_human_review: false
    };

    const decisionRecord = await insertRcmAiDecision(aiAnalysis);

    assert(decisionRecord && decisionRecord.id, '❌ Failed to log decision to ai_decisions_rcm');
    console.log(`✅ Audit Log Created: Decision ID ${decisionRecord.id}`);

    console.log('\n✨ TEST PASSED: Financial Intelligence Layer is operational.');
    process.exit(0);
  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    process.exit(1);
  }
}

testFinancialIntelligenceFlow();

