#!/usr/bin/env node
'use strict';

/**
 * Production env gate — Kelly routing + HIPAA/voice vendor requirements.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  isProductionProfile,
  isDeployedProfile,
  getKellyRoutingViolations,
  getDeployedProfileViolations,
  getAllEnvGateViolations
} = require('../services/hipaa-production-guards');

function main() {
  const profile = String(process.env.CLOUDRUN_PROFILE || '').trim().toLowerCase();
  const isCi = ['1', 'true', 'yes'].includes(String(process.env.CI || '').trim().toLowerCase());
  const violations = isCi
    ? [
        ...getKellyRoutingViolations(process.env),
        ...getDeployedProfileViolations(process.env)
      ]
    : getAllEnvGateViolations(process.env);

  const report = {
    cloudrun_profile: profile || null,
    conversation_mode_routing: process.env.CONVERSATION_MODE_ROUTING || null,
    kelly_allow_hybrid_graph: process.env.KELLY_ALLOW_HYBRID_GRAPH ?? null,
    baa_acknowledged: process.env.BAA_ACKNOWLEDGED ?? null,
    require_jwt_for_fhir: process.env.REQUIRE_JWT_FOR_FHIR ?? null,
    admin_portal_secret_set: !!(process.env.ADMIN_PORTAL_SECRET || '').trim(),
    production_profile: isProductionProfile(),
    deployed_profile: isDeployedProfile(),
    violations,
    pass: violations.length === 0
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
