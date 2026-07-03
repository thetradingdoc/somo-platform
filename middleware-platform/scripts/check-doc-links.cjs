#!/usr/bin/env node
'use strict';

/**
 * Verify relative markdown links resolve to tracked files.
 * Scans all markdown under docs/ from repo root.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'docs', 'design'),
  path.join(REPO_ROOT, 'docs', 'Brand', 'SOMO_GUIDELINES.md'),
  path.join(REPO_ROOT, 'docs', 'voice-agent', 'PROD_VENDOR_GATES.md'),
  path.join(REPO_ROOT, 'docs', 'voice-agent', 'phase2-pilot-checklist.md'),
  path.join(REPO_ROOT, 'docs', 'voice-agent', 'README.md')
];

const LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;
const SKIP_SCHEMES = /^(https?:|mailto:|#)/i;
const DESIGN_LINK = /(^|\/)design\//i;

function collectMarkdownFiles(target, acc = []) {
  if (!fs.existsSync(target)) return acc;
  const st = fs.statSync(target);
  if (st.isFile() && target.endsWith('.md')) {
    acc.push(target);
    return acc;
  }
  if (!st.isDirectory()) return acc;
  for (const name of fs.readdirSync(target)) {
    const full = path.join(target, name);
    const child = fs.statSync(full);
    if (child.isDirectory()) collectMarkdownFiles(full, acc);
    else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

function resolveLink(fromFile, target) {
  const cleaned = target.split('#')[0].split('?')[0].trim();
  if (!cleaned || SKIP_SCHEMES.test(cleaned)) return null;
  if (path.isAbsolute(cleaned)) {
    return fs.existsSync(cleaned) ? null : cleaned;
  }
  const fromDir = path.resolve(path.dirname(fromFile));
  const resolved = path.normalize(path.join(fromDir, cleaned));
  if (fs.existsSync(resolved)) return null;
  const fromRepo = path.normalize(path.join(REPO_ROOT, cleaned));
  if (fs.existsSync(fromRepo)) return null;
  return path.relative(REPO_ROOT, resolved);
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => collectMarkdownFiles(root));
  const broken = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = LINK_RE.exec(content)) !== null) {
      const href = match[1];
      if (!DESIGN_LINK.test(href) && !file.includes(`${path.sep}design${path.sep}`)) continue;
      const missing = resolveLink(file, href);
      if (missing) {
        broken.push({
          file: path.relative(REPO_ROOT, file),
          link: href,
          resolved: missing
        });
      }
    }
  }

  if (broken.length) {
    console.error('check-doc-links: broken links found:\n');
    for (const row of broken) {
      console.error(`  ${row.file}: (${row.link}) -> ${row.resolved}`);
    }
    process.exit(1);
  }

  console.log(`check-doc-links: OK (${files.length} markdown files)`);
}

main();
