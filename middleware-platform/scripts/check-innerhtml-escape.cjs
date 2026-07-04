#!/usr/bin/env node
'use strict';

/**
 * Flag innerHTML assignments that interpolate variables without escapeHtml/esc.
 * Heuristic: ${...} in innerHTML template without esc(apeHtml) on same line.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'unified-dashboard');
const SCAN_DIRS = ['admin/assets/js'];

const INNER_HTML_RE = /\.innerHTML\s*=\s*`([^`]*\$\{[^`]*)`/g;
const SAFE_MARKERS = [/escapeHtml\s*\(/, /\besc\s*\(/, /SomoHtml\.escapeHtml/, /ui\.escapeHtml/];

function collectJsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) collectJsFiles(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function checkFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('.innerHTML')) continue;
    if (!line.includes('${')) continue;
    if (SAFE_MARKERS.some((re) => re.test(line))) continue;
    if (/innerHTML\s*=\s*['"]/.test(line)) continue;
    violations.push({ line: i + 1, text: line.trim() });
  }

  return violations.length ? { rel, violations } : null;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => collectJsFiles(path.join(ROOT, d)));
  const failures = files.map(checkFile).filter(Boolean);

  if (failures.length) {
    console.error('check-innerhtml-escape: potential unescaped innerHTML:\n');
    for (const f of failures) {
      for (const v of f.violations) {
        console.error(`  ${f.rel}:${v.line}  ${v.text}`);
      }
    }
    process.exit(1);
  }

  console.log(`check-innerhtml-escape: OK (${files.length} files scanned)`);
}

main();
