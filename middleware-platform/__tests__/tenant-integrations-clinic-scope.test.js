'use strict';

jest.mock('../middleware/customer-auth', () => ({
  requireCustomerAuth: (req, res, next) => {
    if (!req._testCustomer) return res.status(401).json({ success: false, error: 'auth' });
    req.customer = req._testCustomer;
    next();
  }
}));

jest.mock('../services/tenant-voice-config', () => ({
  resolveClinicForCustomer: jest.fn()
}));

jest.mock('../services/integrations-status-service', () => ({
  resolveIntegrationsStatus: jest.fn(() => ({ pms: { status: 'DISCONNECTED' } })),
  listPmsSyncErrors: jest.fn(() => [])
}));

const express = require('express');
const request = require('supertest');
const { resolveClinicForCustomer } = require('../services/tenant-voice-config');
const { resolveIntegrationsStatus } = require('../services/integrations-status-service');

function buildApp(customer) {
  const app = express();
  app.use((req, res, next) => {
    req._testCustomer = customer;
    next();
  });
  app.use('/api/tenant/integrations', require('../routes/tenant-integrations'));
  return app;
}

describe('tenant-integrations clinic scoping', () => {
  beforeEach(() => {
    resolveClinicForCustomer.mockReset();
    resolveIntegrationsStatus.mockClear();
  });

  test('returns status for customer linked clinic', async () => {
    resolveClinicForCustomer.mockReturnValue({ clinic_id: 'clinic-a', name: 'Clinic A' });
    const app = buildApp({ id: 'cust-a', email: 'a@test.com' });
    const res = await request(app).get('/api/tenant/integrations/status?clinic_id=clinic-a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(resolveClinicForCustomer).toHaveBeenCalledWith(expect.anything(), 'cust-a', 'clinic-a');
    expect(resolveIntegrationsStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: 'cust-a', clinicId: 'clinic-a' })
    );
  });

  test('does not expose clinic B status when customer is linked only to clinic A', async () => {
    resolveClinicForCustomer.mockReturnValue({ clinic_id: 'clinic-a', name: 'Clinic A' });
    const app = buildApp({ id: 'cust-a', email: 'a@test.com' });
    const res = await request(app).get('/api/tenant/integrations/status?clinic_id=clinic-b');
    expect(res.status).toBe(200);
    expect(resolveIntegrationsStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: 'cust-a', clinicId: 'clinic-a' })
    );
    expect(resolveIntegrationsStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clinicId: 'clinic-b' })
    );
  });

  test('requires authentication', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/tenant/integrations/status');
    expect(res.status).toBe(401);
  });
});
