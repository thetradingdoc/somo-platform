/**
 * Task 23: Versioned migrations bootstrap.
 * Creates schema_migrations table and runs migration tracking.
 */
async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function down(db) {
  db.exec(`DROP TABLE IF EXISTS schema_migrations`);
}

module.exports = { up, down };
