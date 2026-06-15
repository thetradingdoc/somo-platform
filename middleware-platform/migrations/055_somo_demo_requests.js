'use strict';

/**
 * Somo landing demo-call tables (public /api/public/somo-demo/request).
 * Versioned migration so Cloud Run applies this even when SKIP_STARTUP_MIGRATIONS=1.
 */

function addColumnIfMissing(db, table, col, ddl) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  if (!exists) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS somo_demo_requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      use_case TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      twilio_call_sid TEXT,
      client_ip TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_somo_demo_phone ON somo_demo_requests(phone);
    CREATE INDEX IF NOT EXISTS idx_somo_demo_created ON somo_demo_requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_somo_demo_ip_created ON somo_demo_requests(client_ip, created_at);

    CREATE TABLE IF NOT EXISTS somo_demo_phone_daily_lock (
      phone TEXT NOT NULL,
      day_key TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (phone, day_key)
    );
    CREATE INDEX IF NOT EXISTS idx_somo_demo_phone_lock_created
      ON somo_demo_phone_daily_lock(created_at);

    CREATE TABLE IF NOT EXISTS somo_demo_phone_window_lock (
      phone TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      locked_until DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_somo_demo_phone_window_until
      ON somo_demo_phone_window_lock(locked_until);
  `);

  const extraCols = [
    ['template_id', 'template_id TEXT'],
    ['language', 'language TEXT'],
    ['country', 'country TEXT'],
    ['city', 'city TEXT'],
    ['practice_specialty', 'practice_specialty TEXT'],
    ['practice_size', 'practice_size TEXT'],
    ['questions_asked', 'questions_asked TEXT'],
    ['conversation_stage', 'conversation_stage TEXT'],
    ['interest_level', 'interest_level TEXT'],
    ['cta_offered_at', 'cta_offered_at TEXT'],
    ['signup_link_sent', 'signup_link_sent INTEGER DEFAULT 0'],
    ['outcome', 'outcome TEXT'],
    ['duration_sec', 'duration_sec INTEGER'],
    ['voicemail_detected', 'voicemail_detected INTEGER DEFAULT 0'],
    ['attribution_json', 'attribution_json TEXT']
  ];
  for (const [, ddl] of extraCols) {
    const col = ddl.split(' ')[0];
    addColumnIfMissing(db, 'somo_demo_requests', col, ddl);
  }

  const legacyExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dodgecall_demo_requests'")
    .get();
  if (legacyExists) {
    db.exec(`
      INSERT OR IGNORE INTO somo_demo_requests (
        id, name, phone, use_case, status, twilio_call_sid, client_ip, error_message, created_at, updated_at
      )
      SELECT
        id, name, phone, use_case, status, twilio_call_sid, client_ip, error_message, created_at, updated_at
      FROM dodgecall_demo_requests
    `);
  }

  db.exec(`
    DELETE FROM somo_demo_phone_daily_lock
    WHERE created_at < datetime('now', '-2 days');
    DELETE FROM somo_demo_phone_window_lock
    WHERE locked_until <= datetime('now');
  `);
}

function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS somo_demo_phone_window_lock;
    DROP TABLE IF EXISTS somo_demo_phone_daily_lock;
    DROP TABLE IF EXISTS somo_demo_requests;
  `);
}

module.exports = { up, down };
