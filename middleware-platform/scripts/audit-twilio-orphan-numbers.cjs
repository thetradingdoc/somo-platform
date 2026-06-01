#!/usr/bin/env node
'use strict';

/**
 * Compare Twilio IncomingPhoneNumbers to local DB customer.twilio_phone_sid.
 * Orphans = numbers in Twilio not referenced by any customer row.
 *
 * Usage:
 *   node scripts/audit-twilio-orphan-numbers.cjs
 *   node scripts/audit-twilio-orphan-numbers.cjs --apply   # release orphans (not owner SID)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.chdir(require('path').join(__dirname, '..'));

const db = require('../database');
const TwilioPhoneService = require('../services/twilio-phone-service');

const APPLY = process.argv.includes('--apply');

function knownSidsFromDb() {
  const rows = db.db
    .prepare(
      `SELECT id, email, twilio_phone_sid AS sid, twilio_phone_number AS number
       FROM customers
       WHERE twilio_phone_sid IS NOT NULL AND TRIM(twilio_phone_sid) != ''`
    )
    .all();
  const bySid = new Map();
  for (const r of rows) {
    bySid.set(r.sid, r);
  }
  return bySid;
}

function extractCustomerIdFromVoiceUrl(voiceUrl) {
  if (!voiceUrl) return null;
  const m = String(voiceUrl).match(/customer_id=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

async function main() {
  const twilio = new TwilioPhoneService();
  if (!twilio.isAvailable()) {
    console.error('Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).');
    process.exit(1);
  }

  const known = knownSidsFromDb();
  const numbers = await twilio.listIncomingPhoneNumbers();

  console.log(`\nTwilio account: ${numbers.length} incoming number(s)`);
  console.log(`DB referenced SIDs: ${known.size}\n`);

  const orphans = [];
  const linked = [];

  for (const n of numbers) {
    const dbRow = known.get(n.sid);
    if (dbRow) {
      linked.push({ ...n, customerId: dbRow.id, email: dbRow.email });
      continue;
    }
    const cid = extractCustomerIdFromVoiceUrl(n.voiceUrl);
    orphans.push({ ...n, webhookCustomerId: cid });
  }

  if (linked.length) {
    console.log('Linked (in DB):');
    for (const n of linked) {
      console.log(`  ${n.phoneNumber}  ${n.sid}  → ${n.email} (${n.customerId})`);
    }
  }

  if (!orphans.length) {
    console.log('\nNo orphan numbers (all Twilio SIDs match a customer row).');
    return;
  }

  console.log(`\nOrphan candidates (${orphans.length}) — not in customers.twilio_phone_sid:`);
  for (const n of orphans) {
    console.log(`  ${n.phoneNumber}  ${n.sid}`);
    if (n.voiceUrl) console.log(`    voice_url: ${n.voiceUrl}`);
    if (n.webhookCustomerId) console.log(`    webhook customer_id: ${n.webhookCustomerId}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to release orphan SIDs (owner DB SIDs are never released).');
    return;
  }

  const protectedSids = new Set(known.keys());
  console.log('\nReleasing orphans…');
  for (const n of orphans) {
    if (protectedSids.has(n.sid)) {
      console.log(`  skip (protected): ${n.phoneNumber}`);
      continue;
    }
    try {
      await twilio.releasePhoneNumber(n.sid);
      console.log(`  released: ${n.phoneNumber}`);
    } catch (e) {
      if (e.response?.status === 404) {
        console.warn(`  already gone: ${n.phoneNumber}`);
      } else {
        console.error(`  failed ${n.phoneNumber}:`, e.message);
      }
    }
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
