/**
 * Legacy landing reference report.
 *
 * Scans repository text files and reports references to legacy landing paths/files
 * so removal can be done safely after monitoring.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const TARGETS = [
  'unified-dashboard/landing.html',
  'middleware-platform/public/landing.html',
  '/landing',
  '/landing.html'
];

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) walk(full, out);
      continue;
    }
    out.push(full);
  }
  return out;
}

function isTextCandidate(file) {
  const ext = path.extname(file).toLowerCase();
  return ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt'].includes(ext);
}

const allFiles = walk(ROOT).filter(isTextCandidate);
const report = TARGETS.map((target) => ({ target, hits: [] }));

for (const file of allFiles) {
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const item of report) {
    if (content.includes(item.target)) item.hits.push(rel);
  }
}

console.log('Legacy landing reference report:\n');
for (const item of report) {
  console.log(`- ${item.target}: ${item.hits.length} file(s)`);
  for (const hit of item.hits.slice(0, 25)) console.log(`  - ${hit}`);
  if (item.hits.length > 25) console.log(`  - ... and ${item.hits.length - 25} more`);
  console.log('');
}
