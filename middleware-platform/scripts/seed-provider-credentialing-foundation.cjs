#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

const ARTIFACTS = [
  ['npi_registry', 'NPI Registry Record', 'identity'],
  ['state_medical_license', 'State Medical License', 'licensure'],
  ['dea_certificate', 'DEA Certificate', 'licensure'],
  ['cds_certificate', 'Controlled Dangerous Substance Certificate', 'licensure'],
  ['board_certification', 'Board Certification', 'training'],
  ['residency_completion', 'Residency Completion Certificate', 'training'],
  ['fellowship_completion', 'Fellowship Completion Certificate', 'training'],
  ['medical_school_diploma', 'Medical School Diploma', 'training'],
  ['ecfmg_certificate', 'ECFMG Certificate', 'training'],
  ['cv_current', 'Current Curriculum Vitae', 'identity'],
  ['government_photo_id', 'Government Photo ID', 'identity'],
  ['ssn_or_tin_verification', 'SSN/TIN Verification', 'identity'],
  ['w9_form', 'W-9 Form', 'financial'],
  ['voided_check_or_bank_letter', 'Voided Check or Bank Letter', 'financial'],
  ['eft_authorization', 'EFT Authorization', 'financial'],
  ['malpractice_insurance', 'Malpractice Insurance Certificate', 'insurance'],
  ['malpractice_history', 'Malpractice Claims History', 'insurance'],
  ['liability_limits_attestation', 'Liability Limits Attestation', 'insurance'],
  ['work_history_5y', '5-Year Work History', 'history'],
  ['gap_explanations', 'Gap Explanations', 'history'],
  ['hospital_privileges', 'Hospital Privileges Letter', 'privileges'],
  ['admitting_arrangement', 'Admitting Coverage Arrangement', 'privileges'],
  ['references_peer_1', 'Peer Reference 1', 'references'],
  ['references_peer_2', 'Peer Reference 2', 'references'],
  ['references_peer_3', 'Peer Reference 3', 'references'],
  ['sanctions_disclosure', 'Sanctions Disclosure', 'compliance'],
  ['oig_sam_exclusion_check', 'OIG/SAM Exclusion Check', 'compliance'],
  ['npdb_query', 'NPDB Query Result', 'compliance'],
  ['hipaa_training_attestation', 'HIPAA Training Attestation', 'compliance'],
  ['caqh_profile_attestation', 'CAQH Profile Attestation', 'compliance'],
  ['immunization_records', 'Immunization Records', 'clinical'],
  ['bcls_acls_certification', 'BCLS/ACLS Certification', 'clinical'],
  ['clia_waiver', 'CLIA Waiver', 'clinical'],
  ['site_address_verification', 'Practice Site Address Verification', 'practice'],
  ['hours_of_operation', 'Practice Hours of Operation', 'practice'],
  ['emr_system_attestation', 'EMR System Attestation', 'practice']
];

const FIELD_MAPPINGS = [
  ['provider_npi', 'provider_registry_entities', 'canonical_npi', 'none', 1],
  ['provider_first_name', 'provider_registry_entities', 'first_name', 'none', 1],
  ['provider_middle_name', 'provider_registry_entities', 'middle_name', 'none', 0],
  ['provider_last_name', 'provider_registry_entities', 'last_name', 'none', 1],
  ['provider_organization_name', 'provider_registry_entities', 'organization_name', 'none', 0],
  ['provider_type', 'provider_registry_entities', 'provider_type', 'none', 1],
  ['taxonomy_primary', 'provider_taxonomy_links', 'nucc_code', 'primary_flag=1', 1],
  ['taxonomy_group', 'provider_taxonomy_links', 'taxonomy_group', 'primary_flag=1', 0],
  ['source_provenance', 'provider_registry_source_links', 'source', 'group_concat_distinct', 1],
  ['network_status', 'provider_payer_networks', 'network_status', 'latest_by_confidence', 0],
  ['network_payor_entity_id', 'provider_payer_networks', 'payor_entity_id', 'latest_by_confidence', 0],
  ['network_effective_start', 'provider_payer_networks', 'effective_start_date', 'latest_by_confidence', 0]
];

function main() {
  const upsertArtifact = db.db.prepare(`
    INSERT INTO credentialing_artifact_catalog (
      artifact_code, artifact_name, category, required_flag, verification_method, created_at
    ) VALUES (?, ?, ?, 1, 'document_upload_or_primary_source', ?)
    ON CONFLICT(artifact_code) DO UPDATE SET
      artifact_name = excluded.artifact_name,
      category = excluded.category,
      required_flag = excluded.required_flag,
      verification_method = excluded.verification_method
  `);
  const upsertMapping = db.db.prepare(`
    INSERT INTO provider_enrollment_field_mappings (
      id, enrollment_field, source_table, source_field, transform_hint, required_flag, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(enrollment_field, source_table, source_field) DO UPDATE SET
      transform_hint = excluded.transform_hint,
      required_flag = excluded.required_flag
  `);
  const ensureProfile = db.db.prepare(`
    INSERT INTO provider_credentialing_profiles (
      id, provider_entity_id, profile_status, completeness_score, verification_metadata_json, created_at, updated_at
    )
    SELECT ?, e.id, 'incomplete', 0, '{}', ?, ?
    FROM provider_registry_entities e
    WHERE NOT EXISTS (
      SELECT 1 FROM provider_credentialing_profiles p
      WHERE p.provider_entity_id = e.id
    )
    AND e.id = ?
  `);

  const now = new Date().toISOString();
  const tx = db.db.transaction(() => {
    for (const [code, name, category] of ARTIFACTS) {
      upsertArtifact.run(code, name, category, now);
    }
    for (const [enrollmentField, tableName, fieldName, transformHint, requiredFlag] of FIELD_MAPPINGS) {
      upsertMapping.run(`cred_map_${uuidv4()}`, enrollmentField, tableName, fieldName, transformHint, requiredFlag, now);
    }
    const providers = db.db.prepare(`SELECT id FROM provider_registry_entities`).all();
    for (const provider of providers) {
      ensureProfile.run(`cred_prof_${uuidv4()}`, now, now, provider.id);
    }
  });
  tx();

  console.log(JSON.stringify({
    event: 'provider_credentialing_foundation_seeded',
    artifact_count: ARTIFACTS.length,
    mapping_count: FIELD_MAPPINGS.length
  }, null, 2));
}

main();

