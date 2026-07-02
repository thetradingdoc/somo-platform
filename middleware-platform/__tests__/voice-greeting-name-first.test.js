'use strict';

jest.mock('axios');
const axios = require('axios');
const RetellWebSocketHandler = require('../webhooks/retell-websocket');

function fakeWs() {
  return { readyState: 1, send: () => {} };
}

function baseConnection(overrides = {}) {
  return {
    callId: 'call-test',
    ws: fakeWs(),
    direction: 'inbound',
    sentInitialGreeting: false,
    conversationHistory: [],
    _isNavigationConnection: false,
    ...overrides
  };
}

describe('name-first greeting (sendInitialGreeting awaitingName)', () => {
  function makeHandler() {
    const db = {
      insertKellyCallEvent: () => {},
      getVoiceAgentSettingsForProvider: () => null
    };
    return new RetellWebSocketHandler(db, { apiBaseUrl: 'http://localhost:4000' });
  }

  test('inbound greeting sets awaitingName = true', () => {
    const handler = makeHandler();
    const callId = 'call-inbound-1';
    const connection = baseConnection({
      callId,
      _lastOpenerBundle: {
        activeOpener: {
          text: "Hi, I'm Kelly, the front desk at Bright Path Clinic. Thank you for calling. Can I start with your name?",
          direction: 'inbound',
          source: 'default',
          asksName: true
        }
      }
    });
    handler.activeConnections.set(callId, connection);

    handler.sendInitialGreeting(callId, connection, {}, 1);

    expect(connection.awaitingName).toBe(true);
    expect(connection.sentInitialGreeting).toBe(true);
  });

  test('inbound opener that does NOT ask for a name (asksName=false) does not await name', () => {
    const handler = makeHandler();
    const callId = 'call-intentfirst-1';
    const connection = baseConnection({
      callId,
      _lastOpenerBundle: {
        activeOpener: {
          // A custom tenant greeting that jumps straight to intent.
          text: 'Welcome to Bright Path Clinic. How can I help you today?',
          direction: 'inbound',
          source: 'tenant_setting',
          asksName: false
        }
      }
    });
    handler.activeConnections.set(callId, connection);

    handler.sendInitialGreeting(callId, connection, {}, 1);

    expect(connection.awaitingName).toBe(false);
    expect(connection.sentInitialGreeting).toBe(true);
  });

  test('after-hours greeting does NOT await name', () => {
    const handler = makeHandler();
    const callId = 'call-ah-1';
    const connection = baseConnection({
      callId,
      _lastOpenerBundle: {
        activeOpener: {
          text: 'Thanks for calling. Our office is currently closed.',
          direction: 'inbound',
          source: 'after_hours'
        }
      }
    });
    handler.activeConnections.set(callId, connection);

    handler.sendInitialGreeting(callId, connection, {}, 1);

    expect(connection.awaitingName).toBe(false);
  });

  test('known caller name is not re-requested', () => {
    const handler = makeHandler();
    const callId = 'call-known-1';
    const connection = baseConnection({
      callId,
      customerName: 'Jane Doe',
      _lastOpenerBundle: {
        activeOpener: {
          text: "Hi, I'm Kelly, the front desk at Bright Path Clinic. Can I start with your name?",
          direction: 'inbound',
          source: 'default',
          asksName: true
        }
      }
    });
    handler.activeConnections.set(callId, connection);

    handler.sendInitialGreeting(callId, connection, {}, 1);

    expect(connection.awaitingName).toBe(false);
  });
});

describe('extractLikelyName rejects intents/commands but keeps real names', () => {
  function makeHandler() {
    return new RetellWebSocketHandler(
      { insertKellyCallEvent: () => {}, getVoiceAgentSettingsForProvider: () => null },
      { apiBaseUrl: 'http://localhost:4000' }
    );
  }

  test.each([
    'Book appointment',
    'Need a refill',
    'Cancel my appointment',
    'refill',
    'appointment',
    'I want to book an appointment',
    'insurance question'
  ])('rejects intent: %s', (utterance) => {
    expect(makeHandler().extractLikelyName(utterance)).toBeNull();
  });

  test.each([
    ['My name is John Smith', 'John Smith'],
    ['this is Maria', 'Maria'],
    ['Bill', 'Bill'],
    ['Will', 'Will'],
    ['Mary Jane', 'Mary Jane'],
    ['John', 'John']
  ])('accepts name: %s', (utterance, expected) => {
    expect(makeHandler().extractLikelyName(utterance)).toBe(expected);
  });
});

describe('voice schedule_appointment emits provider activity-feed event', () => {
  afterEach(() => jest.clearAllMocks());

  test('successful booking emits appointment_booked kelly_call_event', async () => {
    const events = [];
    const db = {
      insertKellyCallEvent: (e) => events.push(e)
    };
    const handler = new RetellWebSocketHandler(db, { apiBaseUrl: 'http://localhost:4000' });
    const callId = 'call-book-1';
    handler.activeConnections.set(
      callId,
      baseConnection({
        callId,
        clinic_id: 'clinic-test',
        customer_id: 'cust-test',
        customerName: 'Jane Doe'
      })
    );

    axios.post.mockResolvedValue({
      data: {
        success: true,
        appointment: {
          id: 'appt-123',
          confirmation_number: 'CONF-1',
          patient_id: 'pat-1',
          appointment_type: 'Therapy Session'
        }
      }
    });

    const res = await handler.handleScheduleAppointment(callId, {
      patient_name: 'Jane Doe',
      patient_email: 'jane@example.com',
      patient_phone: '+15551234567',
      appointment_type: 'Therapy Session',
      date: '2026-07-01',
      time: '10:00',
      provider_override_emergency: true
    });

    expect(res.success).toBe(true);
    const booked = events.find((e) => e.event_type === 'appointment_booked');
    expect(booked).toBeTruthy();
    expect(booked.clinic_id).toBe('clinic-test');
    expect(booked.session_id).toBe(callId);
    expect(booked.payload_json.tool_name).toBe('schedule_appointment');
    expect(booked.payload_json.appointment_id).toBe('appt-123');
    expect(booked.payload_json.patient_name).toBe('Jane Doe');
  });
});
