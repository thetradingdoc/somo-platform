'use strict';

const db = require('../database');

function ensurePatientPortalEventsTable() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS patient_portal_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      event_name TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_portal_events_session ON patient_portal_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_portal_events_name ON patient_portal_events(event_name);
  `);
}

module.exports = { ensurePatientPortalEventsTable };
