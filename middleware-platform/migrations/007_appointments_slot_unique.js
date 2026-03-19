/**
 * B-1: Add unique constraint to prevent TOCTOU double-booking.
 * One active appointment per (clinic_id, start_time). Cancelled/no_show excluded.
 */
function up(db) {
  // SQLite: partial unique index on non-cancelled appointments
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_clinic_start_unique
    ON appointments(clinic_id, start_time)
    WHERE status NOT IN ('cancelled', 'no_show') AND (deleted_at IS NULL OR deleted_at = '')
  `);
}

function down(db) {
  db.exec('DROP INDEX IF EXISTS idx_appointments_clinic_start_unique');
}

module.exports = { up, down };
