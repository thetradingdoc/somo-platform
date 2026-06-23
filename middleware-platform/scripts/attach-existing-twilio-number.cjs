#!/usr/bin/env node
/**
 * Bind an existing Twilio number to a SaaS customer (DB + optional webhook).
 *
 *   node scripts/attach-existing-twilio-number.cjs \
 *     --customer-id=cust_xxx \
 *     --phone=+18622307479 \
 *     --twilio-sid=PNxxxxxxxx \
 *     [--update-webhook] [--dry-run]
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const TwilioPhoneService = require('../services/voice/twilio-phone-service');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq).replace(/-/g, '_')] = a.slice(eq + 1);
    } else {
      out[a.slice(2).replace(/-/g, '_')] = true;
    }
  }
  return out;
}

function publicBaseUrl() {
  const raw =
    process.env.PUBLIC_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.NGROK_URL ||
    process.env.BASE_URL ||
    '';
  return String(raw).replace(/\/$/, '');
}

async function main() {
  const args = parseArgs();
  const customerId = args.customer_id;
  const phone = String(args.phone || '').replace(/\s+/g, '');
  const twilioSid = args.twilio_sid;
  const dryRun = !!args.dry_run;
  const updateWebhook = !!args.update_webhook;

  if (!customerId || !phone || !twilioSid) {
    console.error('Required: --customer-id= --phone=+1... --twilio-sid=PN...');
    process.exit(1);
  }

  const customer = db.getCustomer(customerId);
  if (!customer) {
    console.error(`Customer not found: ${customerId}`);
    process.exit(1);
  }

  const base = publicBaseUrl();
  const webhookUrl = base
    ? `${base}/voice/incoming?customer_id=${encodeURIComponent(customerId)}`
    : null;

  console.log(`${dryRun ? '[dry-run] ' : ''}Attach Twilio number for ${customer.email || customerId}`);
  console.log(`  phone: ${phone}`);
  console.log(`  sid:   ${twilioSid}`);
  if (webhookUrl) console.log(`  voice webhook: ${webhookUrl}`);
  else console.warn('  ⚠️  Set API_BASE_URL or NGROK_URL for webhook URL preview');

  if (!dryRun) {
    db.updateCustomer(customerId, {
      twilio_phone_number: phone,
      twilio_phone_sid: twilioSid
    });

    let clinicId = customer.clinic_id || null;
    if (!clinicId && customer.merchant_id) {
      const clinic = db.db
        .prepare(`SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1`)
        .get(customer.merchant_id);
      clinicId = clinic?.clinic_id || null;
    }
    if (clinicId && typeof db.createClinicPhoneNumber === 'function') {
      try {
        const existing = db.db
          .prepare(`SELECT id FROM clinic_phone_numbers WHERE clinic_id = ? AND phone_number = ?`)
          .get(clinicId, phone);
        if (!existing) {
          db.createClinicPhoneNumber({
            id: `phone-${uuidv4()}`,
            clinic_id: clinicId,
            phone_number: phone,
            status: 'active'
          });
          console.log(`  clinic_phone_numbers: linked to ${clinicId}`);
        }
      } catch (e) {
        console.warn('  clinic_phone_numbers skipped:', e.message);
      }
    }

    if (updateWebhook && webhookUrl) {
      const twilio = new TwilioPhoneService();
      if (twilio.isConfigured) {
        await twilio.updatePhoneNumberWebhook(twilioSid, webhookUrl);
        console.log('  Twilio webhook updated.');
      } else {
        console.warn('  Twilio not configured — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
      }
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
