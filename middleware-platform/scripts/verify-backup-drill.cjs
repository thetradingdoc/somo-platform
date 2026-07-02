#!/usr/bin/env node
'use strict';

/**
 * Automated backup drill — list GCS backups/ and optional scratch restore sanity.
 *
 * Usage: node scripts/verify-backup-drill.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(ROOT, '..');
const RECORD = path.join(REPO_ROOT, 'docs/deployment/BACKUP_DRILL_RECORD.md');

function check(name, ok, detail) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
}

function gsutilAvailable() {
  return spawnSync('which', ['gsutil'], { encoding: 'utf8' }).status === 0;
}

function main() {
  console.log('\n=== Backup drill verify ===\n');
  let pass = true;

  pass = check('BACKUP_DRILL_RECORD.md exists', fs.existsSync(RECORD)) && pass;
  pass = check('backup-drill-checklist.cjs exists', fs.existsSync(path.join(ROOT, 'scripts/backup-drill-checklist.cjs'))) && pass;

  const bucket = (process.env.GCS_DB_BUCKET || '').trim();
  if (bucket) {
    const checklist = spawnSync('node', ['scripts/backup-drill-checklist.cjs'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env
    });
    pass = check('backup-drill-checklist passes', checklist.status === 0) && pass;
  } else {
    console.log('ℹ️  GCS_DB_BUCKET unset — skip live bucket checklist (set for prod drill)');
  }

  if (bucket && gsutilAvailable()) {
    const cleanBucket = bucket.replace(/^gs:\/\//, '').replace(/\/$/, '');
    const list = spawnSync('gsutil', ['ls', `gs://${cleanBucket}/backups/`], { encoding: 'utf8' });
    if (list.status === 0 && list.stdout.trim()) {
      const latest = list.stdout.trim().split('\n').filter(Boolean).pop();
      pass = check('latest backup object', Boolean(latest), latest) && pass;

      const scratch = path.join(ROOT, 'var/restore-drill-scratch.db');
      try {
        if (fs.existsSync(scratch)) fs.unlinkSync(scratch);
        const cp = spawnSync('gsutil', ['cp', latest, scratch], { encoding: 'utf8' });
        if (cp.status === 0 && fs.existsSync(scratch)) {
          let tableCount = 0;
          try {
            const Database = require('better-sqlite3');
            const db = new Database(scratch, { readonly: true });
            tableCount = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
            db.close();
          } catch (e) {
            pass = check('scratch sqlite open', false, e.message) && pass;
          }
          fs.unlinkSync(scratch);
          pass = check('scratch restore schema tables', tableCount > 5, String(tableCount)) && pass;
        } else {
          pass = check('gsutil cp to scratch', false, cp.stderr?.trim()) && pass;
        }
      } catch (e) {
        pass = check('scratch restore', false, e.message) && pass;
      }
    }
  } else {
    console.log('ℹ️  Skip live restore — set GCS_DB_BUCKET + gsutil for full drill');
  }

  console.log('\n' + JSON.stringify({ pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
