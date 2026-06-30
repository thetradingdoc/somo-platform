#!/usr/bin/env node
/**
 * Unit tests for admin-scrape-ingestion helpers.
 * Run: node middleware-platform/tests/admin-scrape-ingestion.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const ingestion = require('../services/admin-scrape-ingestion');
const tenantHealth = require('../services/tenant-health');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('admin-scrape-ingestion.test.js\n');

test('resolveExternalId prefers job.external_id', () => {
  const id = ingestion.resolveExternalId({ external_id: 'abc-123', clinic_name: 'Foo' }, {});
  assert.strictEqual(id, 'abc-123');
});

test('resolveExternalId falls back to clinic_name + url', () => {
  const id = ingestion.resolveExternalId(
    { clinic_name: 'Smile Dental', link: 'https://example.com/job' },
    { source_url: 'https://smiledental.com' }
  );
  assert.ok(String(id).includes('Smile Dental'));
});

test('appendNote dedupes lines', () => {
  const n = ingestion.appendNote('line one', 'line two');
  assert.strictEqual(n, 'line one\nline two');
  const n2 = ingestion.appendNote(n, 'line one');
  assert.strictEqual(n2, n);
});

test('groupAlerts merges reasons per clinic_id', () => {
  const flat = [
    { clinic_id: 'c1', company_name: 'A', severity: 'warning', reason: 'Low minutes' },
    { clinic_id: 'c1', company_name: 'A', severity: 'critical', reason: 'Trial expired' },
    { clinic_id: 'c2', company_name: 'B', severity: 'info', reason: 'Credits low' },
  ];
  const grouped = tenantHealth.groupAlerts(flat);
  assert.strictEqual(grouped.length, 2);
  const c1 = grouped.find((g) => g.clinic_id === 'c1');
  assert.strictEqual(c1.severity, 'critical');
  assert.strictEqual(c1.reasons.length, 2);
});

test('formatLeadForApi normalizes suggested_stage to UI label', () => {
  const facade = require('../services/admin-lead-facade');
  const formatted = facade.formatLeadForApi({
    id: '1',
    clinic_name: 'Test',
    pipeline_stage: 'demo_scheduled',
    suggested_stage: 'demo_scheduled',
    clinic_phone: '+15551234567',
  });
  assert.strictEqual(formatted.suggested_stage, 'demo');
  assert.strictEqual(formatted.pipeline_stage, 'demo');
});

if (process.exitCode) {
  console.error('\nSome tests failed');
} else {
  console.log('\n✅ admin-scrape-ingestion tests passed');
}
