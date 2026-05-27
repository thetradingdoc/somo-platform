'use strict';

/**
 * Canonical FHIR extension URLs for DocLittle-branded resources.
 */

const BRAND_SLUG = String(process.env.FHIR_BRAND_SLUG || 'doclittle').trim() || 'doclittle';
const STRUCTURE_DEFINITION_BASE = `https://${BRAND_SLUG}.site/fhir/StructureDefinition`;

function extensionUrlCanonical(suffix) {
  const key = String(suffix || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${STRUCTURE_DEFINITION_BASE}/${key}`;
}

module.exports = {
  BRAND_SLUG,
  STRUCTURE_DEFINITION_BASE,
  extensionUrlCanonical
};
