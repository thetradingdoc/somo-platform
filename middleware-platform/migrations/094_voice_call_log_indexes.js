'use strict';

/**
 * Hot-path indexes for voice_call_log metrics and CallSid dedupe.
 */

function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_voice_call_log_customer_created
      ON voice_call_log(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_voice_call_log_call_id
      ON voice_call_log(call_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_log_twilio_sid_unique
      ON voice_call_log(twilio_call_sid)
      WHERE twilio_call_sid IS NOT NULL AND twilio_call_sid != '';
  `);
}

function down() {}

module.exports = { up, down };
