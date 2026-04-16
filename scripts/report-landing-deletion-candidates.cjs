/**
 * Produce safe deletion candidates for legacy landing pages.
 *
 * Inputs:
 * - todos/LANDING_DO_NOT_DELETE_ALLOWLIST.json
 *
 * Output:
 * - todos/LANDING_DELETION_CANDIDATES.md
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWLIST_PATH = path.join(ROOT, 'todos', 'LANDING_DO_NOT_DELETE_ALLOWLIST.json');
const OUTPUT_PATH = path.join(ROOT, 'todos', 'LANDING_DELETION_CANDIDATES.md');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const EXCLUDED_REFERENCE_FILES = new Set([
  'scripts/report-landing-deletion-candidates.cjs',
  'scripts/report-legacy-landing-references.cjs',
  'scripts/check-landing-route-canonicalization.cjs',
  'todos/LANDING_DELETION_CANDIDATES.md',
  'todos/LANDING_CONSOLIDATION_TODOS.md'
]);
const LEGACY_FILES = [
  'unified-dashboard/landing.html',
  'middleware-platform/public/landing.html'
];

function walk(dir, out = []) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!IGNORE_DIRS.has(item.name)) walk(full, out);
      continue;
    }
    out.push(full);
  }
  return out;
}

function isText(file) {
  const ext = path.extname(file).toLowerCase();
  return ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt'].includes(ext);
}

function loadAllowlist() {
  const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return new Set(Array.isArray(parsed.pages) ? parsed.pages : []);
}

function countReferences(target, files) {
  let count = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (EXCLUDED_REFERENCE_FILES.has(rel)) continue;
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes(target)) count += 1;
  }
  return count;
}

function decisionFor({ exists, allowlisted, refs }) {
  if (allowlisted) return 'PROTECTED_DO_NOT_DELETE';
  if (!exists) return 'NOT_PRESENT';
  if (refs > 0) return 'CANDIDATE_AFTER_MONITORING_AND_REF_CLEANUP';
  return 'SAFE_TO_DELETE_AFTER_MONITORING';
}

function main() {
  const allowlist = loadAllowlist();
  const files = walk(ROOT).filter(isText);
  const date = new Date().toISOString();

  const rows = LEGACY_FILES.map((relPath) => {
    const abs = path.join(ROOT, relPath);
    const exists = fs.existsSync(abs);
    const allowlisted = allowlist.has(relPath);
    const refs = countReferences(relPath, files);
    const decision = decisionFor({ exists, allowlisted, refs });
    const notes = allowlisted
      ? 'Protected by strict allowlist.'
      : refs > 0
        ? 'Still referenced in code/docs/scripts; keep redirect active until refs are cleaned and monitoring window closes.'
        : 'No direct path references detected.';
    return { relPath, exists, allowlisted, refs, decision, notes };
  });

  const protectedRows = [...allowlist].map((p) => {
    const abs = path.join(ROOT, p);
    return { relPath: p, exists: fs.existsSync(abs) };
  });

  const md = [
    '# Landing Deletion Candidates',
    '',
    `Generated: ${date}`,
    '',
    '## Legacy Candidates (Evaluation)',
    '',
    '| File | Exists | Allowlisted | Direct Refs | Decision | Notes |',
    '|---|---:|---:|---:|---|---|',
    ...rows.map((r) => `| \`${r.relPath}\` | ${r.exists ? 'Yes' : 'No'} | ${r.allowlisted ? 'Yes' : 'No'} | ${r.refs} | ${r.decision} | ${r.notes} |`),
    '',
    '## Strict Do-Not-Delete Allowlist',
    '',
    '| Protected Page | Exists |',
    '|---|---:|',
    ...protectedRows.map((r) => `| \`${r.relPath}\` | ${r.exists ? 'Yes' : 'No'} |`),
    '',
    '## Deletion Rule',
    '',
    '- Never delete allowlisted pages.',
    '- Delete a legacy page only after 1-2 week monitoring confirms no meaningful traffic and references are cleaned or intentionally retained for redirects.',
    ''
  ].join('\n');

  fs.writeFileSync(OUTPUT_PATH, md, 'utf8');
  console.log(`[landing-deletion-candidates] wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
