#!/usr/bin/env node
'use strict';

/**
 * Gov-03 — verify relative markdown links in Kelly coding SSOT cross-link files.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const FILES = [
  'docs/Medical Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md',
  'docs/Medical Coding/ARCHITECTURE.md',
  'docs/Medical Coding/README.md',
  'docs/Medical Coding/COVERAGE_MATRIX.md',
  'docs/Medical Coding/KELLY_PHASE_C_SIGNOFF.md',
  'docs/meta/CANONICAL_DOC_MAP.md',
  'docs/architecture/PLATFORM_SNAPSHOT.md',
  'docs/architecture/AGENTIC_FINANCE_REVIEW.md',
  'docs/clinical/KELLY_F09_GOVERNANCE.md',
  'todos/CODING-FOUNDATION.md',
  'todos/PENDING.md'
].map((p) => path.join(REPO_ROOT, p));

const LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;
const SKIP = /^(https?:|mailto:|#)/i;

function decodeHref(href) {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Gov-03: coding SSOT scope — avoid failing on unrelated legacy PENDING links. */
function shouldCheckLink(fromFile, href) {
  const rel = path.relative(REPO_ROOT, fromFile).replace(/\\/g, '/');
  const decoded = decodeHref(href);
  if (SKIP.test(decoded)) return false;
  const codingPath =
    /Medical Coding|clinical\/KELLY|COVERAGE_MATRIX|KELLY_CODING|CODING-FOUNDATION|AGENTIC_FINANCE|PROD_DB_PARITY/i.test(
      decoded
    );
  if (/^docs\/Medical Coding\//.test(rel)) return true;
  if (/^docs\/clinical\/KELLY/.test(rel)) return true;
  if (rel === 'docs/meta/CANONICAL_DOC_MAP.md') return codingPath || /Medical Coding/.test(rel);
  if (rel === 'docs/architecture/PLATFORM_SNAPSHOT.md') return codingPath;
  if (rel === 'docs/architecture/AGENTIC_FINANCE_REVIEW.md') return codingPath;
  if (rel === 'todos/CODING-FOUNDATION.md') return codingPath;
  if (rel === 'todos/PENDING.md') return codingPath;
  return true;
}

function resolve(fromFile, href) {
  const decoded = decodeHref(href);
  const cleaned = decoded.split('#')[0].split('?')[0].trim();
  if (!cleaned || SKIP.test(cleaned)) return null;
  const candidates = [
    path.normalize(path.join(path.dirname(fromFile), cleaned)),
    path.normalize(path.join(REPO_ROOT, cleaned))
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return null;
  }
  return path.relative(REPO_ROOT, candidates[0]);
}

function main() {
  const broken = [];
  for (const file of FILES) {
    if (!fs.existsSync(file)) {
      broken.push({ file: path.relative(REPO_ROOT, file), link: '(missing file)', resolved: '—' });
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = LINK_RE.exec(content)) !== null) {
      if (!shouldCheckLink(file, m[1])) continue;
      const miss = resolve(file, m[1]);
      if (miss) {
        broken.push({
          file: path.relative(REPO_ROOT, file),
          link: m[1],
          resolved: miss
        });
      }
    }
  }
  if (broken.length) {
    console.error('check-coding-ssot-links: broken links:\n');
    for (const row of broken) {
      console.error(`  ${row.file}: (${row.link}) -> ${row.resolved}`);
    }
    process.exit(1);
  }
  console.log(`check-coding-ssot-links: OK (${FILES.length} files)`);
}

main();
