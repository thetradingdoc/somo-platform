#!/usr/bin/env node
/**
 * CRM pipeline diagnostic — scrape config, DB leads, facade APIs, contact extraction.
 * Usage: node scripts/debug-crm-pipeline.js [--seed] [--scrape] [--api-base http://localhost:4000]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../database');
const facade = require('../services/platform/admin-lead-facade');
const { searchJobs } = require('../services/platform/job-scraper');
const { extractContactInfo } = require('../services/platform/contact-extractor');

const args = process.argv.slice(2);
const shouldSeed = args.includes('--seed');
const shouldScrape = args.includes('--scrape');
const apiBase = (() => {
  const i = args.indexOf('--api-base');
  return (i >= 0 ? args[i + 1] : process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
})();

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function ok(msg) { console.log('  ✅', msg); }
function warn(msg) { console.log('  ⚠️ ', msg); }
function fail(msg) { console.log('  ❌', msg); }

async function checkEnv() {
  section('1. Environment');
  const apiUrl = process.env.JOB_SEARCH_API_URL;
  const apiKey = process.env.JOB_SEARCH_API_KEY;
  if (apiUrl && apiKey) {
    ok(`JOB_SEARCH configured (engine hint: ${process.env.JOB_SEARCH_ENGINE || 'default'})`);
    ok(`API URL host: ${new URL(apiUrl).hostname}`);
  } else {
    fail('JOB_SEARCH_API_URL and JOB_SEARCH_API_KEY are NOT set');
    warn('Scrape will fail until you add JSearch (RapidAPI) or SerpAPI credentials to .env');
    warn('Example JSearch: JOB_SEARCH_API_URL=https://jsearch.p.rapidapi.com/search');
    warn('                 JOB_SEARCH_API_KEY=<rapidapi-key>');
    warn('                 JOB_SEARCH_ENGINE=jsearch');
  }
  if (!process.env.ADMIN_PORTAL_SECRET) {
    warn('ADMIN_PORTAL_SECRET not set — local admin APIs are open in dev');
  }
}

function checkDatabase() {
  section('2. Database leads');
  const total = db.db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE (is_test IS NULL OR is_test = 0) AND (lead_type IS NULL OR lead_type = 'sales')
  `).get().n;
  const withPhone = db.db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE clinic_phone IS NOT NULL AND LENGTH(clinic_phone) > 0
      AND (lead_type IS NULL OR lead_type = 'sales')
  `).get().n;
  const withEmail = db.db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE clinic_email IS NOT NULL AND LENGTH(clinic_email) > 0
      AND (lead_type IS NULL OR lead_type = 'sales')
  `).get().n;
  const withEither = db.db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE (
      (clinic_phone IS NOT NULL AND LENGTH(clinic_phone) > 0)
      OR (clinic_email IS NOT NULL AND LENGTH(clinic_email) > 0)
    ) AND (lead_type IS NULL OR lead_type = 'sales')
  `).get().n;

  console.log(`  Total sales leads: ${total}`);
  console.log(`  With phone: ${withPhone}`);
  console.log(`  With email: ${withEmail}`);
  console.log(`  With phone OR email: ${withEither}`);

  if (total === 0) {
    warn('No sales leads in DB — admin portal will show empty queues');
    warn('Run with --seed to insert test leads, or --scrape if JOB_SEARCH is configured');
  } else {
    const samples = db.db.prepare(`
      SELECT clinic_name, clinic_phone, clinic_email, source, pipeline_stage, created_at
      FROM leads WHERE (lead_type IS NULL OR lead_type = 'sales')
      ORDER BY created_at DESC LIMIT 5
    `).all();
    console.log('  Recent leads:');
    for (const l of samples) {
      console.log(`    - ${l.clinic_name}: phone=${l.clinic_phone || '—'} email=${l.clinic_email || '—'} [${l.pipeline_stage}]`);
    }
  }
}

function checkFacade() {
  section('3. Facade layer (admin portal data shape)');
  const counts = facade.getLeadCountsByContactStatus();
  console.log('  contact_status counts:', counts);
  const { leads, total } = facade.querySalesLeads({ contact_status: 'verified', limit: 5 });
  console.log(`  call-ready (verified) query: ${total} total, showing ${leads.length}`);
  for (const l of leads) {
    console.log(`    - ${l.clinic_name} | ${l.contact_status} | score=${l.lead_score}`);
  }
  const pipeline = facade.getPipelineView('');
  console.log('  pipeline counts:', pipeline.counts);
}

async function seedTestLeads() {
  section('4. Seed test leads (--seed)');
  const { v4: uuidv4 } = require('uuid');
  const samples = [
    {
      id: uuidv4(),
      external_id: `debug_${Date.now()}_1`,
      clinic_name: 'Debug Dental Queens',
      clinic_phone: '+17185551234',
      clinic_email: 'frontdesk@debug-dental.test',
      location: 'Queens, NY',
      specialty: 'Dental',
      source: 'debug_seed',
      lead_type: 'sales',
      pipeline_stage: 'new',
      lead_score: 82,
    },
    {
      id: uuidv4(),
      external_id: `debug_${Date.now()}_2`,
      clinic_name: 'Debug Medical Needs Phone',
      clinic_phone: null,
      clinic_email: null,
      location: 'Brooklyn, NY',
      specialty: 'Medical',
      source_url: 'https://example.com/job-posting',
      source: 'debug_seed',
      lead_type: 'sales',
      pipeline_stage: 'new',
      lead_score: 65,
    },
  ];
  for (const lead of samples) {
    try {
      db.createLead(lead);
      ok(`Created: ${lead.clinic_name}`);
    } catch (e) {
      warn(`Skip ${lead.clinic_name}: ${e.message}`);
    }
  }
}

async function testScrape() {
  section('5. Live job search (--scrape)');
  try {
    const jobs = await searchJobs({
      query: 'dental receptionist',
      location: 'US,NY',
      postedSinceDays: 7,
      engine: 'jsearch',
    });
    ok(`JSearch returned ${jobs.length} raw jobs`);
    const withUrl = jobs.filter((j) => j.source_url).length;
    const withPhone = jobs.filter((j) => j.clinic_phone).length;
    const withEmail = jobs.filter((j) => j.clinic_email).length;
    console.log(`  Jobs with source_url: ${withUrl}/${jobs.length}`);
    console.log(`  Jobs with phone in feed: ${withPhone}/${jobs.length} (JSearch rarely includes phone)`);
    console.log(`  Jobs with email in feed: ${withEmail}/${jobs.length}`);
    if (jobs[0]) {
      const j = jobs[0];
      console.log('  Sample job:', {
        clinic: j.clinic_name,
        title: j.title,
        location: j.location,
        url: j.source_url?.slice(0, 60),
      });
      if (j.source_url) {
        console.log('  Attempting contact extraction on first job URL...');
        try {
          const { phone, email } = await extractContactInfo(j.source_url, j.clinic_name, j.location);
          console.log(`  Extracted: phone=${phone || '—'} email=${email || '—'}`);
          if (!phone && !email) {
            warn('Extraction found no contacts — job board pages often lack direct phone/email');
            warn('SerpAPI + findClinicWebsite helps when JOB_SEARCH_API_URL is serpapi.com');
          }
        } catch (e) {
          fail(`Extraction failed: ${e.message}`);
        }
      }
    }
  } catch (e) {
    fail(`searchJobs failed: ${e.message}`);
  }
}

async function testHttpApi() {
  section('6. HTTP API (' + apiBase + ')');
  const paths = [
    '/api/admin/scrape/status',
    '/api/admin/scrape/leads/pipeline',
    '/api/admin/tenants/alerts',
  ];
  for (const p of paths) {
    try {
      const res = await fetch(`${apiBase}${p}`, { credentials: 'include' });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
      if (res.ok) {
        ok(`${p} → ${res.status}`);
        if (p.includes('status')) {
          console.log('    scheduler:', body.scheduler);
          console.log('    leads:', body.leads);
        }
        if (p.includes('pipeline')) {
          console.log('    counts:', body.counts);
        }
        if (p.includes('alerts')) {
          console.log('    alerts:', (body.alerts || []).length);
        }
      } else if (res.status === 404) {
        fail(`${p} → 404 — server needs restart to load new admin-scrape routes`);
      } else {
        warn(`${p} → ${res.status}: ${typeof body === 'object' ? body.error : body}`);
      }
    } catch (e) {
      fail(`${p}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('CRM Pipeline Diagnostic');
  await checkEnv();
  if (shouldSeed) await seedTestLeads();
  checkDatabase();
  checkFacade();
  if (shouldScrape) await testScrape();
  await testHttpApi();
  section('Summary');
  const hasSearch = !!(process.env.JOB_SEARCH_API_URL && process.env.JOB_SEARCH_API_KEY);
  const total = db.db.prepare(`SELECT COUNT(*) as n FROM leads`).get().n;
  if (!hasSearch) {
    fail('Job scraping is NOT configured — add JOB_SEARCH_* to .env');
  }
  if (total === 0 && !shouldSeed) {
    warn('Admin portal will be empty until scrape runs or you use --seed');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
