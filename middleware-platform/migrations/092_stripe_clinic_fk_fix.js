'use strict';

/**
 * Fix invalid FK: stripe_* tables referenced clinics(id) but clinics PK is clinic_id.
 */

function tableSql(db, name) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
  return row?.sql || '';
}

function needsFix(db) {
  const sql = tableSql(db, 'stripe_card_transactions');
  if (!sql) return false;
  return /REFERENCES\s+clinics\s*\(\s*id\s*\)/i.test(sql);
}

function up(db) {
  if (!needsFix(db)) return;

  db.pragma('foreign_keys = OFF');

  db.exec(`
    CREATE TABLE stripe_cardholders_new (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      clinic_id TEXT,
      stripe_cardholder_id TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'individual',
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      billing_address TEXT,
      status TEXT DEFAULT 'active',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
      FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
    );

    CREATE TABLE stripe_cards_new (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      clinic_id TEXT,
      cardholder_id TEXT NOT NULL,
      stripe_card_id TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'virtual',
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'active',
      last4 TEXT,
      brand TEXT,
      expiry_month INTEGER,
      expiry_year INTEGER,
      spending_controls TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
      FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id),
      FOREIGN KEY (cardholder_id) REFERENCES stripe_cardholders_new(id)
    );

    CREATE TABLE stripe_card_transactions_new (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      clinic_id TEXT,
      stripe_transaction_id TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd',
      merchant_name TEXT,
      merchant_category TEXT,
      status TEXT,
      authorization_code TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (card_id) REFERENCES stripe_cards_new(id),
      FOREIGN KEY (patient_id) REFERENCES fhir_patients(resource_id),
      FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
    );
  `);

  if (tableSql(db, 'stripe_cardholders')) {
    db.exec('INSERT INTO stripe_cardholders_new SELECT * FROM stripe_cardholders');
  }
  if (tableSql(db, 'stripe_cards')) {
    db.exec('INSERT INTO stripe_cards_new SELECT * FROM stripe_cards');
  }
  if (tableSql(db, 'stripe_card_transactions')) {
    db.exec('INSERT INTO stripe_card_transactions_new SELECT * FROM stripe_card_transactions');
  }

  db.exec(`
    DROP TABLE IF EXISTS stripe_card_transactions;
    DROP TABLE IF EXISTS stripe_cards;
    DROP TABLE IF EXISTS stripe_cardholders;

    ALTER TABLE stripe_cardholders_new RENAME TO stripe_cardholders;
    ALTER TABLE stripe_cards_new RENAME TO stripe_cards;
    ALTER TABLE stripe_card_transactions_new RENAME TO stripe_card_transactions;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stripe_cardholders_patient ON stripe_cardholders(patient_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_cardholders_clinic ON stripe_cardholders(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_cardholders_stripe_id ON stripe_cardholders(stripe_cardholder_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_cards_patient ON stripe_cards(patient_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_cards_clinic ON stripe_cards(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_cards_cardholder ON stripe_cards(cardholder_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_cards_stripe_id ON stripe_cards(stripe_card_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_card_transactions_card ON stripe_card_transactions(card_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_card_transactions_patient ON stripe_card_transactions(patient_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_card_transactions_clinic ON stripe_card_transactions(clinic_id);
  `);

  db.pragma('foreign_keys = ON');
}

function down() {}

module.exports = { up, down };
