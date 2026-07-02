'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { resolveUseCaseTemplate, resolveSpecialtyToUseCase } = require('./prompt-profile-templates');
const { FALLBACKS, DEFAULT_FALLBACK, getPricingFallback } = require('../config/pricing-fallbacks');

function slugify(name) {
  return String(name || 'clinic')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) || 'clinic';
}

function uniqueClinicSlug(db, baseSlug) {
  let slug = slugify(baseSlug);
  let n = 1;
  while (db.prepare('SELECT 1 FROM clinics WHERE slug = ?').get(slug)) {
    slug = `${slugify(baseSlug)}-${n++}`;
  }
  return slug;
}

function seedPromptProfile(dbModule, { clinicId, customerId, useCase, clinicName }) {
  try {
    const template = resolveUseCaseTemplate(useCase);
    const existing = dbModule.getClinicPromptProfile?.(clinicId, customerId);
    if (existing) {
      console.log(`[provision] prompt_profile already exists for clinic ${clinicId}`);
      return existing.id;
    }

    const profileId = uuidv4();
    const policyPayload = template.policy || {};
    const metadata = JSON.stringify({
      use_case: useCase || 'healthcare_clinic',
      tenant_policy: policyPayload
    });
    const policyJson = JSON.stringify(policyPayload);
    const cols = dbModule.db.prepare(`PRAGMA table_info(prompt_profiles)`).all();
    const colNames = new Set(cols.map((c) => c.name));
    const hasPolicyJson = colNames.has('policy_json');
    const hasUseCase = colNames.has('use_case');

    if (hasPolicyJson && hasUseCase) {
      dbModule.db.prepare(`
        INSERT INTO prompt_profiles (
          id, clinic_id, customer_id, name, specialty, use_case,
          system_prompt, allowed_tools, version, status, metadata, policy_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'v1', 'active', ?, ?, datetime('now'), datetime('now'))
      `).run(
        profileId,
        clinicId,
        customerId,
        `${clinicName || 'Practice'} — ${template.specialty}`,
        template.specialty,
        useCase || 'healthcare_clinic',
        template.system_prompt,
        JSON.stringify(template.allowed_tools),
        metadata,
        policyJson
      );
    } else {
      dbModule.db.prepare(`
        INSERT INTO prompt_profiles (
          id, clinic_id, customer_id, name, specialty,
          system_prompt, allowed_tools, version, status, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'v1', 'active', ?, datetime('now'), datetime('now'))
      `).run(
        profileId,
        clinicId,
        customerId,
        `${clinicName || 'Practice'} — ${template.specialty}`,
        template.specialty,
        template.system_prompt,
        JSON.stringify(template.allowed_tools),
        metadata
      );
    }

    console.log(`✅ [provision] Seeded prompt_profile ${profileId} for clinic ${clinicId} (${useCase || 'healthcare_clinic'})`);
    return profileId;
  } catch (err) {
    console.warn('⚠️  [provision] Failed to seed prompt_profile:', err.message);
    return null;
  }
}

const SPECIALTY_PRICING_TYPES = {
  'General Medicine': ['General Consult', 'Mental Health Consultation'],
  Dermatology: ['General Consult'],
  'Mental Health': ['Therapy', 'Mental Health Consultation', 'Psychiatry Initial', 'Psychiatry Follow-up'],
  'General Business': ['General Consult']
};

function seedVisitPricingForClinic(dbModule, clinicId, useCase) {
  if (!dbModule?.db || !clinicId) return;
  try {
    const template = resolveUseCaseTemplate(useCase);
    const types = SPECIALTY_PRICING_TYPES[template.specialty] || ['General Consult'];
    const seed = dbModule.db.prepare(`
      INSERT OR IGNORE INTO visit_pricing (clinic_id, appointment_type, base_price, surge_multiplier)
      VALUES (?, ?, ?, 1.0)
    `);
    for (const appointmentType of types) {
      const basePrice = getPricingFallback(appointmentType) || DEFAULT_FALLBACK;
      seed.run(clinicId, appointmentType, basePrice);
    }
    const specialtyPrice = FALLBACKS[template.specialty] || DEFAULT_FALLBACK;
    if (template.specialty && !types.includes(template.specialty)) {
      seed.run(clinicId, template.specialty, specialtyPrice);
    }
    console.log(`✅ [provision] Seeded visit_pricing for clinic ${clinicId} (${useCase || 'healthcare_clinic'})`);
  } catch (err) {
    console.warn('⚠️  [provision] Failed to seed visit_pricing:', err.message);
  }
}

async function ensureStripeMerchantReady(dbModule, customerId) {
  if (!customerId) return null;
  if (process.env.NODE_ENV === 'test' && !process.env.STRIPE_SECRET_KEY) {
    return null;
  }
  try {
    const customer = dbModule.getCustomer(customerId);
    if (!customer) return null;
    const { ensureStripeCustomer } = require('./voice-billing-stripe');
    return await ensureStripeCustomer(customer);
  } catch (err) {
    console.warn('⚠️  [provision] Stripe merchant ready skipped:', err.message);
    return null;
  }
}

/**
 * Create or link merchant + clinic for a SaaS customer in one SQLite transaction.
 * @param {object} dbModule - database facade
 * @param {object} options
 * @returns {{ merchantId: string, clinicId: string }}
 */
function provisionSaasTenant(dbModule, options = {}) {
  const {
    customerId,
    clinicName,
    phone = null,
    email = null,
    customerType = 'saas',
    enabledPlatforms = ['voice'],
    createUser = false,
    passwordHash = null,
    userName = null
  } = options;

  const customer = dbModule.getCustomer(customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  const sqlite = dbModule.db;
  const displayName = clinicName || customer.company_name || customer.name || 'Somo Clinic';
  const normalizedPhone = (phone || customer.phone_number || customer.twilio_phone_number || '')
    .replace(/\s+/g, '') || null;
  const contactEmail = email || customer.email || null;

  let merchantId = customer.merchant_id || null;
  let clinicId = null;

  const txn = sqlite.transaction(() => {
    if (!merchantId) {
      merchantId = `merchant-${uuidv4()}`;
      const apiKey = `mk_${crypto.randomBytes(32).toString('hex')}`;
      dbModule.createMerchant({
        id: merchantId,
        name: displayName,
        api_key: apiKey,
        api_url: process.env.API_BASE_URL || process.env.PUBLIC_API_URL || '',
        webhook_url: '',
        enabled_platforms: enabledPlatforms,
        status: 'active',
        ...(options.subdomain
          ? { subdomain: String(options.subdomain).toLowerCase().replace(/[^a-z0-9-]/g, '') }
          : {})
      });
      dbModule.updateCustomer(customerId, {
        merchant_id: merchantId,
        customer_type: customerType
      });
    }

    const existingClinic = sqlite
      .prepare('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
      .get(merchantId);
    clinicId = existingClinic?.clinic_id || null;

    if (!clinicId) {
      clinicId = `clinic-${uuidv4()}`;
      const slug = uniqueClinicSlug(sqlite, displayName);
      sqlite.prepare(`
        INSERT INTO clinics (
          clinic_id, name, slug, phone_number, email, merchant_id, is_active, transfer_number
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(clinicId, displayName, slug, normalizedPhone, contactEmail, merchantId, normalizedPhone || null);

      if (normalizedPhone) {
        try {
          dbModule.createClinicPhoneNumber({
            id: `phone-${uuidv4()}`,
            clinic_id: clinicId,
            phone_number: normalizedPhone,
            status: 'active'
          });
        } catch (_) {}
      }
    }

    if (customerId && clinicId) {
      try {
        const { ensureCustomerClinicLink } = require('./tenant-voice-config');
        ensureCustomerClinicLink(dbModule, customerId, clinicId, { isPrimary: true });
      } catch (linkErr) {
        console.warn('⚠️  [provision] customer_clinics link skipped:', linkErr.message);
      }
    }

    if (createUser && passwordHash && contactEmail) {
      const existingUser = dbModule.getUserByEmail && dbModule.getUserByEmail(contactEmail);
      if (!existingUser) {
        dbModule.createUser({
          id: `user-${uuidv4()}`,
          email: contactEmail,
          password_hash: passwordHash,
          name: userName || customer.name || displayName,
          role: 'healthcare_provider',
          merchant_id: merchantId,
          clinic_id: clinicId,
          auth_method: 'email'
        });
      }
    }
  });

  txn();

  if (typeof dbModule.migrateVoiceAgentSettingsToMerchant === 'function') {
    dbModule.migrateVoiceAgentSettingsToMerchant(customerId, merchantId);
  }

  const baseUseCase = options.useCase || options.use_case || customer.use_case || 'healthcare_clinic';
  const effectiveUseCase = resolveSpecialtyToUseCase(
    options.medicalSpecialty || options.medical_specialty,
    baseUseCase
  );

  const profileId = seedPromptProfile(dbModule, {
    clinicId,
    customerId,
    useCase: effectiveUseCase,
    clinicName: displayName
  });

  if (!customerId || !clinicId || !profileId) {
    throw new Error('Voice enablement blocked: tenant must have customer + clinic + prompt_profile');
  }

  seedVoiceAgentSettings(dbModule, {
    customerId,
    merchantId,
    customer: dbModule.getCustomer(customerId),
    clinicName: displayName
  });

  seedVisitPricingForClinic(dbModule, clinicId, effectiveUseCase);

  ensureStripeMerchantReady(dbModule, customerId).catch(() => {});

  const { ensureSignupTrialCredits } = require('./subscription-credits');
  ensureSignupTrialCredits(dbModule, customerId);

  return { merchantId, clinicId, promptProfileId: profileId };
}

function seedVoiceAgentSettings(dbModule, { customerId, merchantId, customer, clinicName }) {
  if (!dbModule.upsertVoiceAgentSettings || !customerId) return null;

  const existing = dbModule.getVoiceAgentSettingsForProvider({
    merchantId: merchantId || dbModule.customerVoiceSettingsMerchantKey(customerId),
    customerId
  });
  if (existing?.greeting && existing?.outbound_opener) return existing;

  const VoiceAgentRuntime = require('./voice-agent-runtime');
  const {
    resolvePracticeDisplayName,
    buildDefaultInboundGreeting,
    buildDefaultOutboundOpener
  } = require('./call-opener-resolver');
  const company = resolvePracticeDisplayName(dbModule, {
    customerId,
    customer: customer || dbModule.getCustomer(customerId)
  });
  const effectiveMerchantId =
    merchantId || customer?.merchant_id || dbModule.customerVoiceSettingsMerchantKey(customerId);
  const { languagesFromProviderProfile } = require('./tenant-language-config');
  const langFromProfile = languagesFromProviderProfile(customer || dbModule.getCustomer(customerId));
  const seedSettings = {
    retell_agent_id: customer?.retell_agent_id || null,
    enabled: true,
    greeting: existing?.greeting || buildDefaultInboundGreeting(company, 'warm'),
    outbound_opener: existing?.outbound_opener || buildDefaultOutboundOpener(company, 'warm'),
    outbound_enabled: existing?.outbound_enabled ?? 0,
    after_hours_message: existing?.after_hours_message || VoiceAgentRuntime.buildAfterHoursMessage({}),
    business_hours: existing?.business_hours || {
      mon: '09:00-17:00',
      tue: '09:00-17:00',
      wed: '09:00-17:00',
      thu: '09:00-17:00',
      fri: '09:00-17:00'
    },
    tone_preset: 'warm',
    language_mode: existing?.language_mode || langFromProfile?.language_mode || 'en_only',
    supported_languages: existing?.supported_languages || langFromProfile?.supported_languages || ['en'],
    coverage_mode: existing?.coverage_mode || 'full_replacement',
    after_hours_action: existing?.after_hours_action || 'message_only',
    ai_disclosure_enabled: existing?.ai_disclosure_enabled ?? 1,
    voice_reply_suppress_enabled: existing?.voice_reply_suppress_enabled ?? 0,
    sync_status: 'synced'
  };
  dbModule.upsertVoiceAgentSettings(effectiveMerchantId, seedSettings, customerId);
  console.log(`✅ [provision] Seeded voice_agent_settings for ${customerId}`);
  return seedSettings;
}

module.exports = {
  provisionSaasTenant,
  seedPromptProfile,
  seedVoiceAgentSettings,
  seedVisitPricingForClinic,
  ensureStripeMerchantReady,
  slugify,
  uniqueClinicSlug
};
