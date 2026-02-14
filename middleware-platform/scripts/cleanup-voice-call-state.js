#!/usr/bin/env node
/**
 * Clean up voice call state data older than retention period (default 30 days).
 * Includes: voice_call_states, voice_conversation_memory, agent_state_snapshots, coding_decisions.
 * Run via cron or manually: node scripts/cleanup-voice-call-state.js [days]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const db = require('../database');
const retentionDays = parseInt(process.argv[2] || '30', 10) || 30;

const result = db.cleanupVoiceCallStateData(retentionDays);
console.log(`Done: deleted ${result.deleted} records (retention: ${result.retentionDays} days)`);
