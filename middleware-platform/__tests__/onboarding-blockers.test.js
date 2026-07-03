'use strict';

const {
  resolveOnboardingBlockers,
  isGoogleCalendarConnected
} = require('../services/onboarding-blockers-service');
const { parseMeta } = require('../services/voice-onboarding-state');

describe('onboarding-blockers-service', () => {
  const db = {
    db: {
      prepare(sql) {
        const self = this;
        return {
          get(...args) {
            if (sql.includes('COUNT(*)') && sql.includes('voice_call_log')) {
              return { c: self._callCount || 0 };
            }
            return null;
          }
        };
      },
      _callCount: 0
    },
    getVoiceAgentSettingsForProvider() {
      return { enabled: 0, greeting: 'Hello', business_hours: JSON.stringify({ mon: ['09:00', '17:00'] }) };
    },
    getUserCalendarSettingsByEmail(email) {
      if (email === 'google@example.com') {
        return { google_calendar_connected: 1, google_refresh_token: 'tok' };
      }
      return null;
    }
  };

  test('flags missing dedicated line', () => {
    const customer = { id: 'c1', email: 'a@b.com', merchant_id: 'm1' };
    const { blockers } = resolveOnboardingBlockers(db, customer);
    expect(blockers).toContain('missing_dedicated_line');
  });

  test('checklist includes voice-setup item', () => {
    const customer = {
      id: 'c1',
      email: 'a@b.com',
      merchant_id: 'm1',
      twilio_phone_number: '+15551234567',
      voice_setup_completed_at: null
    };
    const { checklist } = resolveOnboardingBlockers(db, customer);
    expect(checklist.some((c) => c.id === 'voice-setup')).toBe(true);
  });

  test('spoofed calendar_connection google without OAuth still blocks calendar', () => {
    const customer = {
      id: 'c1',
      email: 'fake@b.com',
      merchant_id: 'm1',
      twilio_phone_number: '+15551234567',
      onboarding_meta_json: JSON.stringify({ calendar_connection: 'google' })
    };
    const meta = parseMeta(customer);
    expect(isGoogleCalendarConnected(db, customer.email)).toBe(false);
    const { checklist } = resolveOnboardingBlockers(db, customer);
    const cal = checklist.find((c) => c.id === 'calendar');
    expect(cal?.done).toBe(false);
    expect(meta.calendar_connection).toBe('google');
  });

  test('forward_line_ack meta alone without calls does not clear forward-line blocker', () => {
    db.db._callCount = 0;
    const customer = {
      id: 'c1',
      email: 'a@b.com',
      merchant_id: 'm1',
      twilio_phone_number: '+15551234567',
      onboarding_meta_json: JSON.stringify({ forward_line_ack: true })
    };
    const { blockers, checklist } = resolveOnboardingBlockers(db, customer);
    expect(blockers).toContain('forward_line_pending');
    const fwd = checklist.find((c) => c.id === 'forward-line');
    expect(fwd?.done).toBe(false);
  });

  test('hasCalls clears forward-line blocker', () => {
    db.db._callCount = 1;
    const customer = {
      id: 'c1',
      email: 'a@b.com',
      merchant_id: 'm1',
      twilio_phone_number: '+15551234567',
      onboarding_meta_json: JSON.stringify({ forward_line_ack: true })
    };
    const { blockers, checklist } = resolveOnboardingBlockers(db, customer);
    expect(blockers).not.toContain('forward_line_pending');
    const fwd = checklist.find((c) => c.id === 'forward-line');
    expect(fwd?.done).toBe(true);
    db.db._callCount = 0;
  });
});
