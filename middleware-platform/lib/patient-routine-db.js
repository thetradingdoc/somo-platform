'use strict';

const db = require('../database');

function ensureRoutineTables() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS patient_routine_templates (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      name TEXT NOT NULL,
      start_date TEXT,
      duration_days INTEGER DEFAULT 28,
      repeat_cadence TEXT DEFAULT 'daily',
      repeat_days_of_week_json TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_routine_templates_session ON patient_routine_templates(session_id);
    CREATE INDEX IF NOT EXISTS idx_routine_templates_patient ON patient_routine_templates(patient_id);

    CREATE TABLE IF NOT EXISTS patient_routine_template_items (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      source_type TEXT DEFAULT 'shelf',
      source_ref_id TEXT,
      product_name TEXT NOT NULL,
      product_brand TEXT,
      usage_time TEXT,
      frequency_rule TEXT,
      days_of_week_json TEXT,
      goal TEXT,
      step_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_routine_items_template ON patient_routine_template_items(template_id);

    CREATE TABLE IF NOT EXISTS patient_routine_daily_entries (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      patient_id TEXT,
      entry_date TEXT NOT NULL,
      skin_report TEXT,
      notes TEXT,
      completion_score INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(template_id, entry_date)
    );
    CREATE INDEX IF NOT EXISTS idx_routine_daily_template_date ON patient_routine_daily_entries(template_id, entry_date);
    CREATE INDEX IF NOT EXISTS idx_routine_daily_session_date ON patient_routine_daily_entries(session_id, entry_date);

    CREATE TABLE IF NOT EXISTS patient_routine_daily_item_logs (
      id TEXT PRIMARY KEY,
      daily_entry_id TEXT NOT NULL,
      template_item_id TEXT,
      completed INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_routine_daily_logs_entry ON patient_routine_daily_item_logs(daily_entry_id);

    CREATE TABLE IF NOT EXISTS patient_routine_daily_media (
      id TEXT PRIMARY KEY,
      daily_entry_id TEXT NOT NULL,
      media_type TEXT DEFAULT 'image',
      patient_document_id TEXT,
      media_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_routine_daily_media_entry ON patient_routine_daily_media(daily_entry_id);
  `);
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN start_date TEXT`).run();
  } catch (_) {}
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN duration_days INTEGER DEFAULT 28`).run();
  } catch (_) {}
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN repeat_cadence TEXT DEFAULT 'daily'`).run();
  } catch (_) {}
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN repeat_days_of_week_json TEXT`).run();
  } catch (_) {}
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN metadata_json TEXT`).run();
  } catch (_) {}
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN concern_id TEXT`).run();
  } catch (_) {}
  try {
    db.db.prepare(`ALTER TABLE patient_routine_templates ADD COLUMN program_week INTEGER DEFAULT 1`).run();
  } catch (_) {}
}

module.exports = { ensureRoutineTables };
