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

const scrape = require('../routes/admin-scrape');
assert.ok(layerHasMethod(scrape, 'get', '/status'), 'scrape GET /status');
assert.ok(layerHasMethod(scrape, 'get', '/leads/pipeline'), 'scrape GET /leads/pipeline');
assert.ok(layerHasMethod(scrape, 'get', '/leads/export'), 'scrape GET /leads/export');
assert.ok(layerHasMethod(scrape, 'post', '/run'), 'scrape POST /run');
assert.ok(layerHasMethod(scrape, 'post', '/leads/:id/suggested-stage/accept'), 'scrape POST suggested-stage accept');

const enrich = require('../routes/admin-enrich');
assert.ok(layerHasMethod(enrich, 'post', '/batch'), 'enrich POST /batch');

const tenants = require('../routes/admin-tenants');
assert.ok(layerHasMethod(tenants, 'get', '/alerts'), 'tenants GET /alerts');

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

console.log('✅ Admin CRM route smoke tests passed');
