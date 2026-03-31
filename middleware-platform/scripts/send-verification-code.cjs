/* eslint-disable no-console */
require('dotenv').config();

// Usage:
//   DB_PATH=./middleware-dev.db EMAIL=drlittlekids@gmail.com node scripts/send-verification-code.cjs
//
// This sends a *real* verification email using EmailVerificationService, which:
// - creates a 6-digit code in DB
// - calls EmailService.sendCheckoutVerificationCode(email, code)
//
// Watch output for:
// - "📧 Email sent via Azure:"  (real delivery attempt via Azure)
// - "📧 Email sent via SMTP:"  (real delivery attempt via SMTP)
// - "📧 EMAIL (SIMULATED):"    (no provider configured / could not send)

const EmailVerificationService = require('../services/email-verification-service');

async function main() {
  const email = String(process.env.EMAIL || '').trim();
  if (!email) throw new Error('Set EMAIL=someone@example.com');

  console.log('[SendVerificationCode] sending to:', email);
  console.log('[SendVerificationCode] AZURE configured:', !!process.env.AZURE_COMMUNICATION_CONNECTION_STRING);
  console.log('[SendVerificationCode] SMTP configured:', !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD));

  const r = await EmailVerificationService.sendVerificationCode(email);
  console.log('[SendVerificationCode] result:', {
    success: r && r.success,
    email_sent: r && r.email_sent,
    expires_at: r && r.expires_at,
    // The service currently returns code for debug/testing.
    code: r && r.code
  });
}

main().catch((e) => {
  console.error('[SendVerificationCode] FAILED:', e.message);
  process.exitCode = 1;
});

