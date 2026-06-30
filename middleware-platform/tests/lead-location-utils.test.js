#!/usr/bin/env node
/**
 * Unit tests for lead-location-utils.
 * Run: node middleware-platform/tests/lead-location-utils.test.js
 */

const assert = require('assert');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const {
  parseLeadLocation,
  leadMatchesState,
  leadMatchesCity,
  matchesLocationFilter,
  sortStatesWithPin,
} = require('../services/lead-location-utils');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('lead-location-utils.test.js\n');

test('parseLeadLocation parses JSearch format', () => {
  const p = parseLeadLocation('Alexandria, Virginia, US');
  assert.strictEqual(p.city, 'Alexandria');
  assert.strictEqual(p.state, 'Virginia');
  assert.strictEqual(p.country, 'US');
});

test('leadMatchesState matches Virginia but not West Virginia', () => {
  assert.strictEqual(leadMatchesState('Alexandria, Virginia, US', 'Virginia'), true);
  assert.strictEqual(leadMatchesState('Charleston, West Virginia, US', 'Virginia'), false);
  assert.strictEqual(leadMatchesState('Charleston, West Virginia, US', 'West Virginia'), true);
});

test('leadMatchesCity matches exact raw or city+state', () => {
  assert.strictEqual(
    leadMatchesCity('Alexandria, Virginia, US', 'Alexandria, Virginia, US'),
    true
  );
  assert.strictEqual(
    leadMatchesCity('Alexandria, Virginia, US', 'Richmond, Virginia, US'),
    false
  );
});

test('matchesLocationFilter state mode', () => {
  const lead = { location: 'Brooklyn, New York, US' };
  assert.strictEqual(matchesLocationFilter(lead, 'New York', 'state'), true);
  assert.strictEqual(matchesLocationFilter(lead, 'Virginia', 'state'), false);
});

test('sortStatesWithPin puts New York first', () => {
  const sorted = sortStatesWithPin([
    { state: 'California', count: 100 },
    { state: 'New York', count: 5 },
    { state: 'Texas', count: 50 },
  ]);
  assert.strictEqual(sorted[0].state, 'New York');
});

console.log('\nDone.');
