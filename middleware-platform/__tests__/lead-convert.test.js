'use strict';

jest.mock('../services/saas-tenant-provision', () => ({
  provisionSaasTenant: jest.fn(() => ({
    clinicId: 'clinic_convert_mock',
    merchantId: 'merch_convert_mock'
  }))
}));

const db = require('../database');
const { provisionSaasTenant } = require('../services/saas-tenant-provision');
const { convertLeadToCustomer } = require('../services/lead-convert-service');

describe('lead-convert-service', () => {
  const leadId = `lead_convert_${Date.now()}`;
  const email = `convert-${Date.now()}@example.com`;

  beforeAll(() => {
    db.db
      ?.prepare(
        `INSERT INTO leads (id, title, clinic_name, clinic_email, pipeline_stage, status)
         VALUES (?, ?, ?, ?, 'qualified', 'new')`
      )
      .run(leadId, 'Convert Test Lead', 'Convert Dental', email);
  });

  test('throws when lead not found', async () => {
    await expect(convertLeadToCustomer('missing_lead_xyz')).rejects.toMatchObject({
      code: 'lead_not_found'
    });
  });

  test('one-step convert provisions tenant and marks lead won', async () => {
    const result = await convertLeadToCustomer(leadId, {
      send_email: false
    });
    expect(result.customerId).toMatch(/^cust_/);
    expect(result.clinicId).toBe('clinic_convert_mock');
    expect(result.portal_url).toContain('/login');
    expect(result.email_sent).toBe(false);
    expect(result.temporary_password).toBeUndefined();
    expect(provisionSaasTenant).toHaveBeenCalled();

    const lead = db.getLead(leadId);
    expect(['won', 'closed_won']).toContain(lead.pipeline_stage);

    const customer = db.getCustomer(result.customerId);
    expect(customer.email).toBe(email);
    expect(customer.onboarding_state).toBe('voice_setup_incomplete');
  });

  test('throws when email already belongs to a customer', async () => {
    const dupeEmail = `dupe-convert-${Date.now()}@example.com`;
    const dupeLeadId = `lead_dupe_${Date.now()}`;
    db.db
      ?.prepare(
        `INSERT INTO leads (id, title, clinic_name, clinic_email, pipeline_stage, status)
         VALUES (?, ?, ?, ?, 'qualified', 'new')`
      )
      .run(dupeLeadId, 'Duplicate Email Lead', 'Dup Dental', dupeEmail);
    db.createCustomer({
      id: `cust_dupe_${Date.now()}`,
      name: 'Existing Customer',
      email: dupeEmail,
      company_name: 'Dup Dental',
      customer_type: 'saas',
      status: 'active'
    });

    await expect(convertLeadToCustomer(dupeLeadId)).rejects.toMatchObject({
      code: 'invite_email_taken'
    });
  });
});
