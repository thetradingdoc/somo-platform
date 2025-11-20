#!/usr/bin/env node

/**
 * Export selected SQLite tables into a Postgres-compatible SQL seed file.
 *
 * Usage:
 *   node scripts/export-sqlite-to-postgres.js [output-path]
 *
 * If no output path is provided, the file is written to
 * ../backups/postgres-seed-<timestamp>.sql
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const db = require('../database');

const TABLES = [
  {
    name: 'clinics',
    create: `
CREATE TABLE IF NOT EXISTS clinics (
  clinic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  email TEXT,
  address TEXT,
  business_hours TEXT,
  services TEXT,
  retell_agent_id TEXT,
  retell_agent_status TEXT DEFAULT 'pending',
  merchant_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`.trim(),
    query: 'SELECT * FROM clinics'
  },
  {
    name: 'clinic_phone_numbers',
    create: `
CREATE TABLE IF NOT EXISTS clinic_phone_numbers (
  phone_number TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES clinics(clinic_id),
  is_primary BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`.trim(),
    query: 'SELECT * FROM clinic_phone_numbers'
  },
  {
    name: 'appointments',
    create: `
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT REFERENCES clinics(clinic_id),
  patient_name TEXT NOT NULL,
  patient_phone TEXT,
  patient_email TEXT,
  patient_id TEXT,
  appointment_type TEXT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  provider TEXT,
  status TEXT,
  notes JSONB,
  reminder_sent BOOLEAN DEFAULT FALSE,
  calendar_event_id TEXT,
  calendar_link TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`.trim(),
    query: 'SELECT * FROM appointments'
  },
  {
    name: 'voice_checkouts',
    create: `
CREATE TABLE IF NOT EXISTS voice_checkouts (
  id TEXT PRIMARY KEY,
  clinic_id TEXT REFERENCES clinics(clinic_id),
  merchant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  amount NUMERIC(12,2) NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  payment_token TEXT,
  payment_intent_id TEXT,
  merchant_order_id TEXT,
  fhir_patient_id TEXT,
  fhir_encounter_id TEXT,
  appointment_id TEXT,
  payment_method TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);`.trim(),
    query: 'SELECT * FROM voice_checkouts'
  },
  {
    name: 'voice_call_log',
    create: `
CREATE TABLE IF NOT EXISTS voice_call_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  call_id TEXT NOT NULL,
  twilio_call_sid TEXT,
  call_duration_seconds INTEGER,
  call_duration_minutes NUMERIC,
  credits_deducted INTEGER,
  function_calls_count INTEGER,
  status TEXT,
  twilio_cost_usd NUMERIC,
  retell_cost_usd NUMERIC,
  total_cost_usd NUMERIC,
  twilio_cost_calculated_usd NUMERIC,
  retell_cost_calculated_usd NUMERIC,
  cost_source TEXT,
  cost_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`.trim(),
    query: 'SELECT * FROM voice_call_log'
  },
  {
    name: 'function_call_log',
    create: `
CREATE TABLE IF NOT EXISTS function_call_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  call_id TEXT,
  function_name TEXT NOT NULL,
  parameters JSONB,
  response_time_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`.trim(),
    query: 'SELECT * FROM function_call_log'
  },
  {
    name: 'customers',
    create: `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  company_name TEXT,
  business_size TEXT,
  use_case TEXT,
  api_features JSONB,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  plan_tier TEXT DEFAULT 'starter',
  status TEXT DEFAULT 'pending',
  retell_agent_id TEXT,
  retell_agent_status TEXT DEFAULT 'pending',
  customer_type TEXT DEFAULT 'api',
  twilio_phone_number TEXT,
  twilio_phone_sid TEXT,
  pricing_tier TEXT DEFAULT 'starter',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`.trim(),
    query: 'SELECT * FROM customers'
  }
];

function formatValue(value) {
  if (value === null || value === undefined) return 'NULL';

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }

  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

function buildInsertStatements(tableName, rows) {
  if (!rows || rows.length === 0) {
    return [`-- No rows for ${tableName}`];
  }

  const columns = Object.keys(rows[0]);
  return rows.map(row => {
    const values = columns.map(col => formatValue(row[col]));
    return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
  });
}

async function exportTables(outputPath) {
  const lines = [];
  lines.push('-- Postgres seed generated from SQLite');
  lines.push(`-- Generated at ${new Date().toISOString()}`);
  lines.push('');

  TABLES.forEach(table => {
    lines.push(`-- ${table.name}`);
    lines.push(table.create);
    lines.push(`TRUNCATE TABLE ${table.name} CASCADE;`);

    const rows = db.db.prepare(table.query).all();
    lines.push(...buildInsertStatements(table.name, rows));
    lines.push('');
  });

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`✅ Postgres seed written to ${outputPath}`);
}

async function main() {
  try {
    const backupsDir = path.join(__dirname, '..', '..', 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });

    const customPath = process.argv[2];
    const defaultName = `postgres-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    const outputPath = customPath
      ? path.resolve(customPath)
      : path.join(backupsDir, defaultName);

    await exportTables(outputPath);
  } catch (error) {
    console.error('❌ Failed to export Postgres seed:', error.message);
    process.exit(1);
  }
}

main();

