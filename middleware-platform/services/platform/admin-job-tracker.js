/**
 * Tracks admin scrape/enrich job state for control board status banner
 */

const db = require('../../database');

const enrichingLeadIds = new Set();

function ensureTable() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS admin_jobs (
      job_type TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      is_running INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      last_result_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

ensureTable();

function getJob(jobType) {
  ensureTable();
  let row = db.db.prepare('SELECT * FROM admin_jobs WHERE job_type = ?').get(jobType);
  if (!row) {
    db.db.prepare(`
      INSERT INTO admin_jobs (job_type, status, is_running)
      VALUES (?, 'idle', 0)
    `).run(jobType);
    row = db.db.prepare('SELECT * FROM admin_jobs WHERE job_type = ?').get(jobType);
  }
  return row;
}

function startJob(jobType) {
  ensureTable();
  const now = new Date().toISOString();
  db.db.prepare(`
    INSERT INTO admin_jobs (job_type, status, is_running, updated_at)
    VALUES (?, 'running', 1, ?)
    ON CONFLICT(job_type) DO UPDATE SET
      status = 'running',
      is_running = 1,
      updated_at = excluded.updated_at
  `).run(jobType, now);
  return getJob(jobType);
}

function finishJob(jobType, result, error) {
  ensureTable();
  const now = new Date().toISOString();
  const status = error ? 'error' : 'done';
  db.db.prepare(`
    UPDATE admin_jobs
    SET status = ?,
        is_running = 0,
        last_run_at = ?,
        last_result_json = ?,
        updated_at = ?
    WHERE job_type = ?
  `).run(status, now, JSON.stringify(result || { error: error?.message }), now, jobType);
}

function getSchedulerState() {
  const scrape = getJob('scrape');
  const enrich = getJob('enrich');
  return {
    is_running: scrape.is_running === 1 || enrich.is_running === 1,
    scrape,
    enrich,
    last_run_at: scrape.last_run_at || enrich.last_run_at || null,
  };
}

function setEnrichingLeadIds(ids) {
  enrichingLeadIds.clear();
  for (const id of ids) enrichingLeadIds.add(String(id));
}

function addEnrichingLeadId(id) {
  enrichingLeadIds.add(String(id));
}

function removeEnrichingLeadId(id) {
  enrichingLeadIds.delete(String(id));
}

function clearEnrichingLeadIds() {
  enrichingLeadIds.clear();
}

function getEnrichingLeadIds() {
  return enrichingLeadIds;
}

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = {
  ensureTable,
  getJob,
  startJob,
  finishJob,
  getSchedulerState,
  setEnrichingLeadIds,
  addEnrichingLeadId,
  removeEnrichingLeadId,
  clearEnrichingLeadIds,
  getEnrichingLeadIds,
  sseWrite,
};
