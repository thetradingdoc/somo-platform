'use strict';

const { collectContactInfo, scheduleDemo } = require('../services/sales-crm-tools');

function mockDb() {
  const leads = new Map();
  return {
    db: {
      prepare(sql) {
        return {
          get(id) {
            return leads.get(id) ? { notes: leads.get(id).notes } : null;
          },
          run(...args) {
            const id = args[args.length - 1];
            const row = leads.get(id) || { id, notes: '' };
            if (/pipeline_stage = 'demo_scheduled'/i.test(sql)) {
              row.pipeline_stage = 'demo_scheduled';
              row.status = 'demo_scheduled';
              row.notes = args[0];
              row.follow_up_date = args[1];
            }
            leads.set(id, row);
          }
        };
      }
    },
    updateLead(id, updates) {
      const row = leads.get(id) || { id };
      Object.assign(row, updates);
      leads.set(id, row);
    },
    getLead(id) {
      return leads.get(id) || null;
    },
    _leads: leads
  };
}

describe('sales-crm-tools', () => {
  test('collectContactInfo writes exact lead fields', () => {
    const db = mockDb();
    db._leads.set('lead_1', { id: 'lead_1', notes: 'existing' });
    const first = collectContactInfo(db, {
      leadId: 'lead_1',
      args: {
        contact_email: 'owner@clinic.com',
        contact_phone: '+15551234567',
        interest_level: 'high',
        notes: 'practice=dental'
      }
    });
    expect(first.success).toBe(true);
    const row = db.getLead('lead_1');
    expect(row.clinic_email).toBe('owner@clinic.com');
    expect(row.clinic_phone).toBe('+15551234567');
    expect(row.lead_score).toBe(90);
    expect(row.notes).toContain('practice=dental');

    const second = collectContactInfo(db, {
      leadId: 'lead_1',
      args: { contact_email: 'owner@clinic.com', notes: 'practice=dental' }
    });
    expect(second.success).toBe(true);
    expect(db.getLead('lead_1').notes.match(/practice=dental/g).length).toBe(1);
  });

  test('scheduleDemo sets pipeline_stage demo_scheduled', () => {
    const db = mockDb();
    db._leads.set('lead_2', { id: 'lead_2', notes: '' });
    const out = scheduleDemo(db, {
      leadId: 'lead_2',
      args: { preferred_date: '2026-07-10', preferred_time: '2pm', contact_name: 'Sam' }
    });
    expect(out.success).toBe(true);
    expect(db.getLead('lead_2').pipeline_stage).toBe('demo_scheduled');
    expect(db.getLead('lead_2').notes).toMatch(/Demo scheduled/);
  });
});
