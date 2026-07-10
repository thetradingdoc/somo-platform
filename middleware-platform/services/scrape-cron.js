'use strict';

/**
 * Optional nightly scrape when SCRAPE_CRON_ENABLED=1.
 * Runs Craigslist + JSearch ingestion without HTTP admin auth.
 */

let timer = null;

async function runScheduledScrape() {
  if (process.env.SCRAPE_CRON_ENABLED !== '1') return;
  const isConfigured =
    process.env.CRAIGSLIST_ENABLED === '1' ||
    (process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY);
  if (!isConfigured) {
    console.warn('[scrape-cron] skipped — no engines configured');
    return;
  }
  console.log('[scrape-cron] starting scheduled scrape');
  try {
    const scrapeIngestion = require('./admin-scrape-ingestion');
    const { searchJobs } = require('./job-scraper');
    const { searchCraigslistJobs } = require('./craigslist-scraper');
    const db = require('../database');
    const maxSave = parseInt(process.env.MEDICAL_RECEPTIONIST_MAX_LEADS || '25', 10);
    let saved = 0;

    if (process.env.CRAIGSLIST_ENABLED === '1') {
      const jobs = await searchCraigslistJobs({ maxPerRun: maxSave });
      for (const job of jobs) {
        if (saved >= maxSave) break;
        const outcome =
          job.clinic_phone || job.clinic_email
            ? scrapeIngestion.persistScrapedJob(job, job, { source: 'craigslist' })
            : await scrapeIngestion.enrichAndPersist(job, { source: 'craigslist' });
        if (outcome.status === 'saved') saved++;
      }
    }

    if (process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY && saved < maxSave) {
      const location = process.env.MEDICAL_RECEPTIONIST_LOCATION || 'New York, NY';
      const results = await searchJobs({
        query: 'Medical receptionist OR dental receptionist',
        location,
        engine: 'jsearch'
      });
      for (const job of results || []) {
        if (saved >= maxSave) break;
        const outcome = await scrapeIngestion.enrichAndPersist(job, { source: 'jsearch' });
        if (outcome.status === 'saved') saved++;
      }
    }

    try {
      const { persistSqliteToGcs } = require('../utils/gcs-db-persist');
      await persistSqliteToGcs(db);
    } catch (_) {}

    console.log(`[scrape-cron] complete — saved ${saved} leads`);
  } catch (err) {
    console.error('[scrape-cron] failed:', err.message);
  }
}

function startScrapeCron() {
  if (process.env.SCRAPE_CRON_ENABLED !== '1') return;
  if (timer) return;
  const intervalMs = parseInt(process.env.SCRAPE_CRON_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10);
  timer = setInterval(runScheduledScrape, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[scrape-cron] enabled — interval ${Math.round(intervalMs / 3600000)}h`);
  setTimeout(runScheduledScrape, 60000);
}

module.exports = { startScrapeCron, runScheduledScrape };
