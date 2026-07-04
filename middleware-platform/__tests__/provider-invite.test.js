'use strict';

describe('provider-invite-service', () => {
  let database;
  let validateInvite;
  let createInvite;
  let assertInviteEmailAvailable;

  beforeAll(() => {
    process.env.DB_PATH = require('path').join(__dirname, '..', 'tmp-test-invite.db');
    try {
      require('fs').unlinkSync(process.env.DB_PATH);
    } catch (_) {}
    jest.resetModules();
    database = require('../database');
    require('../migrations/103_phase4_pilot').up(database.db);
    const svc = require('../services/provider-invite-service');
    validateInvite = svc.validateInvite;
    createInvite = svc.createInvite;
    assertInviteEmailAvailable = svc.assertInviteEmailAvailable;
  });

  afterAll(() => {
    try {
      database?.db?.close();
    } catch (_) {}
  });

  test('createInvite and validateInvite round-trip', () => {
    const inv = createInvite({ email: 'pilot@example.com', practiceName: 'Smile Dental' });
    expect(inv.code).toBeTruthy();
    const v = validateInvite(inv.code);
    expect(v.valid).toBe(true);
    expect(v.invite.email).toBe('pilot@example.com');
  });

  test('assertInviteEmailAvailable rejects duplicate customer email', () => {
    const email = 'dup-invite@example.com';
    database.db
      .prepare(
        `INSERT INTO customers (id, name, email, company_name, customer_type, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('cust_dup_invite', 'Dup', email, 'Dup Co', 'saas', 'active');
    expect(() => assertInviteEmailAvailable(email)).toThrow(
      expect.objectContaining({ code: 'invite_email_taken' })
    );
  });

  test('assertInviteEmailAvailable rejects pending invite email', () => {
    createInvite({ email: 'pending-dup@example.com', practiceName: 'Pending Office' });
    expect(() => assertInviteEmailAvailable('pending-dup@example.com')).toThrow(
      expect.objectContaining({ code: 'invite_pending_exists' })
    );
  });
});
