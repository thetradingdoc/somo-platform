'use strict';

const db = require('../database');
const TwilioPhoneService = require('../services/twilio-phone-service');
const {
  TrialProvisionError,
  startTrialTenant,
  canStartTrial,
  syncTwilioProvisionFlags
} = require('../services/trial-lifecycle');

describe('trial-lifecycle provision', () => {
  const customerId = `cust_provision_${Date.now()}`;
  const testPhone = '+12025558877';
  let provisionMock;

  beforeAll(() => {
    process.env.TRIAL_SIM_FLOW_ENABLED = '1';
    process.env.TRIAL_SIM_LAUNCH_AT = '2020-01-01T00:00:00Z';
    db.createCustomer({
      id: customerId,
      name: 'Provision Test',
      email: `provision-${Date.now()}@example.com`,
      phone_number: testPhone,
      status: 'active',
      email_verified: 1
    });
    db.updateCustomer(customerId, {
      customer_type: 'saas',
      phone_verified: 1,
      phone_verified_at: new Date().toISOString()
    });
  });

  beforeEach(() => {
    jest.spyOn(TwilioPhoneService.prototype, 'isAvailable').mockReturnValue(true);
    provisionMock = jest
      .spyOn(TwilioPhoneService.prototype, 'provisionPhoneNumberForCustomer')
      .mockResolvedValue({
        phoneNumber: '+12025550199',
        sid: 'PN_test_provision_sid',
        searchStrategy: 'trial_default_area_code'
      });
    db.updateCustomer(customerId, {
      trial_status: 'none',
      twilio_phone_number: null,
      twilio_phone_sid: null,
      trial_started_at: null,
      trial_expires_at: null
    });
  });

  afterEach(() => {
    provisionMock.mockRestore();
    jest.restoreAllMocks();
  });

  test('startTrialTenant activates only after Twilio success', async () => {
    const result = await startTrialTenant(db, customerId, {
      phoneE164: testPhone,
      phoneVerifiedAt: new Date().toISOString()
    });
    expect(result.success).toBe(true);
    expect(result.twilio_phone_number).toBe('+12025550199');
    const c = db.getCustomer(customerId);
    expect(c.trial_status).toBe('active');
    expect(c.twilio_phone_sid).toBe('PN_test_provision_sid');
    expect(provisionMock).toHaveBeenCalled();
  });

  test('startTrialTenant throws when Twilio fails (no active trial)', async () => {
    provisionMock.mockRejectedValue(new Error('No available phone numbers found'));

    await expect(
      startTrialTenant(db, customerId, {
        phoneE164: testPhone,
        phoneVerifiedAt: new Date().toISOString()
      })
    ).rejects.toBeInstanceOf(TrialProvisionError);

    const c = db.getCustomer(customerId);
    expect(c.trial_status).not.toBe('active');
    expect(c.twilio_phone_number).toBeFalsy();
  });

  test('canStartTrial allows retry when active without number (legacy partial)', () => {
    const legacyId = `cust_legacy_partial_${Date.now()}`;
    db.createCustomer({
      id: legacyId,
      name: 'Legacy Partial',
      email: `legacy-partial-${Date.now()}@example.com`,
      phone_number: '+12025558878',
      status: 'active',
      email_verified: 1
    });
    db.updateCustomer(legacyId, {
      customer_type: 'saas',
      trial_status: 'active',
      twilio_phone_number: null
    });
    const gate = canStartTrial(db, legacyId, '+12025558878');
    expect(gate.allowed).toBe(true);
  });
});

describe('syncTwilioProvisionFlags', () => {
  test('clears twilio_provisioned when DID columns are missing', () => {
    const provision = { twilio_provisioned: true, twilio_search_strategy: 'nationwide' };
    syncTwilioProvisionFlags(provision, {
      twilio_phone_number: null,
      twilio_phone_sid: null
    });
    expect(provision.twilio_provisioned).toBe(false);
    expect(provision.twilio_provision_error).toBeTruthy();
  });

  test('sets twilio_provisioned when DID columns are present', () => {
    const provision = {};
    syncTwilioProvisionFlags(provision, {
      twilio_phone_number: '+12025550199',
      twilio_phone_sid: 'PN_test'
    });
    expect(provision.twilio_provisioned).toBe(true);
    expect(provision.twilio_provision_error).toBeUndefined();
  });
});

describe('twilio-phone-service area code helpers', () => {
  const { normalizeUsAreaCode, isValidUsAreaCode } = require('../services/twilio-phone-service');

  test('rejects 555 test line area code', () => {
    expect(normalizeUsAreaCode('+15555551234')).toBeNull();
    expect(isValidUsAreaCode('555')).toBe(false);
  });

  test('accepts valid US area code', () => {
    expect(normalizeUsAreaCode('+12025551234')).toBe('202');
    expect(isValidUsAreaCode('202')).toBe(true);
  });
});
