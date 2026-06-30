'use strict';

/**
 * Multi-DID support — Clinic Pro and future tiers with max_phone_numbers > 1.
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_phone_numbers (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      e164 TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      twilio_phone_sid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_phone_numbers_e164
      ON customer_phone_numbers(e164);
    CREATE INDEX IF NOT EXISTS idx_customer_phone_numbers_customer
      ON customer_phone_numbers(customer_id);
  `);

  const rows = db.prepare(`
    SELECT id, twilio_phone_number, twilio_phone_sid
    FROM customers
    WHERE twilio_phone_number IS NOT NULL AND twilio_phone_number != ''
  `).all();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO customer_phone_numbers (id, customer_id, e164, is_primary, twilio_phone_sid)
    VALUES (?, ?, ?, 1, ?)
  `);

  for (const row of rows) {
    insert.run(`cpn-${row.id}-primary`, row.id, row.twilio_phone_number, row.twilio_phone_sid || null);
  }
}

function down() {}

module.exports = { up, down };
