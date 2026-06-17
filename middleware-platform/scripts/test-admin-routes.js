#!/usr/bin/env node
/**
 * Smoke test admin CRM route modules load and export expected handlers.
 * Run: node middleware-platform/scripts/test-admin-routes.js
 */

const assert = require('assert');
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
assert.ok(layerHasMethod(scrape, 'post', '/run'), 'scrape POST /run');

const enrich = require('../routes/admin-enrich');
assert.ok(layerHasMethod(enrich, 'post', '/batch'), 'enrich POST /batch');

const tenants = require('../routes/admin-tenants');
assert.ok(layerHasMethod(tenants, 'get', '/alerts'), 'tenants GET /alerts');

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

const jobTracker = require('../services/admin-job-tracker');
jobTracker.ensureTable();
const state = jobTracker.getSchedulerState();
assert.ok('is_running' in state);

console.log('✅ Admin CRM route smoke tests passed');
