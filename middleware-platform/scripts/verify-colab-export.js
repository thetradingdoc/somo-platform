#!/usr/bin/env node
/**
 * Verify Colab export loads.
 * Run: node scripts/verify-colab-export.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

let loaded = false;
const origLog = console.log;
console.log = (...args) => {
  const msg = args.join(' ');
  if (msg.includes('Colab export loaded')) loaded = true;
  origLog.apply(console, args);
};

try {
  const ks = require('../services/knowledge-service');
  const stats = ks.getExportStats ? ks.getExportStats() : {};
  origLog('\n--- Verification ---');
  origLog('colab_export.loaded:', stats.loaded);
  origLog('version:', stats.version || 'N/A');
  origLog(loaded && stats.loaded ? '\n✅ [knowledge-service] Colab export loaded' : '\n❌ Colab export NOT loaded');
  process.exit(loaded && stats.loaded ? 0 : 1);
} catch (e) {
  origLog('Error:', e.message);
  process.exit(1);
}
