/**
 * gap3: Seed provider_profiles with 2–3 rows so SpecialistResolver has data.
 */

function up(db) {
  let clinicId;
  try {
    const row = db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
    clinicId = row?.clinic_id || process.env.DEFAULT_CLINIC_ID || 'default-clinic';
  } catch (_) {
    clinicId = process.env.DEFAULT_CLINIC_ID || 'default-clinic';
  }

  const profiles = [
    {
      id: 'prov-seed-cardiology',
      clinic_id: clinicId,
      display_name: 'Dr. Sarah Chen',
      email: 'sarah.chen@doclittle.example',
      specialty: JSON.stringify(['Cardiology']),
      languages: JSON.stringify(['en', 'zh']),
      supported_lanes: JSON.stringify(['sync', 'async']),
      review_capacity: 5,
      price_tier: 2,
      accepts_urgent: 1
    },
    {
      id: 'prov-seed-dermatology',
      clinic_id: clinicId,
      display_name: 'Dr. Maria Santos',
      email: 'maria.santos@doclittle.example',
      specialty: JSON.stringify(['Dermatology']),
      languages: JSON.stringify(['en', 'es']),
      supported_lanes: JSON.stringify(['sync', 'async']),
      review_capacity: 5,
      price_tier: 1,
      accepts_urgent: 1
    },
    {
      id: 'prov-seed-psychiatry',
      clinic_id: clinicId,
      display_name: 'Dr. James Okello',
      email: 'james.okello@doclittle.example',
      specialty: JSON.stringify(['Psychiatry']),
      languages: JSON.stringify(['en', 'sw']),
      supported_lanes: JSON.stringify(['sync']),
      review_capacity: 3,
      price_tier: 3,
      accepts_urgent: 1
    }
  ];

  for (const p of profiles) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO provider_profiles (
          id, clinic_id, display_name, email, specialty, languages,
          license_states, credentials, supported_lanes, review_capacity,
          min_rate, price_tier, accepts_urgent, accepts_emergency_triage,
          is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, 0, ?, 1, 0, 1, datetime('now'), datetime('now'))
      `).run(
        p.id,
        p.clinic_id,
        p.display_name,
        p.email,
        p.specialty,
        p.languages,
        p.supported_lanes,
        p.review_capacity,
        p.price_tier
      );
    } catch (e) {
      console.warn('[009_seed_provider_profiles] Skip row:', e.message);
    }
  }
}

function down(db) {
  db.prepare("DELETE FROM provider_profiles WHERE id IN ('prov-seed-cardiology', 'prov-seed-dermatology', 'prov-seed-psychiatry')").run();
}

module.exports = { up, down };
