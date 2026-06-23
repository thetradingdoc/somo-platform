'use strict';

const { dbWarn } = require('../log');

/**
 * Run ordered startup migrations. Bodies stay in database.js until Phase 2 domain split.
 *
 * @param {Array<() => void>} migrationFns
 * @param {{ skip?: boolean }} [options]
 */
function runStartupMigrations(migrationFns, options = {}) {
  const skip = !!options.skip;
  if (skip) {
    dbWarn('⚠️  SKIP_STARTUP_MIGRATIONS enabled: skipping startup migration batch');
    return;
  }
  for (const fn of migrationFns) {
    if (typeof fn === 'function') fn();
  }
}

module.exports = { runStartupMigrations };
