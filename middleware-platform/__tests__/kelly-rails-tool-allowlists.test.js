'use strict';

const { ALLOWLISTS, getAllowedToolNames } = require('../services/kelly-rails/tool-allowlists');

function allSteps(lane) {
  return Object.keys(ALLOWLISTS[lane] || {});
}

describe('kelly-rails tool allowlists — positive', () => {
  test('payment pay_invoice includes request_patient_payment', () => {
    expect(getAllowedToolNames('payment', 'pay_invoice')).toContain('request_patient_payment');
  });

  test('booking confirm_visit includes schedule_appointment', () => {
    expect(getAllowedToolNames('booking', 'confirm_visit')).toContain('schedule_appointment');
  });
});

describe('kelly-rails tool allowlists — negative contract', () => {
  const forbiddenInEducation = ['schedule_appointment', 'request_patient_payment'];
  const forbiddenInPayment = ['schedule_appointment', 'evaluate_skincare_routine'];
  const forbiddenInClinicalBooking = ['evaluate_skincare_routine'];

  for (const step of allSteps('education')) {
    test(`education/${step} must not expose scheduling or pay tools`, () => {
      const allowed = getAllowedToolNames('education', step);
      for (const name of forbiddenInEducation) {
        expect(allowed).not.toContain(name);
      }
    });
  }

  for (const step of allSteps('payment')) {
    test(`payment/${step} must not expose schedule_appointment or skincare tools`, () => {
      const allowed = getAllowedToolNames('payment', step);
      for (const name of forbiddenInPayment) {
        expect(allowed).not.toContain(name);
      }
    });
  }

  for (const lane of ['clinical', 'booking']) {
    for (const step of allSteps(lane)) {
      test(`${lane}/${step} must not expose evaluate_skincare_routine`, () => {
        const allowed = getAllowedToolNames(lane, step);
        for (const name of forbiddenInClinicalBooking) {
          expect(allowed).not.toContain(name);
        }
      });
    }
  }

  for (const step of allSteps('clinical')) {
    test(`clinical/${step} must not expose request_patient_payment before payment lane`, () => {
      expect(getAllowedToolNames('clinical', step)).not.toContain('request_patient_payment');
    });
  }

  for (const step of allSteps('booking')) {
    test(`booking/${step} must not expose request_patient_payment`, () => {
      expect(getAllowedToolNames('booking', step)).not.toContain('request_patient_payment');
    });
  }

  test('support handoff is read-only triage session', () => {
    expect(getAllowedToolNames('support', 'handoff')).toEqual(['get_triage_session']);
  });
});
