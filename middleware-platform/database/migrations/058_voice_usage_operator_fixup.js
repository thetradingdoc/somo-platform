/**
 * Fixup: ensure 056 columns exist (partial apply on some DBs).
 */
const { up: ensure056 } = require('./056_voice_usage_and_operator');

function up(db) {
  ensure056(db);
}

function down(db) {}

module.exports = { up, down };
