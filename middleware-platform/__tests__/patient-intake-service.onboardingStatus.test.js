const {
  canonicalFromPatientResource,
  onboardingStatusFromCanonical
} = require('../services/patient-intake-service');

describe('PatientIntakeService onboarding status', () => {
  test('reports missing required fields', () => {
    const status = onboardingStatusFromCanonical({
      first_name: '',
      last_name: '',
      dob: '',
      phone: '',
      email: 'a@example.com',
      country: '',
      city: '',
      city_place_id: ''
    });
    expect(status.onboarding_complete).toBe(false);
    expect(status.missing_fields).toEqual(['first_name', 'last_name', 'dob', 'phone', 'country', 'city']);
  });

  test('complete when all required fields present', () => {
    const status = onboardingStatusFromCanonical({
      first_name: 'A',
      last_name: 'B',
      dob: '1990-01-01',
      phone: '+15555551212',
      email: 'a@example.com',
      country: 'United States',
      city: 'Austin',
      city_place_id: ''
    });
    expect(status.onboarding_complete).toBe(true);
    expect(status.missing_fields).toEqual([]);
  });

  test('canonicalFromPatientResource extracts fields from FHIR Patient', () => {
    const canonical = canonicalFromPatientResource({
      resourceType: 'Patient',
      id: 'p1',
      name: [{ given: ['Jane'], family: 'Doe' }],
      birthDate: '1985-05-01',
      telecom: [
        { system: 'email', value: 'jane@example.com' },
        { system: 'phone', value: '+15550001111' }
      ],
      address: [{ city: 'Toronto', country: 'Canada' }]
    });
    expect(canonical.first_name).toBe('Jane');
    expect(canonical.last_name).toBe('Doe');
    expect(canonical.dob).toBe('1985-05-01');
    expect(canonical.email).toBe('jane@example.com');
    expect(canonical.phone).toBe('+15550001111');
    expect(canonical.city).toBe('Toronto');
    expect(canonical.country).toBe('Canada');
  });
});

