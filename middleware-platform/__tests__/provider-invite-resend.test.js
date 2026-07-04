'use strict';

const { createInvite, resendInvite, revokeInvite, validateInvite } = require('../services/provider-invite-service');

describe('provider-invite resend/revoke', () => {
  let database;

  beforeAll(() => {
    process.env.DB_PATH = require('path').join(__dirname, '..', 'tmp-test-invite-resend.db');
    try {
      require('fs').unlinkSync(process.env.DB_PATH);
    } catch (_) {}
    jest.resetModules();
    database = require('../database');
    require('../migrations/103_phase4_pilot').up(database.db);
  });

  afterAll(() => {
    try {
      database?.db?.close();
    } catch (_) {}
  });

  test('resendInvite issues new code', () => {
    const inv = createInvite({ email: 'resend@example.com', practiceName: 'Test' });
    const resent = resendInvite(inv.id);
    expect(resent.code).not.toBe(inv.code);
    expect(validateInvite(resent.code).valid).toBe(true);
  });

  test('revokeInvite rejects validation', () => {
    const inv = createInvite({ email: 'revoke@example.com', practiceName: 'Test' });
    revokeInvite(inv.id);
    const v = validateInvite(inv.code);
    expect(v.valid).toBe(false);
    expect(v.error).toBe('invite_revoked');
  });
});
