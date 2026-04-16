#!/usr/bin/env node
'use strict';

const dbModule = require('../database');
const { buildScanSummary } = require('../services/product-summary-service');

function main() {
  const db = dbModule.db;
  const rows = db.prepare(`
    SELECT id, snapshot_json
    FROM session_result_snapshots
    ORDER BY created_at DESC
    LIMIT 50000
  `).all();

  let updated = 0;
  const tx = db.transaction(() => {
    const upd = db.prepare(`
      UPDATE session_result_snapshots
      SET snapshot_json = ?, semantic_contract_version = ?
      WHERE id = ?
    `);
    for (const row of rows) {
      const snap = (() => { try { return JSON.parse(String(row.snapshot_json || '{}')); } catch (_) { return null; } })();
      if (!snap || typeof snap !== 'object') continue;
      if (snap?.result_summary?.semantic_contract && snap?.result_summary?.semantic_contract_version) continue;
      const route = String(snap?.scanned_product?.category_route || snap?.category_route || 'unknown');
      const contract = buildScanSummary({ categoryRoute: route }).semantic_contract;
      if (!snap.result_summary || typeof snap.result_summary !== 'object') snap.result_summary = {};
      snap.result_summary.semantic_contract = contract;
      snap.result_summary.semantic_contract_version = contract?.semantic_contract_version || '1';
      snap.result_summary.legacy_pre_contract = true;
      upd.run(JSON.stringify(snap), String(contract?.semantic_contract_version || '1'), row.id);
      updated += 1;
    }
  });
  tx();
  console.log(`[backfill-legacy-semantic-contracts] updated ${updated} snapshot(s)`);
}

main();
