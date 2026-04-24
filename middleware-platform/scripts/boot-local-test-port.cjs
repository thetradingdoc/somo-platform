'use strict';

/**
 * Load .env into process.env but force PORT (dotenv in server.js uses
 * override:true in non-production, which overwrites shell PORT=...).
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (key === 'PORT') continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
}

process.env.PORT = String(process.env.TEST_PORT || '4010');
process.env.DB_PATH = process.env.DB_PATH || './middleware-dev.db';

const dotenv = require('dotenv');
dotenv.config = () => ({ parsed: {} });

require(path.join(__dirname, '..', 'server.js'));
