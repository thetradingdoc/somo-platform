#!/usr/bin/env node
'use strict';

/**
 * Local check: Stedi claim mode and webhook secret presence (not live API call).
 * Usage: node scripts/verify-stedi-env.cjs
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const InsuranceService = require('../services/insurance-service');
const mode = InsuranceService.getStediClaimSubmissionMode();
const secret = (process.env.STEDI_WEBHOOK_SECRET || '').trim();
const apiKey = (process.env.STEDI_API_KEY || '').trim();

console.log('\nStedi env check');
console.log('  STEDI_CLAIM_SUBMISSION_MODE:', mode);
console.log('  STEDI_API_KEY set:', Boolean(apiKey));
console.log('  STEDI_WEBHOOK_SECRET set:', Boolean(secret));
console.log('  Webhook path: POST /webhooks/stedi/claim-status');
console.log('  Prod URL: https://api.myskinandcare.com/webhooks/stedi/claim-status\n');

if (mode !== 'professional') {
  console.error('❌ Set STEDI_CLAIM_SUBMISSION_MODE=professional on Render before telehealth submit.');
  process.exit(1);
}
if (!secret) {
  console.warn('⚠️  STEDI_WEBHOOK_SECRET empty — enable after registering webhook in Stedi dashboard.');
}
console.log('✅ Professional (837P) mode configured locally.\n');
