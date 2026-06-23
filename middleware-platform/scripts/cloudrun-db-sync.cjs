#!/usr/bin/env node
'use strict';

/**
 * GCS-backed SQLite sync for Cloud Run staging.
 * Usage: node scripts/cloudrun-db-sync.cjs download|upload|serve [cmd...]
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Storage } = require('@google-cloud/storage');
const { gcsCp } = require('./gcs-cli-fallback.cjs');

const DB_PATH = process.env.DB_PATH || '/var/data/middleware-staging.db';
const BUCKET = (process.env.GCS_DB_BUCKET || '').trim();
const OBJECT = process.env.GCS_DB_OBJECT || 'middleware-staging.db';

function shouldBlockUpload() {
  if (process.env.GCS_DB_UPLOAD_FORCE === '1') return null;
  const operatorId =
    process.env.CALLSOMO_OPERATOR_CUSTOMER_ID || process.env.CALLSOMO_VOICE_CUSTOMER_ID;
  if (!operatorId || !fs.existsSync(DB_PATH)) return null;
  try {
    const Database = require('better-sqlite3');
    const sqlite = new Database(DB_PATH, { readonly: true });
    try {
      const row = sqlite.prepare('SELECT id FROM customers WHERE id = ?').get(operatorId);
      if (!row) {
        return `refusing upload: operator ${operatorId} missing from ${DB_PATH}`;
      }
      const count = sqlite.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
      if (count === 0) {
        return `refusing upload: customers table empty in ${DB_PATH}`;
      }
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return `refusing upload: preflight failed (${err.message})`;
  }

  try {
    const { checkTenantSiteContextUploadPreflight } = require('./lib/stamp-tenant-site-context.cjs');
    const did = process.env.CAPSTONE_TENANT_DID || '+18622307479';
    const clinicId = process.env.CAPSTONE_CLINIC_ID || process.env.DEFAULT_CLINIC_ID || 'clinic-default';
    const bindBlock = checkTenantSiteContextUploadPreflight(DB_PATH, {
      customerId: operatorId,
      clinicId,
      did
    });
    if (bindBlock) {
      return `refusing upload: ${bindBlock}`;
    }
  } catch (err) {
    return `refusing upload: tenant site-context preflight failed (${err.message})`;
  }

  return null;
}

async function download() {
  if (!BUCKET) {
    console.log('[cloudrun-db-sync] GCS_DB_BUCKET unset — ephemeral FS');
    return;
  }
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const remote = `gs://${BUCKET}/${OBJECT}`;
  try {
    const storage = new Storage();
    const file = storage.bucket(BUCKET).file(OBJECT);
    const [exists] = await file.exists();
    if (!exists) {
      console.log('[cloudrun-db-sync] No remote object — fresh DB at', DB_PATH);
      return;
    }
    await file.download({ destination: DB_PATH });
    console.log('[cloudrun-db-sync] Downloaded %s -> %s', remote, DB_PATH);
  } catch (e) {
    console.warn('[cloudrun-db-sync] Node GCS download failed (%s) — trying gcloud storage', e.message);
    gcsCp(remote, DB_PATH);
    console.log('[cloudrun-db-sync] Downloaded via CLI %s -> %s', remote, DB_PATH);
  }
}

async function upload() {
  if (!BUCKET || !fs.existsSync(DB_PATH)) return;
  const blockReason = shouldBlockUpload();
  if (blockReason) {
    console.error('[cloudrun-db-sync]', blockReason);
    return;
  }
  const snap = `${DB_PATH}.upload-snapshot.db`;
  try {
    await snapshotDbForUpload(DB_PATH, snap);
  } catch (e) {
    console.error('[cloudrun-db-sync] snapshot failed:', e.message);
    return;
  }
  const remote = `gs://${BUCKET}/${OBJECT}`;
  try {
    const storage = new Storage();
    await storage.bucket(BUCKET).upload(snap, { destination: OBJECT, resumable: false });
    console.log('[cloudrun-db-sync] Uploaded snapshot %s -> %s', snap, remote);
  } catch (e) {
    console.warn('[cloudrun-db-sync] Node GCS upload failed (%s) — trying gcloud storage', e.message);
    gcsCp(snap, remote);
    console.log('[cloudrun-db-sync] Uploaded via CLI %s -> %s', snap, remote);
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(snap + suffix);
      } catch (_) {}
    }
  }
}

/** Consistent SQLite snapshot safe while the live DB may be open (WAL). */
async function snapshotDbForUpload(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(destPath + suffix);
    } catch (_) {}
  }
  const Database = require('better-sqlite3');
  const src = new Database(srcPath, { readonly: true });
  try {
    await src.backup(destPath);
  } finally {
    try {
      src.close();
    } catch (_) {}
  }
}

function serve(cmd, args) {
  let uploaded = false;
  const doUpload = async () => {
    if (uploaded) return;
    uploaded = true;
    try {
      await upload();
    } catch (e) {
      console.error('[cloudrun-db-sync] Upload failed (best-effort):', e.message);
    }
  };
  process.on('SIGTERM', () => {
    doUpload().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    doUpload().finally(() => process.exit(0));
  });

  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    doUpload().finally(() => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 1);
    });
  });
}

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  if (action === 'download') {
    await download();
    return;
  }
  if (action === 'upload') {
    await upload();
    return;
  }
  if (action === 'serve') {
    await download();
    const cmd = rest[0] || 'node';
    const args = rest.slice(1).length ? rest.slice(1) : ['server.js'];
    serve(cmd, args);
    return;
  }
  console.error('Usage: node cloudrun-db-sync.cjs download|upload|serve [cmd args...]');
  process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { snapshotDbForUpload, upload, download };
