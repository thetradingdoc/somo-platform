'use strict';

/**
 * Craigslist job listings via regional RSS + posting body contact extraction.
 * Does not use JOB_BOARD_DOMAINS enrichment path.
 */

const axios = require('axios');
const { extractPhoneNumber, extractEmail } = require('./contact-extractor');

const USER_AGENT = 'SomoLeadBot/1.0 (+https://callsomo.com; admin CRM ingestion)';
const MIN_INTERVAL_MS = 1000;

const bodyCache = new Map();
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedGet(url, opts = {}) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
  return axios.get(url, {
    timeout: opts.timeout || 15000,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: opts.accept || 'application/rss+xml, text/xml, text/html, */*'
    },
    ...opts
  });
}

function parseRegions() {
  const raw = process.env.CRAIGSLIST_REGIONS || 'newyork';
  return raw
    .split(/[,|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseQueries() {
  const raw = process.env.CRAIGSLIST_QUERIES || 'dental receptionist|medical receptionist|front desk';
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractPostingId(url) {
  if (!url) return null;
  const m = String(url).match(/\/(\d+)\.html/i);
  return m ? m[1] : null;
}

function extractRssItems(xml) {
  const items = [];
  const blocks = String(xml).split(/<item>/i).slice(1);
  for (const block of blocks) {
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1];
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || [])[1];
    const date = (block.match(/<dc:date>([\s\S]*?)<\/dc:date>/i) || [])[1];
    if (!link) continue;
    items.push({
      title: title ? title.trim().replace(/&amp;/g, '&') : 'Job posting',
      link: link.trim(),
      description: desc ? desc.trim() : '',
      posted_at: date ? date.trim() : null
    });
  }
  return items;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPostingBody(url) {
  if (bodyCache.has(url)) return bodyCache.get(url);
  try {
    const resp = await rateLimitedGet(url, { accept: 'text/html' });
    const text = stripHtml(resp.data);
    bodyCache.set(url, text);
    return text;
  } catch (err) {
    bodyCache.set(url, '');
    return '';
  }
}

function normalizeCraigslistJob(item, region, bodyText) {
  const postingId = extractPostingId(item.link);
  const external_id = postingId
    ? `craigslist-${region}-${postingId}`
    : `craigslist-${region}-${Buffer.from(item.link).toString('base64url').slice(0, 16)}`;
  const combined = `${item.title}\n${item.description}\n${bodyText || ''}`;
  const clinic_phone = extractPhoneNumber(combined);
  const clinic_email = extractEmail(combined);
  const clinic_name = item.title.split(' - ')[0]?.trim() || item.title || 'Craigslist employer';

  return {
    external_id,
    title: item.title || 'Receptionist',
    clinic_name,
    clinic_phone,
    clinic_email,
    location: region,
    source_url: item.link,
    pay_rate: null,
    charge_rate: null,
    posted_at: item.posted_at || null,
    source: 'craigslist',
    description: combined.slice(0, 4000)
  };
}

/**
 * Search Craigslist RSS feeds for configured regions/queries.
 * @returns {Promise<Array<object>>}
 */
async function searchCraigslistJobs(opts = {}) {
  if (process.env.CRAIGSLIST_ENABLED !== '1') return [];

  const regions = opts.regions || parseRegions();
  const queries = opts.queries || parseQueries();
  const maxPerRun = opts.maxPerRun || parseInt(process.env.CRAIGSLIST_MAX_PER_RUN || '25', 10);
  const results = [];
  const seen = new Set();

  for (const region of regions) {
    for (const query of queries) {
      if (results.length >= maxPerRun) break;
      const rssUrl = `https://${region}.craigslist.org/search/jjj?format=rss&query=${encodeURIComponent(query)}`;
      try {
        const resp = await rateLimitedGet(rssUrl);
        const items = extractRssItems(resp.data);
        for (const item of items) {
          if (results.length >= maxPerRun) break;
          const postingId = extractPostingId(item.link);
          const dedupeKey = postingId ? `${region}-${postingId}` : item.link;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const bodyText = await fetchPostingBody(item.link);
          results.push(normalizeCraigslistJob(item, region, bodyText));
        }
      } catch (err) {
        console.warn(`[craigslist] RSS failed ${region}/${query}:`, err.message);
      }
    }
  }

  return results;
}

function isCraigslistConfigured() {
  return process.env.CRAIGSLIST_ENABLED === '1' && parseRegions().length > 0;
}

module.exports = {
  searchCraigslistJobs,
  isCraigslistConfigured,
  parseRegions,
  parseQueries,
  extractPostingId,
  extractRssItems,
  normalizeCraigslistJob,
  _clearCacheForTests: () => bodyCache.clear()
};
