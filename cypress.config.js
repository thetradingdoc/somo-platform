const { defineConfig } = require('cypress');
const path = require('path');

module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:4000',
    supportFile: false,
    setupNodeEvents(on, config) {
      // Reads latest patient verification code from local SQLite DB.
      // Used only for local/dev runs where we control the DB.
      on('task', {
        getLastVerificationCode() {
          try {
            const Database = require('better-sqlite3');
            const dbPath = process.env.DB_PATH
              ? path.resolve(process.cwd(), process.env.DB_PATH)
              : path.join(process.cwd(), 'middleware-platform', 'middleware-dev.db');
            const db = new Database(dbPath, { readonly: true, fileMustExist: true });
            const row = db
              .prepare(`
                SELECT verification_code
                FROM patient_portal_sessions
                WHERE verification_code IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
              `)
              .get();
            db.close();
            return row ? String(row.verification_code || '').trim() : null;
          } catch (e) {
            return null;
          }
        }
      });
      return config;
    }
  }
});

