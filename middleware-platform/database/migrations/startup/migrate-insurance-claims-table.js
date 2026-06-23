'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateInsuranceClaimsTable(db) {
  try {
    // Temporarily disable foreign keys for migration
    db.pragma('foreign_keys = OFF');

    // Get table info to check existing columns
    const tableInfo = db.prepare("PRAGMA table_info(insurance_claims)").all();
    const columnNames = tableInfo.map(col => col.name);

    // Check and add circle_transfer_id if missing
    if (!columnNames.includes('circle_transfer_id')) {
      dbLog('🔄 Migrating: Adding circle_transfer_id column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN circle_transfer_id TEXT").run();
    }

    // Check and add payment_status if missing
    if (!columnNames.includes('payment_status')) {
      dbLog('🔄 Migrating: Adding payment_status column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN payment_status TEXT DEFAULT 'pending'").run();
    }

    // Check and add payment_amount if missing
    if (!columnNames.includes('payment_amount')) {
      dbLog('🔄 Migrating: Adding payment_amount column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN payment_amount REAL").run();
    }

    // Impact-weighted escrow: salted SHA-256 hash linking Octopi scan to blockchain (PHI-safe)
    if (!columnNames.includes('data_integrity_hash')) {
      dbLog('🔄 Migrating: Adding data_integrity_hash column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN data_integrity_hash TEXT").run();
    }

    if (!columnNames.includes('impact_tier')) {
      dbLog('🔄 Migrating: Adding impact_tier column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN impact_tier INTEGER DEFAULT 1").run();
    }

    if (!columnNames.includes('escrow_hash')) {
      dbLog('🔄 Migrating: Adding escrow_hash column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN escrow_hash TEXT").run();
    }

    if (!columnNames.includes('healthcare_staff_address')) {
      dbLog('🔄 Migrating: Adding healthcare_staff_address column to insurance_claims table');
      db.prepare("ALTER TABLE insurance_claims ADD COLUMN healthcare_staff_address TEXT").run();
    }

    // Re-enable foreign keys after migration
    db.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn('⚠️  Insurance claims migration failed:', error.message);
    // Re-enable foreign keys even if migration fails
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Add email column to patient_portal_sessions if it doesn't exist

