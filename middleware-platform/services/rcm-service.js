/**
 * RCM (Revenue Cycle Management) Financial Intelligence Layer - Service
 *
 * Phase 0.5: glue for tests and early agents:
 * - EMPI lookup / creation
 * - EDI → FHIR ExplanationOfBenefit (minimal mapping)
 * - RCM AI decision auditing (ai_decisions_rcm)
 */

const db = require('../database');

/**
 * Resolve or create an EMPI record for a patient.
 * For now, this is a simple stub that always creates a new EMPI person.
 * In a full implementation, this would:
 *  - search existing empi_links (by FHIR Patient, billing id, etc.)
 *  - run probabilistic matching on name/DOB
 */
async function getEmpiRecord({ name, dob }) {
  // Phase 0.5: always create a new EMPI person; ignore name/dob for now
  const empiPerson = db.createEmpiPerson(null);
  return { empi_id: empiPerson.id, primary_patient_id: empiPerson.primary_patient_id || null };
}

/**
 * Minimal EDI 835 → FHIR ExplanationOfBenefit mapping stub.
 * Uses the mapping guidelines from FHIR_NATIVE_RCM_MAPPING.md.
 *
 * @param {Object} edi835 - Parsed EDI 835 fragment
 * @param {string} empiId - EMPI person id
 * @returns {Promise<Object>} FHIR ExplanationOfBenefit resource
 */
async function mapEdiToFhirEOB(edi835, empiId) {
  const claimId = edi835.claimId || edi835.claim_id || 'UNKNOWN';
  const reasonCode = edi835.adjustmentReason || null;
  const remark = edi835.remark || null;

  return {
    resourceType: 'ExplanationOfBenefit',
    status: 'active',
    type: {
      coding: [
        { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional', display: 'Professional' }
      ]
    },
    patient: {
      // For now we use EMPI id as the Patient id placeholder; in a full implementation this would be a real FHIR Patient id
      reference: `Patient/${empiId}`,
      display: edi835.patientName || undefined
    },
    identifier: [
      { system: 'urn:example:claim-id', value: claimId }
    ],
    payment: {
      amount: {
        value: typeof edi835.paidAmount === 'number' ? edi835.paidAmount : 0,
        currency: 'USD'
      }
    },
    outcome: 'error',
    // Represent denial/adjustment information in a simple, structured way
    item: [
      {
        sequence: 1,
        adjudication: [
          reasonCode
            ? {
                category: {
                  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/adjudication', code: 'denial' }]
                },
                reason: {
                  coding: [{ system: 'http://example.org/edi/reason-code', code: reasonCode }],
                  text: remark || undefined
                }
              }
            : {
                category: {
                  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/adjudication', code: 'denial' }]
                },
                reason: remark ? { text: remark } : undefined
              }
        ]
      }
    ]
  };
}

/**
 * Insert an RCM AI decision via the DB helper. Returns an object with id.
 * @param {Object} payload
 * @returns {Promise<{id: string|null}>}
 */
async function insertRcmAiDecision(payload) {
  const id = db.insertRcmAiDecision(payload || {});
  return { id };
}

module.exports = {
  getEmpiRecord,
  mapEdiToFhirEOB,
  insertRcmAiDecision
};

