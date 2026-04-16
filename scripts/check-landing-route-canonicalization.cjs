/**
 * Landing route canonicalization guardrail.
 *
 * Ensures server route declarations keep public entrypoints stable:
 * - legacy landing paths redirect to "/"
 * - "/skin-care" route exists
 * - "/team-kelly" route exists
 * - "/waitlist" and "/invite" routes exist
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'middleware-platform', 'server.js');
const text = fs.readFileSync(serverPath, 'utf8');

const checks = [
  { key: 'legacy landing redirect', pattern: "app.get(['/landing', '/landing.html']" },
  { key: 'legacy redirect to root', pattern: "res.redirect(301, `/${qs}`)" },
  { key: 'skin-care route', pattern: "app.get('/skin-care'" },
  { key: 'team-kelly route', pattern: "app.get('/team-kelly'" },
  { key: 'waitlist route', pattern: "app.get('/waitlist'" },
  { key: 'invite route', pattern: "app.get('/invite'" }
];

const missing = checks.filter((c) => !text.includes(c.pattern));
if (missing.length) {
  console.error('[landing-canonicalization] FAILED');
  for (const item of missing) console.error(`- missing: ${item.key}`);
  process.exit(1);
}

console.log('[landing-canonicalization] OK');
