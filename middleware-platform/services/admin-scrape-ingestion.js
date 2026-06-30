/**
 * Shared admin CRM lead ingestion — single save path for scrape/run, insights, and POST /save.
 */

const db = require('../database');
const leadIngestion = require('./lead-ingestion');

function resolveExternalId(job, enriched) {
  return (
    job.external_id ||
    job.job_id ||
    job.id ||
    `${job.clinic_name || 'clinic'}-${enriched?.source_url || job.source_url || job.link || ''}`
  );
}

/**
 * Persist one scraped/enriched job candidate. Saves all non-duplicates regardless of phone.
 * @returns {{ status: 'saved'|'duplicate'|'error', lead?: object, callable?: boolean, error?: string }}
 */
function persistScrapedJob(job, enriched, opts = {}) {
  const source = opts.source || job.source || 'jsearch';
  const externalId = resolveExternalId(job, enriched);

  if (externalId && db.getLeadByExternalId(externalId)) {
    return { status: 'duplicate', external_id: externalId };
  }

  const leadData = leadIngestion.buildLeadPayload(job, enriched, { source });
  db.createLead(leadData);

  try {
    const LeadIntelligenceService = require('./lead-intelligence-service');
    const created = db.getLeadByExternalId(externalId);
    if (created) LeadIntelligenceService.updateLeadScore(created.id);
  } catch {
    // non-critical
  }

  const created = db.getLeadByExternalId(externalId);
  const callable = leadIngestion.isCallableLead(enriched);
  return {
    status: 'saved',
    lead: created,
    callable,
    external_id: externalId,
  };
}

/**
 * Enrich then persist; used by scrape loop and save API.
 */
async function enrichAndPersist(job, opts = {}) {
  try {
    const enriched = await leadIngestion.enrichJobCandidate(job);
    const result = persistScrapedJob(job, enriched, opts);
    return { ...result, enriched };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

function appendNote(existing, line) {
  if (!line) return existing || null;
  const notes = existing || '';
  if (notes.includes(line)) return notes;
  return notes ? `${notes}\n${line}` : line;
}

module.exports = {
  resolveExternalId,
  persistScrapedJob,
  enrichAndPersist,
  appendNote,
};
