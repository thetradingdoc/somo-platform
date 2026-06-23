'use strict';

/**
 * Database module entry (Phase 4a incremental split).
 * Full SQL facade remains in ../database.js until repository extraction completes.
 */

const connection = require('./connection');
const { runVersionedMigrations } = require('./versioned-migrations');
const { runStartupMigrations } = require('./migrations/run-startup-migrations');

module.exports = {
  ...connection,
  runVersionedMigrations,
  runStartupMigrations,
  /** @deprecated use require('../database') for SQL helpers until facade migration completes */
  legacy: () => require('../database')
};
