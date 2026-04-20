#!/usr/bin/env node
/**
 * Fix mistaken redirects that pointed middleware docs at docs/README.md#middleware-platform-readme#...
 * Canonical: docs/middleware-platform/README.md#...
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv']);

const EXT = new Set(['.md', '.js', '.cjs', '.mjs', '.jsx', '.tsx', '.ts', '.yml', '.yaml']);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (!SKIP_DIRS.has(name.name)) walk(p, out);
    } else if (EXT.has(path.extname(name.name))) {
      out.push(p);
    }
  }
}

function fix(s) {
  return s
    .replace(/\.\.\/README\.md#middleware-platform-readme#/g, '../middleware-platform/README.md#')
    .replace(/\(\.\/README\.md#middleware-platform-readme#/g, '(./middleware-platform/README.md#')
    .replace(/\]\(\.\/README\.md#middleware-platform-readme#/g, '](./middleware-platform/README.md#')
    .replace(/\.\/README\.md#middleware-platform-readme#/g, './middleware-platform/README.md#')
    .replace(/\(\.\/README\.md#middleware-platform-readme\)/g, '(./middleware-platform/README.md#readme)')
    .replace(/\]\(\.\/README\.md#middleware-platform-readme\)/g, '](./middleware-platform/README.md#readme)');
}

function main() {
  const files = [];
  walk(REPO, files);
  let n = 0;
  for (const abs of files) {
    const txt = fs.readFileSync(abs, 'utf8');
    const next = fix(txt);
    if (next !== txt) {
      fs.writeFileSync(abs, next, 'utf8');
      n++;
      console.log(path.relative(REPO, abs));
    }
  }
  console.log(JSON.stringify({ filesUpdated: n }, null, 2));
}

main();
