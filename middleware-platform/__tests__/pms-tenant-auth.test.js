'use strict';

jest.mock('../middleware/customer-auth', () => ({
  requireCustomerAuth: (req, res, next) => {
    if (!req._testCustomer) {
      return res.status(401).json({ success: false, error: 'auth' });
    }
    req.customer = req._testCustomer;
    next();
  }
}));

jest.mock('../services/tenant-voice-config', () => ({
  resolveClinicForCustomer: jest.fn()
}));

const { resolveClinicForCustomer } = require('../services/tenant-voice-config');
const { requireCustomerPmsAuth, requireAgentPmsAuth } = require('../middleware/pms-tenant-auth');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    headersSent: false
  };
  return res;
}

describe('pms-tenant-auth', () => {
  beforeEach(() => {
    resolveClinicForCustomer.mockReset();
    delete process.env.INTERNAL_JOB_TOKEN;
  });

  test('rejects clinic_id mismatch for tenant', () => {
    resolveClinicForCustomer.mockReturnValue({ clinic_id: 'clinic-a' });
    const req = {
      _testCustomer: { id: 'cust-1' },
      query: { clinic_id: 'clinic-b' }
    };
    const res = mockRes();
    const next = jest.fn();

    requireCustomerPmsAuth(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('clinic_mismatch');
    expect(next).not.toHaveBeenCalled();
  });

  test('attaches pmsClinicId when clinic matches', () => {
    resolveClinicForCustomer.mockReturnValue({ clinic_id: 'clinic-a', name: 'Test' });
    const req = {
      _testCustomer: { id: 'cust-1' },
      query: { clinic_id: 'clinic-a' }
    };
    const res = mockRes();
    const next = jest.fn();

    requireCustomerPmsAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.pmsClinicId).toBe('clinic-a');
    expect(req.pmsClinic.name).toBe('Test');
  });

  test('internal job token bypasses customer auth', () => {
    process.env.INTERNAL_JOB_TOKEN = 'test-token';
    const req = {
      headers: { 'x-internal-job-token': 'test-token' },
      query: { clinic_id: 'clinic-x' }
    };
    const res = mockRes();
    const next = jest.fn();

    requireAgentPmsAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.pmsClinicId).toBe('clinic-x');
  });
});
