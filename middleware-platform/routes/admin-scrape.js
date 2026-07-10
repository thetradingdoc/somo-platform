/**
 * Admin CRM facade routes — matches /api/admin/scrape/* and /api/admin/enrich/*
 * Delegates to existing lead services and database helpers.
 */

const express = require('express');
const { searchJobs } = require('../services/job-scraper');
const leadIngestion = require('../services/lead-ingestion');
const scrapeIngestion = require('../services/admin-scrape-ingestion');
const { requireAdminOrCapability } = require('../middleware/admin-auth');
const { adminLimiter } = require('../middleware/rate-limiter');
const db = require('../database');
const facade = require('../services/admin-lead-facade');
const jobTracker = require('../services/admin-job-tracker');
const { persistSqliteToGcs } = require('../utils/gcs-db-persist');

const router = express.Router();
const requireLeads = requireAdminOrCapability('platform.leads');

function isScrapeConfigured() {
  const jsearch = !!(process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY);
  const craigslist = process.env.CRAIGSLIST_ENABLED === '1';
  return jsearch || craigslist;
}

function isJSearchConfigured() {
  return !!(process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY);
}

function detectJobSearchProvider() {
  const url = (process.env.JOB_SEARCH_API_URL || '').toLowerCase();
  if (url.includes('serpapi.com')) return 'serpapi';
  if (url.includes('rapidapi') || url.includes('jsearch')) return 'jsearch';
  if (process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY) return 'serpapi';
  return url ? 'custom' : 'unset';
}

function parseJobResultJson(row) {
  if (!row?.last_result_json) return null;
  try {
    return JSON.parse(row.last_result_json);
  } catch {
    return null;
  }
}

function buildPipelineSummary(dbTotal, leads, scrapeRow) {
  const lastScrape = parseJobResultJson(scrapeRow);
  const hasScrapeRun = !!(scrapeRow?.last_run_at || lastScrape);
  return {
    db_total: dbTotal,
    verified: leads.verified || 0,
    needs_phone: leads.needs_phone || 0,
    never_scraped: dbTotal === 0 && !hasScrapeRun,
    scraped_zero_callable: hasScrapeRun && (leads.verified || 0) === 0 && dbTotal > 0,
  };
}

function setupSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function escapeCsv(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * GET /api/admin/scrape/status
 */
router.get('/status', requireLeads, adminLimiter, async (req, res) => {
  try {
    const scheduler = jobTracker.getSchedulerState();
    const leads = facade.getLeadCountsByContactStatus();
    const usage = db.getCallUsageStats();
    const dbTotal = db.db.prepare(`SELECT COUNT(*) as n FROM leads WHERE (lead_type IS NULL OR lead_type = 'sales')`).get().n;
    const scrapeConfigured = isScrapeConfigured();
    const craigslistEnabled = process.env.CRAIGSLIST_ENABLED === '1';
    const jsearchConfigured = isJSearchConfigured();
    const scrapeResult = parseJobResultJson(scheduler.scrape);
    const enrichResult = parseJobResultJson(scheduler.enrich);

    res.json({
      scrape_configured: scrapeConfigured,
      craigslist_enabled: craigslistEnabled,
      jsearch_configured: jsearchConfigured,
      setup_hint: scrapeConfigured
        ? null
        : 'Set CRAIGSLIST_ENABLED=1 or JOB_SEARCH_API_URL + JOB_SEARCH_API_KEY (see .env.example)',
      db_total: dbTotal,
      job_search_provider: detectJobSearchProvider(),
      scrape_cron_enabled: process.env.SCRAPE_CRON_ENABLED === '1',
      scheduler: {
        is_running: scheduler.is_running,
        last_run_at: scheduler.last_run_at,
        scrape_status: scheduler.scrape?.status,
        enrich_status: scheduler.enrich?.status,
        scrape_last_result: scrapeResult,
        enrich_last_result: enrichResult,
      },
      pipeline_summary: buildPipelineSummary(dbTotal, leads, scheduler.scrape),
      leads,
      calls_this_month: usage.calls_used || 0,
      calls_cap: 250,
      calls_remaining: usage.calls_remaining ?? 250,
    });
  } catch (error) {
    console.error('scrape/status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/scrape/leads/export?format=csv
 */
router.get('/leads/export', requireLeads, adminLimiter, async (req, res) => {
  try {
    if (req.query.format !== 'csv') {
      return res.status(400).json({ error: 'Only format=csv is supported' });
    }
    const { leads } = facade.querySalesLeads({
      contact_status: req.query.contact_status || undefined,
      specialty: req.query.specialty || undefined,
      location: req.query.location || undefined,
      location_mode: req.query.location_mode || undefined,
      search: req.query.search || undefined,
      callable_only: req.query.callable_only === '1',
      limit: 5000,
      offset: 0,
    });
    const header = ['id', 'clinic_name', 'clinic_phone', 'clinic_email', 'location', 'specialty', 'pipeline_stage', 'contact_status', 'lead_score', 'created_at'];
    const lines = [header.join(',')];
    for (const l of leads) {
      lines.push(header.map((k) => escapeCsv(l[k])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-leads.csv"');
    res.send(lines.join('\n'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/scrape/leads/call-ready
 */
router.get('/leads/call-ready', requireLeads, adminLimiter, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const { leads } = facade.querySalesLeads({
      contact_status: 'verified',
      specialty: req.query.specialty || undefined,
      location: req.query.location || undefined,
      location_mode: req.query.location_mode || undefined,
      callable_only: true,
      limit: 500,
    });
    const callReady = facade
      .filterCallableLeads(leads)
      .filter((l) => l.pipeline_stage === 'new' || !l.pipeline_stage)
      .slice(0, limit);

    res.json({ leads: callReady, total: callReady.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/scrape/leads/pipeline
 */
router.get('/leads/pipeline', requireLeads, adminLimiter, async (req, res) => {
  try {
    const specialty = req.query.specialty || '';
    const location = req.query.location || '';
    const locationMode = req.query.location_mode || '';
    const view = facade.getPipelineView(specialty, location, locationMode);
    res.json(view);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/scrape/leads
 */
router.get('/leads', requireLeads, adminLimiter, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 15;
    const offset = parseInt(req.query.offset, 10) || 0;
    const { leads, total } = facade.querySalesLeads({
      contact_status: req.query.contact_status || undefined,
      specialty: req.query.specialty || undefined,
      location: req.query.location || undefined,
      location_mode: req.query.location_mode || undefined,
      search: req.query.search || undefined,
      source: req.query.source || undefined,
      callable_only: req.query.contact_status === 'verified' || req.query.callable_only === '1',
      limit,
      offset,
    });
    res.json({ leads, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/scrape/leads/locations
 */
router.get('/leads/locations', requireLeads, adminLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const group = req.query.group || 'raw';
    const state = req.query.state || '';
    const locations = facade.getDistinctLeadLocations({ group, state, limit });
    res.json({ locations, group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/scrape/leads/:id
 */
router.get('/leads/:id', requireLeads, adminLimiter, async (req, res) => {
  try {
    const lead = db.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const calls = facade.formatCalls(db.getLeadCallsByLeadId(lead.id));
    const activities = facade.formatActivities(db.getLeadActivities(lead.id, { limit: 50 }));

    res.json({
      lead: facade.formatLeadForApi(lead, jobTracker.getEnrichingLeadIds()),
      calls,
      activities,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/scrape/leads/:id/stage
 */
router.put('/leads/:id/stage', requireLeads, adminLimiter, async (req, res) => {
  try {
    const { stage } = req.body;
    const lead = db.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    try {
      facade.assertCallableLead(lead);
    } catch (e) {
      return res.status(400).json({ error: e.message, code: e.code });
    }

    const dbStage = facade.denormalizeStage(stage);
    const oldStage = lead.pipeline_stage;
    db.updateLead(req.params.id, { pipeline_stage: dbStage });

    if (dbStage !== oldStage) {
      db.createLeadActivity({
        lead_id: req.params.id,
        activity_type: 'stage_change',
        activity_subject: 'Pipeline stage updated',
        activity_description: `Moved from ${facade.normalizeStage(oldStage)} to ${stage}`,
        created_by: 'admin',
      });
    }

    res.json({ success: true, stage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/scrape/leads/:id/suggested-stage/accept
 */
router.post('/leads/:id/suggested-stage/accept', requireLeads, adminLimiter, async (req, res) => {
  try {
    const lead = db.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.suggested_stage) {
      return res.status(400).json({ error: 'No suggested stage pending' });
    }
    const dbStage = facade.denormalizeStage(lead.suggested_stage);
    const oldStage = lead.pipeline_stage;
    db.updateLead(req.params.id, {
      pipeline_stage: dbStage,
      suggested_stage: null,
      suggested_stage_note: null,
    });
    if (dbStage !== oldStage) {
      db.createLeadActivity({
        lead_id: req.params.id,
        activity_type: 'stage_change',
        activity_subject: 'Accepted AI stage suggestion',
        activity_description: lead.suggested_stage_note || `Moved to ${lead.suggested_stage}`,
        created_by: 'admin',
      });
    }
    res.json({ success: true, stage: lead.suggested_stage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/scrape/leads/:id/suggested-stage/dismiss
 */
router.post('/leads/:id/suggested-stage/dismiss', requireLeads, adminLimiter, async (req, res) => {
  try {
    const lead = db.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    db.updateLead(req.params.id, { suggested_stage: null, suggested_stage_note: null });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/scrape/leads/:id/note
 */
router.post('/leads/:id/note', requireLeads, adminLimiter, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });

    const lead = db.getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    db.createLeadActivity({
      lead_id: req.params.id,
      activity_type: 'note',
      activity_subject: 'Note',
      activity_description: content.trim(),
      created_by: 'admin',
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function resolveScrapeLocations(req) {
  const fromBody = req?.body?.locations;
  if (Array.isArray(fromBody) && fromBody.length) {
    return fromBody.map(String).filter(Boolean);
  }
  const envList = process.env.MEDICAL_RECEPTIONIST_LOCATIONS;
  if (envList && envList.includes('|')) {
    return envList.split('|').map((s) => s.trim()).filter(Boolean);
  }
  const single = process.env.MEDICAL_RECEPTIONIST_LOCATION;
  if (single && String(single).trim()) return [String(single).trim()];
  return ['New York, NY', 'New York', 'US'];
}

function resolveScrapeEngines() {
  const engines = [];
  const fromEnv = (process.env.JOB_SEARCH_ENGINE || '').trim();
  if (process.env.CRAIGSLIST_ENABLED === '1') engines.push('craigslist');
  if (fromEnv && fromEnv !== 'craigslist') engines.push(fromEnv);
  else if (isJSearchConfigured()) {
    const provider = detectJobSearchProvider();
    engines.push(provider === 'serpapi' ? 'google_jobs' : 'jsearch');
  }
  return [...new Set(engines)];
}

/**
 * POST /api/admin/scrape/run — SSE scrape job
 */
router.post('/run', requireLeads, adminLimiter, async (req, res) => {
  setupSse(res);
  jobTracker.startJob('scrape');
  const engines = resolveScrapeEngines();
  jobTracker.sseWrite(res, { type: 'start', job_search_provider: detectJobSearchProvider(), engines });

  if (!isScrapeConfigured()) {
    const msg = 'No scrape engines configured — set CRAIGSLIST_ENABLED=1 or JOB_SEARCH_API_*';
    jobTracker.finishJob('scrape', null, new Error(msg));
    jobTracker.sseWrite(res, { type: 'error', error: msg });
    return res.end();
  }

  let rawFound = 0;
  let saved = 0;
  let savedCallable = 0;
  let savedNeedsPhone = 0;
  let skippedDupes = 0;
  let enrichAttempts = 0;
  let enrichHits = 0;
  const seenExternal = new Set();

  try {
    const queries = [
      'Medical receptionist OR dental receptionist',
      'Healthcare front desk receptionist',
    ];
    const maxSave = parseInt(process.env.MEDICAL_RECEPTIONIST_MAX_LEADS || '50', 10);
    const scrapeLocations = resolveScrapeLocations(req);

    jobTracker.sseWrite(res, {
      msg: `Regions: ${scrapeLocations.join(' → ')} (stop at ${maxSave} saves)`,
    });

    locationLoop: for (const scrapeLocation of scrapeLocations) {
      if (saved >= maxSave) break;
      jobTracker.sseWrite(res, { msg: `Searching ${scrapeLocation}…` });

      for (const engine of engines) {
        if (engine === 'craigslist') {
          const { searchCraigslistJobs } = require('../services/craigslist-scraper');
          jobTracker.sseWrite(res, { type: 'progress', source: 'craigslist', msg: 'Searching Craigslist RSS…' });
          const clJobs = await searchCraigslistJobs({ maxPerRun: maxSave - saved });
          rawFound += clJobs.length;
          for (const job of clJobs) {
            if (saved >= maxSave) break locationLoop;
            enrichAttempts++;
            const outcome =
              job.clinic_phone || job.clinic_email
                ? scrapeIngestion.persistScrapedJob(job, job, { source: 'craigslist' })
                : await scrapeIngestion.enrichAndPersist(job, { source: 'craigslist' });
            if (outcome.enriched?.clinic_phone || outcome.enriched?.clinic_email || job.clinic_phone) {
              enrichHits++;
            }
            if (outcome.status === 'duplicate') {
              skippedDupes++;
              continue;
            }
            if (outcome.status === 'error') {
              jobTracker.sseWrite(res, { msg: `Skip: ${outcome.error}` });
              continue;
            }
            const ext = outcome.external_id;
            if (ext && seenExternal.has(ext)) {
              skippedDupes++;
              continue;
            }
            if (ext) seenExternal.add(ext);
            saved++;
            if (outcome.callable || job.clinic_phone) {
              savedCallable++;
              jobTracker.sseWrite(res, { msg: `Saved (callable): ${job.clinic_name || 'Unknown'}` });
            } else {
              savedNeedsPhone++;
              jobTracker.sseWrite(res, { msg: `Saved (needs phone): ${job.clinic_name || 'Unknown'}` });
            }
          }
          continue;
        }

        if (!isJSearchConfigured()) continue;

        for (const query of queries) {
          if (saved >= maxSave) break locationLoop;
          jobTracker.sseWrite(res, {
            type: 'progress',
            source: engine,
            msg: `[${scrapeLocation}] ${query.slice(0, 40)}…`,
          });
          const searchResults = await searchJobs({
            query,
            location: scrapeLocation,
            postedSinceDays: parseInt(process.env.MEDICAL_RECEPTIONIST_DAYS || '3', 10),
            engine,
          });
          rawFound += searchResults?.length || 0;

          for (const job of searchResults || []) {
            if (saved >= maxSave) break locationLoop;
            enrichAttempts++;
            const outcome = await scrapeIngestion.enrichAndPersist(job, { source: engine });
            if (outcome.enriched?.clinic_phone || outcome.enriched?.clinic_email) enrichHits++;

            if (outcome.status === 'duplicate') {
              skippedDupes++;
              continue;
            }
            if (outcome.status === 'error') {
              jobTracker.sseWrite(res, { msg: `Skip: ${outcome.error}` });
              continue;
            }

            const ext = outcome.external_id;
            if (ext && seenExternal.has(ext)) {
              skippedDupes++;
              continue;
            }
            if (ext) seenExternal.add(ext);

            saved++;
            if (outcome.callable) {
              savedCallable++;
              jobTracker.sseWrite(res, {
                msg: `Saved (callable): ${job.clinic_name || job.title || 'Unknown'}`,
              });
            } else {
              savedNeedsPhone++;
              jobTracker.sseWrite(res, {
                msg: `Saved (needs phone): ${job.clinic_name || job.title || 'Unknown'}`,
              });
            }

            if (saved % 5 === 0) {
              jobTracker.sseWrite(res, { msg: `Saved ${saved} leads so far...` });
            }
          }
        }
      }
    }

    jobTracker.sseWrite(res, { msg: `Found ${rawFound} raw postings across queries` });

    const result = {
      raw_found: rawFound,
      saved,
      saved_callable: savedCallable,
      saved_needs_phone: savedNeedsPhone,
      enriched: enrichHits,
      skipped_dupes: skippedDupes,
      skipped_no_phone: 0,
      enrich_attempts: enrichAttempts,
      enrich_hits: enrichHits,
      engine: 'jsearch',
      scrape_locations: scrapeLocations,
    };
    jobTracker.finishJob('scrape', result);
    const gcsPersist = await persistSqliteToGcs('scrape');
    jobTracker.sseWrite(res, {
      type: 'done',
      result: { ...result, gcs_persisted: gcsPersist.ok === true },
    });
  } catch (error) {
    console.error('scrape/run error:', error);
    jobTracker.finishJob('scrape', null, error);
    jobTracker.sseWrite(res, { type: 'error', error: error.message });
  } finally {
    res.end();
  }
});

module.exports = router;
module.exports.resolveScrapeLocations = resolveScrapeLocations;
