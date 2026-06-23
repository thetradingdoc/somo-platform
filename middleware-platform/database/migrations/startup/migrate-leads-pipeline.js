'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateLeadsPipeline(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(leads)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('pipeline_stage')) {
      dbLog('🔄 Migrating: Adding pipeline_stage column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN pipeline_stage TEXT DEFAULT 'new'").run();
    }

    if (!columnNames.includes('is_qualified')) {
      dbLog('🔄 Migrating: Adding is_qualified column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN is_qualified INTEGER DEFAULT 0").run();

      // Auto-qualify existing leads that have phone + email
      db.prepare(`
        UPDATE leads 
        SET is_qualified = 1 
        WHERE clinic_phone IS NOT NULL 
          AND clinic_phone != '' 
          AND clinic_email IS NOT NULL 
          AND clinic_email != ''
      `).run();
    }

    if (!columnNames.includes('lead_score')) {
      dbLog('🔄 Migrating: Adding lead_score column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN lead_score INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('follow_up_date')) {
      dbLog('🔄 Migrating: Adding follow_up_date column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN follow_up_date DATETIME").run();
    }

    if (!columnNames.includes('next_action')) {
      dbLog('🔄 Migrating: Adding next_action column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN next_action TEXT").run();
    }

    if (!columnNames.includes('estimated_value')) {
      dbLog('🔄 Migrating: Adding estimated_value column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN estimated_value REAL").run();
    }

    if (!columnNames.includes('owner_id')) {
      dbLog('🔄 Migrating: Adding owner_id column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN owner_id TEXT").run();
    }

    if (!columnNames.includes('opening_hours')) {
      dbLog('🔄 Migrating: Adding opening_hours column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN opening_hours TEXT").run();
    }

    if (!columnNames.includes('is_test')) {
      dbLog('🔄 Migrating: Adding is_test column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN is_test INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('lead_type')) {
      dbLog('🔄 Migrating: Adding lead_type column to leads table');
      db.prepare("ALTER TABLE leads ADD COLUMN lead_type TEXT DEFAULT 'sales'").run();

      // Set lead_type based on source field for existing leads
      // Sales leads: source = 'google_search' or 'job_search'
      // Customer leads: source = 'self_signup'
      db.prepare(`
        UPDATE leads 
        SET lead_type = CASE 
          WHEN source = 'self_signup' THEN 'customer'
          ELSE 'sales'
        END
      `).run();
    }

    if (!columnNames.includes('required_languages')) {
      dbLog('🔄 Migrating: Adding required_languages column to leads table');
      db.prepare('ALTER TABLE leads ADD COLUMN required_languages TEXT').run();
    }

    if (!columnNames.includes('preferred_language')) {
      dbLog('🔄 Migrating: Adding preferred_language column to leads table');
      db.prepare('ALTER TABLE leads ADD COLUMN preferred_language TEXT').run();
    }

    db.pragma('foreign_keys = ON');
    dbLog('✅ Migration complete: pipeline columns added to leads');
  } catch (error) {
    console.warn('⚠️  Leads pipeline migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add Phase 2 qualification rules table

