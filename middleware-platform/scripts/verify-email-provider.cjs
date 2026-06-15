#!/usr/bin/env node
/**
 * Verify production/staging email provider configuration.
 * Usage: node scripts/verify-email-provider.cjs [recipient@email.com]
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const EmailService = require('../services/email-service');

async function main() {
  const to = process.argv[2] || process.env.SOMO_OWNER_EMAIL || process.env.SMTP_USER;
  if (!to) {
    console.error('Usage: node scripts/verify-email-provider.cjs recipient@example.com');
    process.exit(1);
  }

  const health = EmailService.getEmailHealth();
  console.log('Email health:', JSON.stringify(health, null, 2));

  if (health.provider_configured === 'none') {
    console.error('❌ No email provider configured');
    process.exit(1);
  }

  const result = await EmailService.sendEmail({
    to,
    subject: 'Somo email provider verification',
    html: '<p>If you received this, transactional email is working.</p>',
    text: 'If you received this, transactional email is working.'
  });

  console.log('Send result:', JSON.stringify(result, null, 2));
  if (!result.success) {
    console.error('❌ Email send failed');
    process.exit(1);
  }
  console.log(`✅ Test email sent via ${result.provider} to ${to}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
