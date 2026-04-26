#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
process.chdir(path.join(__dirname, '..'));

const db = require('../database');

function main() {
  const requiredCatalog = db.db.prepare(`
    SELECT artifact_code
    FROM credentialing_artifact_catalog
    WHERE required_flag = 1
    ORDER BY artifact_code
  `).all().map((r) => r.artifact_code);

  const providers = db.db.prepare(`
    SELECT id, canonical_npi, COALESCE(organization_name, TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS provider_name
    FROM provider_registry_entities
    WHERE status = 'active'
    ORDER BY updated_at DESC
    LIMIT 5000
  `).all();

  const artifactStatusStmt = db.db.prepare(`
    SELECT artifact_code, artifact_status
    FROM provider_credentialing_artifacts
    WHERE provider_entity_id = ?
  `);
  const upsertProfileStmt = db.db.prepare(`
    INSERT INTO provider_credentialing_profiles (
      id, provider_entity_id, profile_status, completeness_score, verification_metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_entity_id) DO UPDATE SET
      profile_status = excluded.profile_status,
      completeness_score = excluded.completeness_score,
      verification_metadata_json = excluded.verification_metadata_json,
      updated_at = excluded.updated_at
  `);

  const readiness = [];
  const now = new Date().toISOString();
  const tx = db.db.transaction(() => {
    for (const provider of providers) {
      const statuses = artifactStatusStmt.all(provider.id);
      const completeSet = new Set(
        statuses
          .filter((s) => String(s.artifact_status || '').toLowerCase() === 'verified')
          .map((s) => s.artifact_code)
      );
      const missing = requiredCatalog.filter((code) => !completeSet.has(code));
      const completed = requiredCatalog.length - missing.length;
      const score = requiredCatalog.length > 0 ? Number((completed / requiredCatalog.length).toFixed(4)) : 1;
      const profileStatus = missing.length === 0 ? 'ready' : (completed > 0 ? 'in_progress' : 'incomplete');
      upsertProfileStmt.run(
        `cred_prof_${uuidv4()}`,
        provider.id,
        profileStatus,
        score,
        JSON.stringify({
          required_artifact_total: requiredCatalog.length,
          completed_required_artifacts: completed,
          missing_required_artifact_codes: missing.slice(0, 100)
        }),
        now,
        now
      );
      readiness.push({
        provider_entity_id: provider.id,
        canonical_npi: provider.canonical_npi,
        provider_name: provider.provider_name || null,
        profile_status: profileStatus,
        completeness_score: score,
        missing_required_artifact_count: missing.length,
        missing_required_artifact_codes: missing
      });
    }
  });
  tx();

  const readyCount = readiness.filter((r) => r.profile_status === 'ready').length;
  const avgScore = readiness.length
    ? Number((readiness.reduce((sum, r) => sum + r.completeness_score, 0) / readiness.length).toFixed(4))
    : 0;
  console.log(JSON.stringify({
    event: 'provider_credentialing_readiness_report',
    provider_count: readiness.length,
    required_artifact_count: requiredCatalog.length,
    ready_provider_count: readyCount,
    average_completeness_score: avgScore,
    providers_with_gaps: readiness.filter((r) => r.missing_required_artifact_count > 0).slice(0, 100)
  }, null, 2));
}

main();

