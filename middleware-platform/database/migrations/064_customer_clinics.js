'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_clinics (
      customer_id TEXT NOT NULL,
      clinic_id TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (customer_id, clinic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_clinics_clinic ON customer_clinics(clinic_id);
  `);

  try {
    db.exec(`
      INSERT OR IGNORE INTO customer_clinics (customer_id, clinic_id, is_primary)
      SELECT c.id, cl.clinic_id, 1
      FROM customers c
      JOIN clinics cl ON cl.merchant_id = c.merchant_id
      WHERE c.merchant_id IS NOT NULL AND cl.clinic_id IS NOT NULL
    `);
  } catch (e) {
    console.warn('[064] customer_clinics seed:', e.message);
  }
}

function down() {}

module.exports = { up, down };
