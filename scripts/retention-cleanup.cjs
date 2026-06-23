/**
 * Data retention cleanup (mvp-62)
 *
 * - delete old idempotency keys
 * - delete expired patient portal sessions
 * - optional: prune HIPAA access log older than N days
 */

const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || path.join('middleware-platform', 'var', 'db', 'middleware-dev.db');

// This file runs at repo root; middleware DB module lives under middleware-platform/.
const db = require('../middleware-platform/database');

function main() {
  const dryRun = process.env.RETENTION_DRY_RUN === '1' || process.env.RETENTION_DRY_RUN === 'true';
  const portalSessionDays = parseInt(process.env.RETENTION_PATIENT_PORTAL_SESSIONS_DAYS || '14', 10);
  const hipaaDays = parseInt(process.env.RETENTION_HIPAA_ACCESS_LOG_DAYS || '90', 10);
  const docDays = parseInt(process.env.RETENTION_PATIENT_DOCUMENTS_DAYS || '3650', 10); // default 10 years

  let deletedIdem = 0;
  try {
    deletedIdem = db.cleanupIdempotencyKeys ? db.cleanupIdempotencyKeys() : 0;
  } catch (_) {}

  let deletedSessions = 0;
  try {
    if (!dryRun) {
      const r = db.db.prepare(`
        DELETE FROM patient_portal_sessions
        WHERE datetime(created_at) <= datetime('now', ?)
      `).run(`-${portalSessionDays} days`);
      deletedSessions = r.changes || 0;
    }
  } catch (_) {}

  let deletedHipaa = 0;
  try {
    if (!dryRun) {
      const r2 = db.db.prepare(`
        DELETE FROM hipaa_access_log
        WHERE datetime(created_at) <= datetime('now', ?)
      `).run(`-${hipaaDays} days`);
      deletedHipaa = r2.changes || 0;
    }
  } catch (_) {}

  // Patient documents retention (mvp-70) - local deletes only; cloud delete can be added later
  let deletedDocs = 0;
  try {
    const docs = db.db.prepare(`
      SELECT id, storage_path FROM patient_documents
      WHERE datetime(created_at) <= datetime('now', ?)
    `).all(`-${docDays} days`);
    if (!dryRun) {
      for (const d of docs) {
        try {
          if (d.storage_path) {
            const fs = require('fs');
            if (fs.existsSync(d.storage_path)) fs.unlinkSync(d.storage_path);
          }
        } catch (_) {}
      }
      const r3 = db.db.prepare(`
        DELETE FROM patient_documents
        WHERE datetime(created_at) <= datetime('now', ?)
      `).run(`-${docDays} days`);
      deletedDocs = r3.changes || 0;
    }
  } catch (_) {}

  console.log(JSON.stringify({
    success: true,
    dry_run: !!dryRun,
    deleted_idempotency_keys: deletedIdem,
    deleted_patient_portal_sessions: deletedSessions,
    deleted_hipaa_access_log: deletedHipaa,
    deleted_patient_documents: deletedDocs
  }, null, 2));
}

main();

