#!/usr/bin/env node
/**
 * Soft-delete (deleted_at) appointments that are either:
 *   - tied to the demo provider SaaS customer (provider@doclittle.com), or
 *   - patient display name is "Jeremiah Richard" (any phone — fixes duplicate-phone confusion).
 *
 * Usage (from middleware-platform):
 *   node scripts/purge-demo-provider-and-jeremiah-appointments.js
 *   node scripts/purge-demo-provider-and-jeremiah-appointments.js --dry-run
 */

require('dotenv').config();
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

const DRY = process.argv.includes('--dry-run');
const DEMO_EMAIL = 'provider@doclittle.com';

function normName(n) {
  return String(n || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function main() {
  const sqlite = db.db || db;
  const customer = db.getCustomerByEmail(DEMO_EMAIL);
  const demoCustomerId = customer?.id || null;

  const rows = sqlite.prepare(`
    SELECT id, patient_name, patient_phone, patient_email, customer_id, provider, date, status
    FROM appointments
    WHERE deleted_at IS NULL
      AND (
        (? IS NOT NULL AND customer_id = ?)
        OR lower(trim(patient_name)) = 'jeremiah richard'
      )
  `).all(demoCustomerId, demoCustomerId);

  const byPhone = {};
  for (const r of rows) {
    const p = r.patient_phone || '(no phone)';
    byPhone[p] = (byPhone[p] || 0) + 1;
  }

  console.log(DRY ? 'DRY RUN — no changes' : 'Purging (soft delete)');
  console.log('Demo customer:', DEMO_EMAIL, demoCustomerId || '(not found — only name match applies)');
  console.log('Rows to update:', rows.length);
  if (Object.keys(byPhone).length) {
    console.log('Jeremiah / demo rows by patient_phone:', byPhone);
  }
  rows.forEach((r) => {
    console.log(`  • ${r.id} | ${r.patient_name} | ${r.patient_phone || '-'} | ${r.date} | ${r.provider}`);
  });

  if (DRY || rows.length === 0) return;

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  try {
    sqlite.prepare(`DELETE FROM appointment_slot_assignments WHERE appointment_id IN (${placeholders})`).run(...ids);
  } catch (e) {
    console.warn('Slot assignments cleanup:', e.message);
  }

  try {
    sqlite.prepare(`DELETE FROM appointment_todos WHERE appointment_id IN (${placeholders})`).run(...ids);
  } catch (e) {
    /* table optional */
  }

  const info = sqlite.prepare(`
    UPDATE appointments
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE deleted_at IS NULL AND id IN (${placeholders})
  `).run(...ids);

  console.log('Soft-deleted appointments:', info.changes);
}

main();
