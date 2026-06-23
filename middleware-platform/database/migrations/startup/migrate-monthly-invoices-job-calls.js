'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateMonthlyInvoicesJobCalls(db) {
  try {
    db.pragma('foreign_keys = OFF');

    const tableInfo = db.prepare("PRAGMA table_info(monthly_invoices)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('job_calls_count')) {
      dbLog('🔄 Migrating: Adding job_calls_count column to monthly_invoices table');
      db.prepare("ALTER TABLE monthly_invoices ADD COLUMN job_calls_count INTEGER DEFAULT 0").run();
    }

    if (!columnNames.includes('job_calls_revenue')) {
      dbLog('🔄 Migrating: Adding job_calls_revenue column to monthly_invoices table');
      db.prepare("ALTER TABLE monthly_invoices ADD COLUMN job_calls_revenue REAL DEFAULT 0").run();
    }

    if (!columnNames.includes('job_calls_cost')) {
      dbLog('🔄 Migrating: Adding job_calls_cost column to monthly_invoices table');
      db.prepare("ALTER TABLE monthly_invoices ADD COLUMN job_calls_cost REAL DEFAULT 0").run();
    }

    db.pragma('foreign_keys = ON');
    dbLog('✅ Migration complete: job call columns added to monthly_invoices');
  } catch (error) {
    console.warn('⚠️  Monthly invoices job calls migration failed:', error.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add delivery tracking fields to merchant_orders table

