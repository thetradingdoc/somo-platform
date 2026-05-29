'use strict';

const USE_CASES = new Set([
  'receptionist',
  'appointment_setter',
  'lead_qualification',
  'customer_service',
  'debt_collection',
  'survey'
]);

const USE_CASE_LABELS = {
  receptionist: 'Receptionist',
  appointment_setter: 'Appointment Setter',
  lead_qualification: 'Lead Qualification',
  customer_service: 'Customer Service',
  debt_collection: 'Debt Collection',
  survey: 'Survey'
};

const USE_CASE_OPENERS = {
  receptionist: 'You are calling as a friendly medical office receptionist for DodgeCall demo purposes.',
  appointment_setter: 'You are calling to schedule an appointment as a DodgeCall appointment setter demo.',
  lead_qualification: 'You are qualifying a lead for a DodgeCall sales demo call.',
  customer_service: 'You are providing helpful customer service on this DodgeCall demo call.',
  debt_collection: 'You are conducting a polite, compliant collections-style DodgeCall demo (fictional balance).',
  survey: 'You are running a short customer satisfaction survey for this DodgeCall demo.'
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
