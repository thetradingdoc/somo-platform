#!/usr/bin/env node
'use strict';

/**
 * Seed a validation pilot office (local/staging DB) for lifecycle gates.
 *
 * Usage: node scripts/seed-pilot-office.cjs [--clinic-id <id>]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function main() {
  process.chdir(ROOT);
  const db = require('../database');
  if (!db.db) throw new Error('DB unavailable');

  const clinicId =
    (process.argv.includes('--clinic-id') && process.argv[process.argv.indexOf('--clinic-id') + 1]) ||
    process.env.PHASE2_PILOT_CLINIC_ID ||
    `clinic-pilot-${uuidv4().slice(0, 8)}`;

  let clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (!clinic) {
    const merchantId = `merchant-pilot-${uuidv4().slice(0, 8)}`;
    db.db
      .prepare(
        `INSERT INTO merchants (id, name, status, created_at, updated_at)
         VALUES (?, ?, 'active', datetime('now'), datetime('now'))`
      )
      .run(merchantId, 'Pilot Validation Office');
    db.db
      .prepare(
        `INSERT INTO clinics (
          clinic_id, merchant_id, name, slug, email, phone_number, transfer_number,
          npi, practice_address, office_type, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dental', 1, datetime('now'), datetime('now'))`
      )
      .run(
        clinicId,
        merchantId,
        'Pilot Validation Office',
        `pilot-${clinicId.slice(-8)}`,
        'pilot-validation@callsomo.local',
        '+12125550199',
        '+12125550200',
        '1234567890',
        '123 Main St, New York, NY 10001'
      );
    clinic = db.db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
    console.log(`✅ Created clinic ${clinicId}`);
  } else {
    console.log(`ℹ️  Using existing clinic ${clinicId}`);
  }

  const somo = spawnSync('node', ['scripts/setup-phase2-somo-pilot.cjs', '--clinic-id', clinicId], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (somo.status !== 0) process.exit(somo.status || 1);

  console.log(`\nPilot seed complete. clinic_id=${clinicId}`);
  console.log(`  npm run setup:pilot-go-live -- --clinic-id ${clinicId}`);
  console.log(`  npm run verify:pilot-lifecycle -- --clinic-id ${clinicId}\n`);
}

main();
