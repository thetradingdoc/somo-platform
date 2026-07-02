#!/usr/bin/env node
'use strict';

/**
 * Phase 0 front-desk verification — HIPAA audit plumbing + subscription=credits SSOT.
 * Exit 0 when all structural checks pass (does not require live vendor BAAs).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(ROOT, '..');

function fail(report, msg) {
  report.checks.push({ ok: false, message: msg });
  report.pass = false;
}

function pass(report, msg) {
  report.checks.push({ ok: true, message: msg });
}

function main() {
  const report = { pass: true, checks: [] };

  // BAA checklist doc
  const baaDoc = path.join(REPO_ROOT, 'docs/compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md');
  if (fs.existsSync(baaDoc)) {
    const body = fs.readFileSync(baaDoc, 'utf8');
    const vendors = ['Retell', 'Twilio', 'Stedi', 'Groq', 'Anthropic'];
    const missing = vendors.filter((v) => !body.includes(v));
    if (missing.length) {
      fail(report, `BAA checklist missing vendors: ${missing.join(', ')}`);
    } else {
      pass(report, 'Front-desk BAA checklist documents required vendors');
    }
  } else {
    fail(report, 'Missing docs/compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md');
  }

  // plan-catalog.json
  const catalogPath = path.join(ROOT, 'config/plan-catalog.json');
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (!catalog.signup_trial_minutes || catalog.signup_trial_minutes < 1) {
      fail(report, 'plan-catalog.json signup_trial_minutes must be positive');
    } else {
      pass(report, `plan-catalog signup_trial_minutes=${catalog.signup_trial_minutes}`);
    }
    const tiers = Object.values(catalog.tiers || {});
    if (!tiers.length) {
      fail(report, 'plan-catalog.json has no tiers');
    } else {
      const bad = tiers.filter((t) => !t.included_minutes_per_cycle);
      if (bad.length) {
        fail(report, 'Every tier must define included_minutes_per_cycle');
      } else {
        pass(report, `plan-catalog has ${tiers.length} tiers with cycle minutes`);
      }
    }
  } catch (e) {
    fail(report, `plan-catalog.json unreadable: ${e.message}`);
  }

  // subscription-credits SSOT module
  try {
    const { ensureSignupTrialCredits, getSignupTrialMinutes } = require('../services/subscription-credits');
    const minutes = getSignupTrialMinutes();
    if (minutes !== catalog.signup_trial_minutes) {
      fail(report, 'subscription-credits getSignupTrialMinutes out of sync with catalog');
    } else {
      pass(report, 'subscription-credits module reads plan-catalog SSOT');
    }
    if (typeof ensureSignupTrialCredits !== 'function') {
      fail(report, 'ensureSignupTrialCredits not exported');
    }
  } catch (e) {
    fail(report, `subscription-credits module: ${e.message}`);
  }

  // voice-billing-stripe grants cycle minutes
  try {
    const stripeBilling = require('../services/voice-billing-stripe');
    if (typeof stripeBilling.getBillingStatus !== 'function') {
      fail(report, 'voice-billing-stripe missing getBillingStatus');
    } else {
      pass(report, 'voice-billing-stripe exposes getBillingStatus');
    }
  } catch (e) {
    fail(report, `voice-billing-stripe: ${e.message}`);
  }

  // provision path seeds credits
  const provisionSrc = fs.readFileSync(path.join(ROOT, 'services/saas-tenant-provision.js'), 'utf8');
  if (!provisionSrc.includes('ensureSignupTrialCredits')) {
    fail(report, 'saas-tenant-provision must call ensureSignupTrialCredits');
  } else {
    pass(report, 'saas-tenant-provision seeds signup trial credits');
  }

  // HIPAA audit log
  try {
    const db = require('../database');
    const cols = db.db.prepare('PRAGMA table_info(hipaa_access_log)').all().map((c) => c.name);
    const required = ['id', 'user_id', 'resource_type', 'action'];
    const missingCols = required.filter((c) => !cols.includes(c));
    if (missingCols.length) {
      fail(report, `hipaa_access_log missing columns: ${missingCols.join(', ')}`);
    } else if (typeof db.logHipaaAccess !== 'function') {
      fail(report, 'db.logHipaaAccess not defined');
    } else {
      pass(report, 'hipaa_access_log table + logHipaaAccess available');
    }
  } catch (e) {
    fail(report, `HIPAA audit log check: ${e.message}`);
  }

  // case-report auth
  const caseReportSrc = fs.readFileSync(path.join(ROOT, 'routes/case-report.js'), 'utf8');
  if (!caseReportSrc.includes('requireCustomerAuth')) {
    fail(report, 'case-report route must use requireCustomerAuth');
  } else if (!caseReportSrc.includes('logHipaaAccess')) {
    fail(report, 'case-report route must log HIPAA access');
  } else {
    pass(report, 'case-report protected with customer auth + audit log');
  }

  // env gate module
  try {
    const guards = require('../services/hipaa-production-guards');
    const sample = guards.getHipaaProductionViolations({ CLOUDRUN_PROFILE: 'production' });
    if (!Array.isArray(sample) || !sample.some((v) => v.includes('BAA_ACKNOWLEDGED'))) {
      fail(report, 'hipaa-production-guards missing BAA_ACKNOWLEDGED check');
    } else if (!sample.some((v) => v.includes('ADMIN_PORTAL_SECRET'))) {
      fail(report, 'hipaa-production-guards missing ADMIN_PORTAL_SECRET check');
    } else {
      pass(report, 'hipaa-production-guards enforces production BAA + admin secret env');
    }
  } catch (e) {
    fail(report, `hipaa-production-guards: ${e.message}`);
  }

  const complianceDocs = [
    'docs/compliance/templates/CUSTOMER_BAA_TEMPLATE.md',
    'docs/compliance/templates/HIPAA_RISK_ASSESSMENT_CHECKLIST.md',
    'docs/compliance/templates/MSA_SERVICES_AGREEMENT_TEMPLATE.md',
    'docs/compliance/FRONT_DESK_COVERAGE_PRICING_DECISION.md',
    'docs/compliance/FRONT_DESK_ELIGIBILITY_PRICING_DECISION.md',
    'docs/runbooks/TENANT_OFFBOARDING.md'
  ];
  for (const rel of complianceDocs) {
    const p = path.join(REPO_ROOT, rel);
    if (fs.existsSync(p)) pass(report, `exists: ${rel}`);
    else fail(report, `missing: ${rel}`);
  }

  const practice = catalog.tiers?.practice;
  if (practice?.included_eligibility_checks_per_cycle === 400 && practice?.eligibility_overage_rate_usd === 0.35) {
    pass(report, 'plan-catalog practice eligibility hybrid pricing locked');
  } else {
    fail(report, 'plan-catalog practice tier must be 400 checks @ $0.35 overage');
  }

  const tenantsRoute = fs.readFileSync(path.join(ROOT, 'routes/admin-tenants.js'), 'utf8');
  if (!tenantsRoute.includes('phi-export') || !tenantsRoute.includes('buildTenantPhiExport')) {
    fail(report, 'admin-tenants must expose phi-export route');
  } else {
    pass(report, 'admin phi-export route wired');
  }

  try {
    const { buildTenantPhiExport, maskPhone } = require('../services/tenant-phi-export-service');
    if (maskPhone('8085551234') !== '***-***-1234') {
      fail(report, 'tenant-phi-export maskPhone unexpected');
    } else if (typeof buildTenantPhiExport !== 'function') {
      fail(report, 'buildTenantPhiExport not exported');
    } else {
      pass(report, 'tenant-phi-export-service available');
    }
  } catch (e) {
    fail(report, `tenant-phi-export-service: ${e.message}`);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
