#!/usr/bin/env node
/**
 * Clean up video consult data older than retention period (default 30 days).
 * P2 Data retention. Run via cron or manually.
 *
 * Usage: node scripts/cleanup-video-consult-data.js [days]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../database');
const retention = require('../config/retention-policy');

const retentionDays = parseInt(process.argv[2] || retention.video_consult_sessions || '30', 10) || 30;

const result = db.cleanupVideoConsultData(retentionDays);
console.log(`Done: deleted ${result.deleted} records (retention: ${retentionDays} days)`);
