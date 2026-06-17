/**
 * Sales lead ingestion — enrich job postings and gate saves on verified phone.
 */

const { extractContactInfo, isJobBoardUrl } = require('./contact-extractor');
const { extractLanguagesFromJob } = require('./lead-language-extractor');

const JOB_POSTING_NOTE_PREFIX = 'job_posting_url:';

function hasValidPhone(phone) {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10;
}

function parseJobPostingUrl(notes) {
  if (!notes) return null;
  for (const line of String(notes).split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(JOB_POSTING_NOTE_PREFIX)) {
      return trimmed.slice(JOB_POSTING_NOTE_PREFIX.length).trim() || null;
    }
  }
  return null;
}

function buildNotesWithJobPosting(jobPostingUrl, existingNotes) {
  if (!jobPostingUrl || !isJobBoardUrl(jobPostingUrl)) {
    return existingNotes || null;
  }
  const line = `${JOB_POSTING_NOTE_PREFIX} ${jobPostingUrl}`;
  if (existingNotes && existingNotes.includes(line)) return existingNotes;
  return [existingNotes, line].filter(Boolean).join('\n') || null;
}

/**
 * Enrich a raw job search result; prefer clinic website over job-board URLs.
 */
async function enrichJobCandidate(job) {
  const jobPostingUrl = job.source_url || job.link || job.url || null;
  const clinicName = job.clinic_name || job.company || job.source || 'Unknown Clinic';
  const location = job.location || job.city || job.job_location || null;

  let clinic_phone = job.clinic_phone || null;
  let clinic_email = job.clinic_email || null;
  let opening_hours = job.opening_hours || null;
  let website_url = null;

  if (jobPostingUrl && (!clinic_phone || !clinic_email || !opening_hours)) {
    const extracted = await extractContactInfo(jobPostingUrl, clinicName, location);
    clinic_phone = clinic_phone || extracted.phone || null;
    clinic_email = clinic_email || extracted.email || null;
    opening_hours = opening_hours || extracted.openingHours || null;
    website_url = extracted.website_url || null;
  } else if (jobPostingUrl && !isJobBoardUrl(jobPostingUrl)) {
    website_url = jobPostingUrl;
  }

  let source_url = null;
  if (website_url && !isJobBoardUrl(website_url)) {
    source_url = website_url;
  } else if (jobPostingUrl && !isJobBoardUrl(jobPostingUrl)) {
    source_url = jobPostingUrl;
  }

  return {
    clinic_phone,
    clinic_email,
    opening_hours,
    source_url,
    website_url,
    job_posting_url: jobPostingUrl && isJobBoardUrl(jobPostingUrl) ? jobPostingUrl : null,
  };
}

function isCallableLead({ clinic_phone }) {
  return hasValidPhone(clinic_phone);
}

function buildLeadPayload(job, enriched, extra = {}) {
  const externalId = job.external_id || job.job_id || job.id
    || `${job.clinic_name || 'clinic'}-${jobPostingUrl(job)}`;

  const description = job.description || job.snippet || job.job_description || null;
  const lang = extractLanguagesFromJob({
    title: job.title || extra.title,
    description,
    snippet: job.snippet,
  });

  return {
    external_id: externalId,
    title: job.title || extra.title || 'Medical Receptionist',
    clinic_name: job.clinic_name || job.company || 'Unknown Clinic',
    clinic_phone: enriched.clinic_phone,
    clinic_email: enriched.clinic_email,
    opening_hours: enriched.opening_hours,
    location: job.location || job.city || job.job_location || null,
    source_url: enriched.source_url,
    description,
    source: extra.source || job.source || 'jsearch',
    posted_at: job.posted_at || job.date || null,
    lead_type: 'sales',
    pipeline_stage: 'new',
    specialty: extra.specialty ?? job.specialty ?? null,
    required_languages: lang.required_languages.length
      ? JSON.stringify(lang.required_languages)
      : null,
    preferred_language: lang.preferred_language,
    notes: buildNotesWithJobPosting(enriched.job_posting_url, extra.notes || job.notes),
    ...extra,
  };
}

function jobPostingUrl(job) {
  return job.source_url || job.link || job.url || '';
}

/**
 * Public website URL for admin UI (never a job board / ATS page).
 */
function getDisplayWebsiteUrl(lead) {
  if (lead.source_url && !isJobBoardUrl(lead.source_url)) {
    return lead.source_url;
  }
  const fromNotes = parseJobPostingUrl(lead.notes);
  if (fromNotes && !isJobBoardUrl(fromNotes)) return fromNotes;
  return null;
}

module.exports = {
  enrichJobCandidate,
  isCallableLead,
  hasValidPhone,
  buildLeadPayload,
  buildNotesWithJobPosting,
  parseJobPostingUrl,
  getDisplayWebsiteUrl,
  JOB_POSTING_NOTE_PREFIX,
};
