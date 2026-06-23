'use strict';

const { dbLog } = require('../../log');

module.exports = function migrateVoiceCallLogCosts(db) {
  try {
    const voiceCallLogColumns = db.pragma('table_info(voice_call_log)');
    const columnNames = voiceCallLogColumns.map(col => col.name);

    const costColumns = {
      'twilio_call_sid': 'TEXT',
      'twilio_cost_usd': 'REAL',
      'retell_cost_usd': 'REAL',
      'total_cost_usd': 'REAL',
      'twilio_cost_calculated_usd': 'REAL',
      'retell_cost_calculated_usd': 'REAL',
      'cost_source': 'TEXT',
      'cost_updated_at': 'DATETIME'
    };

    Object.keys(costColumns).forEach(colName => {
      if (!columnNames.includes(colName)) {
        dbLog(`📦 Adding ${colName} column to voice_call_log table...`);
        db.exec(`ALTER TABLE voice_call_log ADD COLUMN ${colName} ${costColumns[colName]};`);
        dbLog(`✅ Migration complete: ${colName} column added`);
      }
    });

    // Create indexes for cost tracking
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_call_log_twilio_sid ON voice_call_log(twilio_call_sid);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_call_log_created_at ON voice_call_log(created_at);`);

    dbLog('✅ Migration complete: voice_call_log cost columns ensured');
  } catch (migrationError) {
    console.warn('⚠️  voice_call_log cost columns migration failed:', migrationError.message);
  }
}

// ============================================
// MIGRATION: Voice call state tables (medical coding agent)
// ============================================

