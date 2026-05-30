'use strict';

const express = require('express');
const request = require('supertest');

const mockCustomer = {
  id: 'cust-toggle-1',
  merchant_id: 'merchant-1',
  email: 'toggle@test.com',
  email_verified: 1,
  kelly_status: 'active',
  retell_agent_status: 'active',
  retell_agent_id: 'agent-1',
  twilio_phone_number: '+15551234567',
  provisioning_state: 'ready'
};

const mockSettings = {
  retell_agent_id: 'agent-1',
  enabled: 1,
  greeting: 'Hi there',
  after_hours_message: 'Closed',
  business_hours: { mon: '09:00-17:00' }
};

let updatedCustomer = null;
let upsertPayload = null;

jest.mock('../database', () => ({
  getCustomer: jest.fn((id) => (id === mockCustomer.id ? { ...mockCustomer, ...updatedCustomer } : null)),
  updateCustomer: jest.fn((id, patch) => {
    updatedCustomer = { ...updatedCustomer, ...patch };
    return { ...mockCustomer, ...updatedCustomer };
  }),
  getVoiceAgentSettingsForProvider: jest.fn(() => ({ ...mockSettings })),
  upsertVoiceAgentSettings: jest.fn((merchantId, payload) => {
    upsertPayload = { merchantId, payload };
  })
}));

jest.mock('../middleware/customer-auth', () => ({
  requireCustomerAuth: (req, res, next) => {
    req.customer = { ...mockCustomer, ...updatedCustomer };
    next();
  }
}));

describe('PATCH /api/kelly/toggle', () => {
  let app;

  beforeAll(() => {
    updatedCustomer = null;
    upsertPayload = null;
    const kellyRoutes = require('../routes/kelly');
    app = express();
    app.use(express.json());
    app.use('/api/kelly', kellyRoutes);
  });

  beforeEach(() => {
    updatedCustomer = null;
    upsertPayload = null;
    mockCustomer.kelly_status = 'active';
    mockCustomer.retell_agent_status = 'active';
    jest.clearAllMocks();
  });

  test('pauses Kelly and syncs voice_agent_settings.enabled=false', async () => {
    const res = await request(app)
      .patch('/api/kelly/toggle')
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('paused');
    expect(updatedCustomer.kelly_status).toBe('paused');
    expect(upsertPayload).toBeTruthy();
    expect(upsertPayload.payload.enabled).toBe(false);
  });

  test('activates Kelly and syncs voice_agent_settings.enabled=true', async () => {
    mockCustomer.kelly_status = 'paused';
    updatedCustomer = { kelly_status: 'paused', retell_agent_status: 'paused' };

    const res = await request(app)
      .patch('/api/kelly/toggle')
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('active');
    expect(updatedCustomer.kelly_status).toBe('active');
    expect(upsertPayload.payload.enabled).toBe(true);
  });
});
