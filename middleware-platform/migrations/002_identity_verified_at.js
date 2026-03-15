/**
 * Task 53: Patient identity verification before payment redemption.
 * Add identity_verified_at to payment_tokens; tokens require verification before payment.
 */
async function up(db) {
  try {
    const info = db.prepare('PRAGMA table_info(payment_tokens)').all();
    if (!info.some(c => c.name === 'identity_verified_at')) {
      db.exec('ALTER TABLE payment_tokens ADD COLUMN identity_verified_at DATETIME');
    }
  } catch (e) {
    console.warn('Migration 002 identity_verified_at:', e.message);
  }
}

async function down() {
  // SQLite doesn't support DROP COLUMN easily; leave as no-op
}

module.exports = { up, down };
