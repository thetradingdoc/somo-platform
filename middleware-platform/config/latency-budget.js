/**
 * Latency Budget Constants (Section 3)
 *
 * Per-stage timeouts. Tool handlers exceeding budget are logged.
 */

const DEFAULT_MS = parseInt(process.env.LATENCY_BUDGET_DEFAULT_MS || '5000', 10);

const BUDGET_BY_FUNCTION = {
  suggest_codes_from_symptoms: 3000,
  validate_code_pair: 1500,
  check_payer_guidelines: 2000,
  extract_medical_text: 1500,
  assess_urgency: 1000,
  search_icd10_codes: 1500,
  search_cpt_codes: 1500,
  search_hcpcs_codes: 1500,
  get_code_pricing: 2000,
  collect_insurance: 3000,
  schedule_appointment: 5000,
  send_document_upload_link: 6000
};

let violations = 0;

function getBudget(functionName) {
  return BUDGET_BY_FUNCTION[functionName] ?? DEFAULT_MS;
}

function recordViolation() {
  violations++;
}

function getViolationCount() {
  return violations;
}

module.exports = {
  CODING_MS: parseInt(process.env.LATENCY_BUDGET_CODING_MS || '3000', 10),
  VALIDATION_MS: parseInt(process.env.LATENCY_BUDGET_VALIDATION_MS || '1500', 10),
  TRIAGE_MS: parseInt(process.env.LATENCY_BUDGET_TRIAGE_MS || '2000', 10),
  DEFAULT_MS,
  getBudget,
  recordViolation,
  getViolationCount,
  BUDGET_BY_FUNCTION
};
