'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_drills (
      id TEXT PRIMARY KEY,
      drill_type TEXT NOT NULL, -- tabletop|live
      scenario TEXT NOT NULL,
      outcome TEXT,
      retro_closed INTEGER NOT NULL DEFAULT 0,
      evidence_url TEXT,
      conducted_by TEXT,
      conducted_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_incident_drills_conducted_at
      ON incident_drills(conducted_at DESC);

    CREATE TABLE IF NOT EXISTS compliance_signoffs (
      id TEXT PRIMARY KEY,
      signoff_key TEXT NOT NULL UNIQUE,
      signed_by TEXT,
      signed_at DATETIME NOT NULL,
      notes TEXT,
      evidence_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

module.exports = { up };

