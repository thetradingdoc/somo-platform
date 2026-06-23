'use strict';

const db = require('../../database');
const EHRSyncService = require('./ehr-sync-service');

class EhrSyncJobWorker {
  constructor() {
    this.timer = null;
    this.intervalMs = parseInt(process.env.EHR_SYNC_JOB_WORKER_MS || '30000', 10);
    this.batchSize = Math.max(1, Math.min(parseInt(process.env.EHR_SYNC_JOB_BATCH || '10', 10), 50));
    this.running = false;
  }

  start() {
    if (this.timer) return;
    console.log(`[ehr-sync-job-worker] Started (interval ${this.intervalMs}ms, batch ${this.batchSize})`);
    this.timer = setInterval(() => this.tick().catch((e) => {
      console.error('[ehr-sync-job-worker] tick error:', e.message);
    }), this.intervalMs);
    this.tick().catch((e) => console.error('[ehr-sync-job-worker] initial tick error:', e.message));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _claimQueuedJobs() {
    const now = new Date().toISOString();
    const jobs = db.db.prepare(`
      SELECT *
      FROM ehr_sync_jobs
      WHERE status = 'queued'
        AND datetime(run_at) <= datetime('now')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(this.batchSize);
    const claimed = [];
    const claimStmt = db.db.prepare(`
      UPDATE ehr_sync_jobs
      SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
    `);
    for (const j of jobs) {
      const r = claimStmt.run(j.id);
      if (r.changes > 0) claimed.push(j);
    }
    return claimed;
  }

  async _processJob(job) {
    const payload = (() => {
      try { return job.payload_json ? JSON.parse(job.payload_json) : {}; } catch (_) { return {}; }
    })();
    if (!job.appointment_id) {
      throw new Error(`No appointment_id on job ${job.id}`);
    }
    await EHRSyncService.syncAppointment(job.appointment_id);
    db.db.prepare(`
      UPDATE ehr_sync_jobs
      SET status = 'done', last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(job.id);
    return payload;
  }

  _failJob(job, err) {
    const attempts = (job.attempts || 0) + 1;
    const maxAttempts = job.max_attempts || 5;
    const terminal = attempts >= maxAttempts;
    const backoffSeconds = Math.min(300, Math.pow(2, Math.min(attempts, 7)) * 5); // 10s..300s
    if (terminal) {
      db.db.prepare(`
        UPDATE ehr_sync_jobs
        SET status = 'dead',
            attempts = ?,
            last_error = ?,
            dead_letter_json = json_object('failed_at', datetime('now'), 'error', ?, 'event_type', ?, 'appointment_id', ?, 'patient_id', ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(attempts, String(err?.message || err), String(err?.message || err), job.event_type, job.appointment_id || null, job.patient_id || null, job.id);
    } else {
      db.db.prepare(`
        UPDATE ehr_sync_jobs
        SET status = 'queued',
            attempts = ?,
            last_error = ?,
            run_at = datetime('now', ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(attempts, String(err?.message || err), `+${backoffSeconds} seconds`, job.id);
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = this._claimQueuedJobs();
      for (const j of jobs) {
        try {
          await this._processJob(j);
        } catch (e) {
          this._failJob(j, e);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

module.exports = new EhrSyncJobWorker();

