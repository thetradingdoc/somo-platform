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
  return null;
}

async function download() {
  if (!BUCKET) {
    console.log('[cloudrun-db-sync] GCS_DB_BUCKET unset — ephemeral FS');
    return;
  }
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const storage = new Storage();
  const file = storage.bucket(BUCKET).file(OBJECT);
  const [exists] = await file.exists();
  if (!exists) {
    console.log('[cloudrun-db-sync] No remote object — fresh DB at', DB_PATH);
    return;
  }
  await file.download({ destination: DB_PATH });
  console.log('[cloudrun-db-sync] Downloaded gs://%s/%s -> %s', BUCKET, OBJECT, DB_PATH);
}

async function upload() {
  if (!BUCKET || !fs.existsSync(DB_PATH)) return;
  const blockReason = shouldBlockUpload();
  if (blockReason) {
    console.error('[cloudrun-db-sync]', blockReason);
    return;
  }
  const storage = new Storage();
  await storage.bucket(BUCKET).upload(DB_PATH, { destination: OBJECT, resumable: false });
  console.log('[cloudrun-db-sync] Uploaded %s -> gs://%s/%s', DB_PATH, BUCKET, OBJECT);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
