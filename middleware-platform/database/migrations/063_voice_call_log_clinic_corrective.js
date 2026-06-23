'use strict';

function up(db) {
  const info = db.prepare('PRAGMA table_info(voice_call_log)').all();
  if (!info.some((c) => c.name === 'clinic_id')) return;
  db.exec(`
    UPDATE voice_call_log
    SET clinic_id = NULL
    WHERE clinic_id IS NOT NULL
      AND customer_id IS NOT NULL
      AND clinic_id = customer_id
  `);
}

function down() {}

module.exports = { up, down };
