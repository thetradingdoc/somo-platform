#!/usr/bin/env node
'use strict';

/**
 * J-03 / MT-08 — minimal SQLite fixture for CI coding spine gates (2-clinic multitenant).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MP = path.join(__dirname, '..');
const dbPath = path.join(MP, 'var/db/middleware-dev.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

process.env.DB_PATH = dbPath;
process.env.SKIP_STARTUP_MIGRATIONS = '0';

if (!fs.existsSync(dbPath)) {
  execSync('node -e "require(\'./database\').runMigrations()"', {
    cwd: MP,
    env: process.env,
    stdio: 'inherit'
  });
}

const db = require('../database').db;

function ensureCode(table, code, description) {
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE code = ?`).get(code);
  if (exists) return;
  db.prepare(`INSERT INTO ${table} (code, description, created_at) VALUES (?, ?, datetime('now'))`).run(
    code,
    description
  );
}

function ensureCustomer(id, name, email) {
  const exists = db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id);
  if (exists) return;
  db.prepare(
    `INSERT INTO customers (id, name, email, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))`
  ).run(id, name, email);
}

function ensureClinic(clinicId, name, slug) {
  const exists = db.prepare('SELECT 1 FROM clinics WHERE clinic_id = ?').get(clinicId);
  if (exists) return;
  db.prepare(
    `INSERT INTO clinics (clinic_id, name, slug, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run(clinicId, name, slug);
}

function ensureCustomerClinic(customerId, clinicId, isPrimary = 0) {
  const exists = db
    .prepare('SELECT 1 FROM customer_clinics WHERE customer_id = ? AND clinic_id = ?')
    .get(customerId, clinicId);
  if (exists) return;
  db.prepare(
    `INSERT INTO customer_clinics (customer_id, clinic_id, is_primary, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(customerId, clinicId, isPrimary ? 1 : 0);
}

const codes = [
  ['icd10_codes', 'K29.70', 'Gastritis, unspecified, without bleeding'],
  ['icd10_codes', 'Z00.00', 'Encounter for general adult medical examination'],
  ['icd10_codes', 'Z01.20', 'Encounter for dental examination and cleaning'],
  ['icd10_codes', 'F32.9', 'Major depressive disorder, single episode, unspecified'],
  ['cpt_codes', '99213', 'Office outpatient visit est patient level 3'],
  ['cpt_codes', '99203', 'Office outpatient visit new patient level 3'],
  ['cpt_codes', '99214', 'Office outpatient visit est patient level 4'],
  ['cpt_codes', '90834', 'Psychotherapy 45 minutes'],
  ['cpt_codes', '90791', 'Psychiatric diagnostic evaluation'],
  ['cpt_codes', '99395', 'Periodic comprehensive preventive medicine'],
  ['cpt_codes', 'D1110', 'Prophylaxis adult'],
  ['hcpcs_codes', 'G0438', 'Annual wellness visit initial'],
  ['cdt_codes', 'D1110', 'Prophylaxis adult']
];

for (const [table, code, desc] of codes) {
  try {
    ensureCode(table, code, desc);
  } catch (e) {
    console.warn(`[ci-coding-db-fixture] skip ${table}/${code}:`, e.message);
  }
}

const clinics = [
  ['clinic-a', 'Clinic A Dental', 'clinic-a-dental', 'customer-clinic-a', 'clinic-a@fixture.test'],
  ['clinic-b', 'Clinic B Primary Care', 'clinic-b-primary', 'customer-clinic-b', 'clinic-b@fixture.test']
];

for (const [clinicId, name, slug, customerId, email] of clinics) {
  try {
    ensureClinic(clinicId, name, slug);
    ensureCustomer(customerId, name, email);
    ensureCustomerClinic(customerId, clinicId, 1);
  } catch (e) {
    console.warn(`[ci-coding-db-fixture] skip clinic ${clinicId}:`, e.message);
  }
}

try {
  const { seedPayerRules } = require('./lib/seed-payer-rules.cjs');
  seedPayerRules(MP);
} catch (e) {
  console.warn('[ci-coding-db-fixture] payer rules:', e.message);
}

console.log(JSON.stringify({
  ok: true,
  db: dbPath,
  clinics: ['clinic-a', 'clinic-b'],
  customers: ['customer-clinic-a', 'customer-clinic-b']
}, null, 2));
