/**
 * M-S5.C (gap17): Practitioner-scoped unique constraint to prevent double-booking.
 * Ensures (practitioner_id, start_time) is unique for non-cancelled appointments.
 * Idempotent — creates index if missing (010 may have already created it).
 */

function up(db) {
  try {
    const existing = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_appointments_practitioner_start_unique'`
    ).get();
    if (!existing) {
      db.exec(`
        CREATE UNIQUE INDEX idx_appointments_practitioner_start_unique
        ON appointments(practitioner_id, start_time)
        WHERE practitioner_id IS NOT NULL AND practitioner_id != ''
          AND status NOT IN ('cancelled', 'no_show')
      `);
      console.log('✅ Migration 013: practitioner slot uniqueness index created');
    }
  } catch (e) {
    console.warn('[013] Practitioner slot unique:', e.message);
  }
}

function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_appointments_practitioner_start_unique');
}

module.exports = { up, down };
