'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateCustomersTable(db) {
  try {
    db.pragma('foreign_keys = OFF');
    const tableInfo = db.prepare("PRAGMA table_info(customers)").all();
    const columnNames = tableInfo.map(col => col.name);

    const newColumns = {
      phone_number: 'TEXT',
      business_size: 'TEXT',
      use_case: 'TEXT',
      api_features: 'TEXT',
      email_verified: 'BOOLEAN DEFAULT 0',
      email_verified_at: 'DATETIME',
      updated_at: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
      retell_agent_id: 'TEXT',
      retell_agent_status: "TEXT DEFAULT 'pending'",
      stripe_customer_id: 'TEXT',
      stripe_payment_method_id: 'TEXT',
      card_last4: 'TEXT',
      card_brand: 'TEXT',
      card_verified: 'BOOLEAN DEFAULT 0',
      card_verified_at: 'DATETIME',
      customer_type: "TEXT DEFAULT 'saas'",
      twilio_phone_number: 'TEXT',
      twilio_phone_sid: 'TEXT',
      kelly_status: "TEXT DEFAULT 'pending'",
      provisioning_state: "TEXT DEFAULT 'requested'",
      pricing_tier: "TEXT DEFAULT 'starter'",
      custom_prompt: 'TEXT',
      prompt_updated_at: 'DATETIME',
      fhir_patient_id: 'TEXT',
      provider_profile: 'TEXT'
    };

    Object.keys(newColumns).forEach(colName => {
      if (!columnNames.includes(colName)) {
        dbLog(`📦 Adding ${colName} column to customers table...`);
        db.prepare(`ALTER TABLE customers ADD COLUMN ${colName} ${newColumns[colName]}`).run();
      }
    });

    // Create index for fhir_patient_id if it was just added
    if (!columnNames.includes('fhir_patient_id')) {
      dbLog('📦 Creating index on customers.fhir_patient_id...');
      db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_fhir_patient_id ON customers(fhir_patient_id)").run();
    }

    db.pragma('foreign_keys = ON');
    dbLog('✅ Migration complete: customers table updated');
  } catch (migrationError) {
    console.warn('⚠️  Customers table migration failed:', migrationError.message);
    db.pragma('foreign_keys = ON');
  }
}

// Migration: Canonical provider links (provider_id) for status + availability

