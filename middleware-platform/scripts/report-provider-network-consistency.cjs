#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function main() {
  const summary = db.db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM provider_payer_networks) AS total_links,
      (SELECT COUNT(*) FROM provider_payer_networks ppn
        LEFT JOIN provider_registry_entities p ON p.id = ppn.provider_entity_id
        WHERE p.id IS NULL) AS orphan_provider_links,
      (SELECT COUNT(*) FROM provider_payer_networks ppn
        LEFT JOIN payor_canonical_entities c ON c.id = ppn.payor_entity_id
        WHERE c.id IS NULL) AS orphan_payor_links,
      (SELECT COUNT(*) FROM provider_payer_networks
        WHERE network_status NOT IN ('in_network','out_of_network','unknown')) AS invalid_status_links
  `).get();

  const danglingSourceRecords = db.db.prepare(`
    SELECT COUNT(*) AS dangling_source_records
    FROM provider_network_source_records src
    WHERE src.provider_npi IS NOT NULL
      AND TRIM(src.provider_npi) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM provider_registry_entities p
        WHERE p.canonical_npi = src.provider_npi
      )
  `).get();

  console.log(JSON.stringify({
    event: 'provider_network_consistency_report',
    ...summary,
    dangling_source_records: Number(danglingSourceRecords?.dangling_source_records || 0),
    consistent: Number(summary.orphan_provider_links || 0) === 0 &&
      Number(summary.orphan_payor_links || 0) === 0 &&
      Number(summary.invalid_status_links || 0) === 0
  }, null, 2));
}

main();

