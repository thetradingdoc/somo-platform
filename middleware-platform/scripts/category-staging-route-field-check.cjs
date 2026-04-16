#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    apiBase: process.env.API_BASE || 'http://127.0.0.1:4000',
    output: process.env.OUTPUT || '',
    samples: [
      { endpoint: 'beautyfacts', barcode: '8809652637891' },
      { endpoint: 'foodfacts', barcode: '049000042566' }
    ]
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--api-base') out.apiBase = String(argv[++i] || out.apiBase);
    if (a === '--output') out.output = String(argv[++i] || out.output);
  }
  return out;
}

function getJson(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod
      .get(url, (res) => {
        let buf = '';
        res.on('data', (d) => { buf += String(d); });
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf || '{}'));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const required = ['category_route', 'category_route_source', 'category_route_confidence', 'category_route_rule_id'];
  const errors = [];
  const evidence = {
    generated_at: new Date().toISOString(),
    api_base: args.apiBase,
    required_fields: required,
    samples: []
  };
  for (const s of args.samples) {
    const url = `${args.apiBase.replace(/\/$/, '')}/api/public/${s.endpoint}/${s.barcode}`;
    const data = await getJson(url);
    const missing = required.filter((k) => data[k] == null);
    const row = { sample: s, route_fields: required.reduce((a, k) => ((a[k] = data[k]), a), {}) };
    evidence.samples.push(row);
    console.log(JSON.stringify(row, null, 2));
    if (missing.length) errors.push({ sample: s, missing });
  }
  evidence.errors = errors;
  evidence.pass = errors.length === 0;
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[category-staging-route-field-check] wrote ${args.output}`);
  }
  if (errors.length) {
    console.error('[category-staging-route-field-check] FAIL');
    console.error(JSON.stringify(errors, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log('[category-staging-route-field-check] PASS');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
