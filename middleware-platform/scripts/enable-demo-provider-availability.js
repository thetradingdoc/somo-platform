#!/usr/bin/env node
/**
 * Canonical Specialist #1 onboarding for demo provider.
 * Ensures provider_profiles row exists, sets online status, and seeds availability blocks (9am-6pm Mon-Fri).
 *
 * Usage: node scripts/enable-demo-provider-availability.js [email]
 *   email: defaults to provider@callsomo.com
 */

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const ProviderService = require('../services/provider-service');

const EMAIL = process.argv[2] || 'provider@callsomo.com';
const TZ = process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York';

function addAvailabilityBlocks(providerEmail, daysAhead = 60) {
  const blocks = [];
  const now = new Date();
  for (let d = 0; d < daysAhead; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const day = date.getDay();
    if (day === 0 || day === 6) continue; // Skip weekend
    const dateStr = date.toISOString().slice(0, 10);
    blocks.push({
      id: `avb_${crypto.randomBytes(8).toString('hex')}`,
      provider_email: providerEmail,
      block_type: 'available',
      start_datetime: `${dateStr}T09:00:00`,
      end_datetime: `${dateStr}T18:00:00`,
      title: 'Business hours'
    });
  }
  return blocks;
}

async function main() {
  const c = db.getCustomerByEmail(EMAIL);
  if (!c) {
    console.error('Customer not found:', EMAIL);
    console.error('Run: npm run seed:demo first');
    process.exit(1);
  }

  db.updateCustomer(c.id, { provider_profile: JSON.stringify({ specialty: 'PrimaryCare' }) });
  const profile = ProviderService.ensureProviderProfileForEmail(EMAIL, process.env.DEFAULT_CLINIC_ID || 'clinic-default');
  if (!profile) {
    console.error('Failed to create canonical provider profile for:', EMAIL);
    process.exit(1);
  }
  ProviderService.setProviderOnline(EMAIL, true);

  const providerEmail = EMAIL.trim().toLowerCase();
  const blocks = addAvailabilityBlocks(providerEmail);
  let inserted = 0;
  for (const b of blocks) {
    try {
      ProviderService.createAvailabilityBlock(b);
      inserted++;
    } catch (e) {
      if (!e.message?.includes('UNIQUE')) console.warn('Skip block:', e.message);
    }
  }

  console.log('✅ Demo provider enabled for availability:', EMAIL);
  console.log('   • canonical provider_profile set:', profile.id);
  console.log('   • is_online = true');
  console.log('   • availability blocks: 9am-6pm Mon-Fri,', inserted, 'days');
  console.log('');
  console.log('Slots will now respect provider_availability_blocks for this provider.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
