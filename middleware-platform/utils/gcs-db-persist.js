'use strict';

/**
 * Best-effort SQLite → GCS upload after admin jobs (scrape/enrich).
 * No-op when GCS_DB_BUCKET is unset (local dev).
 */

const { upload } = require('../scripts/cloudrun-db-sync.cjs');

async function persistSqliteToGcs(reason = 'job') {
  if (!(process.env.GCS_DB_BUCKET || '').trim()) {
    return { skipped: true };
  }
  try {
    await upload();
    console.log('[gcs-db-persist] upload ok (%s)', reason);
    return { ok: true };
  } catch (err) {
    console.error('[gcs-db-persist] upload failed (%s): %s', reason, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { persistSqliteToGcs };
