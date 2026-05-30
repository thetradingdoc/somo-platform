#!/usr/bin/env node
/**
 * Create or update the Somo owner provider account from env or local/provider-login.credentials.
 *
 * Usage (from middleware-platform/):
 *   npm run ensure:somo-owner
 *
 * Env: SOMO_OWNER_EMAIL, SOMO_OWNER_PASSWORD, optional SOMO_OWNER_CLINIC_PHONE,
 *      SOMO_OWNER_NAME, SOMO_OWNER_CLINIC_NAME
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function parseCredentialsFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key === 'email') out.email = val;
    else if (key === 'password') out.password = val;
    else if (key === 'clinic_phone' || key === 'phone') out.phone = val;
  }
  return out;
}

function loadConfig() {
  const credPath = path.join(__dirname, '..', '..', 'local', 'provider-login.credentials');
  const file = parseCredentialsFile(credPath);
  return {
    email: (process.env.SOMO_OWNER_EMAIL || file.email || '').trim(),
    password: process.env.SOMO_OWNER_PASSWORD || file.password || '',
    phone: (process.env.SOMO_OWNER_CLINIC_PHONE || file.phone || '').trim(),
    name: (process.env.SOMO_OWNER_NAME || 'Somo Owner').trim(),
    clinicName: (process.env.SOMO_OWNER_CLINIC_NAME || 'Somo Clinic').trim()
  };
}

async function hashPassword(password) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hash(password, 10);
}

async function updateExisting(customer, passwordHash, phone) {
  const patch = {
    password_hash: passwordHash,
    email_verified: 1,
    status: 'active',
    customer_type: 'saas',
    kelly_status: customer.kelly_status || 'active',
    retell_agent_status: customer.retell_agent_status || 'active'
  };
  if (phone) patch.phone_number = phone.replace(/\s+/g, '');
  if (customer.twilio_phone_number && !phone) {
    patch.phone_number = patch.phone_number || customer.twilio_phone_number;
  }
  db.updateCustomer(customer.id, patch);
  try {
    if (!db.hasAcceptedTerms(customer.id, '1.0')) {
      db.acceptTerms(customer.id, '1.0', 'ensure-somo-owner', 'cli');
    }
  } catch (_) {}
  return db.getCustomer(customer.id);
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.email || !cfg.password) {
    console.error(`
Missing SOMO_OWNER_EMAIL / SOMO_OWNER_PASSWORD.

Set in middleware-platform/.env or copy:
  local/provider-login.credentials.example → local/provider-login.credentials

See local/README.md
`);
    process.exit(1);
  }
  if (cfg.password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = db.getCustomerByEmail(cfg.email);
  if (existing) {
    const passwordHash = await hashPassword(cfg.password);
    let updated = await updateExisting(existing, passwordHash, cfg.phone);
    if (!updated.merchant_id && cfg.phone) {
      console.log('Provisioning merchant + clinic for existing customer…');
      const { provisionSaasTenant } = require('../services/saas-tenant-provision');
      provisionSaasTenant(db, {
        customerId: updated.id,
        phone: cfg.phone.replace(/\s+/g, ''),
        clinicName: cfg.clinicName,
        email: cfg.email,
        createUser: false
      });
      updated = db.getCustomer(updated.id);
    } else if (updated.merchant_id) {
      db.migrateVoiceAgentSettingsToMerchant(updated.id, updated.merchant_id);
    }
    console.log('Updated existing provider account:');
    console.log(`  email:       ${updated.email}`);
    console.log(`  customer_id: ${updated.id}`);
    console.log(`  merchant_id: ${updated.merchant_id || '(none)'}`);
    if (updated.twilio_phone_number) {
      console.log(`  line:        ${updated.twilio_phone_number}`);
    }
    console.log(`\nSign in: ${process.env.BASE_URL || 'http://localhost:4000'}/login`);
    return;
  }

  if (!cfg.phone) {
    console.error('No account found for this email. Set SOMO_OWNER_CLINIC_PHONE (+E.164) to create one.');
    process.exit(1);
  }

  const script = path.join(__dirname, 'create-web-provider-account.js');
  const args = [
    script,
    `--email=${cfg.email}`,
    `--name=${cfg.name}`,
    `--password=${cfg.password}`,
    `--clinic-name=${cfg.clinicName}`,
    `--phone=${cfg.phone.replace(/\s+/g, '')}`
  ];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (r.status !== 0) process.exit(r.status || 1);
  console.log(`\nSign in: ${process.env.BASE_URL || 'http://localhost:4000'}/login`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
