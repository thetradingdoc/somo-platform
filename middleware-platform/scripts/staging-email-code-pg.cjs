#!/usr/bin/env node
'use strict';

/**
 * Print latest unused email verification code from live Postgres (staging Cloud SQL).
 * Usage: POSTGRES_URL=... node scripts/staging-email-code-pg.cjs user@example.com
 */

const email = (process.argv[2] || '').trim();
if (!email) {
  process.exit(1);
}

const url = (process.env.POSTGRES_URL || '').trim();
if (!url) {
  process.exit(1);
}

async function main() {
  const { Pool } = require('pg');
  const ssl =
    process.env.POSTGRES_SSL === '1' || /sslmode=require/i.test(url)
      ? { rejectUnauthorized: false }
      : undefined;
  const pool = new Pool({ connectionString: url, max: 1, ssl });
  try {
    const r = await pool.query(
      `SELECT code FROM email_verification_codes
       WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );
    const code = r.rows[0]?.code;
    if (code) {
      process.stdout.write(String(code).trim());
    } else {
      process.exit(2);
    }
  } finally {
    await pool.end();
  }
}

main().catch(() => process.exit(1));
