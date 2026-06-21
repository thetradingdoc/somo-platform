#!/usr/bin/env node
'use strict';

/**
 * Archive legacy package-root SQLite into var/db/archive/ (Session 2 DB SSOT).
 */
const fs = require('fs');
const path = require('path');

const mp = path.join(__dirname, '..');
const archiveDir = path.join(mp, 'var', 'db', 'archive');
const canonical = path.join(mp, 'var', 'db', 'middleware-dev.db');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

fs.mkdirSync(archiveDir, { recursive: true });

for (const legacy of ['middleware-dev.db', 'middleware-audit.db']) {
  const src = path.join(mp, legacy);
  if (!fs.existsSync(src) || !fs.existsSync(canonical)) continue;
  const dest = path.join(archiveDir, `${legacy}.${stamp}`);
  fs.renameSync(src, dest);
  for (const ext of ['-wal', '-shm']) {
    const wal = `${src}${ext}`;
    if (fs.existsSync(wal)) fs.renameSync(wal, `${dest}${ext}`);
  }
  console.log(`Archived ${legacy} -> ${dest}`);
}

console.log(JSON.stringify({ canonical, archived: true }, null, 2));
