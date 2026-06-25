#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'unified-dashboard'),
  path.join(ROOT, 'middleware-platform/public'),
  path.join(ROOT, 'patient-app'),
];

const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'playwright-report', 'test-results']);
const EXT = new Set(['.html', '.css', '.js', '.jsx', '.json', '.webmanifest', '.md']);

const COLOR_MAP = [
  ['#1e40af', '#1C35EA'],
  ['#1E40AF', '#1C35EA'],
  ['#314db6', '#1C35EA'],
  ['#314DB6', '#1C35EA'],
  ['#3b82f6', '#1C35EA'],
  ['#3B82F6', '#1C35EA'],
  ['#1b5ee4', '#1C35EA'],
  ['#2563eb', '#1529C4'],
  ['#ffa51f', '#1C35EA'],
  ['#e8951a', '#1529C4'],
];

const TEXT_REPLACEMENTS = [
  [/DodgeCall/g, 'Somo'],
  [/DocLittle/gi, 'Somo'],
  [/Doctor Little LLC/gi, 'Somo'],
  [/Doctor Little/gi, 'Somo'],
  [/Skin & Care/g, 'Somo'],
  [/Skin and Care/gi, 'Somo'],
  [/FrontDesk Provider Portal/gi, 'Somo Provider'],
  [/FrontDesk/g, 'Somo'],
  [/Consʌlt/g, 'Somo'],
  [/Consult/g, 'Somo'],
  [/Meet your AI call center from the future\.?/gi, 'Never answer business calls again.'],
  [/LittleLab/gi, 'Somo'],
  [/myskinandcare\.com/gi, (m) => m], // keep URLs — display-only pass skips
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

let changed = 0;
for (const base of DIRS) {
  for (const file of walk(base)) {
    if (file.includes('dodgecall-demo') || file.includes('/dist/')) continue;
    let text = fs.readFileSync(file, 'utf8');
    const orig = text;
    for (const [from, to] of COLOR_MAP) {
      text = text.split(from).join(to);
    }
    for (const [re, rep] of TEXT_REPLACEMENTS) {
      if (typeof rep === 'function') continue;
      text = text.replace(re, rep);
    }
    if (text !== orig) {
      fs.writeFileSync(file, text);
      changed += 1;
    }
  }
}
console.log(`rebrand-somo-ui: updated ${changed} files`);
