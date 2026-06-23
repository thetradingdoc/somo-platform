'use strict';

function up(db) {
  const table = 'voice_agent_settings';
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;

  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === 'clinic_id')) return;

  const pkCol = cols.find((c) => c.pk === 1);
  const needsRebuild = pkCol?.name === 'merchant_id';

  if (needsRebuild) {
    db.exec(`
      CREATE TABLE voice_agent_settings_v2 (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        clinic_id TEXT,
        customer_id TEXT,
        retell_agent_id TEXT,
        enabled INTEGER DEFAULT 1,
        greeting TEXT,
        after_hours_message TEXT,
        business_hours TEXT,
        outbound_opener TEXT,
        outbound_enabled INTEGER DEFAULT 0,
        outbound_quiet_hours TEXT,
        outbound_allowed_types TEXT,
        settings_version INTEGER DEFAULT 1,
        sync_status TEXT DEFAULT 'synced',
        synced_at DATETIME,
        last_sync_error TEXT,
        tone_preset TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO voice_agent_settings_v2 (
        id, merchant_id, clinic_id, customer_id, retell_agent_id, enabled, greeting,
        after_hours_message, business_hours, outbound_opener, outbound_enabled,
        outbound_quiet_hours, outbound_allowed_types, settings_version, sync_status,
        synced_at, last_sync_error, tone_preset, updated_at
      )
      SELECT
        merchant_id, merchant_id, NULL, customer_id, retell_agent_id, enabled, greeting,
        after_hours_message, business_hours, outbound_opener, outbound_enabled,
        outbound_quiet_hours, outbound_allowed_types, settings_version, sync_status,
        synced_at, last_sync_error, tone_preset, updated_at
      FROM voice_agent_settings;
      DROP TABLE voice_agent_settings;
      ALTER TABLE voice_agent_settings_v2 RENAME TO voice_agent_settings;
    `);
  } else {
    db.exec(`ALTER TABLE ${table} ADD COLUMN clinic_id TEXT`);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_agent_settings_merchant_default
      ON voice_agent_settings(merchant_id) WHERE clinic_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_agent_settings_merchant_clinic
      ON voice_agent_settings(merchant_id, clinic_id) WHERE clinic_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_voice_agent_settings_clinic
      ON voice_agent_settings(clinic_id);
  `);
}

function down() {}

module.exports = { up, down };
