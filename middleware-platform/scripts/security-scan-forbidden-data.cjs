'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET_DIRS = ['test-results', 'logs'];
const FILE_RE = /\.(log|txt|json|jsonl|md)$/i;
const PAN_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const CVV_RE = /\b(cvv|cvc|security code)\b[:=\s-]*\d{3,4}\b/i;
const SECRET_RE = /\b(client_secret|payment_token|verification_code)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]{6,}/i;

const findings = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.git')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (FILE_RE.test(ent.name)) inspect(full);
  }
}

function inspect(filePath) {
  let txt = '';
  try { txt = fs.readFileSync(filePath, 'utf8'); } catch (_) { return; }
  const lines = txt.split('\n');
  lines.forEach((line, idx) => {
    if (PAN_RE.test(line) || CVV_RE.test(line) || SECRET_RE.test(line)) {
      findings.push({ file: path.relative(ROOT, filePath), line: idx + 1, sample: line.slice(0, 180) });
    }
  });
}

for (const d of TARGET_DIRS) walk(path.join(ROOT, d));

if (findings.length) {
  console.error('[security-scan-forbidden-data] FAILED. Potential sensitive data patterns found:');
  findings.slice(0, 200).forEach((f) => {
    console.error(`- ${f.file}:${f.line} ${f.sample}`);
  });
  process.exit(1);
}

console.log('[security-scan-forbidden-data] PASS (artifact/log scope)');
