/**
 * Task 4: Add practitioner_id to appointments for provider-level availability.
 * Task 51: Add timezone column to appointments for timezone-aware storage.
 */
function up(db) {
  try {
    const info = db.prepare('PRAGMA table_info(appointments)').all();

    if (!info.some(c => c.name === 'practitioner_id')) {
      db.exec('ALTER TABLE appointments ADD COLUMN practitioner_id TEXT');
      console.log('✅ Migration: appointments.practitioner_id added');
    }

    if (!info.some(c => c.name === 'timezone')) {
      db.exec("ALTER TABLE appointments ADD COLUMN timezone TEXT DEFAULT 'America/New_York'");
      console.log('✅ Migration: appointments.timezone added');
    }
  } catch (e) {
    console.warn('⚠️  Migration 004 practitioner_id/timezone:', e.message);
  }
}

function down(db) {
  // SQLite does not support DROP COLUMN easily; leave columns in place
  console.warn('Migration 004 down: column drop not supported in SQLite');
}

module.exports = { up, down };
