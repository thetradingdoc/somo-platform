'use strict';

const USE_CASES = new Set([
  'receptionist',
  'appointment_setter',
  'lead_qualification',
  'customer_service',
  'debt_collection',
  'survey',
  'dental_front_desk',
  'medical_clinic',
  'specialty_practice',
  'bilingual_front_desk',
  'after_hours',
  'patient_billing'
]);

const USE_CASE_LABELS = {
  receptionist: 'Receptionist',
  appointment_setter: 'Appointment Setter',
  lead_qualification: 'Lead Qualification',
  customer_service: 'Customer Service',
  debt_collection: 'Debt Collection',
  survey: 'Survey',
  dental_front_desk: 'Dental Front Desk',
  medical_clinic: 'Medical Clinic',
  specialty_practice: 'Specialty Practice',
  bilingual_front_desk: 'Bilingual Front Desk',
  after_hours: 'After-hours Coverage',
  patient_billing: 'Patient Billing'
};

const USE_CASE_OPENERS = {
  receptionist: 'You are calling as a friendly medical office receptionist for Somo demo demo purposes.',
  appointment_setter: 'You are calling to schedule an appointment as a Somo demo appointment setter demo.',
  lead_qualification: 'You are qualifying a lead for a Somo demo sales demo call.',
  customer_service: 'You are providing helpful customer service on this Somo demo demo call.',
  debt_collection: 'You are conducting a polite, compliant collections-style Somo demo demo (fictional balance).',
  survey: 'You are running a short customer satisfaction survey for this Somo demo demo.',
  dental_front_desk:
    'You are calling as a friendly dental office front desk for this Somo demo — scheduling, insurance FAQs, and new patient intake.',
  medical_clinic:
    'You are calling as a medical clinic front desk for this Somo demo — appointments, prescription refills, and call routing.',
  specialty_practice:
    'You are calling as a specialty practice front desk for this Somo demo — referrals, prior auth handoff, and specialist scheduling.',
  bilingual_front_desk:
    'You are calling as a bilingual medical front desk for this Somo demo — greet in English or Spanish based on the caller.',
  after_hours:
    'You are calling as an after-hours medical line for this Somo demo — nights and weekends without voicemail.',
  patient_billing:
    'You are calling as a patient billing representative for this Somo demo — balances, payment plans, and statements.'
};

function getUseCaseContext(useCase) {
  return {
    use_case_label: USE_CASE_LABELS[useCase] || useCase,
    use_case_opener: USE_CASE_OPENERS[useCase] || USE_CASE_OPENERS.receptionist
  };
}

module.exports = {
  USE_CASES,
  USE_CASE_LABELS,
  USE_CASE_OPENERS,
  getUseCaseContext
};
