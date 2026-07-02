#!/usr/bin/env node
'use strict';

/**
 * Backfill active clinics with null/none pms_type → somo + pms_enabled=1.
 * Idempotent — safe to run on every verify:phase3-sandbox.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function main() {
  const db = require('../database');
  const { encryptPmsConfig } = require('../services/pms/pms-config');
  const mig = require('../migrations/099_phase3_pms_connect');
  if (mig?.up && db.db) mig.up(db.db);

  const rows = db.db
    .prepare(
      `SELECT clinic_id, pms_type, pms_enabled FROM clinics
       WHERE is_active = 1 AND (pms_type IS NULL OR pms_type = '' OR lower(pms_type) = 'none')`
    )
    .all();

  let updated = 0;
  for (const row of rows) {
    db.updateClinic(row.clinic_id, {
      pms_type: 'somo',
      pms_enabled: 1,
      pms_config: encryptPmsConfig({ mirror_google: true }),
      pms_connected_at: new Date().toISOString(),
      pms_last_error: null
    });
    updated++;
    console.log(`✅ ${row.clinic_id} → pms_type=somo, pms_enabled=1`);
  }

  console.log(`\nBackfill complete: ${updated} clinic(s) updated, ${rows.length - updated} unchanged.\n`);
}

main();
