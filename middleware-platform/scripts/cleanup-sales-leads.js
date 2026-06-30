#!/usr/bin/env node
/**
 * Sanitize sales leads: strip job-board URLs, backfill languages.
 * Does NOT delete phoneless leads — use admin UI DELETE /api/admin/leads/:id instead.
 *
 * Usage: node scripts/cleanup-sales-leads.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const db = require('../database');
const { hasValidPhone, buildNotesWithJobPosting } = require('../services/lead-ingestion');
const { isJobBoardUrl } = require('../services/contact-extractor');
const { extractLanguagesFromJob } = require('../services/lead-language-extractor');

const dryRun = process.argv.includes('--dry-run');

const rows = db.db.prepare(`
  SELECT id, clinic_name, clinic_phone, source_url, notes
  FROM leads
  WHERE (is_test IS NULL OR is_test = 0)
    AND (lead_type IS NULL OR lead_type = 'sales')
`).all();

let phoneless = 0;
let sanitized = 0;
let languagesBackfilled = 0;

for (const row of rows) {
  if (!hasValidPhone(row.clinic_phone)) {
    phoneless++;
    console.log(`${dryRun ? '[dry-run] phoneless' : 'phoneless'}: ${row.clinic_name} (kept — delete via admin UI if junk)`);
    continue;
  }

  if (row.source_url && isJobBoardUrl(row.source_url)) {
    const notes = buildNotesWithJobPosting(row.source_url, row.notes);
    console.log(`${dryRun ? '[dry-run] sanitize' : 'sanitize'}: ${row.clinic_name} — job board URL removed`);
    if (!dryRun) {
      db.db.prepare('UPDATE leads SET source_url = NULL, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(notes, row.id);
    }
    sanitized++;
  }
}

for (const row of db.db.prepare(`
  SELECT id, title, description, required_languages
  FROM leads
  WHERE (is_test IS NULL OR is_test = 0)
    AND (lead_type IS NULL OR lead_type = 'sales')
    AND clinic_phone IS NOT NULL AND LENGTH(clinic_phone) > 0
    AND (required_languages IS NULL OR required_languages = '')
    AND description IS NOT NULL AND LENGTH(description) > 20
`).all()) {
  const lang = extractLanguagesFromJob({ title: row.title, description: row.description });
  if (!lang.required_languages.length) continue;
  console.log(`${dryRun ? '[dry-run] languages' : 'languages'}: ${row.title || row.id} → ${lang.required_languages.join(', ')}`);
  if (!dryRun) {
    db.db.prepare(`
      UPDATE leads SET required_languages = ?, preferred_language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(lang.required_languages), lang.preferred_language, row.id);
  }
  languagesBackfilled++;
}

console.log(`\nDone. phoneless_kept=${phoneless} sanitized=${sanitized} languages_backfilled=${languagesBackfilled}${dryRun ? ' (dry run)' : ''}`);
