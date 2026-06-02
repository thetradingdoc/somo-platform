'use strict';

const {
  KELLY_BRANCH,
  routeIntakeSwitch
} = require('../services/kelly-conversation-graph');

describe('kelly-conversation-graph routeIntakeSwitch', () => {
  test('rash + derm booking routes to clinical_intake when not routine intake', () => {
    const branch = routeIntakeSwitch({
      last_user_message:
        'I have an itchy rash on my arm for about a week. I would like dermatology help.',
      flags: { routine_intake_active: false }
    });
    expect(branch).toBe(KELLY_BRANCH.CLINICAL_INTAKE);
  });

  test('pelvic pain + gynecology routes to clinical_intake', () => {
    const branch = routeIntakeSwitch({
      last_user_message: 'I have irregular periods and pelvic pain. I need gynecology.',
      flags: { routine_intake_active: false }
    });
    expect(branch).toBe(KELLY_BRANCH.CLINICAL_INTAKE);
  });

  test('pay copay now routes to payment_line', () => {
    const branch = routeIntakeSwitch({
      last_user_message: 'I would like to pay my copay now. Please send me a secure payment link.',
      flags: {}
    });
    expect(branch).toBe(KELLY_BRANCH.PAYMENT_LINE);
  });

  test('skincare-only with routine_intake_active routes to skincare_education', () => {
    const branch = routeIntakeSwitch({
      last_user_message: 'What moisturizer should I use for dry skin?',
      flags: { routine_intake_active: true }
    });
    expect(branch).toBe(KELLY_BRANCH.SKINCARE_EDUCATION);
  });

  test('reschedule intent routes to clinical_intake', () => {
    const branch = routeIntakeSwitch({
      last_user_message: 'I need to reschedule my appointment for next week please',
      flags: {}
    });
    expect(branch).toBe(KELLY_BRANCH.CLINICAL_INTAKE);
  });

  test('generic receipt question routes to support not payment_line', () => {
    const branch = routeIntakeSwitch({
      last_user_message: 'I need a receipt for my last appointment',
      flags: {}
    });
    expect(branch).toBe(KELLY_BRANCH.SUPPORT);
  });
});
