#!/usr/bin/env node
/**
 * Daily Medical Receptionist Lead Fetcher
 *
 * Logs into the admin API using ADMIN_PORTAL_SECRET, pulls the latest
 * “Medical Receptionist” lead for the configured location, saves it to the
 * CRM, and optionally extracts contact info when missing.
 *
 * Designed to be invoked locally (`npm run search:medical`) or by an Azure job.
 */

const path = require('path');
const fs = require('fs');

// Load environment variables from the middleware .env if running locally
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const ADMIN_SECRET = process.env.ADMIN_PORTAL_SECRET;
const BASE_URL =
  (process.env.ADMIN_PORTAL_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.DOC_LITTLE_BASE_URL ||
    'http://localhost:4000').replace(/\/$/, '');
// Search both NY and NJ - the API endpoint handles multiple locations
const SEARCH_LOCATION = process.env.MEDICAL_RECEPTIONIST_LOCATION || 'US,NY';
const SEARCH_DAYS = process.env.MEDICAL_RECEPTIONIST_DAYS || '1';
const INTERNAL_JOB_TOKEN = process.env.INTERNAL_JOB_TOKEN;

const LOG_PREFIX = '[medical-receptionist-daily]';

function log(message, data) {
  const ts = new Date().toISOString();
  if (data) {
    console.log(`${LOG_PREFIX} ${ts} ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${ts} ${message}`);
  }
}

if (!ADMIN_SECRET) {
  console.error(`${LOG_PREFIX} ADMIN_PORTAL_SECRET is required to run this script.`);
  process.exit(1);
}

async function adminFetch(pathname, { method = 'GET', headers = {}, body, cookie } = {}) {
  const res = await fetchFn(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(INTERNAL_JOB_TOKEN ? { 'x-internal-job-token': INTERNAL_JOB_TOKEN } : {}),
      ...headers
    },
    body
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Failed to parse response from ${pathname}: ${text}`);
  }

  if (!res.ok) {
    const errMsg = json?.message || json?.error || res.statusText;
    throw new Error(`Request to ${pathname} failed (${res.status}): ${errMsg}`);
  }

  return { json, headers: res.headers };
}

async function login() {
  log(`Logging into admin portal at ${BASE_URL}...`);
  const { headers } = await adminFetch('/api/admin/session', {
    method: 'POST',
    body: JSON.stringify({ secret: ADMIN_SECRET })
  });

  const setCookie = headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Admin login succeeded but no session cookie was returned.');
  }

  const cookie = setCookie.split(',')[0].split(';')[0];
  log('Admin session established.');
  return cookie;
}

async function fetchLeads(cookie) {
  log(`Searching for Medical Receptionist leads (location=${SEARCH_LOCATION}, days=${SEARCH_DAYS})...`);
  const { json } = await adminFetch(
    `/api/admin/leads/insights/medical-receptionist?location=${encodeURIComponent(
      SEARCH_LOCATION
    )}&days=${encodeURIComponent(SEARCH_DAYS)}`,
    { cookie }
  );

  if (!json?.success || !json?.leads || !json.leads.length) {
    const single = json?.lead;
    if (single) {
      log('Single Medical Receptionist lead returned from insights.', single);
      return [single];
    }
    log('No Medical Receptionist leads found for this window.');
    return [];
  }

  log(`Leads found from insights provider (count=${json.leads.length}).`);
  return json.leads;
}

async function saveLead(cookie, lead) {
  log('Saving lead to CRM...');
  const { json } = await adminFetch('/api/admin/leads/save', {
    method: 'POST',
    body: JSON.stringify(lead),
    cookie
  });

  if (!json?.success) {
    throw new Error(json?.message || 'Failed to save lead');
  }

  log('Lead saved.', json.lead || json);
  return json.lead;
}

async function extractContactsIfNeeded(cookie, leadRecord, insightsLead) {
  if (!leadRecord?.id) return;
  const needsPhone = !leadRecord.clinic_phone && !insightsLead?.clinic_phone;
  const needsEmail = !leadRecord.clinic_email && !insightsLead?.clinic_email;
  const hasSource = insightsLead?.source_url || leadRecord?.source_url;

  if (!hasSource || (!needsPhone && !needsEmail)) {
    return;
  }

  log('Attempting contact extraction for saved lead...');
  try {
    const { json } = await adminFetch(`/api/admin/leads/${leadRecord.id}/extract-contact`, {
      method: 'POST',
      cookie
    });
    log('Contact extraction result:', json);
  } catch (error) {
    log(`Contact extraction failed: ${error.message}`);
  }
}

async function run() {
  try {
    const cookie = await login();
    const leads = await fetchLeads(cookie);
    if (!leads || leads.length === 0) {
      log('No leads returned, exiting.');
      return;
    }

    for (const lead of leads) {
      const savedLead = await saveLead(cookie, lead);
      await extractContactsIfNeeded(cookie, savedLead, lead);
    }

    log('Daily Medical Receptionist job completed successfully.');
  } catch (error) {
    console.error(`${LOG_PREFIX} ERROR:`, error.message);
    process.exitCode = 1;
  }
}

run();

