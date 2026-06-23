'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateProviderCanonicalLinks(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const statusCols = db.prepare("PRAGMA table_info(provider_status)").all().map((c) => c.name);
    if (!statusCols.includes('provider_id')) {
      db.exec('ALTER TABLE provider_status ADD COLUMN provider_id TEXT');
      dbLog('✅ Migration: provider_status.provider_id added');
    }
    if (!statusCols.includes('last_seen_at')) {
      db.exec('ALTER TABLE provider_status ADD COLUMN last_seen_at DATETIME');
      dbLog('✅ Migration: provider_status.last_seen_at added');
    }
    if (!statusCols.includes('heartbeat_expires_at')) {
      db.exec('ALTER TABLE provider_status ADD COLUMN heartbeat_expires_at DATETIME');
      dbLog('✅ Migration: provider_status.heartbeat_expires_at added');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_provider_status_provider_id ON provider_status(provider_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_provider_status_heartbeat_expiry ON provider_status(heartbeat_expires_at)');

    const blockCols = db.prepare("PRAGMA table_info(provider_availability_blocks)").all().map((c) => c.name);
    if (!blockCols.includes('provider_id')) {
      db.exec('ALTER TABLE provider_availability_blocks ADD COLUMN provider_id TEXT');
      dbLog('✅ Migration: provider_availability_blocks.provider_id added');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_availability_blocks_provider_id ON provider_availability_blocks(provider_id)');

    // Backfill provider_id by provider email
    db.exec(`
      UPDATE provider_status
      SET provider_id = (
        SELECT pp.id
        FROM provider_profiles pp
        WHERE lower(pp.email) = lower(provider_status.email)
        LIMIT 1
      )
      WHERE provider_id IS NULL
    `);

    db.exec(`
      UPDATE provider_availability_blocks
      SET provider_id = (
        SELECT pp.id
        FROM provider_profiles pp
        WHERE lower(pp.email) = lower(provider_availability_blocks.provider_email)
        LIMIT 1
      )
      WHERE provider_id IS NULL
    `);

    db.pragma('foreign_keys = ON');
  } catch (e) {
    console.warn('⚠️  provider canonical links migration failed:', e.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: persist booking persona in triage session for reconnect/restart resilience

