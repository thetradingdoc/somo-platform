'use strict';

const manifest = require('./portal-p1-manifest.json');
const { readHistory } = require('./portal-e2e-history.cjs');
const { P1_COVERAGE_WINDOW, log } = require('./portal-e2e-config.cjs');

function pickSampleForRun(runIndex, count = 4) {
  const controls = manifest.controls;
  const start = runIndex % controls.length;
  const picked = [];
  for (let i = 0; i < Math.min(count, controls.length); i++) {
    picked.push(controls[(start + i) % controls.length]);
  }
  return picked;
}

function nextRunIndex() {
  const hist = readHistory().filter((e) => e.env === 'production' && e.mode === 'reuse');
  return hist.length;
}

function selectP1ForConfig(config) {
  if (!config.tierIncludesP1) return [];
  if (!config.isProd) return manifest.controls;
  const idx = nextRunIndex();
  const sample = pickSampleForRun(idx, 4);
  log(`p1-sampler: prod reuse run #${idx} → ${sample.map((c) => c.id).join(', ')}`);
  return sample;
}

function assertP1CoverageOrWarn() {
  const hist = readHistory();
  const prodRuns = hist.filter((e) => e.env === 'production' && e.mode === 'reuse').slice(-P1_COVERAGE_WINDOW);
  const seen = new Set();
  for (const r of prodRuns) for (const id of r.p1_sampled || []) seen.add(id);
  const missing = manifest.controls.map((c) => c.id).filter((id) => !seen.has(id));
  if (prodRuns.length >= P1_COVERAGE_WINDOW && missing.length) {
    log(`p1-sampler: WARN coverage debt after ${P1_COVERAGE_WINDOW} runs: ${missing.join(', ')}`);
    return { ok: false, missing };
  }
  return { ok: true, missing, runs: prodRuns.length };
}

module.exports = { selectP1ForConfig, pickSampleForRun, assertP1CoverageOrWarn, manifest };
