'use strict';

const request = require('supertest');
const express = require('express');

const mockPatient = {
  resource_id: 'patient-a',
  merchant_id: 'merchant-a',
  resource_data: { resourceType: 'Patient', id: 'patient-a', name: [{ given: ['A'], family: 'Test' }] }
};

jest.mock('../services/fhir-service', () => ({}));
jest.mock('../services/email-service', () => ({}));
jest.mock('../utils/stripe-config', () => ({ initializeStripe: () => null }));

jest.mock('../database', () => ({
  resolveFHIRPatient: jest.fn(() => mockPatient),
  logHipaaAccess: jest.fn(),
  getFHIRPatientEncounters: jest.fn(() => []),
  getAppointmentsByPatientIds: jest.fn(() => []),
  getClaimsByPatient: jest.fn(() => []),
  getEligibilityChecksByPatient: jest.fn(() => []),
  getPatientDocuments: jest.fn(() => []),
  getInvoicePayments: jest.fn(() => []),
  getWalletTransactionsByPatientId: jest.fn(() => []),
  getCardTransactionsByPatientId: jest.fn(() => []),
  db: {
    prepare: () => ({
      all: () => [],
      get: () => undefined,
      run: () => ({})
    })
  }
}));

jest.mock('../middleware/customer-auth', () => ({
  requireCustomerAuth: (req, res, next) => {
    if (!req._testCustomer) return res.status(401).json({ success: false, error: 'auth' });
    req.customer = req._testCustomer;
    req.merchant_id = req._testCustomer.merchant_id;
    next();
  }
}));

function buildApp(customer) {
  const app = express();
  app.use((req, res, next) => {
    req._testCustomer = customer;
    next();
  });
  app.use(require('../routes/case-report'));
  return app;
}

describe('case-report merchant scoping', () => {
  beforeEach(() => {
    mockPatient.merchant_id = 'merchant-a';
    const db = require('../database');
    db.resolveFHIRPatient.mockImplementation(() => mockPatient);
  });

  test('allows read when merchant matches', async () => {
    const app = buildApp({ id: 'cust-1', merchant_id: 'merchant-a' });
    const res = await request(app).get('/api/patient/patient-a/case-report');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('denies read when merchant mismatches', async () => {
    const app = buildApp({ id: 'cust-1', merchant_id: 'merchant-b' });
    const res = await request(app).get('/api/patient/patient-a/case-report');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  test('denies read when patient has no merchant_id', async () => {
    mockPatient.merchant_id = null;
    const app = buildApp({ id: 'cust-1', merchant_id: 'merchant-a' });
    const res = await request(app).get('/api/patient/patient-a/case-report');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});
