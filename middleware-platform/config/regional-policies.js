/**
 * Regional Policy Configuration
 *
 * Maps regions to coding systems, fee schedules, and retrieval strategies.
 * Extensible for future international expansion.
 */

const REGIONAL_CONFIGS = {
  US: {
    coding_system: 'ICD10CM_CPT',
    fee_schedule: 'CMS_MEDICARE',
    collection: 'code_embeddings',
    strategy: 'hierarchical',
    modifiers_enabled: true,
    tariff_based: false,
    requires_npi: true,
    specialty_mapping: {
      orthopedics: 'ama_ortho',
      cardiology: 'ama_cardio',
      dermatology: 'ama_derm',
      neurology: 'ama_neuro',
      pulmonology: 'ama_pulm',
      gastroenterology: 'ama_gi',
      emergency: 'ama_emergency',
      general: 'general'
    },
    guideline_sources: ['CMS', 'AMA', 'NCCI']
  },

  UK: {
    coding_system: 'ICD10_OPCS4',
    fee_schedule: 'NHS_TARIFF',
    collection: 'code_embeddings',
    strategy: 'tariff_based',
    modifiers_enabled: false,
    tariff_based: true,
    requires_npi: false,
    specialty_mapping: {
      orthopedics: 'nhs_trauma_ortho',
      cardiology: 'nhs_cardio',
      dermatology: 'nhs_derm',
      neurology: 'nhs_neuro',
      pulmonology: 'nhs_pulm',
      gastroenterology: 'nhs_gi',
      emergency: 'nhs_emergency',
      general: 'general'
    },
    guideline_sources: ['NICE', 'NHS_ENGLAND']
  },

  ZA: {
    coding_system: 'ICD10_CCSA',
    fee_schedule: 'DISCOVERY_HEALTH',
    collection: 'code_embeddings',
    strategy: 'tariff_based',
    modifiers_enabled: false,
    tariff_based: true,
    requires_npi: false,
    specialty_mapping: {
      orthopedics: 'ccsa_ortho',
      cardiology: 'ccsa_cardio',
      dermatology: 'ccsa_derm',
      general: 'general'
    },
    guideline_sources: ['CCSA', 'NHRPL']
  }
};

/**
 * Get regional configuration
 * @param {string} region - Region code (US, UK, ZA)
 * @returns {object} Regional config
 */
function getRegionalConfig(region = 'US') {
  const config = REGIONAL_CONFIGS[region.toUpperCase()];
  if (!config) {
    return REGIONAL_CONFIGS.US;
  }
  return config;
}

/**
 * Map specialty to regional code set
 * @param {string} specialty - Base specialty (orthopedics, cardiology, etc.)
 * @param {string} region - Region code
 * @returns {string} Regional specialty identifier
 */
function mapSpecialtyToRegion(specialty, region = 'US') {
  const config = getRegionalConfig(region);
  return config.specialty_mapping[specialty] || specialty;
}

/**
 * Check if region requires specific fee schedule
 * @param {string} region - Region code
 * @returns {boolean}
 */
function requiresFeeSchedule(region = 'US') {
  const config = getRegionalConfig(region);
  return config.tariff_based;
}

module.exports = {
  REGIONAL_CONFIGS,
  getRegionalConfig,
  mapSpecialtyToRegion,
  requiresFeeSchedule
};
