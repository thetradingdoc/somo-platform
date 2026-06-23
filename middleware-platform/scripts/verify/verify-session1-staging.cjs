#!/usr/bin/env node
'use strict';

/**
 * Session 1 — verify staging deploy wiring (no deploy).
 * Checks api.callsomo.com health + local Cloud Run env generator output.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function fetchHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { url, ok: res.ok, status: res.status, json };
  } catch (e) {
    return { url, ok: false, error: e.message };
  }
}

async function main() {
  const mp = path.join(__dirname, '..');
  const health = await fetchHealth('https://api.callsomo.com/health');

  let yamlSnippet = null;
  try {
    const stagingExample = path.join(mp, '.env.staging.example');
    const gen = execSync('node scripts/generate-cloudrun-env-yaml.cjs --profile staging 2>/dev/null || node scripts/generate-cloudrun-env-yaml.cjs 2>/dev/null', {
      cwd: mp,
      encoding: 'utf8',
      env: { ...process.env, CLOUDRUN_PROFILE: 'staging' }
    });
    const lines = gen.split('\n').filter((l) =>
      /USE_TRIAGE_RAG_V2|RAG_API_URL|PINECONE_INDEX_HOST|RAG_CPT_FALLBACK_PINECONE/.test(l)
    );
    yamlSnippet = lines;
  } catch (e) {
    yamlSnippet = [`generator_error: ${e.message}`];
  }

  const stagingExample = fs.readFileSync(path.join(mp, '.env.staging.example'), 'utf8');
  const stagingHasSpine =
    stagingExample.includes('USE_TRIAGE_RAG_V2=1') &&
    stagingExample.includes('RAG_API_URL=disabled') &&
    stagingExample.includes('PINECONE_INDEX_HOST=');

  const result = {
    staging_api_health: health,
    staging_example_spine_wired: stagingHasSpine,
    cloudrun_yaml_spine_lines: yamlSnippet,
    deploy_script_preserves_spine: fs
      .readFileSync(path.join(mp, '..', 'scripts', 'deploy-to-gcp.sh'), 'utf8')
      .includes('USE_TRIAGE_RAG_V2=1'),
    assertion_passed: health.ok && stagingHasSpine
  };

  const outDir = path.join(mp, 'var', 'evidence', 'session1');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'staging-spine-verify.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.assertion_passed ? 0 : 2);
}

main();
