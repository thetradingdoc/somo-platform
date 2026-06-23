'use strict';

/**
 * Postgres dual-write / mirror layer (Phase 6).
 *
 * Status: incremental extraction from database.js.
 *
 * When POSTGRES_URL is set:
 * - database/connection.js initializes a Postgres pool
 * - database/postgres-hot-path.js mirrors selected hot-path reads/writes
 * - services/postgres-sync-worker.js runs background sync (when enabled)
 *
 * SQLite remains primary for local dev and Cloud Run staging unless POSTGRES_URL is configured.
 *
 * Implementation map:
 * - Session projection mirror: services/kelly/rails/session-ssot.js
 * - Pool factory: utils/postgres.js
 * - Stub entry (this file): re-exports docs until sync helpers move out of database.js
 *
 * To complete migration: move enqueuePostgresSync / flush helpers from database.js into
 * database/postgres-sync.js and require from session-ssot + billing paths only.
 */

const { initPostgresPoolIfConfigured } = require('./connection');

function getPostgresStatus() {
  const { usePostgres, pgPool } = initPostgresPoolIfConfigured();
  return {
    configured: !!process.env.POSTGRES_URL,
    pool_active: usePostgres && !!pgPool,
    sqlite_primary: true,
    note: 'Dual-write helpers still invoked via require("../database") until postgres-sync extraction lands.'
  };
}

module.exports = {
  getPostgresStatus,
  initPostgresPoolIfConfigured
};
