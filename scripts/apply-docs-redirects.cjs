#!/usr/bin/env node
/**
 * Replace old docs paths with docs/<folder>/README.md#anchor using
 * docs/_consolidated_path_redirects.json (from consolidate-docs-subfolders.cjs).
 *
 * Skips lines containing "Former path:" (preserves merge provenance).
 * Skips rewriting docs/_consolidated_path_redirects.json.
 *
 * Usage: node scripts/apply-docs-redirects.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const MAP = path.join(REPO, 'docs', '_consolidated_path_redirects.json');
const SKIP_FILES = new Set([path.normalize(path.join(REPO, 'docs', '_consolidated_path_redirects.json'))]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.venv',
  '__pycache__',
  'out',
]);

const EXT = new Set([
  '.md',
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.tsx',
  '.ts',
  '.yml',
  '.yaml',
  '.json',
  '.sh',
  '.txt',
  '.css',
]);

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (!shouldSkipDir(name.name)) walk(p, out);
    } else if (EXT.has(path.extname(name.name))) {
      out.push(p);
    }
  }
}

function buildPairs(raw) {
  const base = Object.entries(raw).sort((a, b) => b[0].length - a[0].length);
  const seen = new Set();
  const pairs = [];

  function add(from, to) {
    if (from === to) return;
    const k = `${from}\0${to}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push([from, to]);
  }

  for (const [k, v] of base) {
    add(k, v);

    if (k.startsWith('docs/')) {
      add(`../${k}`, `../${v}`);
    }

    const vDocs = v.startsWith('docs/') ? v : null;
    if (k.startsWith('docs/') && vDocs) {
      add(`./${k.slice(5)}`, `./${vDocs.slice(5)}`);
      add(`../${k.slice(5)}`, `../${vDocs.slice(5)}`);
    }
  }

  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

function replaceLine(line, pairs) {
  if (/Former path:/i.test(line)) return line;
  let s = line;
  for (const [from, to] of pairs) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  return s;
}

function main() {
  if (!fs.existsSync(MAP)) {
    console.error('Missing', MAP);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const pairs = buildPairs(raw);

  const files = [];
  walk(REPO, files);

  let n = 0;
  for (const abs of files) {
    if (SKIP_FILES.has(path.normalize(abs))) continue;
    const txt = fs.readFileSync(abs, 'utf8');
    const lines = txt.split('\n');
    const out = lines.map((line) => replaceLine(line, pairs));
    const next = out.join('\n');
    if (next !== txt) {
      fs.writeFileSync(abs, next, 'utf8');
      n++;
      console.log(path.relative(REPO, abs));
    }
  }
  console.log(JSON.stringify({ filesUpdated: n }, null, 2));
}

main();
