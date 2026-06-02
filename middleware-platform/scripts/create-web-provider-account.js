#!/usr/bin/env node
/**
 * Create a production-style web provider tenant (not the local demo@doclittle seed).
 *
 * Creates the same core rows as POST /api/auth/signup:
 *   merchant → customer (SaaS) → clinic → user → free credits → clinic phone
 * Optional: Retell voice agent (set SKIP_RETELL=1 to skip).
 *
 * Enables provider_profile + online status so booking slots can resolve this provider.
 *
 * Usage (env or flags):
 *   node scripts/create-web-provider-account.js \
 *     --email=owner@callsomo.com \
 *     --name="Skin Care Admin" \
 *     --password='YourSecurePass8+' \
 *     --clinic-name="Skin & Care" \
 *     --phone=+15551234567
 *
 * Or via env:
 *   WEB_PROVIDER_EMAIL=... WEB_PROVIDER_PASSWORD=... WEB_PROVIDER_NAME="..." \
 *   WEB_CLINIC_NAME="..." WEB_CLINIC_PHONE=+1... \
 *   node scripts/create-web-provider-account.js
 *
 * Optional:
 *   --subdomain=skin-care   (fixed merchant subdomain; must be unique)
 *   SKIP_RETELL=1           skip Retell agent creation
 */

require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

process.chdir(path.join(__dirname, '..'));
const db = require('../database');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        const k = a.slice(2, eq).replace(/-/g, '_');
        out[k] = a.slice(eq + 1);
      } else {
        out[a.slice(2).replace(/-/g, '_')] = true;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const email = (
    args.email ||
    process.env.WEB_PROVIDER_EMAIL ||
    ''
  ).trim();
  const name = (args.name || process.env.WEB_PROVIDER_NAME || '').trim();
  const password = args.password || process.env.WEB_PROVIDER_PASSWORD || '';
  const clinicName = (args.clinic_name || process.env.WEB_CLINIC_NAME || '').trim();
  const clinicPhone = (args.phone || process.env.WEB_CLINIC_PHONE || '').trim();
  const fixedSubdomain = (args.subdomain || process.env.WEB_MERCHANT_SUBDOMAIN || '').trim() || null;
  const skipRetell =
    process.env.SKIP_RETELL === '1' ||
    process.env.SKIP_RETELL === 'true' ||
    args.skip_retell === true;

  if (!email || !password || !name || !clinicName || !clinicPhone) {
    console.error(`
Usage:
  node scripts/create-web-provider-account.js \\
    --email=you@company.com \\
    --name="Your Name" \\
    --password='min8chars' \\
    --clinic-name="Clinic Name" \\
    --phone=+15551234567

Optional: --subdomain=my-brand   SKIP_RETELL=1
`);
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  const normalizedPhone = clinicPhone.replace(/\s+/g, '');
  if (!phoneRegex.test(normalizedPhone)) {
    console.error('Use E.164 phone, e.g. +15551234567');
    process.exit(1);
  }

  let bcrypt;
  try {
    bcrypt = require('bcryptjs');
  } catch (_) {
    console.error('Install bcryptjs: npm install bcryptjs');
    process.exit(1);
  }

  if (db.getCustomerByEmail(email)) {
    console.error(`Customer already exists: ${email}`);
    process.exit(1);
  }
  if (db.getUserByEmail && db.getUserByEmail(email)) {
    console.error(`User already exists: ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const customerId = `cust_${uuidv4()}`;
  db.createCustomer({
    id: customerId,
    name,
    email,
    phone_number: normalizedPhone,
    company_name: clinicName,
    customer_type: 'saas',
    status: 'active',
    email_verified: 1
  });
  db.updateCustomer(customerId, {
    password_hash: passwordHash,
    customer_type: 'saas',
    status: 'active'
  });
  console.log(`  customer_id: ${customerId}`);

  const { provisionSaasTenant } = require('../services/saas-tenant-provision');
  const provisioned = provisionSaasTenant(db, {
    customerId,
    clinicName,
    phone: normalizedPhone,
    email,
    createUser: true,
    passwordHash,
    userName: name,
    subdomain: fixedSubdomain || undefined
  });
  const resolvedMerchantId = provisioned.merchantId;
  const clinicId = provisioned.clinicId;
  const createdMerchant = db.getMerchant(resolvedMerchantId);
  const subdomain = createdMerchant?.subdomain || fixedSubdomain || null;
  console.log(`  merchant_id: ${resolvedMerchantId}`);
  console.log(`  subdomain:   ${subdomain || '(none)'}`);
  console.log(`  clinic_id:   ${clinicId}`);

  try {
    db.allocateFreeCredits(customerId, 250);
  } catch (e) {
    console.warn('  (credits skipped)', e.message);
  }

  let retellAgentId = null;
  if (!skipRetell) {
    try {
      const RetellService = require('../services/retell-service');
      const retellService = new RetellService();
      const agentResult = await retellService.createAgent({
        name: clinicName,
        phone_number: normalizedPhone
      });
      if (agentResult.success) {
        retellAgentId = agentResult.agent_id;
        db.updateCustomerRetellAgent(customerId, retellAgentId, 'active');
        db.updateClinic(clinicId, {
          retell_agent_id: retellAgentId,
          retell_agent_status: 'active'
        });
        console.log(`  retell_agent: ${retellAgentId}`);
      } else {
        console.warn('  Retell agent not created:', agentResult.error || 'unknown');
      }
    } catch (e) {
      console.warn('  Retell skipped:', e.message);
    }
  } else {
    console.log('  retell: skipped (SKIP_RETELL)');
  }

  try {
    const ProviderService = require('../services/provider-service');
    ProviderService.ensureProviderProfileForEmail(email, clinicId);
    ProviderService.setProviderOnline(email, true);
    console.log('  provider availability: enabled (online)');
  } catch (e) {
    console.warn('  provider profile:', e.message);
  }

  try {
    if (typeof db.acceptTerms === 'function') {
      db.acceptTerms(customerId, '1.0', 'create-web-provider-account', 'cli');
    }
  } catch (_) {}

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Web provider tenant ready.');
  console.log('');
  console.log('  Login: unified-dashboard login.html with this email + password.');
  console.log('  Landing REACT_APP_MERCHANT_ID should match:');
  console.log(`    ${resolvedMerchantId}`);
  console.log('');
  console.log('  Subdomain URL (tenant.callsomo.com):');
  console.log(`    https://${subdomain || 'YOUR_SUBDOMAIN'}.callsomo.com/unified-dashboard/login.html`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
