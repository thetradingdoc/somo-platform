'use strict';

/**
 * small_business admin-path PSTN scenarios (Phase 7.3).
 */

const SMALL_BUSINESS_PSTN_SCENARIOS = [
  {
    id: 'SB-001',
    title: 'Book a consultation',
    use_case: 'small_business',
    locale: 'en-US',
    intent: 'booking',
    utterances: ['I would like to book a consultation for next week.'],
    expectedTools: ['schedule_appointment'],
    assertions: ['BOOKING_OFFER'],
    live_only: true
  },
  {
    id: 'SB-002',
    title: 'Cancel appointment',
    use_case: 'small_business',
    locale: 'en-US',
    intent: 'cancel',
    utterances: ['Please cancel my appointment.', 'Yes, cancel it.'],
    expectedTools: ['cancel_appointment'],
    assertions: ['CANCEL_CONFIRMED'],
    live_only: true
  },
  {
    id: 'SB-003',
    title: 'Reschedule',
    use_case: 'small_business',
    locale: 'en-US',
    intent: 'reschedule',
    utterances: ['Can I reschedule to Thursday at 2pm?'],
    expectedTools: ['reschedule_appointment'],
    assertions: ['RESCHEDULE_OFFER'],
    live_only: true
  },
  {
    id: 'SB-004',
    title: 'General inquiry — hours',
    use_case: 'small_business',
    locale: 'en-US',
    intent: 'inquiry',
    utterances: ['What are your business hours today?'],
    expectedTools: [],
    assertions: ['HOURS_RESPONSE'],
    live_only: true
  }
];

module.exports = { SMALL_BUSINESS_PSTN_SCENARIOS };
