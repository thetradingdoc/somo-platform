/* eslint-disable no-console */
require('dotenv').config();

// Usage:
//   DB_PATH=./middleware-dev.db EMAIL=drlittlekids@gmail.com node scripts/test-email-verification-gate.cjs
//
// This test proves the end-to-end *verification state* flow:
// - create/send a code
// - verify the code
// - confirm `isEmailVerified(email)` returns true

const db = require('../database');
const EmailVerificationService = require('../services/email-verification-service');

async function main() {
  const email = String(process.env.EMAIL || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Set EMAIL=someone@example.com');
  }

  console.log('[EmailVerifyGateTest] using DB_PATH:', process.env.DB_PATH || '(default)');
  console.log('[EmailVerifyGateTest] email:', email);

  // Generate a deterministic code so we can verify without reading inbox.
  const code = EmailVerificationService.generateCode();
  db.createEmailVerificationCode(email, code, null);
  console.log('[EmailVerifyGateTest] code created in DB:', code);

  const v = await EmailVerificationService.verifyCode(email, code);
  console.log('[EmailVerifyGateTest] verifyCode result:', v);

  const ok = await EmailVerificationService.isEmailVerified(email);
  console.log('[EmailVerifyGateTest] isEmailVerified:', ok);

  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[EmailVerifyGateTest] FAILED:', e.message);
  process.exitCode = 1;
});

