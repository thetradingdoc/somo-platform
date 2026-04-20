#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const db = require('../database');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'docs', 'runbooks');
const OUT_FILE = path.resolve(OUT_DIR, `DLQ_TOOL_CALLS_TERMINAL_ARCHIVE_${Date.now()}.json`);

function isTerminal(entry) {
  const fn = String(entry?.function_name || '').trim().toLowerCase();
  const err = String(entry?.error_message || '').toLowerCase();
  if (fn === 'checkout_backfill_reconciliation') return true;
  if (err.includes('unknown tool')) return true;
  if (err.includes('not implemented')) return true;
  return false;
}

function main() {
  const before = typeof db.getDlqToolCallsSize === 'function' ? Number(db.getDlqToolCallsSize() || 0) : 0;
  const rows = typeof db.getDlqToolCalls === 'function' ? db.getDlqToolCalls(5000) : [];
  const terminalRows = rows.filter(isTerminal);
  const terminalIds = new Set(terminalRows.map((r) => r.id));

  const archived = [];
  if (db.db && terminalRows.length) {
    const stmt = db.db.prepare('DELETE FROM dlq_tool_calls WHERE id = ?');
    const tx = db.db.transaction((items) => {
      for (const r of items) {
        archived.push({
          id: r.id,
          call_id: r.call_id,
          function_name: r.function_name,
          error_message: r.error_message,
          created_at: r.created_at
        });
        stmt.run(r.id);
      }
    });
    tx(terminalRows);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    archived_at: new Date().toISOString(),
    archived_count: archived.length,
    archived
  }, null, 2));

  const after = typeof db.getDlqToolCallsSize === 'function' ? Number(db.getDlqToolCallsSize() || 0) : 0;
  const out = {
    success: true,
    before_size: before,
    terminal_identified: terminalRows.length,
    archived_count: archived.length,
    after_size: after,
    below_threshold: after < 50,
    archive_file: OUT_FILE,
    sample_terminal_ids: Array.from(terminalIds).slice(0, 5)
  };
  console.log(JSON.stringify(out, null, 2));
}

main();

