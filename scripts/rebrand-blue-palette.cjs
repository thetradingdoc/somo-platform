#!/usr/bin/env node
'use strict';

/**
 * Replace legacy Somo green brand hex with unified blue palette.
 * Semantic success greens (#16a34a, #48bb78, etc.) are NOT replaced.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'unified-dashboard'),
  path.join(ROOT, 'middleware-platform/public'),
  path.join(ROOT, 'middleware-platform/lib'),
  path.join(ROOT, 'middleware-platform/services'),
  path.join(ROOT, 'docs'),
  path.join(ROOT, '.cursor'),
];

const EXTRA_FILES = [
  path.join(ROOT, 'scripts/rebrand-somo-ui.cjs'),
  path.join(ROOT, 'scripts/migrate-admin-brand.cjs'),
];

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'build',
  'hosting-dist',
  '.git',
  'playwright-report',
  'test-results',
  '_archive',
  'gecko-legacy',
]);

const EXT = new Set(['.html', '.css', '.js', '.jsx', '.json', '.webmanifest', '.tsx', '.ts', '.md', '.mdc']);

const COLOR_MAP = [
  ['#16A637', '#1C35EA'],
  ['#16a637', '#1C35EA'],
  ['#128A2E', '#1529C4'],
  ['#128a2e', '#1529C4'],
  ['#E8F7ED', '#EEF0FE'],
  ['#e8f7ed', '#EEF0FE'],
  ['#B5E930', '#1C35EA'],
  ['#b5e930', '#1C35EA'],
  ['#9FD628', '#1529C4'],
  ['#9fd628', '#1529C4'],
  ['#164437', '#000000'],
  ['#238108', '#1529C4'],
  ['#F4FBE8', '#EEF0FE'],
  ['#f4fbe8', '#EEF0FE'],
  ['#E8F7D0', '#E8EBFD'],
  ['#e8f7d0', '#E8EBFD'],
  ['#14532D', '#121F9E'],
  ['#14532d', '#121F9E'],
  ['#166534', '#121F9E'],
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (EXT.has(path.extname(ent.name))) files.push(p);
  }
  return files;
}

function shouldSkip(file) {
  if (file.includes('rebrand-blue-palette.cjs')) return true;
  if (file.includes('gecko-legacy')) return true;
  if (file.includes('/_archive/')) return true;
  return false;
}

let changed = 0;
const allFiles = new Set();
for (const base of DIRS) {
  for (const file of walk(base)) allFiles.add(file);
}
for (const file of EXTRA_FILES) {
  if (fs.existsSync(file)) allFiles.add(file);
}

for (const file of allFiles) {
  if (shouldSkip(file)) continue;
  let text = fs.readFileSync(file, 'utf8');
  const orig = text;
  for (const [from, to] of COLOR_MAP) {
    text = text.split(from).join(to);
  }
  if (text !== orig) {
    fs.writeFileSync(file, text);
    changed += 1;
    console.log('updated:', path.relative(ROOT, file));
  }
}

console.log(`rebrand-blue-palette: updated ${changed} files`);
