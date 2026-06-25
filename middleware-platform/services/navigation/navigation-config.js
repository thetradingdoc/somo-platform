'use strict';

const { resolveNavCustomerId, resolveNavDid } = require('../../scripts/lib/navigation-demo-config.cjs');

function isNavigationEnabled() {
  const raw = process.env.NAVIGATION_ENABLED;
  if (raw === '0' || raw === 'false') return false;
  return true;
}

function navigationCustomerId() {
  return resolveNavCustomerId();
}

function navigationDid() {
  return resolveNavDid();
}

function phonesMatch(a, b) {
  if (!a || !b) return false;
  const digits = (p) => String(p).replace(/\D/g, '');
  return digits(a) === digits(b);
}

function isPlatformNavigationDid(normalizedTo) {
  if (!isNavigationEnabled() || !normalizedTo) return false;
  return phonesMatch(normalizedTo, navigationDid());
}

function resolveNavigationRetellAgentId() {
  return (
    process.env.NAVIGATION_RETELL_AGENT_ID ||
    process.env.RETELL_AGENT_ID ||
    'agent_9151f738c705a56f4a0d8df63a'
  );
}

module.exports = {
  isNavigationEnabled,
  navigationCustomerId,
  navigationDid,
  phonesMatch,
  isPlatformNavigationDid,
  resolveNavigationRetellAgentId,
  NAVIGATION_RUNTIME: 'navigation_handler_v1'
};
