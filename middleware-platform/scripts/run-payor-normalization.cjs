#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { normalizeRawRecords } = require('../services/payor-normalization-service');

function getArg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const untilDone = process.argv.includes('--until-done');
const source = getArg('source', null);
const limit = Number(getArg('limit', '5000'));
const offset = Number(getArg('offset', '0'));
const version = getArg('version', 'v1');

if (untilDone && !source) {
  console.error('Usage: --until-done requires --source=<value> (payor_source_records.source), e.g. --source=nppes_bulk');
  process.exit(1);
}

if (untilDone) {
  const pageSize = Number.isFinite(limit) && limit > 0 ? limit : 5000;
  let off = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  let totalScanned = 0;
  let totalUpserted = 0;
  let rounds = 0;
  while (true) {
    rounds += 1;
    const out = normalizeRawRecords({
      source,
      limit: pageSize,
      offset: off,
      normalizationVersion: version
    });
    totalScanned += out.scanned;
    totalUpserted += out.upserted;
    if (out.scanned < pageSize) break;
    off += pageSize;
    if (rounds % 20 === 0) {
      console.error(
        `[payor-normalization] --until-done progress source=${source} offset=${off} scanned_this_round=${out.scanned} upserted_total=${totalUpserted}`
      );
    }
  }
  console.log(
    JSON.stringify(
      {
        event: 'payor_normalization_run_completed',
        mode: 'until_done',
        source,
        rounds,
        total_scanned: totalScanned,
        total_upserted: totalUpserted,
        normalizationVersion: version
      },
      null,
      2
    )
  );
} else {
  const out = normalizeRawRecords({
    source,
    limit: Number.isFinite(limit) ? limit : 5000,
    offset: Number.isFinite(offset) ? offset : 0,
    normalizationVersion: version
  });

  console.log(JSON.stringify({ event: 'payor_normalization_run_completed', source: source || 'all', ...out }, null, 2));
}
