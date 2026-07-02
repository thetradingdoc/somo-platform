#!/usr/bin/env node
'use strict';

/**
 * Read-only GCS SQLite backup/restore drill validation (no writes to prod).
 * Usage: node scripts/backup-drill-checklist.cjs
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(ROOT, '..');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function gsutilAvailable() {
  return spawnSync('which', ['gsutil'], { encoding: 'utf8' }).status === 0;
}

function main() {
  console.log('\n=== Backup / restore drill (read-only) ===\n');
  let pass = true;

  const offboarding = path.join(REPO_ROOT, 'docs/runbooks/TENANT_OFFBOARDING.md');
  pass = check('TENANT_OFFBOARDING runbook exists', fs.existsSync(offboarding)) && pass;

  const hipaa = path.join(REPO_ROOT, 'docs/compliance/templates/HIPAA_RISK_ASSESSMENT_CHECKLIST.md');
  if (fs.existsSync(hipaa)) {
    const body = fs.readFileSync(hipaa, 'utf8');
    pass = check('HIPAA checklist mentions GCS backups', /GCS.*backup/i.test(body)) && pass;
  }

  const bucket = process.env.GCS_DB_BUCKET || '';
  pass = check('GCS_DB_BUCKET configured', Boolean(bucket.trim()), bucket || 'set GCS_DB_BUCKET') && pass;

  const dbPath = process.env.DB_PATH || path.join(ROOT, 'var/db/middleware-dev.db');
  pass = check('local DB_PATH readable or creatable parent', fs.existsSync(path.dirname(dbPath))) && pass;

  const backupScript = path.join(ROOT, 'scripts/verify-prod-db-backup.sh');
  pass = check('verify-prod-db-backup.sh present', fs.existsSync(backupScript)) && pass;

  console.log('\n--- Manual drill steps (operator) ---');
  console.log('1. gsutil ls gs://<GCS_DB_BUCKET>/backups/ — confirm recent middleware-*.db objects');
  console.log('2. Copy latest backup to staging scratch: gsutil cp gs://.../backups/<file> ./var/restore-drill.db');
  console.log('3. node -e "const db=require(\'better-sqlite3\')(\'./var/restore-drill.db\'); console.log(db.prepare(\\"SELECT name FROM sqlite_master WHERE type=\'table\'\\").all().length);"');
  console.log('4. Confirm schema_migrations row count matches production revision notes');
  console.log('5. Delete scratch file — do not point DB_PATH at drill copy in shared env');
  console.log('6. Record drill date + operator in deploy notes');
  console.log('7. Review secrets rotation schedule: docs/runbooks/SECRETS_ROTATION.md\n');

  if (bucket && gsutilAvailable()) {
    const prefix = `gs://${bucket.replace(/^gs:\/\//, '').replace(/\/$/, '')}/`;
    const list = spawnSync('gsutil', ['ls', `${prefix}backups/`], { encoding: 'utf8' });
    if (list.status === 0 && list.stdout.trim()) {
      const lines = list.stdout.trim().split('\n');
      pass = check('GCS backups/ prefix lists objects', lines.length > 0, `${lines.length} object(s)`) && pass;
    } else {
      pass = check('GCS backups/ prefix reachable', false, list.stderr?.trim() || 'empty or denied') && pass;
    }
  } else if (!gsutilAvailable()) {
    console.log('⚠️  gsutil not installed — skip live bucket listing; run manual steps above');
  }

  console.log('\n' + JSON.stringify({ pass, readOnly: true }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
