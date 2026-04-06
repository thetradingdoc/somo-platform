'use strict';

/**
 * PubMed (NCBI E-utilities) search — citations only, no full text.
 * Set NCBI_CONTACT_EMAIL for polite pool identity (recommended by NCBI).
 */

const axios = require('axios');
const secureLogger = require('./secure-logger');

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DEFAULT_TIMEOUT_MS = Math.min(20000, parseInt(process.env.NCBI_EUTILS_TIMEOUT_MS || '12000', 10) || 12000);
const DEFAULT_MAX = Math.min(10, Math.max(1, parseInt(process.env.NCBI_PUBMED_MAX_RESULTS || '5', 10) || 5));

/** @type {Map<string, { count: number, lastAt: number }>} */
const _pubmedSessionBudget = new Map();

function _sessionPubmedBudget(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: true };
  const maxCalls = Math.min(50, Math.max(1, parseInt(process.env.PUBMED_MAX_CALLS_PER_SESSION || '8', 10) || 8));
  let minGapMs = parseInt(String(process.env.PUBMED_MIN_INTERVAL_MS ?? '2500'), 10);
  if (!Number.isFinite(minGapMs)) minGapMs = 2500;
  minGapMs = Math.min(120000, Math.max(0, minGapMs));
  const now = Date.now();
  let s = _pubmedSessionBudget.get(sid);
  if (!s) {
    s = { count: 0, lastAt: 0 };
    _pubmedSessionBudget.set(sid, s);
  }
  if (s.count >= maxCalls) {
    secureLogger.warn('[pubmed] session_cap', { session_prefix: sid.slice(0, 8), maxCalls });
    return {
      ok: false,
      error: 'session_rate_limited',
      message: 'Literature search limit reached for this chat. Try again later.'
    };
  }
  if (minGapMs > 0 && s.lastAt && now - s.lastAt < minGapMs) {
    secureLogger.info('[pubmed] min_interval_block', { session_prefix: sid.slice(0, 8), wait_ms: minGapMs - (now - s.lastAt) });
    return {
      ok: false,
      error: 'min_interval',
      message: 'Please wait a moment before another literature search.'
    };
  }
  s.count += 1;
  s.lastAt = now;
  _pubmedSessionBudget.set(sid, s);
  return { ok: true };
}

function _contactParam() {
  const email = String(process.env.NCBI_CONTACT_EMAIL || process.env.TOOL_USER_EMAIL || '').trim();
  const tool = String(process.env.NCBI_TOOL_NAME || 'doclittle_middleware').trim();
  return { email: email || 'dev@localhost', tool };
}

async function searchPubMed(query, options = {}) {
  const q = String(query || '').trim();
  if (!q) return { success: false, error: 'query_required', articles: [] };

  const max = Math.min(10, Math.max(1, Number(options.max_results) || DEFAULT_MAX));
  const { email, tool } = _contactParam();

  if (String(process.env.MEDICAL_LITERATURE_SEARCH_ENABLED || 'true').toLowerCase() === 'false') {
    return { success: false, error: 'disabled', articles: [] };
  }

  const budget = _sessionPubmedBudget(options.sessionId);
  if (!budget.ok) {
    return { success: false, error: budget.error, message: budget.message, articles: [] };
  }

  try {
    const esearch = await axios.get(`${EUTILS}/esearch.fcgi`, {
      timeout: DEFAULT_TIMEOUT_MS,
      params: {
        db: 'pubmed',
        term: q,
        retmode: 'json',
        retmax: max,
        sort: 'relevance',
        tool,
        email
      }
    });

    const idList = esearch.data?.esearchresult?.idlist || [];
    secureLogger.info('[pubmed] esearch', { query_len: q.length, id_count: idList.length, session_prefix: String(options.sessionId || '').slice(0, 8) });
    if (!idList.length) {
      return { success: true, articles: [], query: q, message: 'No PubMed results for that query.' };
    }

    const esummary = await axios.get(`${EUTILS}/esummary.fcgi`, {
      timeout: DEFAULT_TIMEOUT_MS,
      params: {
        db: 'pubmed',
        id: idList.join(','),
        retmode: 'json',
        tool,
        email
      }
    });

    const result = esummary.data?.result || {};
    const articles = [];
    for (const pmid of idList) {
      const rec = result[pmid];
      if (!rec || rec.error) continue;
      const authors = Array.isArray(rec.authors) ? rec.authors.map((a) => a.name).filter(Boolean).slice(0, 4) : [];
      articles.push({
        pmid: String(pmid),
        title: rec.title || '',
        authors,
        journal: rec.fulljournalname || rec.source || '',
        year: rec.pubdate ? String(rec.pubdate).slice(0, 4) : '',
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
      });
    }

    return { success: true, query: q, articles, source: 'pubmed_ncbi' };
  } catch (e) {
    return {
      success: false,
      error: 'ncbi_request_failed',
      message: e.message || 'PubMed search failed',
      articles: []
    };
  }
}

module.exports = { searchPubMed };
