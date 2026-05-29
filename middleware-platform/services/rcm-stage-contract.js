'use strict';

const RCM_STAGE_CONTRACT = [
  {
    id: 'pre_registration',
    label: 'Pre-registration',
    owner: 'agent',
    required_inputs: ['patient_contact', 'visit_reason'],
    success_criteria: 'intake captured and patient intent confirmed',
    fallback: 'manual front desk intake and journey start',
    primary_cta: { label: 'Open intake queue', href: 'today.html' },
    secondary_cta: { label: 'Open schedule', href: 'calendar.html' },
  },
  {
    id: 'registration',
    label: 'Registration',
    owner: 'shared',
    required_inputs: ['demographics_verified', 'insurance_member_id'],
    success_criteria: 'registration profile verified and complete',
    fallback: 'manual registration checklist in patient profile',
    primary_cta: { label: 'Open patients', href: 'patients.html' },
    secondary_cta: { label: 'Open eligibility', href: 'billing.html?section=claims' },
  },
  {
    id: 'charge_capture',
    label: 'Charge Capture',
    owner: 'human_system',
    required_inputs: ['visit_notes', 'procedure_context'],
    success_criteria: 'claim draft created from encounter data',
    fallback: 'manual claim draft from report/PDF',
    primary_cta: { label: 'Create claim', href: 'billing.html?section=claims' },
    secondary_cta: { label: 'Review coding', href: 'claims.html' },
  },
  {
    id: 'prior_authorization',
    label: 'Prior Authorization',
    owner: 'agent_shared',
    required_inputs: ['payer', 'procedure', 'medical_necessity_context'],
    success_criteria: 'PA approved or documented not-required decision',
    fallback: 'manual submission and follow-up workflow',
    primary_cta: { label: 'Open prior auth', href: 'billing.html?section=prior-auth' },
    secondary_cta: { label: 'Review blockers', href: 'claims.html' },
  },
  {
    id: 'medical_coding',
    label: 'Medical Coding',
    owner: 'human',
    required_inputs: ['diagnosis_codes', 'procedure_codes'],
    success_criteria: 'coder-reviewed code set linked to claim',
    fallback: 'manual coding review queue',
    primary_cta: { label: 'Open claims workspace', href: 'billing.html?section=claims' },
    secondary_cta: { label: 'Open exceptions', href: 'claims.html' },
  },
  {
    id: 'cdi',
    label: 'Clinical Documentation Integrity',
    owner: 'shared',
    required_inputs: ['documentation_completeness', 'coding_support'],
    success_criteria: 'documentation gaps resolved before submission',
    fallback: 'manual CDI review and provider attestation',
    primary_cta: { label: 'Open CDI exceptions', href: 'claims.html' },
    secondary_cta: { label: 'Open patient case', href: 'patient-case.html' },
  },
  {
    id: 'claim_submission',
    label: 'Claim Submission',
    owner: 'system',
    required_inputs: ['approved_claim_payload'],
    success_criteria: 'claim accepted for adjudication',
    fallback: 'manual submission with status polling',
    primary_cta: { label: 'Submit/track claim', href: 'billing.html?section=claims' },
    secondary_cta: { label: 'View claim ledger', href: 'claims.html' },
  },
  {
    id: 'remittance_processing',
    label: 'Remittance Processing',
    owner: 'system_shared',
    required_inputs: ['era_or_eob_payload'],
    success_criteria: 'remittance posted and variance reconciled',
    fallback: 'manual remittance posting and reconciliation',
    primary_cta: { label: 'Open remittance view', href: 'claims.html' },
    secondary_cta: { label: 'Open invoices', href: 'billing.html?section=invoices' },
  },
  {
    id: 'follow_up_phone',
    label: 'Follow up (Phone)',
    owner: 'agent',
    required_inputs: ['follow_up_reason', 'contact_target'],
    success_criteria: 'follow-up attempt logged with next action',
    fallback: 'manual outbound call workflow',
    primary_cta: { label: 'Open voice agent', href: 'agent.html' },
    secondary_cta: { label: 'Open schedule', href: 'calendar.html' },
  },
  {
    id: 'patient_collection',
    label: 'Patient Collection',
    owner: 'agent_shared',
    required_inputs: ['patient_balance', 'collection_strategy'],
    success_criteria: 'payment plan or payment outcome recorded',
    fallback: 'manual collections and payment reminders',
    primary_cta: { label: 'Open patient payments', href: 'patient-payments.html' },
    secondary_cta: { label: 'Open invoices', href: 'billing.html?section=invoices' },
  },
  {
    id: 'bill',
    label: 'Bill',
    owner: 'system',
    required_inputs: ['final_balance'],
    success_criteria: 'final statement issued and tracked',
    fallback: 'manual invoice generation and delivery',
    primary_cta: { label: 'Open invoices', href: 'billing.html?section=invoices' },
    secondary_cta: { label: 'Open claims workspace', href: 'billing.html?section=claims' },
  },
];

const STAGE_ORDER = RCM_STAGE_CONTRACT.map((s) => s.id);

function normalizeStageId(value) {
  if (!value) return 'pre_registration';
  const raw = String(value).trim().toLowerCase();
  if (raw === 'intake' || raw === 'pre-reg' || raw === 'pre_registration') return 'pre_registration';
  if (raw === 'registration') return 'registration';
  if (raw === 'charge_capture' || raw === 'charge-capture') return 'charge_capture';
  if (raw === 'prior_authorization' || raw === 'prior-auth' || raw === 'prior auth') return 'prior_authorization';
  if (raw === 'medical_coding' || raw === 'coding') return 'medical_coding';
  if (raw === 'cdi') return 'cdi';
  if (raw === 'claim_submission' || raw === 'claims') return 'claim_submission';
  if (raw === 'remittance_processing' || raw === 'remittance') return 'remittance_processing';
  if (raw === 'follow_up_phone' || raw === 'followup' || raw === 'follow-up') return 'follow_up_phone';
  if (raw === 'patient_collection' || raw === 'collections') return 'patient_collection';
  if (raw === 'bill' || raw === 'billing') return 'bill';
  return raw;
}

function isValidStageId(stageId) {
  return STAGE_ORDER.includes(normalizeStageId(stageId));
}

function stageContractMap() {
  return new Map(RCM_STAGE_CONTRACT.map((stage) => [stage.id, stage]));
}

function resolveIntegrationState(stageId) {
  const norm = normalizeStageId(stageId);
  if (norm === 'prior_authorization') return 'manual_required';
  if (norm === 'claim_submission' || norm === 'remittance_processing') {
    return process.env.STEDI_MODE === 'simulated' ? 'simulated' : 'live';
  }
  return 'manual_required';
}

function actionStateLabel(stageId) {
  const state = resolveIntegrationState(stageId);
  if (state === 'live') return 'Live rail';
  if (state === 'simulated') return 'Simulated rail';
  return 'Manual required';
}

module.exports = {
  RCM_STAGE_CONTRACT,
  STAGE_ORDER,
  normalizeStageId,
  isValidStageId,
  stageContractMap,
  resolveIntegrationState,
  actionStateLabel,
};
