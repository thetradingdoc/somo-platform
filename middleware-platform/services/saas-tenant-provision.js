'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

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
          clinic_id, name, slug, phone_number, email, merchant_id, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(clinicId, displayName, slug, normalizedPhone, contactEmail, merchantId);

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

  return { merchantId, clinicId };
}

module.exports = { provisionSaasTenant, slugify, uniqueClinicSlug };
