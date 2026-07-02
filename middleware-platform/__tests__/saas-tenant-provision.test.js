'use strict';

const db = require('../database');
const { provisionSaasTenant } = require('../services/saas-tenant-provision');

describe('provisionSaasTenant', () => {
  const customerId = `cust_saas_prov_${Date.now()}`;

  beforeAll(() => {
    db.createCustomer({
      id: customerId,
      name: 'SaaS Provision Test',
      email: `saas-prov-${Date.now()}@example.com`,
      phone_number: '+12025559001',
      status: 'active',
      email_verified: 1
    });
    db.updateCustomer(customerId, {
      customer_type: 'saas',
      company_name: 'Provision Clinic LLC'
    });
  });

  test('creates merchant, clinic, prompt_profile, voice_agent_settings, visit_pricing rows', () => {
    const result = provisionSaasTenant(db, {
      customerId,
      clinicName: 'Provision Test Clinic',
      phone: '+12025559001',
      useCase: 'healthcare_clinic'
    });

    expect(result.merchantId).toBeTruthy();
    expect(result.clinicId).toBeTruthy();
    expect(result.promptProfileId).toBeTruthy();

    const merchant = db.db.prepare('SELECT id FROM merchants WHERE id = ?').get(result.merchantId);
    expect(merchant).toBeTruthy();

    const clinic = db.db.prepare('SELECT clinic_id FROM clinics WHERE clinic_id = ?').get(result.clinicId);
    expect(clinic).toBeTruthy();

    const profile = db.getClinicPromptProfile(result.clinicId, customerId);
    expect(profile).toBeTruthy();

    const voiceSettings = db.getVoiceAgentSettingsForProvider({
      merchantId: result.merchantId,
      customerId
    });
    expect(voiceSettings).toBeTruthy();
    expect(voiceSettings.greeting).toBeTruthy();

    const pricingRows = db.db
      .prepare('SELECT appointment_type, base_price FROM visit_pricing WHERE clinic_id = ?')
      .all(result.clinicId);
    expect(pricingRows.length).toBeGreaterThan(0);
    expect(pricingRows.some((r) => r.appointment_type === 'General Consult')).toBe(true);

    const credits = db.getCustomerCredits(customerId);
    expect(credits).toBeTruthy();
    expect(credits.credits_balance_minutes).toBeGreaterThan(0);
  });
});
