'use strict';

const path = require('path');

function bootstrapVerifyEnv(opts = {}) {
  const root = opts.root || path.join(__dirname, '..', '..');
  require('dotenv').config({ path: path.join(root, '.env') });
  // Verify scripts always use canonical dev DB unless explicit opts.dbPath
  process.env.DB_PATH = opts.dbPath || './var/db/middleware-dev.db';
  if (opts.skipMigrations !== false) {
    process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';
  }
  if (opts.codingSpineOnly) {
    process.env.CODING_SPINE_ONLY = process.env.CODING_SPINE_ONLY || '1';
  }
  return root;
}

function canonicalDbPath() {
  return process.env.DB_PATH || './var/db/middleware-dev.db';
}

module.exports = { bootstrapVerifyEnv, canonicalDbPath };
