#!/usr/bin/env node
'use strict';

/**
 * Local integration gate for P1-S1 routing (offline DB simulation).
 * Complements AT-P1-001 live verify on prod PSTN.
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.chdir(path.join(__dirname, '..'));

const db = require('../database');
const { resolveRoutingWorld } = require('../services/voice-routing-world');
const { resolvePatientPlan } = require('../services/navigation/navigation-payor-service');
const { isNavigationConnection } = require('../webhooks/consumer-navigation-handler');
const { seedMetroHealthPlus, seedNavigationTenant } = require('./seed-navigation-demo.cjs');
const { resolveNavCustomerId, resolveNavDid, METRO_ENTITY_ID } = require('./lib/navigation-demo-config.cjs');

function main() {
  process.env.NAVIGATION_DID = resolveNavDid();
  seedNavigationTenant();
  seedMetroHealthPlus();

  const customerId = resolveNavCustomerId();
  const customer = db.getCustomer(customerId);
  const world = resolveRoutingWorld({
    call_type: 'consumer_navigation',
    direction: 'inbound',
    to_number: resolveNavDid(),
    customer_id: customerId,
    customer
  });

  const plan = resolvePatientPlan({ plan_name: 'Metro Health Plus' });
  const connection = {
    routing_world: world,
    call_type: 'consumer_navigation',
    conversationHistory: [],
    customer_type: 'navigation'
  };
  const navConn = isNavigationConnection(connection);

  const pass =
    world === 'navigation' &&
    navConn &&
    plan.success &&
    plan.payor_entity_id === METRO_ENTITY_ID;

  const report = {
    pass,
    gate: 'P1-S1-local',
    routing_world: world,
    navigation_connection: navConn,
    plan_resolved: plan.success,
    payor_entity_id: plan.payor_entity_id
  };

  if (pass) {
    const gatePath = path.join(__dirname, '..', 'var', 'evidence', 'navigation', 'P1S1_LOCAL_GATE.json');
    fs.mkdirSync(path.dirname(gatePath), { recursive: true });
    fs.writeFileSync(gatePath, JSON.stringify({ ...report, timestamp: new Date().toISOString() }, null, 2) + '\n');
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
