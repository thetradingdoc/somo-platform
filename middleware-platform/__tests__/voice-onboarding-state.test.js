'use strict';

const {
  getOnboardingState,
  deriveStateFromLegacy,
  resolveOnboardingDestination,
  transitionState,
  ONBOARDING_STATES
} = require('../services/voice-onboarding-state');

describe('voice-onboarding-state', () => {
  const db = {
    customers: {},
    getCustomer(id) {
      return this.customers[id] || null;
    },
    updateCustomer(id, patch) {
      this.customers[id] = { ...this.customers[id], ...patch, id };
      return this.customers[id];
    }
  };

  beforeEach(() => {
    db.customers = {
      c1: {
        id: 'c1',
        email_verified: 1,
        trial_status: 'active',
        twilio_phone_number: '+15551234567',
        voice_setup_completed_at: null
      }
    };
  });

  test('deriveStateFromLegacy maps trial without setup to voice_setup_incomplete', () => {
    expect(deriveStateFromLegacy(db.customers.c1)).toBe('voice_setup_incomplete');
  });

  test('transitionState updates customer onboarding_state', () => {
    transitionState(db, 'c1', 'terms_accepted');
    expect(db.getCustomer('c1').onboarding_state).toBe('terms_accepted');
    expect(ONBOARDING_STATES).toContain('terms_accepted');
  });

  test('resolveOnboardingDestination sends incomplete setup to wizard', () => {
    db.customers.c1.onboarding_state = 'voice_setup_incomplete';
    db.customers.c1.onboarding_meta_json = JSON.stringify({ wizard_step: 2 });
    const dest = resolveOnboardingDestination(db.customers.c1);
    expect(dest.path).toContain('voice-setup.html');
    expect(dest.wizard_step).toBe(2);
  });

  test('resolveOnboardingDestination sends complete tenants to agent', () => {
    db.customers.c1.onboarding_state = 'live';
    const dest = resolveOnboardingDestination(db.customers.c1);
    expect(dest.path).toBe('/business/agent.html');
  });
});
