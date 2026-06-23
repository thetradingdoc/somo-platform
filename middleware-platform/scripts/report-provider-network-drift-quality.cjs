#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { computeProviderNetworkDriftQuality } = require('../services/platform/provider-network-drift-quality-service');

function main() {
  const payload = computeProviderNetworkDriftQuality(db.db);
  console.log(JSON.stringify(payload, null, 2));
}

main();
