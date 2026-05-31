#!/usr/bin/env node
'use strict';

/**
 * Shared staging DB helpers (GCS snapshot or Cloud SQL proxy → local SQLite path).
 * Set STAGING_DB_PATH or DB_PATH before require().
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveDbPath() {
  const p = process.env.STAGING_DB_PATH || process.env.DB_PATH;
  if (!p) {
    throw new Error('Set STAGING_DB_PATH or DB_PATH to staging SQLite file');
  }
  const resolved = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Database not found: ${resolved}`);
  }
  return resolved;
}

function openReadonlyDb() {
  const Database = require('better-sqlite3');
  return new Database(resolveDbPath(), { readonly: true });
}

function loadDatabase() {
  const dbPath = resolveDbPath();
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve('../database')];
  return require('../database');
}

function getEmailCodeFromPostgres(email) {
  if (!(process.env.POSTGRES_URL || '').trim()) {
    return null;
  }
  const helper = path.join(__dirname, 'staging-email-code-pg.cjs');
  const r = spawnSync(process.execPath, [helper, email], {
    encoding: 'utf8',
    env: process.env
  });
  if (r.status === 0 && r.stdout?.trim()) {
    return r.stdout.trim();
  }
  return null;
}

function getEmailCode(email) {
  const pgCode = getEmailCodeFromPostgres(email);
  if (pgCode) {
    return pgCode;
  }

  const sqlite = openReadonlyDb();
  try {
    const row = sqlite
      .prepare(
        `SELECT code FROM email_verification_codes
         WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(email);
    if (!row?.code) {
      throw new Error(`No active email verification code for ${email}`);
    }
    return row.code;
  } finally {
    sqlite.close();
  }
}

function getCustomerRow(whereSql, param) {
  const sqlite = openReadonlyDb();
  try {
    const row = sqlite
      .prepare(
        `SELECT id, email, trial_status, phone_verified, twilio_phone_number,
                twilio_phone_sid, merchant_id, retell_agent_id
         FROM customers WHERE ${whereSql} LIMIT 1`
      )
      .get(param);
    if (!row) {
      throw new Error(`No customer where ${whereSql}=${param}`);
    }
    return row;
  } finally {
    sqlite.close();
  }
}

function getCustomerByEmail(email) {
  return getCustomerRow('email = ?', email);
}

function getCustomerById(customerId) {
  return getCustomerRow('id = ?', customerId);
}

function tryGetCustomerById(customerId) {
  try {
    return getCustomerById(customerId);
  } catch (_) {
    return null;
  }
}

function findActiveTrialByPhone(phoneE164) {
  const sqlite = openReadonlyDb();
  try {
    return (
      sqlite
        .prepare(
          `SELECT id, email FROM customers
           WHERE phone_number = ? AND trial_status = 'active' AND twilio_phone_number IS NOT NULL
           LIMIT 1`
        )
        .get(phoneE164) || null
    );
  } finally {
    sqlite.close();
  }
}

function getOwnerCustomer() {
  const email = (process.env.SOMO_OWNER_EMAIL || '').trim();
  if (!email) {
    throw new Error('Set SOMO_OWNER_EMAIL for owner lookup');
  }
  return getCustomerByEmail(email);
}

function assertTrialCustomer(customer, { label = 'customer' } = {}) {
  const errors = [];
  if (customer.trial_status !== 'active') {
    errors.push(`${label}: trial_status expected active, got ${customer.trial_status}`);
  }
  if (customer.phone_verified !== 1) {
    errors.push(`${label}: phone_verified expected 1, got ${customer.phone_verified}`);
  }
  if (!customer.merchant_id) {
    errors.push(`${label}: merchant_id missing`);
  }
  if (!customer.twilio_phone_number || !/^\+1\d{10}$/.test(customer.twilio_phone_number)) {
    errors.push(`${label}: twilio_phone_number invalid: ${customer.twilio_phone_number || '(none)'}`);
  }
  if (!customer.twilio_phone_sid) {
    errors.push(`${label}: twilio_phone_sid missing`);
  }
  return errors;
}

function latestVoiceCallForCustomer(customerId, withinMinutes = 30) {
  const sqlite = openReadonlyDb();
  try {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const row = sqlite
      .prepare(
        `SELECT call_id, customer_id, created_at
         FROM voice_call_log
         WHERE customer_id = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(customerId, since);
    return row || null;
  } finally {
    sqlite.close();
  }
}

module.exports = {
  resolveDbPath,
  loadDatabase,
  getEmailCode,
  getCustomerByEmail,
  getCustomerById,
  tryGetCustomerById,
  findActiveTrialByPhone,
  getOwnerCustomer,
  assertTrialCustomer,
  latestVoiceCallForCustomer
};
