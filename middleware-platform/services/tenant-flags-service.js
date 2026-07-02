'use strict';

const db = require('../database');

function getTenantFlags(clinicId) {
  if (!clinicId || !db.db) return null;
  const clinic = db.db
    .prepare(
      `SELECT clinic_id, office_type, language_pack, pms_type, pms_enabled FROM clinics WHERE clinic_id = ?`
    )
    .get(clinicId);
  if (!clinic) return null;
  const vas = db.db
    .prepare(
      `SELECT coverage_mode, language_mode, supported_languages FROM voice_agent_settings WHERE clinic_id = ? LIMIT 1`
    )
    .get(clinicId);
  const profile = db.db
    .prepare(`SELECT use_case FROM prompt_profiles WHERE clinic_id = ? LIMIT 1`)
    .get(clinicId);
  return {
    clinic_id: clinicId,
    office_type: clinic.office_type || (profile?.use_case === 'dental' ? 'dental' : 'medical'),
    language_pack: clinic.language_pack || vas?.language_mode || 'en',
    pms_type: clinic.pms_type || 'somo',
    pms_enabled: clinic.pms_enabled !== 0,
    coverage_mode: vas?.coverage_mode || 'full_replacement',
    supported_languages: vas?.supported_languages || null,
    use_case: profile?.use_case || null
  };
}

function updateTenantFlags(clinicId, flags = {}) {
  if (!clinicId || !db.db) return null;
  const updates = [];
  const values = [];
  if (flags.office_type) {
    updates.push('office_type = ?');
    values.push(String(flags.office_type).toLowerCase());
  }
  if (flags.language_pack) {
    updates.push('language_pack = ?');
    values.push(String(flags.language_pack));
  }
  if (updates.length) {
    values.push(clinicId);
    db.db.prepare(`UPDATE clinics SET ${updates.join(', ')}, updated_at = datetime('now') WHERE clinic_id = ?`).run(...values);
  }
  if (flags.coverage_mode && db.updateVoiceAgentSettings) {
    db.updateVoiceAgentSettings(clinicId, { coverage_mode: flags.coverage_mode });
  }
  if (flags.language_mode || flags.supported_languages) {
    const patch = {};
    if (flags.language_mode) patch.language_mode = flags.language_mode;
    if (flags.supported_languages) patch.supported_languages = flags.supported_languages;
    if (db.updateVoiceAgentSettings) db.updateVoiceAgentSettings(clinicId, patch);
  }
  return getTenantFlags(clinicId);
}

module.exports = { getTenantFlags, updateTenantFlags };
