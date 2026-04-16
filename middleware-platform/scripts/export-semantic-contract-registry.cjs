#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Registry = require('../services/semantic-contract-registry');

function main() {
  const payload = {
    generated_at: new Date().toISOString(),
    live_version: Registry.getLiveSemanticContractVersion(),
    contracts: Registry.listSemanticContracts()
  };
  const outDir = path.join(__dirname, '..', 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `semantic-contract-registry-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[semantic-contract-registry] wrote ${outPath}`);
}

main();
