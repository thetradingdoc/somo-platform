/**
 * Plan catalog — single source of truth for voice SaaS tiers and top-up packs.
 */

const fs = require('fs');
const path = require('path');

let _cached = null;

function catalogPath() {
  return path.join(__dirname, '../config/plan-catalog.json');
}

function loadPlanCatalog(forceReload = false) {
  if (_cached && !forceReload) return _cached;
  const raw = fs.readFileSync(catalogPath(), 'utf8');
  _cached = JSON.parse(raw);
  return _cached;
}

function getTier(tierId) {
  const catalog = loadPlanCatalog();
  const id = String(tierId || 'starter').toLowerCase();
  const key = id === 'clinic pro' ? 'clinic_pro' : id.replace(/\s+/g, '_');
  return catalog.tiers[key] || catalog.tiers.starter;
}

function getTierLabel(tierId, vertical = 'general') {
  const tier = getTier(tierId);
  const v = vertical === 'healthcare' ? 'healthcare' : 'general';
  return (tier.labels && tier.labels[v]) || tier.name;
}

function listTiers() {
  return Object.values(loadPlanCatalog().tiers);
}

function getTopupPack(packId) {
  const catalog = loadPlanCatalog();
  return catalog.topup_packs.find((p) => p.id === packId) || null;
}

function listTopupPacks() {
  return loadPlanCatalog().topup_packs.slice();
}

function getPastDueGraceDays() {
  return loadPlanCatalog().past_due_grace_days ?? 3;
}

function getNumberRetentionDays() {
  return loadPlanCatalog().number_retention_days ?? 30;
}

function getSignupTrialMinutes() {
  return loadPlanCatalog().signup_trial_minutes ?? 60;
}

function getTrialDurationDays() {
  return loadPlanCatalog().trial_duration_days ?? 7;
}

function getTrialInactivityReleaseDays() {
  return loadPlanCatalog().trial_inactivity_release_days ?? 21;
}

function getMaxRequestsPerMinute(tierId) {
  return getTier(tierId).max_requests_per_minute ?? 150;
}

function getMaxConcurrentCalls(tierId) {
  return getTier(tierId).max_concurrent_calls ?? 2;
}

function getMaxPhoneNumbers(tierId) {
  return getTier(tierId).max_phone_numbers ?? 1;
}

function hasOutboundFeature(tierId) {
  return getTier(tierId).feature_flags?.outbound === true;
}

module.exports = {
  loadPlanCatalog,
  getTier,
  getTierLabel,
  listTiers,
  getTopupPack,
  listTopupPacks,
  getPastDueGraceDays,
  getNumberRetentionDays,
  getSignupTrialMinutes,
  getTrialDurationDays,
  getTrialInactivityReleaseDays,
  getMaxRequestsPerMinute,
  getMaxConcurrentCalls,
  getMaxPhoneNumbers,
  hasOutboundFeature,
  catalogPath
};
