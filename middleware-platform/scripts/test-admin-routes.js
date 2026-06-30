#!/usr/bin/env node
/**
 * Smoke test admin CRM route modules load and export expected handlers.
 * Run: node middleware-platform/scripts/test-admin-routes.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function layerHasMethod(router, method, pathFragment) {
  const stack = router.stack || [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {});
      const p = layer.route.path;
      if (methods.includes(method) && String(p).includes(pathFragment)) return true;
    }
    if (layer.name === 'router' && layer.handle?.stack) {
      if (layerHasMethod(layer.handle, method, pathFragment)) return true;
    }
  }
  return false;
}

const tenants = require('../routes/admin-tenants');
assert.ok(layerHasMethod(tenants, 'get', '/alerts'), 'tenants GET /alerts');
assert.ok(layerHasMethod(tenants, 'delete', '/:clinicId'), 'tenants DELETE /:clinicId');

const scrape = require('../routes/admin-scrape');
assert.ok(layerHasMethod(scrape, 'get', '/status'), 'scrape GET /status');
assert.ok(layerHasMethod(scrape, 'get', '/leads/pipeline'), 'scrape GET /leads/pipeline');
assert.ok(layerHasMethod(scrape, 'get', '/leads/export'), 'scrape GET /leads/export');
assert.ok(layerHasMethod(scrape, 'get', '/leads/locations'), 'scrape GET /leads/locations');
assert.ok(layerHasMethod(scrape, 'post', '/run'), 'scrape POST /run');
assert.ok(layerHasMethod(scrape, 'post', '/leads/:id/suggested-stage/accept'), 'scrape POST suggested-stage accept');

const enrich = require('../routes/admin-enrich');
assert.ok(layerHasMethod(enrich, 'post', '/batch'), 'enrich POST /batch');

const ai = require('../routes/admin-ai-assistant');
assert.ok(layerHasMethod(ai, 'get', '/suggestions'), 'ai GET /suggestions');
assert.ok(layerHasMethod(ai, 'post', '/chat'), 'ai POST /chat');

const leads = require('../routes/admin-leads');
assert.ok(layerHasMethod(leads, 'delete', '/:id'), 'leads DELETE /:id');
assert.ok(layerHasMethod(leads, 'get', '/sales-agent/info'), 'leads GET /sales-agent/info');
assert.ok(layerHasMethod(leads, 'post', '/configure-sales-agent'), 'leads POST configure-sales-agent');

const callRouteSrc = fs.readFileSync(path.join(__dirname, '../routes/admin-leads.js'), 'utf8');
const scheduleGuardIdx = callRouteSrc.indexOf("schedule_type === 'weekly'");
const incrementIdx = callRouteSrc.indexOf('db.incrementCallUsage');
assert.ok(scheduleGuardIdx > 0 && scheduleGuardIdx < incrementIdx, 'schedule guard before incrementCallUsage');

const putLeadSrc = callRouteSrc;
assert.ok(putLeadSrc.includes('isJobBoardUrl(updates.source_url)'), 'PUT lead rejects job-board URLs');

const ingestion = require('../services/admin-scrape-ingestion');
assert.strictEqual(typeof ingestion.persistScrapedJob, 'function');
assert.strictEqual(typeof ingestion.enrichAndPersist, 'function');

const facade = require('../services/admin-lead-facade');
assert.strictEqual(facade.normalizeStage('closed_won'), 'won');
assert.strictEqual(facade.denormalizeStage('won'), 'closed_won');
assert.strictEqual(facade.getContactStatus({ clinic_phone: '+15551234567' }), 'verified');
assert.strictEqual(facade.hasValidPhone('555-1234'), false);
assert.strictEqual(facade.hasValidPhone('+1 (555) 123-4567'), true);
assert.strictEqual(
  facade.filterCallableLeads([
    { clinic_phone: '+15551234567' },
    { clinic_phone: '123' },
    { clinic_phone: null },
  ]).length,
  1
);
assert.throws(() => facade.assertCallableLead({ clinic_phone: '123' }), /verified phone/i);
assert.strictEqual(facade.matchesLocation({ location: 'Sykesville, Maryland, US' }, 'Maryland'), true);
assert.strictEqual(facade.matchesLocation({ location: 'NY' }, 'Maryland'), false);
assert.strictEqual(
  facade.matchesLocation({ location: 'Charleston, West Virginia, US' }, 'Virginia', 'state'),
  false
);
assert.strictEqual(
  facade.matchesLocation({ location: 'Alexandria, Virginia, US' }, 'Virginia', 'state'),
  true
);

const locUtils = require('../services/lead-location-utils');
assert.strictEqual(locUtils.parseLeadLocation('NYC, New York, US').state, 'New York');
const stateGrouped = facade.getDistinctLeadLocations({ group: 'state', limit: 5 });
assert.ok(Array.isArray(stateGrouped));

const { resolveScrapeLocations } = require('../routes/admin-scrape');
const defaultLocs = resolveScrapeLocations({});
assert.deepStrictEqual(defaultLocs, ['New York, NY', 'New York', 'US']);

const tenantDelete = require('../services/admin-tenant-delete-service');
assert.strictEqual(typeof tenantDelete.softDelete, 'function');
assert.strictEqual(typeof tenantDelete.hardDelete, 'function');
assert.ok(tenantDelete.matchesHardDeleteAllowlist({ name: 'Default Clinic', slug: 'x' }), 'allowlist name match');

const tenantHealth = require('../services/tenant-health');
const grouped = tenantHealth.groupAlerts([
  { clinic_id: 'x', company_name: 'X', severity: 'warning', reason: 'a' },
  { clinic_id: 'x', company_name: 'X', severity: 'warning', reason: 'b' },
]);
assert.strictEqual(grouped.length, 1);
assert.strictEqual(grouped[0].reasons.length, 2);

const jobTracker = require('../services/admin-job-tracker');
jobTracker.ensureTable();
const state = jobTracker.getSchedulerState();
assert.ok('is_running' in state);

const enrichSrc = fs.readFileSync(path.join(__dirname, '../routes/admin-enrich.js'), 'utf8');
assert.ok(!/DELETE\s+FROM\s+leads/i.test(enrichSrc), 'enrich batch must not DELETE leads');
assert.ok(enrichSrc.includes('still_needs_phone'), 'enrich reports still_needs_phone');

const leadsDeleteSrc = fs.readFileSync(path.join(__dirname, '../routes/admin-leads.js'), 'utf8');
assert.ok(leadsDeleteSrc.includes('admin_lead_deletions'), 'delete route writes audit table');

const authSrc = fs.readFileSync(path.join(__dirname, '../middleware/admin-auth.js'), 'utf8');
assert.ok(authSrc.includes('capabilities: OPERATOR_CAPABILITIES'), 'session returns capabilities');

const { OPERATOR_CAPABILITIES } = require('../services/customer-capabilities');
assert.ok(OPERATOR_CAPABILITIES.includes('platform.leads'), 'operator has platform.leads');
assert.ok(OPERATOR_CAPABILITIES.includes('platform.tenants.delete'), 'operator has platform.tenants.delete');

const tenantsDeleteSrc = fs.readFileSync(path.join(__dirname, '../services/admin-tenant-delete-service.js'), 'utf8');
assert.ok(tenantsDeleteSrc.includes('admin_tenant_deletions'), 'tenant delete writes audit');
assert.ok(tenantsDeleteSrc.includes('purgeClinicDependencies'), 'hard delete purges stripe and related rows');
assert.ok(tenantsDeleteSrc.includes('platform.tenants.delete') === false, 'capability is in customer-capabilities');
const tenantsRouteSrc = fs.readFileSync(path.join(__dirname, '../routes/admin-tenants.js'), 'utf8');
assert.ok(tenantsRouteSrc.includes('platform.tenants.delete'), 'tenant delete route gated by capability');
assert.ok(tenantsRouteSrc.includes('tenantDelete'), 'tenant delete uses service');

const { isAdminApiPath } = require('../middleware/rate-limiter');
assert.ok(isAdminApiPath({ originalUrl: '/api/admin/scrape/status', url: '/api/admin/scrape/status' }), 'admin scrape status is admin path');
assert.ok(isAdminApiPath({ originalUrl: '/api/admin/tenants/alerts' }), 'admin tenants is admin path');
assert.ok(!isAdminApiPath({ originalUrl: '/api/customers/me' }), 'customer routes are not admin path');

const rateLimiterSrc = fs.readFileSync(path.join(__dirname, '../middleware/rate-limiter.js'), 'utf8');
assert.ok(rateLimiterSrc.includes('isAdminApiPath(req)'), 'apiLimiter skips admin paths');

const scrapeSrc = fs.readFileSync(path.join(__dirname, '../routes/admin-scrape.js'), 'utf8');
assert.ok(scrapeSrc.includes('persistSqliteToGcs'), 'scrape persists to GCS after job');
assert.ok(!/if\s*\(\s*!leadIngestion\.isCallableLead/.test(scrapeSrc), 'scrape must not gate saves on callable phone');
assert.ok(scrapeSrc.includes('resolveScrapeLocations'), 'scrape uses NY-first location queue');
assert.ok(scrapeSrc.includes('location_mode'), 'scrape routes pass location_mode');

const databaseSrc = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
assert.ok(!databaseSrc.includes('REFERENCES clinics(id)'), 'stripe tables must reference clinics(clinic_id)');

const migration092 = fs.readFileSync(path.join(__dirname, '../migrations/092_stripe_clinic_fk_fix.js'), 'utf8');
assert.ok(migration092.includes('REFERENCES clinics(clinic_id)'), 'migration 092 fixes stripe FK');

const enrichRouteSrc = fs.readFileSync(path.join(__dirname, '../routes/admin-enrich.js'), 'utf8');
assert.ok(enrichRouteSrc.includes('persistSqliteToGcs'), 'enrich persists to GCS after job');

const gcsPersist = require('../utils/gcs-db-persist');
assert.strictEqual(typeof gcsPersist.persistSqliteToGcs, 'function');

console.log('✅ Admin CRM route smoke tests passed');
