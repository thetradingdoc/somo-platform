#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const { spawn } = require('child_process');

const SLA_MS = Number(process.env.ENRICHMENT_FRESHNESS_SLA_MS || 45000);

async function runBackfillBatch() {
  return await new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(
      'node',
      ['./scripts/backfill-product-ingredients.cjs', '--batch=50', '--catalog=obf'],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d || ''); });
    child.stderr.on('data', (d) => { stderr += String(d || ''); });
    child.on('error', reject);
    child.on('exit', (code) => {
      const elapsed = Date.now() - start;
      if (code !== 0) {
        reject(new Error(`backfill exited=${code} stderr=${stderr.slice(-500)}`));
        return;
      }
      resolve({ elapsed, stdout });
    });
  });
}

async function main() {
  const { elapsed, stdout } = await runBackfillBatch();
  if (elapsed > SLA_MS) throw new Error(`enrichment SLA breached elapsed=${elapsed}ms sla=${SLA_MS}ms`);
  console.log(`[verify-enrichment-freshness-sla] PASS elapsed=${elapsed}ms sla=${SLA_MS}ms`);
  if (stdout) console.log(stdout.trim());
}

main().catch((e) => {
  console.error('[verify-enrichment-freshness-sla] FAIL', e.message || e);
  process.exit(1);
});
