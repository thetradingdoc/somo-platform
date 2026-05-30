'use strict';

const express = require('express');
const request = require('supertest');

describe('POST /voice/appointments/schedule', () => {
  test('returns 400 without clinic_id and does not 500 on safeLogRequestBody', async () => {
    const { registerVoiceAppointmentRoutes } = require('../routes/voice-appointments');
    const { safeLogRequestBody } = require('../services/payment-security');
    const noop = (req, res, next) => (typeof next === 'function' ? next() : undefined);

    const app = express();
    app.use(express.json());
    registerVoiceAppointmentRoutes(app, {
      apiLimiter: noop,
      express,
      db: {
        getClinicById: async () => null
      },
      scheduleCheckoutLimiter: noop,
      voiceLimiter: noop,
      withIdempotency: () => noop,
      resolveClinicIdFromRequest: () => null,
      FALLBACK_CLINIC_ID: 'clinic-test',
      ensureSlotBundles: (x) => x,
      safeLogRequestBody
    });

    const res = await request(app)
      .post('/voice/appointments/schedule')
      .send({ patient_name: 'Test Patient', patient_email: 't@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error || '')).toMatch(/clinic_id/i);
    expect(JSON.stringify(res.body)).not.toMatch(/safeLogRequestBody is not defined/i);
    expect(JSON.stringify(res.body)).not.toMatch(/requireVoiceSessionIdForTriageParity is not defined/i);
  });
});
