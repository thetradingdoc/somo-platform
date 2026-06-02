#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [path.join(ROOT, 'docs'), path.join(ROOT, 'todos'), path.join(ROOT, 'unified-dashboard/somo-landing')];
const SKIP = new Set(['node_modules', '.git', 'archive', '_archive', 'hosting-dist']);
const EXT = new Set(['.md', '.html', '.json']);

const REPLACEMENTS = [
  [/DocLittle/g, 'Somo'],
  [/doclittle\.site/gi, 'api.callsomo.com'],
  [/api\.doclittle/gi, 'api.callsomo'],
  [/myskinandcare\.com/gi, 'callsomo.com'],
  [/api\.myskinandcare\.com/gi, 'api.callsomo.com'],
  [/DodgeCall/g, 'Somo'],
  [/dodgecall\.app/gi, 'callsomo.com'],
  [/drlittlekids@gmail\.com/gi, 'richard@callsomo.com'],
  [/provider@doclittle\.com/gi, 'provider@callsomo.com'],
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    if (ent.name.includes('archive') && dir.includes('docs')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

let n = 0;
for (const base of DIRS) {
  for (const file of walk(base)) {
    if (/docs[/\\]archive[/\\]/i.test(file)) continue;
    if (/legacy-doclittle/i.test(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    const orig = text;
    for (const [re, rep] of REPLACEMENTS) text = text.replace(re, rep);
    if (text !== orig) {
      fs.writeFileSync(file, text);
      n += 1;
    }
  }
}
console.log(`rebrand-somo-repo: updated ${n} files`);
