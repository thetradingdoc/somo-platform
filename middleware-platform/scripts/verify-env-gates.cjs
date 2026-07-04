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
  getAllEnvGateViolations,
  truthy
} = require('../services/hipaa-production-guards');
const { fetchCloudRunEnv, mergeEnvForGates } = require('./lib/cloudrun-env.cjs');

function main() {
  const profile = String(process.env.CLOUDRUN_PROFILE || '').trim().toLowerCase();
  const isCi = ['1', 'true', 'yes'].includes(String(process.env.CI || '').trim().toLowerCase());
  const cloudVerify = truthy(process.env.CLOUDRUN_VERIFY);

  let gateEnv = { ...process.env };
  let cloudrun = null;
  if (cloudVerify && isProductionProfile(gateEnv)) {
    const live = fetchCloudRunEnv();
    cloudrun = {
      ok: live.ok,
      revision: live.revision || null,
      image: live.image || null,
      error: live.error || null
    };
    if (live.ok) {
      gateEnv = mergeEnvForGates(gateEnv, live.env);
    }
  }

  let violations = isCi
    ? [...getKellyRoutingViolations(gateEnv), ...getDeployedProfileViolations(gateEnv)]
    : getAllEnvGateViolations(gateEnv);

  if (cloudVerify && isProductionProfile(process.env) && cloudrun && !cloudrun.ok && !isCi) {
    violations = [...violations, `CLOUDRUN_VERIFY=1 failed: ${cloudrun.error || 'unknown'}`];
  }

  const report = {
    cloudrun_profile: profile || null,
    cloudrun_verify: cloudVerify,
    cloudrun,
    conversation_mode_routing: gateEnv.CONVERSATION_MODE_ROUTING || null,
    kelly_allow_hybrid_graph: gateEnv.KELLY_ALLOW_HYBRID_GRAPH ?? null,
    baa_acknowledged: gateEnv.BAA_ACKNOWLEDGED ?? null,
    require_jwt_for_fhir: gateEnv.REQUIRE_JWT_FOR_FHIR ?? null,
    admin_portal_secret_set: !!(gateEnv.ADMIN_PORTAL_SECRET || '').trim(),
    production_profile: isProductionProfile(gateEnv),
    deployed_profile: isDeployedProfile(gateEnv),
    violations,
    pass: violations.length === 0
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
