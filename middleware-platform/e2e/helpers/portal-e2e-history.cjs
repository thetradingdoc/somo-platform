'use strict';

const fs = require('fs');
const manifest = require('./portal-p1-manifest.json');
const { HISTORY_FILE, RESULTS_DIR, P1_COVERAGE_WINDOW, log } = require('./portal-e2e-config.cjs');

function ensureDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function readHistory() {
  ensureDir();
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return fs
    .readFileSync(HISTORY_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendRun(entry) {
  ensureDir();
  const row = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(row)}\n`);
  log(`history: appended run env=${row.env} mode=${row.mode} p0_pass=${row.p0_pass}`);
  return row;
}

function p0PassRate(entries, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const slice = entries.filter((e) => new Date(e.ts).getTime() >= cutoff);
  if (!slice.length) return { rate: null, total: 0, passed: 0 };
  const passed = slice.filter((e) => e.p0_pass === true).length;
  return { rate: passed / slice.length, total: slice.length, passed };
}

function p1CoverageDebt(entries, window = P1_COVERAGE_WINDOW) {
  const prodReuse = entries.filter((e) => e.env === 'production' && e.mode === 'reuse').slice(-window);
  const seen = new Set();
  for (const run of prodReuse) {
    for (const id of run.p1_sampled || []) seen.add(id);
  }
  const allIds = manifest.controls.map((c) => c.id);
  const missing = allIds.filter((id) => !seen.has(id));
  return { window, runs: prodReuse.length, missing, covered: allIds.length - missing.length, total: allIds.length };
}

function intermittentFailures(entries, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const counts = {};
  for (const e of entries) {
    if (new Date(e.ts).getTime() < cutoff) continue;
    for (const f of e.p0_failed || []) {
      counts[f] = (counts[f] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .map(([control, count]) => ({ control, count }));
}

module.exports = {
  readHistory,
  appendRun,
  p0PassRate,
  p1CoverageDebt,
  intermittentFailures,
  HISTORY_FILE
};
