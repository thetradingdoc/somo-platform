'use strict';

const { validateInvite, createInvite } = require('../services/provider-invite-service');

describe('provider-invite-service', () => {
  let database;

  beforeAll(() => {
    process.env.DB_PATH = require('path').join(__dirname, '..', 'tmp-test-invite.db');
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

  test('createInvite and validateInvite round-trip', () => {
    const inv = createInvite({ email: 'pilot@example.com', practiceName: 'Smile Dental' });
    expect(inv.code).toBeTruthy();
    const v = validateInvite(inv.code);
    expect(v.valid).toBe(true);
    expect(v.invite.email).toBe('pilot@example.com');
  });
});
