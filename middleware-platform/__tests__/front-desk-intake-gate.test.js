'use strict';

const IntakeRequiredFields = require('../services/intake-required-fields');
const {
  storeFrontDeskFields,
  frontDeskIntakeComplete,
  promptForField
} = require('../services/front-desk-intake');

jest.mock('../services/kelly-tool-executor', () => {
  const store = {};
  return {
    _getSessionMeta: (sid, key) => store[`${sid}:${key}`] || null,
    _setSessionMeta: (sid, key, val) => {
      store[`${sid}:${key}`] = val;
    }
  };
});

describe('front-desk intake gate', () => {
  const sid = 'sess-fd-1';

  test('front_desk pathway schema includes five fields', () => {
    const schema = IntakeRequiredFields.getRequiredFieldsSchema();
    expect(schema.front_desk.minimum_required).toEqual([
      'full_name',
      'date_of_birth',
      'phone',
      'patient_status',
      'reason_for_visit'
    ]);
  });

  test('storeFrontDeskFields marks complete when all fields present', () => {
    storeFrontDeskFields(sid, {
      full_name: 'Jane Doe',
      date_of_birth: '01/15/1990',
      phone: '5551234567',
      patient_status: 'new',
      reason_for_visit: 'cleaning'
    });
    expect(frontDeskIntakeComplete(sid)).toBe(true);
  });

  test('localized prompts exist for zh', () => {
    expect(promptForField('full_name', 'zh')).toMatch(/全名/);
  });
});
