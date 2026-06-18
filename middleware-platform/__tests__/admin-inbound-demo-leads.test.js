'use strict';

const db = require('../database');
const { upsertLeadFromDemoRequest } = require('../services/somo-demo-service');

describe('admin inbound demo leads', () => {
  test('landing_demo lead appears in getAllLeads source filter', () => {
    const demoId = `e2e-demo-${Date.now()}`;
    const leadId = upsertLeadFromDemoRequest({
      demoRequestId: demoId,
      name: 'Inbound Demo Prospect',
      phone: '+15559876543',
      email: 'inbound@example.com',
      useCase: 'medical_clinic',
      questionsAsked: 'After-hours triage',
      qualification: { interest_level: 'warm' }
    });
    expect(leadId).toBeTruthy();

    const rows = db.getAllLeads({
      source: 'landing_demo',
      has_contact: true,
      include_test: true,
      limit: 50
    });
    const match = rows.find((r) => r.id === leadId || r.external_id === `somo_demo:${demoId}`);
    expect(match).toBeTruthy();
    expect(match.source).toBe('landing_demo');

    if (leadId && db.deleteLead) {
      try {
        db.deleteLead(leadId);
      } catch (_) {}
    }
  });
});
