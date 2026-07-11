#!/usr/bin/env node
'use strict';

/**
 * DP-05 / Evid-01 — Upload coding evidence to GCS evidence/ prefix.
 *
 * Usage:
 *   GCS_EVIDENCE_BUCKET=somo-staging-db-somo-callsomo node scripts/upload-coding-evidence-gcs.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MP = path.join(__dirname, '..');
const BUCKET = process.env.GCS_EVIDENCE_BUCKET || 'somo-staging-db-somo-callsomo';
const PREFIX = process.env.GCS_EVIDENCE_PREFIX || 'evidence/coding-prod';
const SRC = path.join(MP, 'var/evidence/coding-prod');

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`❌ No local evidence at ${SRC} — run npm run capture:coding-prod-evidence first`);
    process.exit(1);
  }
  const files = fs.readdirSync(SRC).filter((f) => {
    if (f.startsWith('.')) return false;
    const stat = fs.statSync(path.join(SRC, f));
    return stat.isFile();
  });
  if (!files.length) {
    console.error('❌ No evidence files to upload');
    process.exit(1);
  }
  const dry = process.argv.includes('--dry-run');
  for (const f of files) {
    const dest = `gs://${BUCKET}/${PREFIX}/${f}`;
    const src = path.join(SRC, f);
    console.log(`${dry ? '[dry-run] ' : ''}upload ${f} → ${dest}`);
    if (!dry) {
      const cmd = `gcloud storage cp "${src}" "${dest}"`;
      execSync(cmd, { stdio: 'inherit' });
    }
  }
  console.log(`✅ Evidence ${dry ? 'dry-run ' : ''}complete (${files.length} files)`);
}

main();
