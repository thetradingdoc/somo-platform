#!/usr/bin/env node
'use strict';

/**
 * Fail CI if new code imports removed shim paths.
 * Run: node scripts/verify/verify-no-legacy-paths.cjs
 */

const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', '..');
const BANNED = [/services\/conversation-mode\//, /services\/kelly-rails\//];
const PUBLIC_ROUTE_BANNED = [/require\(['"]\.\/geo-diagnostics['"]\)/];
const SKIP_DIRS = new Set(['node_modules', '.git', 'var', 'hosting-dist', 'backups']);

let offenders = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(js|cjs|mjs)$/.test(ent.name)) {
      const rel = path.relative(MP, p);
      if (rel.startsWith(`migrations${path.sep}`)) continue;
      const content = fs.readFileSync(p, 'utf8');
      const patterns = rel.startsWith(`routes${path.sep}public${path.sep}`)
        ? [...BANNED, ...PUBLIC_ROUTE_BANNED]
        : BANNED;
      for (const re of patterns) {
        if (re.test(content)) {
          offenders.push({ file: rel, pattern: re.toString() });
          break;
        }
      }
    }
  }
}

walk(MP);

if (offenders.length) {
  console.error('❌ legacy path imports detected:');
  for (const o of offenders) console.error(`  ${o.file} (${o.pattern})`);
  process.exit(1);
}
console.log('✓ no legacy conversation-mode / kelly-rails / migrations shim imports');
