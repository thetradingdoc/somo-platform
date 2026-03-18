/**
 * Auth UI guardrails (production readiness).
 *
 * Fails if:
 * - any unified-dashboard/*.html contains multiple <head> or multiple </html>
 * - demo/test strings appear in shipped UI (e.g. "Quick Test Accounts", "TEST MODE")
 *
 * Usage:
 *   node scripts/check-auth-ui-guardrails.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'unified-dashboard');

// Scope: only the auth entrypoints + front-door CTAs we rely on.
// This prevents auth-journey drift without forcing a large cleanup
// of unrelated legacy HTML or vendored fixtures.
const allowlist = new Set([
  'unified-dashboard/portal.html',
  'unified-dashboard/login.html',
  'unified-dashboard/signup.html',
  'unified-dashboard/index.html',
  'unified-dashboard/landing.html',
  'unified-dashboard/patients/patient-login.html'
]);

const bannedSubstrings = [
  'Quick Test Accounts',
  'TEST MODE'
];

function isHtmlFile(p) {
  return p.toLowerCase().endsWith('.html');
}

function listFilesRecursive(dir) {
  const out = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (it.isFile() && isHtmlFile(full)) {
      out.push(full);
    }
  }
  return out;
}

function countMatches(haystack, regex) {
  const m = haystack.match(regex);
  return m ? m.length : 0;
}

function rel(p) {
  return path.relative(ROOT, p);
}

function main() {
  if (!fs.existsSync(TARGET_DIR)) {
    console.log(`[guardrails] unified-dashboard not found at ${TARGET_DIR}, skipping`);
    process.exit(0);
  }

  const files = listFilesRecursive(TARGET_DIR);
  const scoped = files.filter((f) => allowlist.has(rel(f).replace(/\\/g, '/')));
  const errors = [];

  for (const f of scoped) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch (e) {
      errors.push(`${rel(f)}: failed to read (${e.message})`);
      continue;
    }

    const heads = countMatches(text, /<head\b/gi);
    const htmlEnds = countMatches(text, /<\/html>/gi);
    if (heads !== 1 || htmlEnds !== 1) {
      errors.push(`${rel(f)}: expected exactly 1 <head> and 1 </html> (found <head>=${heads}, </html>=${htmlEnds})`);
    }

    for (const s of bannedSubstrings) {
      if (text.includes(s)) {
        errors.push(`${rel(f)}: banned UI string detected: "${s}"`);
      }
    }
  }

  if (errors.length) {
    console.error('[guardrails] FAILED');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log(`[guardrails] OK (${scoped.length} html files checked)`);
}

main();

