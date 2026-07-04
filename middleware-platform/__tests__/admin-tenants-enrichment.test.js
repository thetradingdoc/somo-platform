'use strict';

const Database = require('better-sqlite3');
const {
  formatInvoiceSummary,
  getClinicPmsFields,
  getPendingInviteForClinic,
} = require('../services/tenant-health');

describe('admin tenant enrichment', () => {
  test('formatInvoiceSummary maps due_date as invoice date', () => {
    const summary = formatInvoiceSummary({
      billing_month: '2026-06',
      due_date: '2026-07-01',
      sent_at: '2026-06-28',
      status: 'paid',
      total: 199,
      invoice_number: 'INV-001',
    });
    expect(summary).toEqual({
      billing_month: '2026-06',
      due_date: '2026-07-01',
      sent_at: '2026-06-28',
      status: 'paid',
      total: 199,
      invoice_number: 'INV-001',
    });
  });

  test('getClinicPmsFields defaults to somo', () => {
    expect(getClinicPmsFields({})).toEqual({ pms_type: 'somo', pms_enabled: false });
    expect(getClinicPmsFields({ pms_type: 'dentrix', pms_enabled: 1 })).toEqual({
      pms_type: 'dentrix',
      pms_enabled: true,
    });
  });

  test('getPendingInviteForClinic detects pending invite by clinic_id', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE provider_invites (
        id TEXT PRIMARY KEY,
        clinic_id TEXT,
        customer_id TEXT,
        status TEXT
      );
      INSERT INTO provider_invites (id, clinic_id, customer_id, status)
      VALUES ('inv1', 'clinic-a', 'cust-a', 'pending');
    `);
    const db = require('../database');
    const prevDb = db.db;
    db.db = sqlite;
    try {
      expect(getPendingInviteForClinic('clinic-a', 'cust-a')).toBe(true);
      expect(getPendingInviteForClinic('clinic-b', null)).toBe(false);
    } finally {
      db.db = prevDb;
      sqlite.close();
    }
  });
});
