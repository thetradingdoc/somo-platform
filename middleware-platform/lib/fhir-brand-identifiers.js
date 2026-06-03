'use strict';

/**
 * Canonical FHIR extension URLs for Somo-branded resources.
 * Legacy doclittle.health URLs remain readable via matchesExtensionUrl().
 */

const BRAND_SLUG = String(process.env.FHIR_BRAND_SLUG || 'callsomo').trim() || 'callsomo';
const FHIR_BASE = String(process.env.FHIR_STRUCTURE_BASE || 'https://callsomo.com/fhir').replace(/\/$/, '');
const STRUCTURE_DEFINITION_BASE = `${FHIR_BASE}/StructureDefinition`;
const LEGACY_HEALTH_BASE = 'https://doclittle.health';
const LEGACY_SITE_BASE = 'https://doclittle.site/fhir/StructureDefinition';

function extensionUrl(suffix) {
  const key = String(suffix || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${STRUCTURE_DEFINITION_BASE}/${key}`;
}

/** @deprecated use extensionUrl */
function extensionUrlCanonical(suffix) {
  return extensionUrl(suffix);
}

function patientIdSystem() {
  return `${FHIR_BASE}/patient-id`;
}

function metaSource() {
  return FHIR_BASE;
}

function matchesExtensionUrl(url, suffix) {
  const u = String(url || '');
  if (!u) return false;
  if (u === extensionUrl(suffix)) return true;
  if (u === `${LEGACY_HEALTH_BASE}/extension/${suffix}`) return true;
  if (u === `${LEGACY_HEALTH_BASE}/${suffix}`) return true;
  if (u === `${LEGACY_SITE_BASE}/${suffix}`) return true;
  return false;
}

function normalizeExtensionUrl(url) {
  const u = String(url || '');
  if (!u.startsWith(LEGACY_HEALTH_BASE)) return u;
  const rest = u.slice(LEGACY_HEALTH_BASE.length).replace(/^\/+/, '');
  if (rest.startsWith('extension/')) {
    return extensionUrl(rest.slice('extension/'.length));
  }
  if (rest.startsWith('fhir/')) {
    return `${FHIR_BASE}/${rest}`;
  }
  return extensionUrl(rest);
}

module.exports = {
  BRAND_SLUG,
  FHIR_BASE,
  STRUCTURE_DEFINITION_BASE,
  LEGACY_HEALTH_BASE,
  extensionUrl,
  extensionUrlCanonical,
  patientIdSystem,
  metaSource,
  matchesExtensionUrl,
  normalizeExtensionUrl
};
