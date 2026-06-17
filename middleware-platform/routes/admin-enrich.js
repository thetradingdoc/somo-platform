/**
 * POST /api/admin/enrich/batch — SSE batch contact enrichment
 */

const express = require('express');
const leadIngestion = require('../services/lead-ingestion');
const { requireAdminOrCapability } = require('../middleware/admin-auth');
const { adminLimiter } = require('../middleware/rate-limiter');
const db = require('../database');
const facade = require('../services/admin-lead-facade');
const jobTracker = require('../services/admin-job-tracker');

const router = express.Router();
const requireLeads = requireAdminOrCapability('platform.leads');

function setupSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

router.post('/batch', requireLeads, adminLimiter, async (req, res) => {
  setupSse(res);
  jobTracker.startJob('enrich');
  jobTracker.sseWrite(res, { type: 'start', message: 'Starting batch enrichment' });

  let enrichedCount = 0;

  try {
    const rows = db.db.prepare(`
      SELECT id FROM leads
      WHERE (is_test IS NULL OR is_test = 0)
        AND (lead_type IS NULL OR lead_type = 'sales')
        AND source_url IS NOT NULL AND LENGTH(source_url) > 0
        AND (clinic_phone IS NULL OR LENGTH(clinic_phone) = 0)
      ORDER BY lead_score DESC, created_at DESC
      LIMIT 100
    `).all();

    const ids = rows.map((r) => r.id);
    jobTracker.setEnrichingLeadIds(ids);

    for (const leadId of ids) {
      const lead = db.getLead(leadId);
      if (!lead?.source_url) {
        jobTracker.removeEnrichingLeadId(leadId);
        continue;
      }

      try {
        const enriched = await leadIngestion.enrichJobCandidate({
          ...lead,
          source_url: lead.source_url,
        });

        const updates = {};
        if (enriched.clinic_phone && !lead.clinic_phone) updates.clinic_phone = enriched.clinic_phone;
        if (enriched.clinic_email && !lead.clinic_email) updates.clinic_email = enriched.clinic_email;
        if (enriched.opening_hours && !lead.opening_hours) updates.opening_hours = enriched.opening_hours;
        if (enriched.source_url && enriched.source_url !== lead.source_url) {
          updates.source_url = enriched.source_url;
        }
        if (enriched.job_posting_url) {
          updates.notes = leadIngestion.buildNotesWithJobPosting(enriched.job_posting_url, lead.notes);
        }

        const merged = { ...lead, ...updates };

        if (leadIngestion.isCallableLead(merged)) {
          if (Object.keys(updates).length > 0) {
            db.updateLead(leadId, updates);
          }
          enrichedCount++;
          jobTracker.sseWrite(res, {
            type: 'progress',
            id: leadId,
            status: 'enriched',
            phone: merged.clinic_phone || null,
          });
        } else {
          db.db.prepare('DELETE FROM leads WHERE id = ?').run(leadId);
          jobTracker.sseWrite(res, {
            type: 'progress',
            id: leadId,
            status: 'removed_no_phone',
          });
        }
      } catch (err) {
        jobTracker.sseWrite(res, {
          type: 'progress',
          id: leadId,
          status: 'error',
          message: err.message,
        });
      }

      jobTracker.removeEnrichingLeadId(leadId);
      await new Promise((r) => setTimeout(r, 1000));
    }

    jobTracker.clearEnrichingLeadIds();
    const result = { enriched: enrichedCount, processed: ids.length };
    jobTracker.finishJob('enrich', result);
    jobTracker.sseWrite(res, { type: 'done', enriched: enrichedCount, result });
  } catch (error) {
    jobTracker.clearEnrichingLeadIds();
    jobTracker.finishJob('enrich', null, error);
    jobTracker.sseWrite(res, { type: 'error', error: error.message });
  } finally {
    res.end();
  }
});

module.exports = router;
