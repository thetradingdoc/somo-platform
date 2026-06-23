'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Versioned schema migrations from database/migrations/.
 * Extracted from database.js (Phase 4a).
 */
function runVersionedMigrations({ db, dbPath, isProdEnv, dbLog = console.log }) {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  );
  try {
    const strictEnvRaw = String(process.env.MIGRATIONS_STRICT || '').toLowerCase().trim();
    const strict = strictEnvRaw
      ? strictEnvRaw === '1' || strictEnvRaw === 'true' || strictEnvRaw === 'yes'
      : isProdEnv;
    const wantBackup =
      (process.env.BACKUP_BEFORE_MIGRATE === '1' || process.env.BACKUP_BEFORE_MIGRATE === 'true') && isProdEnv;
    if (wantBackup && fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = process.env.DB_BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
      try {
        fs.mkdirSync(backupDir, { recursive: true });
      } catch (_) {}
      const backupPath = path.join(backupDir, `${path.basename(dbPath)}.bak-${ts}`);
      fs.copyFileSync(dbPath, backupPath);
      dbLog(`✅ DB backup created: ${backupPath}`);
    }

    const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_.*\.js$/.test(f)).sort();
    for (const f of files) {
      const version = f.replace(/\.js$/, '');
      const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
      if (applied) continue;
      try {
        const m = require(path.join(migrationsDir, f));
        if (typeof m.up === 'function') {
          m.up(db);
          db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
          dbLog(`✅ Migration applied: ${version}`);
        }
      } catch (e) {
        console.warn(`⚠️  Migration ${version} failed:`, e.message);
        if (strict) {
          console.error('❌ Migration failed with MIGRATIONS_STRICT enabled; refusing to start.');
          process.exit(1);
        }
      }
    }
  } catch (e) {
    if (isProdEnv) {
      console.error('❌ Migration runner crashed in production:', e.message);
      process.exit(1);
    }
  }
}

module.exports = { runVersionedMigrations };
