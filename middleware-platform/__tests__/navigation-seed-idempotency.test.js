'use strict';

const db = require('../database');
const { main: runSeed } = require('../scripts/seed-navigation-demo.cjs');
const {
  METRO_ENTITY_ID,
  METRO_ALIASES,
  PROVIDERS,
  resolveNavClinicId,
} = require('../scripts/lib/navigation-demo-config.cjs');

describe('navigation seed idempotency (P0-S3)', () => {
  test('double seed keeps stable Metro alias count and provider emails', async () => {
    await runSeed();
    const aliasBefore = db.db
      .prepare('SELECT COUNT(*) AS c FROM payor_entity_aliases WHERE entity_id = ?')
      .get(METRO_ENTITY_ID).c;

    await runSeed();

    const aliasAfter = db.db
      .prepare('SELECT COUNT(*) AS c FROM payor_entity_aliases WHERE entity_id = ?')
      .get(METRO_ENTITY_ID).c;

    expect(aliasBefore).toBe(METRO_ALIASES.length);
    expect(aliasAfter).toBe(METRO_ALIASES.length);

    const clinicId = resolveNavClinicId(db);
    expect(clinicId).toBeTruthy();

    const emails = PROVIDERS.map((p) => p.email.toLowerCase());
    for (const email of emails) {
      const row = db.db
        .prepare(
          `
        SELECT pp.id, ps.is_online
        FROM provider_profiles pp
        LEFT JOIN provider_status ps ON lower(ps.email) = lower(pp.email)
        WHERE pp.clinic_id = ? AND lower(pp.email) = lower(?)
      `
        )
        .get(clinicId, email);
      expect(row).toBeTruthy();
      expect(row.is_online).toBe(1);
    }
  }, 120000);
});
