'use strict';

function ensureHarnessMigration081(db) {
  try {
    require('../../database/migrations/081_seeded_for_harness').up(db);
  } catch (_) {}
}

module.exports = { ensureHarnessMigration081 };
