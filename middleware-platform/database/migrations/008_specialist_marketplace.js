/**
 * Specialist Marketplace Foundation — Phase 0
 * Covers: provider_profiles, specialist_daily_quota, case_report_media,
 * prescriptions, triage_rag_results, patient_pricing, appointment_slot_assignments,
 * resolver_cache, triage_sessions
 */
function up(db) {
  // provider_profiles
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_profiles (
      id                  TEXT PRIMARY KEY,
      clinic_id           TEXT NOT NULL,
      user_id             TEXT,
      display_name        TEXT NOT NULL,
      email               TEXT,
      phone               TEXT,
      specialty           TEXT NOT NULL DEFAULT '[]',
      languages           TEXT NOT NULL DEFAULT '["en"]',
      license_states      TEXT NOT NULL DEFAULT '[]',
      credentials         TEXT NOT NULL DEFAULT '[]',
      supported_lanes     TEXT NOT NULL DEFAULT '["sync"]',
      review_capacity     INTEGER NOT NULL DEFAULT 0,
      min_rate            REAL NOT NULL DEFAULT 0,
      price_tier          INTEGER NOT NULL DEFAULT 2,
      accepts_urgent       INTEGER NOT NULL DEFAULT 0,
      accepts_emergency_triage INTEGER NOT NULL DEFAULT 0,
      is_active           INTEGER NOT NULL DEFAULT 1,
      bio                 TEXT,
      profile_photo_url   TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_provider_profiles_clinic ON provider_profiles(clinic_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_provider_profiles_active ON provider_profiles(is_active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_provider_profiles_tier ON provider_profiles(price_tier)');

  // specialist_daily_quota
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_daily_quota (
      id              TEXT PRIMARY KEY,
      provider_id     TEXT NOT NULL,
      date            TEXT NOT NULL,
      quota_total     INTEGER NOT NULL DEFAULT 0,
      quota_used      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider_id, date)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_daily_quota_provider_date ON specialist_daily_quota(provider_id, date)');

  // case_report_media (case_report_id nullable for triage uploads)
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_report_media (
      id                TEXT PRIMARY KEY,
      case_report_id    TEXT,
      patient_id        TEXT,
      session_id        TEXT,
      media_type        TEXT NOT NULL,
      mime_type         TEXT,
      file_name         TEXT,
      file_size_bytes   INTEGER,
      storage_provider  TEXT NOT NULL DEFAULT 'local',
      storage_key       TEXT,
      storage_url       TEXT,
      context_note      TEXT,
      body_region       TEXT,
      uploaded_during   TEXT,
      ai_analysis       TEXT,
      ai_analyzed_at    TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_case_media_case ON case_report_media(case_report_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_case_media_patient ON case_report_media(patient_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_case_media_session ON case_report_media(session_id)');

  // prescriptions
  db.exec(`
    CREATE TABLE IF NOT EXISTS prescriptions (
      id                TEXT PRIMARY KEY,
      case_report_id    TEXT,
      appointment_id    TEXT,
      patient_id        TEXT NOT NULL,
      specialist_id     TEXT NOT NULL,
      clinic_id         TEXT,
      icd_codes         TEXT NOT NULL DEFAULT '[]',
      cpt_codes         TEXT NOT NULL DEFAULT '[]',
      diagnosis_summary TEXT,
      soap_note         TEXT,
      medications       TEXT DEFAULT '[]',
      instructions      TEXT,
      referrals         TEXT DEFAULT '[]',
      follow_up_days    INTEGER,
      media_attachment_ids TEXT DEFAULT '[]',
      status            TEXT NOT NULL DEFAULT 'draft',
      signed_at         TEXT,
      sent_to_pharmacy  INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_prescriptions_specialist ON prescriptions(specialist_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_prescriptions_case ON prescriptions(case_report_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status)');

  // triage_rag_results
  db.exec(`
    CREATE TABLE IF NOT EXISTS triage_rag_results (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      patient_id        TEXT,
      symptom_text       TEXT NOT NULL,
      opqrst_json       TEXT,
      icd_codes         TEXT DEFAULT '[]',
      cpt_codes         TEXT DEFAULT '[]',
      target_specialty  TEXT,
      secondary_specialties TEXT DEFAULT '[]',
      urgency           TEXT NOT NULL DEFAULT 'routine',
      safety_level      TEXT NOT NULL DEFAULT 'green',
      red_flags         TEXT DEFAULT '[]',
      recommended_lane   TEXT DEFAULT 'sync',
      patient_friendly_summary TEXT,
      specialist_context TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_triage_rag_session ON triage_rag_results(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_triage_rag_patient ON triage_rag_results(patient_id)');

  // patient_pricing
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_pricing (
      patient_id   TEXT PRIMARY KEY,
      price_tier   INTEGER NOT NULL DEFAULT 2,
      country_code TEXT,
      currency     TEXT NOT NULL DEFAULT 'USD',
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // appointment_slot_assignments
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointment_slot_assignments (
      appointment_id  TEXT PRIMARY KEY,
      practitioner_id TEXT NOT NULL,
      specialty       TEXT,
      language        TEXT,
      price_tier      INTEGER,
      lane            TEXT NOT NULL DEFAULT 'sync',
      matched_via     TEXT,
      match_reason    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_slot_assignments_practitioner ON appointment_slot_assignments(practitioner_id)');

  // resolver_cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolver_cache (
      cache_key     TEXT PRIMARY KEY,
      result_json   TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at    TEXT NOT NULL
    )
  `);

  // triage_sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS triage_sessions (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      patient_id      TEXT,
      onset           TEXT,
      provocation     TEXT,
      quality         TEXT,
      radiation       TEXT,
      severity        INTEGER,
      timing          TEXT,
      associated_sx   TEXT,
      rag_result_id   TEXT,
      safety_level    TEXT,
      urgency         TEXT,
      target_specialty TEXT,
      media_requested  INTEGER NOT NULL DEFAULT 0,
      media_received   INTEGER NOT NULL DEFAULT 0,
      media_ids        TEXT DEFAULT '[]',
      opqrst_complete  INTEGER NOT NULL DEFAULT 0,
      triage_complete  INTEGER NOT NULL DEFAULT 0,
      referred_to_911  INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_triage_sessions_session ON triage_sessions(session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_triage_sessions_patient ON triage_sessions(patient_id)');
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS triage_sessions');
  db.exec('DROP TABLE IF EXISTS resolver_cache');
  db.exec('DROP TABLE IF EXISTS appointment_slot_assignments');
  db.exec('DROP TABLE IF EXISTS patient_pricing');
  db.exec('DROP TABLE IF EXISTS triage_rag_results');
  db.exec('DROP TABLE IF EXISTS prescriptions');
  db.exec('DROP TABLE IF EXISTS case_report_media');
  db.exec('DROP TABLE IF EXISTS specialist_daily_quota');
  db.exec('DROP TABLE IF EXISTS provider_profiles');
}

module.exports = { up, down };
