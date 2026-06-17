/**
 * Admin CRM facade helpers — contact_status, pipeline stage normalization
 */

const db = require('../database');
const { getDisplayWebsiteUrl } = require('./lead-ingestion');
const { isJobBoardUrl } = require('./contact-extractor');
const { parseRequiredLanguages } = require('./lead-language-extractor');

const STAGE_TO_UI = {
  qualified: 'contacted',
  proposal: 'contacted',
  negotiation: 'contacted',
  demo_scheduled: 'demo',
  closed_won: 'won',
  closed_lost: 'lost',
};

const UI_TO_DB = {
  demo: 'demo_scheduled',
  won: 'closed_won',
  lost: 'closed_lost',
  call_ready: 'new',
};

const UI_STAGES = ['new', 'contacted', 'demo', 'won', 'lost'];

function hasValidPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10;
}

function normalizeStage(stage) {
  if (!stage) return 'new';
  return STAGE_TO_UI[stage] || stage;
}

function denormalizeStage(uiStage) {
  if (!uiStage) return 'new';
  return UI_TO_DB[uiStage] || uiStage;
}

function dbStagesForUiStage(uiStage) {
  const dbStage = denormalizeStage(uiStage);
  if (uiStage === 'contacted') {
    return ['contacted', 'qualified', 'proposal', 'negotiation'];
  }
  if (uiStage === 'demo') {
    return ['demo', 'demo_scheduled'];
  }
  if (uiStage === 'won') {
    return ['won', 'closed_won'];
  }
  if (uiStage === 'lost') {
    return ['lost', 'closed_lost'];
  }
  return [dbStage];
}

function getContactStatus(lead, enrichingIds = new Set()) {
  if (enrichingIds.has(String(lead.id))) return 'enriching';
  if (hasValidPhone(lead.clinic_phone)) return 'verified';
  if (lead.clinic_email && !lead.source_url) return 'enriched';
  if (lead.notes && String(lead.notes).includes('enrich_failed')) return 'failed';
  if (lead.source_url && !hasValidPhone(lead.clinic_phone)) return 'needs_phone';
  if (!hasValidPhone(lead.clinic_phone) && !lead.clinic_email) return 'raw';
  return 'needs_phone';
}

function formatLeadForApi(lead, enrichingIds = new Set()) {
  if (!lead) return null;
  const website_url = getDisplayWebsiteUrl(lead);
  const safeSource = lead.source_url && !isJobBoardUrl(lead.source_url) ? lead.source_url : null;
  const language_labels = parseRequiredLanguages(lead.required_languages);
  return {
    ...lead,
    source_url: safeSource,
    website_url,
    language_labels,
    preferred_language: lead.preferred_language || (language_labels.length ? null : 'en'),
    pipeline_stage: normalizeStage(lead.pipeline_stage),
    contact_status: getContactStatus(lead, enrichingIds),
    lead_source: lead.source || lead.lead_source || null,
    location: lead.location || null,
    last_called_at: lead.last_called_at || lead.last_call_at || null,
  };
}

function matchesSpecialty(lead, specialty) {
  if (!specialty) return true;
  const s = (lead.specialty || '').toLowerCase();
  const filter = specialty.toLowerCase();
  if (filter === 'dental') return s.includes('dental');
  if (filter === 'medical') {
    return s.includes('medical') || s.includes('primary') || s.includes('clinic') || (!s.includes('dental') && s.length > 0);
  }
  return s.includes(filter);
}

function matchesSearch(lead, search) {
  if (!search) return true;
  const q = search.toLowerCase();
  const hay = [
    lead.clinic_name,
    lead.location,
    lead.specialty,
    lead.title,
    lead.clinic_phone,
    lead.clinic_email,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function querySalesLeads(filters = {}) {
  const {
    contact_status,
    specialty,
    search,
    limit = 50,
    offset = 0,
    pipeline_stage,
    call_ready,
  } = filters;

  let sql = `
    SELECT * FROM leads
    WHERE (is_test IS NULL OR is_test = 0)
      AND (lead_type IS NULL OR lead_type = 'sales')
  `;
  const params = [];

  if (pipeline_stage) {
    const stages = dbStagesForUiStage(pipeline_stage);
    sql += ` AND pipeline_stage IN (${stages.map(() => '?').join(',')})`;
    params.push(...stages);
  }

  if (call_ready) {
    sql += ` AND clinic_phone IS NOT NULL AND LENGTH(clinic_phone) > 0`;
    sql += ` AND (pipeline_stage IS NULL OR pipeline_stage IN ('new', 'call_ready'))`;
  }

  sql += ' ORDER BY lead_score DESC, priority DESC, created_at DESC';

  const rows = db.db.prepare(sql).all(...params);
  const enrichingIds = require('./admin-job-tracker').getEnrichingLeadIds();

  let filtered = rows
    .map((l) => formatLeadForApi(l, enrichingIds))
    .filter((l) => matchesSpecialty(l, specialty))
    .filter((l) => matchesSearch(l, search));

  if (contact_status) {
    filtered = filtered.filter((l) => l.contact_status === contact_status);
  }

  const total = filtered.length;
  const leads = filtered.slice(offset, offset + limit);
  return { leads, total };
}

function getLeadCountsByContactStatus() {
  const rows = db.db.prepare(`
    SELECT * FROM leads
    WHERE (is_test IS NULL OR is_test = 0)
      AND (lead_type IS NULL OR lead_type = 'sales')
  `).all();
  const enrichingIds = require('./admin-job-tracker').getEnrichingLeadIds();

  const counts = {
    verified: 0,
    needs_phone: 0,
    enriched_no_phone: 0,
    raw: 0,
    failed: 0,
  };

  for (const row of rows) {
    const status = getContactStatus(row, enrichingIds);
    if (status === 'verified') counts.verified++;
    else if (status === 'needs_phone' || status === 'enriching') counts.needs_phone++;
    else if (status === 'raw') counts.raw++;
    else if (status === 'failed') counts.failed++;
    else if (status === 'enriched') counts.enriched_no_phone++;
  }

  return counts;
}

function getPipelineView(specialty) {
  const rows = db.db.prepare(`
    SELECT * FROM leads
    WHERE (is_test IS NULL OR is_test = 0)
      AND (lead_type IS NULL OR lead_type = 'sales')
    ORDER BY lead_score DESC, created_at DESC
  `).all();

  const enrichingIds = require('./admin-job-tracker').getEnrichingLeadIds();
  const counts = { new: 0, contacted: 0, demo: 0, won: 0, lost: 0 };
  const cards = { new: [], contacted: [], demo: [], won: [], lost: [] };

  for (const row of rows) {
    if (!hasValidPhone(row.clinic_phone)) continue;
    const lead = formatLeadForApi(row, enrichingIds);
    if (!matchesSpecialty(lead, specialty)) continue;
    const stage = normalizeStage(row.pipeline_stage);
    const key = UI_STAGES.includes(stage) ? stage : 'new';
    counts[key]++;
    if (cards[key].length < 20) cards[key].push(lead);
  }

  return { counts, cards };
}

function formatActivities(activities) {
  return (activities || []).map((a) => ({
    id: a.id,
    type: a.activity_type === 'note' ? 'note' : a.activity_type,
    content: a.activity_description || a.activity_subject || '',
    created_at: a.activity_date || a.created_at,
  }));
}

function formatCalls(calls) {
  return (calls || []).map((c) => ({
    id: c.id,
    call_id: c.call_id,
    status: c.call_status,
    outcome: c.outcome || c.call_status,
    duration_seconds: c.call_duration_seconds,
    transcript_url: c.transcript_url,
    created_at: c.created_at,
    notes: c.notes,
  }));
}

module.exports = {
  UI_STAGES,
  hasValidPhone,
  normalizeStage,
  denormalizeStage,
  dbStagesForUiStage,
  getContactStatus,
  formatLeadForApi,
  querySalesLeads,
  getLeadCountsByContactStatus,
  getPipelineView,
  formatActivities,
  formatCalls,
  matchesSpecialty,
  matchesSearch,
};
