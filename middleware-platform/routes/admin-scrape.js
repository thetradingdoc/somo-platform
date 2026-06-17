/**
 * Admin CRM facade routes — matches /api/admin/scrape/* and /api/admin/enrich/*
 * Delegates to existing lead services and database helpers.
 */

const express = require('express');
const { searchJobs } = require('../services/job-scraper');
const leadIngestion = require('../services/lead-ingestion');
const { requireAdminOrCapability } = require('../middleware/admin-auth');
const { adminLimiter } = require('../middleware/rate-limiter');
const db = require('../database');
const facade = require('../services/admin-lead-facade');
const jobTracker = require('../services/admin-job-tracker');

const router = express.Router();
const requireLeads = requireAdminOrCapability('platform.leads');

function isScrapeConfigured() {
  return !!(process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY);
}

function setupSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
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

    res.json({
      scrape_configured: scrapeConfigured,
      setup_hint: scrapeConfigured ? null : 'Set JOB_SEARCH_API_URL and JOB_SEARCH_API_KEY in server .env (see .env.example)',
      db_total: dbTotal,
      scheduler: {
        is_running: scheduler.is_running,
        last_run_at: scheduler.last_run_at,
        scrape_status: scheduler.scrape?.status,
        enrich_status: scheduler.enrich?.status,
      },
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
 * GET /api/admin/scrape/leads/call-ready
 */
router.get('/leads/call-ready', requireLeads, adminLimiter, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const { leads } = facade.querySalesLeads({
      contact_status: 'verified',
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
    const view = facade.getPipelineView(specialty);
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
      search: req.query.search || undefined,
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

/**
 * POST /api/admin/scrape/run — SSE scrape job
 */
router.post('/run', requireLeads, adminLimiter, async (req, res) => {
  setupSse(res);
  const sources = req.body?.sources || ['jsearch'];
  jobTracker.startJob('scrape');
  jobTracker.sseWrite(res, { type: 'start' });

  if (!isScrapeConfigured()) {
    const msg = 'JOB_SEARCH_API_URL and JOB_SEARCH_API_KEY are not configured in server .env';
    jobTracker.finishJob('scrape', null, new Error(msg));
    jobTracker.sseWrite(res, { type: 'error', error: msg });
    return res.end();
  }

  let rawFound = 0;
  let saved = 0;
  let skippedDupes = 0;
  let skippedNoPhone = 0;
  let enrichAttempts = 0;
  let enrichHits = 0;

  try {
    const queries = [
      'Medical receptionist OR dental receptionist',
      'Healthcare front desk receptionist',
    ];

    for (const source of sources) {
      jobTracker.sseWrite(res, { msg: `Searching ${source}...` });
    }

    const searchResults = await searchJobs({
      query: queries[0],
      location: process.env.MEDICAL_RECEPTIONIST_LOCATION || 'US',
      postedSinceDays: parseInt(process.env.MEDICAL_RECEPTIONIST_DAYS || '3', 10),
      engine: 'jsearch',
    });

    rawFound = searchResults?.length || 0;
    jobTracker.sseWrite(res, { msg: `Found ${rawFound} raw postings` });

    const maxSave = parseInt(process.env.MEDICAL_RECEPTIONIST_MAX_LEADS || '50', 10);
    const candidates = (searchResults || []).slice(0, maxSave);

    for (const job of candidates) {
      try {
        const externalId = job.external_id || job.job_id || `${job.clinic_name}-${job.source_url}`;
        if (externalId && db.getLeadByExternalId(externalId)) {
          skippedDupes++;
          continue;
        }

        enrichAttempts++;
        const enriched = await leadIngestion.enrichJobCandidate(job);
        if (enriched.clinic_phone || enriched.clinic_email) enrichHits++;

        if (!leadIngestion.isCallableLead(enriched)) {
          skippedNoPhone++;
          jobTracker.sseWrite(res, {
            msg: `Skip (no phone): ${job.clinic_name || job.title || 'Unknown'}`,
          });
          continue;
        }

        const leadData = leadIngestion.buildLeadPayload(job, enriched, { source: 'jsearch' });

        db.createLead(leadData);
        saved++;

        try {
          const LeadIntelligenceService = require('../services/lead-intelligence-service');
          const created = db.getLeadByExternalId(externalId);
          if (created) LeadIntelligenceService.updateLeadScore(created.id);
        } catch {
          // non-critical
        }

        if (saved % 5 === 0) {
          jobTracker.sseWrite(res, { msg: `Saved ${saved} leads so far...` });
        }
      } catch (err) {
        jobTracker.sseWrite(res, { msg: `Skip: ${err.message}` });
      }
    }

    const result = {
      raw_found: rawFound,
      saved,
      enriched: enrichHits,
      skipped_dupes: skippedDupes,
      skipped_no_phone: skippedNoPhone,
      enrich_attempts: enrichAttempts,
      enrich_hits: enrichHits,
    };
    jobTracker.finishJob('scrape', result);
    jobTracker.sseWrite(res, { type: 'done', result });
  } catch (error) {
    console.error('scrape/run error:', error);
    jobTracker.finishJob('scrape', null, error);
    jobTracker.sseWrite(res, { type: 'error', error: error.message });
  } finally {
    res.end();
  }
});

module.exports = router;
