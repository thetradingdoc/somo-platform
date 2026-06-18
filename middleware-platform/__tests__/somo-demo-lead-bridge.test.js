'use strict';

const { upsertLeadFromDemoRequest } = require('../services/somo-demo-service');

describe('somo-demo lead bridge', () => {
  test('upsertLeadFromDemoRequest merges qualification into notes', () => {
    const id = `test-demo-${Date.now()}`;
    const leadId = upsertLeadFromDemoRequest({
      demoRequestId: id,
      name: 'Test Prospect',
      phone: '+15551234567',
      email: 'test@example.com',
      useCase: 'medical_clinic',
      practiceSpecialty: 'Dermatology',
      questionsAsked: 'After-hours coverage',
      qualification: {
        interest_level: 'hot',
        primary_problem: 'missed calls',
        practice_size: '3 providers'
      }
    });
    expect(leadId).toBeTruthy();

    const db = require('../database');
    const lead = db.getLeadByExternalId(`somo_demo:${id}`);
    expect(lead).toBeTruthy();
    expect(lead.source).toBe('landing_demo');
    const notes = JSON.parse(lead.notes);
    expect(notes.qualification.interest_level).toBe('hot');
    expect(notes.questions_asked).toBe('After-hours coverage');

    if (leadId && db.deleteLead) {
      try {
        db.deleteLead(leadId);
      } catch (_) {}
    }
  });
});
