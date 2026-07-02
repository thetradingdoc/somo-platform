'use strict';

/**
 * Production HIPAA / voice vendor env checks for deploy gates.
 */

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function isProductionProfile(env = process.env) {
  const profile = String(env.CLOUDRUN_PROFILE || '').trim().toLowerCase();
  return profile === 'production' || profile === 'prod';
}

function isDeployedProfile(env = process.env) {
  const profile = String(env.CLOUDRUN_PROFILE || '').trim().toLowerCase();
  return isProductionProfile(env) || profile === 'staging';
}

/**
 * @returns {string[]} violation messages
 */
function getKellyRoutingViolations(env = process.env) {
  const violations = [];
  if (!isProductionProfile(env)) return violations;

  const modeRouting = String(env.CONVERSATION_MODE_ROUTING || '').trim().toLowerCase();
  if (modeRouting === 'shadow') {
    violations.push('CONVERSATION_MODE_ROUTING=shadow is not allowed in production');
  }
  if (truthy(env.KELLY_ALLOW_HYBRID_GRAPH)) {
    violations.push('KELLY_ALLOW_HYBRID_GRAPH=1 is not allowed in production');
  }
  return violations;
}

/**
 * @returns {string[]} violation messages
 */
function getHipaaProductionViolations(env = process.env) {
  const violations = [];
  if (!isProductionProfile(env)) return violations;

  if (!truthy(env.BAA_ACKNOWLEDGED)) {
    violations.push('BAA_ACKNOWLEDGED must be set for production voice/PHI processing');
  }
  if (!truthy(env.REQUIRE_JWT_FOR_FHIR)) {
    violations.push('REQUIRE_JWT_FOR_FHIR=1 required in production');
  }

  const requiredVoice = ['RETELL_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'];
  for (const key of requiredVoice) {
    if (!String(env[key] || '').trim()) {
      violations.push(`${key} required in production for voice`);
    }
  }

  if (!String(env.STRIPE_SECRET_KEY || '').trim()) {
    violations.push('STRIPE_SECRET_KEY required in production for subscription billing');
  }

  if (!String(env.ADMIN_PORTAL_SECRET || '').trim()) {
    violations.push('ADMIN_PORTAL_SECRET required in production for admin API protection');
  }

  return violations;
}

/**
 * @returns {string[]} violation messages
 */
function getDeployedProfileViolations(env = process.env) {
  const violations = [];
  if (isDeployedProfile(env) && truthy(env.ALLOW_DEV_CLINIC_FALLBACK)) {
    violations.push('ALLOW_DEV_CLINIC_FALLBACK must be unset for staging/production');
  }
  return violations;
}

function getAllEnvGateViolations(env = process.env) {
  return [
    ...getKellyRoutingViolations(env),
    ...getHipaaProductionViolations(env),
    ...getDeployedProfileViolations(env)
  ];
}

module.exports = {
  truthy,
  isProductionProfile,
  isDeployedProfile,
  getKellyRoutingViolations,
  getHipaaProductionViolations,
  getDeployedProfileViolations,
  getAllEnvGateViolations
};
