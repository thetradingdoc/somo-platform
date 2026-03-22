/**
 * Phase 10 Task 65: Case report callback timeout and retry.
 * Every 5 min: find pending jobs older than 10 min → mark failed; retry once (new job) after 5 min.
 * Retry = create new pending row (retry_of_job_id = timed-out job_id) and POST to case report service.
 */
const db = require('../database');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = 5 * 60 * 1000;

let intervalId = null;

function getBaseUrl() {
  const b = process.env.API_BASE_URL || process.env.BASE_URL || '';
  return b ? b.replace(/\/$/, '') : '';
}

function run() {
  const caseReportUrl = process.env.CASE_REPORT_SERVICE_URL;
  const callbackToken = process.env.CASE_REPORT_SERVICE_TOKEN;
  if (!caseReportUrl || !callbackToken || !db.updateCaseReportByJobId) return;

  if (db.getPendingCaseReportsOlderThanMs) {
    const pending = db.getPendingCaseReportsOlderThanMs(TIMEOUT_MS);
    for (const row of pending) {
      db.updateCaseReportByJobId(row.job_id, { status: 'failed', error_message: 'Callback timeout (10 min)' });
    }
  }

  if (!db.getTimedOutCaseReportsReadyForRetry) return;
  const ready = db.getTimedOutCaseReportsReadyForRetry(TIMEOUT_MS + RETRY_DELAY_MS);
  for (const row of ready) {
    const jobId = row.job_id;
    if (db.hasRetryForJobId && db.hasRetryForJobId(jobId)) continue;
    const newJobId = `job-${uuidv4()}`;
    db.insertPendingCaseReport({
      job_id: newJobId,
      patient_id: row.patient_id,
      encounter_id: row.encounter_id,
      retry_of_job_id: jobId
    });
    const baseUrl = getBaseUrl();
    const payload = {
      job_id: newJobId,
      patient_id: row.patient_id,
      encounter_id: row.encounter_id,
      appointment_id: null,
      transcript_endpoint: `${baseUrl}/internal/communications/${row.encounter_id}/text`,
      transcript_endpoint_token: callbackToken,
      document_context_endpoint: `${baseUrl}/internal/communications/${row.encounter_id}/document-context`,
      document_context_endpoint_token: callbackToken,
      vitals_endpoint: `${baseUrl}/internal/communications/${row.encounter_id}/vitals`,
      vitals_endpoint_token: callbackToken,
      prior_report_id: null,
      callback_url: `${baseUrl}/api/case-report/callback`,
      callback_token: callbackToken
    };
    axios.post(`${caseReportUrl.replace(/\/$/, '')}/report`, payload, { timeout: 10000 })
      .catch(err => console.warn('[case-report-timeout] retry POST failed:', err.message));
  }
}

function start() {
  if (intervalId) return;
  run();
  intervalId = setInterval(run, INTERVAL_MS);
  console.log('[case-report-timeout] Worker started (every 5 min, timeout 10 min, retry after 5 min)');
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { start, stop, run };
