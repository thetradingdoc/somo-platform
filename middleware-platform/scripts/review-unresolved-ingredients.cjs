#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const db = require('../database');

const args = process.argv.slice(2);
const limit = Math.max(10, Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 100));
const applyFile = args.find((a) => a.startsWith('--apply='))?.split('=')[1] || '';
const markResolved = args.includes('--mark-resolved');
const weeklyReport = args.includes('--weekly-report');

function parseJsonArray(v) {
  try {
    const p = JSON.parse(v || '[]');
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return [];
  }
}

function loadAliasPatches(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function applyAliasPatches(patches) {
  let applied = 0;
  for (const row of patches) {
    const token = String(row?.raw_token || row?.alias || '').trim().toLowerCase();
    const canonical = String(row?.canonical_inci || '').trim().toLowerCase();
    if (!token || !canonical) continue;
    const up = db.upsertIngredientAlias(token, canonical, 'weekly_unresolved_review', 'weekly_review');
    if (!up?.success) continue;
    applied += 1;
    if (markResolved) {
      db.db.prepare(`
        UPDATE ingredient_unresolved_queue
        SET status = 'resolved', last_seen_at = datetime('now')
        WHERE raw_token = ?
      `).run(token);
    }
  }
  return applied;
}

function renderWeeklyMarkdown(rows, outputPath) {
  const lines = [
    `# Ingredient unresolved weekly review`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `| token | count | status | sample_barcodes |`,
    `|---|---:|---|---|`
  ];
  for (const r of rows) {
    const samples = parseJsonArray(r.sample_barcodes_json).slice(0, 5).join(', ');
    lines.push(`| ${r.raw_token} | ${Number(r.occurrence_count || 0)} | ${r.status || 'pending'} | ${samples} |`);
  }
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function run() {
  let appliedAliases = 0;
  if (applyFile) {
    const patches = loadAliasPatches(applyFile);
    appliedAliases = applyAliasPatches(patches);
  }

  const rows = db.db.prepare(`
    SELECT raw_token, occurrence_count, status, sample_barcodes_json, first_seen_at, last_seen_at
    FROM ingredient_unresolved_queue
    WHERE status IN ('pending', 'resolved')
    ORDER BY occurrence_count DESC, datetime(last_seen_at) DESC
    LIMIT ?
  `).all(limit);

  let weeklyReportPath = null;
  if (weeklyReport) {
    weeklyReportPath = path.join(__dirname, `../reports/ingredient-unresolved-weekly-${new Date().toISOString().slice(0, 10)}.md`);
    fs.mkdirSync(path.dirname(weeklyReportPath), { recursive: true });
    renderWeeklyMarkdown(rows, weeklyReportPath);
  }

  console.log(JSON.stringify({
    success: true,
    reviewed: rows.length,
    applied_aliases: appliedAliases,
    weekly_report_path: weeklyReportPath,
    rows
  }, null, 2));
}

run();
