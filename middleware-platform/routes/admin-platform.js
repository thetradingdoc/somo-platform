'use strict';

const {
  handleAdminLogin,
  handleAdminLogout,
  adminSessionStatus,
} = require('../middleware/admin-auth');
const { resolveClinicIdFromRequest } = require('../lib/resolve-clinic-id');

function registerAdminPlatformRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requireAdminAuth,
    pricingRoutes,
  } = deps;

app.post('/api/admin/session', handleAdminLogin);
app.delete('/api/admin/session', handleAdminLogout);
app.get('/api/admin/session', adminSessionStatus);

// Seed test patients endpoint (S-4: SEED_ENABLED + block staging)
app.post('/api/admin/patients/seed-test', async (req, res) => {
  const env = process.env.NODE_ENV || '';
  if (env === 'production' || env === 'prod') {
    return res.status(403).json({
      success: false,
      error: 'Test patient seeding is not allowed in production environment'
    });
  }
  if (env === 'staging') {
    return res.status(403).json({
      success: false,
      error: 'Test patient seeding is not allowed in staging environment'
    });
  }
  if (process.env.SEED_ENABLED !== '1' && process.env.SEED_ENABLED !== 'true') {
    return res.status(403).json({
      success: false,
      error: 'Seed endpoint disabled. Set SEED_ENABLED=1 to enable.'
    });
  }

  try {
    const { v4: uuidv4 } = require('uuid');

    const testPatients = [
      {
        firstName: 'Sarah',
        lastName: 'Johnson',
        phone: '+18622307479',
        email: 'sarah.johnson@example.com',
        birthDate: '1985-05-20',
        memberId: 'TEST81941',
        payerId: 'AETNA',
        copay: 25,
        allowedAmount: 150,
        insurancePays: 125,
        deductibleTotal: 1000,
        deductibleRemaining: 600,
        coinsurancePercent: 20,
        planSummary: 'Standard PPO: outpatient mental health covered after copay; deductible applies to labs only.'
      },
      {
        firstName: 'Michael',
        lastName: 'Williams',
        phone: '+15551234567',
        email: 'michael.williams@example.com',
        birthDate: '1980-01-15',
        memberId: 'TEST902782',
        payerId: 'BCBS',
        copay: 20,
        allowedAmount: 150,
        insurancePays: 130,
        deductibleTotal: 500,
        deductibleRemaining: 200,
        coinsurancePercent: 20,
        planSummary: 'Covers outpatient mental health visits; prior auth not required for first 6 visits.'
      }
    ];

    let created = 0;
    let updated = 0;

    for (const patientData of testPatients) {
      try {
        const fullName = `${patientData.firstName} ${patientData.lastName}`;
        console.log(`\n📝 Processing: ${fullName} (${patientData.phone})`);

        // Normalize phone number for search (try both formats)
        const phoneVariants = [
          patientData.phone,
          patientData.phone.replace('+1', ''),
          patientData.phone.replace('+', ''),
          `+1${patientData.phone.replace(/[^\d]/g, '')}`,
          patientData.phone.replace(/[^\d]/g, '')
        ];

        // Check if patient already exists (try different phone formats)
        let existingPatient = null;
        for (const phoneVariant of phoneVariants) {
          existingPatient = db.db.prepare('SELECT * FROM fhir_patients WHERE phone = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1').get(phoneVariant);
          if (existingPatient) {
            console.log(`   Found existing patient with phone: ${phoneVariant}`);
            break;
          }
        }

        let patientId;
        if (existingPatient) {
          patientId = existingPatient.resource_id;
          console.log(`   ⏭️  Patient exists: ${patientId}, updating name...`);

          // Update patient name if needed
          const currentName = existingPatient.name || '';
          if (currentName !== fullName) {
            let resourceData = {};
            try {
              resourceData = JSON.parse(existingPatient.resource_data);
            } catch (e) { }

            resourceData.name = [{
              use: 'official',
              family: patientData.lastName,
              given: [patientData.firstName]
            }];
            resourceData.resourceType = 'Patient';

            db.db.prepare(`
              UPDATE fhir_patients
              SET name = ?,
                  resource_data = ?,
                  updated_at = datetime('now')
              WHERE resource_id = ?
            `).run(fullName, JSON.stringify(resourceData), patientId);
            console.log(`   ✅ Updated patient name to: ${fullName}`);
          }
          updated++;
        } else {
          // Create new patient
          console.log(`   ➕ Creating new patient...`);
          const patientResult = await FHIRService.getOrCreatePatient({
            name: {
              family: patientData.lastName,
              given: [patientData.firstName]
            },
            phone: patientData.phone,
            email: patientData.email,
            birthDate: patientData.birthDate
          }, false);

          if (!patientResult.patient) {
            console.warn(`   ⚠️  Failed to create patient ${fullName}`);
            continue;
          }

          patientId = patientResult.patient.id || patientResult.patient.resource_id;
          console.log(`   ✅ Created patient: ${patientId}`);
          created++;
        }

        // Check if eligibility check already exists
        const existingEligibility = db.db.prepare(`
          SELECT id FROM eligibility_checks
          WHERE patient_id = ? AND member_id = ? AND payer_id = ?
          LIMIT 1
        `).get(patientId, patientData.memberId, patientData.payerId);

        if (!existingEligibility) {
          // Create eligibility check
          console.log(`   💳 Creating eligibility check...`);
          const eligibilityId = `elig_${uuidv4()}`;

          // Bug 6: Use 99203 fallback to match getCptCodeForVisit new-patient PrimaryCare/routine
          const defaultCpt = (() => { try { return require('./utils/cpt-helper').getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine', isNewPatient: true }); } catch (_) { return '99203'; } })();
          db.db.prepare(`
            INSERT INTO eligibility_checks (
              id, patient_id, member_id, payer_id, service_code, date_of_service,
              eligible, copay_amount, allowed_amount, insurance_pays,
              deductible_total, deductible_remaining, coinsurance_percent,
              plan_summary, response_data, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            eligibilityId,
            patientId,
            patientData.memberId,
            patientData.payerId,
            defaultCpt,
            new Date().toISOString().split('T')[0],
            1,
            patientData.copay,
            patientData.allowedAmount,
            patientData.insurancePays,
            patientData.deductibleTotal,
            patientData.deductibleRemaining,
            patientData.coinsurancePercent,
            patientData.planSummary,
            JSON.stringify({
              eligible: true,
              copay: patientData.copay,
              allowedAmount: patientData.allowedAmount,
              insurancePays: patientData.insurancePays,
              deductibleTotal: patientData.deductibleTotal,
              deductibleRemaining: patientData.deductibleRemaining,
              coinsurancePercent: patientData.coinsurancePercent,
              planSummary: patientData.planSummary,
              message: `Eligible - Copay $${patientData.copay}`
            })
          );
          console.log(`   ✅ Eligibility check created`);
        } else {
          // Update existing eligibility check to ensure data is current
          console.log(`   🔄 Updating existing eligibility check...`);
          db.db.prepare(`
            UPDATE eligibility_checks
            SET copay_amount = ?,
                allowed_amount = ?,
                insurance_pays = ?,
                deductible_total = ?,
                deductible_remaining = ?,
                coinsurance_percent = ?,
                plan_summary = ?,
                response_data = ?,
                date_of_service = ?
            WHERE id = ?
          `).run(
            patientData.copay,
            patientData.allowedAmount,
            patientData.insurancePays,
            patientData.deductibleTotal,
            patientData.deductibleRemaining,
            patientData.coinsurancePercent,
            patientData.planSummary,
            JSON.stringify({
              eligible: true,
              copay: patientData.copay,
              allowedAmount: patientData.allowedAmount,
              insurancePays: patientData.insurancePays,
              deductibleTotal: patientData.deductibleTotal,
              deductibleRemaining: patientData.deductibleRemaining,
              coinsurancePercent: patientData.coinsurancePercent,
              planSummary: patientData.planSummary,
              message: `Eligible - Copay $${patientData.copay}`
            }),
            new Date().toISOString().split('T')[0],
            existingEligibility.id
          );
          console.log(`   ✅ Eligibility check updated`);
        }

        // Create or update patient_insurance record
        const existingInsurance = db.db.prepare(`
          SELECT id FROM patient_insurance
          WHERE patient_id = ? AND payer_id = ? AND member_id = ?
          LIMIT 1
        `).get(patientId, patientData.payerId, patientData.memberId);

        if (!existingInsurance) {
          console.log(`   🏥 Creating insurance record...`);
          db.db.prepare(`
            INSERT INTO patient_insurance (
              id, patient_id, payer_id, payer_name, member_id,
              is_primary, is_verified, created_at
            ) VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'))
          `).run(
            uuidv4(),
            patientId,
            patientData.payerId,
            patientData.payerId,
            patientData.memberId
          );
          console.log(`   ✅ Insurance record created`);
        } else {
          console.log(`   ⏭️  Insurance record already exists`);
        }

      } catch (error) {
        console.error(`   ❌ Error processing patient ${patientData.firstName} ${patientData.lastName}:`, error.message);
        console.error(error.stack);
      }
    }

    return res.json({
      success: true,
      message: `Seeded test patients: ${created} created, ${updated} updated`,
      created,
      updated
    });
  } catch (error) {
    console.error('❌ Error seeding test patients:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/pricing', pricingRoutes.postPricing);

function createMerchantForClinic(name) {
  const merchantId = `merchant-${uuidv4()}`;
  const placeholderKey = generateApiKey('managed');
  db.createMerchant({
    id: merchantId,
    name: name || merchantId,
    api_key: placeholderKey,
    api_url: process.env.API_BASE_URL || 'https://api.callsomo.com',
    webhook_url: null,
    enabled_platforms: JSON.stringify(['voice']),
    status: 'active'
  });
  return merchantId;
}

function ensureMerchantForClinic(clinic) {
  if (clinic.merchant_id) {
    return clinic.merchant_id;
  }

  const clinicId = clinic.clinic_id || clinic.id;
  if (!clinicId) {
    console.warn('[ensureMerchantForClinic] Clinic missing clinic_id/id, cannot update');
    return createMerchantForClinic(clinic.name || 'Clinic');
  }
  const merchantId = createMerchantForClinic(clinic.name || clinicId);
  db.updateClinic(clinicId, { merchant_id: merchantId });
  clinic.merchant_id = merchantId;
  return merchantId;
}

function issueMerchantApiKey(merchantId, options = {}) {
  const apiKeyValue = generateApiKey('mk');
  const record = {
    id: `mkey_${uuidv4()}`,
    merchant_id: merchantId,
    key_hash: hashApiKey(apiKeyValue),
    key_prefix: apiKeyValue.slice(0, 8),
    key_suffix: apiKeyValue.slice(-4),
    label: options.label || 'Voice Agent',
    created_by: options.createdBy || 'system',
    status: 'active'
  };

  db.createMerchantApiKey(record);
  const stored = db.getMerchantApiKey(record.id);
  return {
    apiKey: apiKeyValue,
    record: stored
  };
}

function serializeApiKey(record) {
  if (!record) return null;
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    created_at: record.created_at,
    last_used_at: record.last_used_at,
    revoked_at: record.revoked_at,
    key_preview: `${record.key_prefix}...${record.key_suffix}`
  };
}

// Get all clients/clinics
app.get('/api/admin/clients', async (req, res) => {
  try {
    const clinics = db.prepare('SELECT * FROM clinics ORDER BY created_at DESC').all();
    const enriched = clinics.map((clinic) => {
      const result = { ...clinic };
      if (clinic.merchant_id) {
        const keys = db.getMerchantApiKeys(clinic.merchant_id);
        const activeKeys = keys.filter(k => k.status === 'active');
        const latest = activeKeys[0] || keys[0];
        result.api_key_summary = {
          total: keys.length,
          active: activeKeys.length,
          latest_preview: latest ? `${latest.key_prefix}...${latest.key_suffix}` : null
        };
      } else {
        result.api_key_summary = null;
      }
      return result;
    });
    res.json({
      success: true,
      clinics: enriched || []
    });
  } catch (error) {
    console.error('❌ Error fetching clients:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/clients/:clinicId', async (req, res) => {
  try {
    const clinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        error: 'Clinic not found'
      });
    }
    const merchantId = ensureMerchantForClinic(clinic);
    const keys = merchantId ? db.getMerchantApiKeys(merchantId).map(serializeApiKey) : [];

    res.json({
      success: true,
      clinic: {
        ...clinic,
        merchant_id: merchantId
      },
      api_keys: keys
    });
  } catch (error) {
    console.error('❌ Error fetching client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/clients', async (req, res) => {
  try {
    const { name, phone_number, retell_agent_id, email } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Clinic name is required'
      });
    }

    // Generate slug from name
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const clinicId = `clinic-${uuidv4()}`;
    const merchantId = createMerchantForClinic(name);
    const keyLabel = `${name} Voice Agent`;
    const issuedKey = issueMerchantApiKey(merchantId, {
      label: keyLabel,
      createdBy: req.adminSession?.id || 'admin'
    });

    // Insert clinic directly (matching database schema)
    db.prepare(`
      INSERT INTO clinics (
        clinic_id, name, slug, phone_number, email, 
        retell_agent_id, retell_agent_status, merchant_id, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clinicId,
      name,
      slug,
      phone_number || null,
      email || null,
      retell_agent_id || null,
      retell_agent_id ? 'active' : 'pending',
      merchantId,
      1
    );

    const clinic = {
      clinic_id: clinicId,
      name: name,
      slug: slug,
      phone_number: phone_number || null,
      email: email || null,
      retell_agent_id: retell_agent_id || null,
      retell_agent_status: retell_agent_id ? 'active' : 'pending',
      merchant_id: merchantId,
      is_active: true
    };

    // If phone number provided, link it
    if (phone_number) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO clinic_phone_numbers (phone_number, clinic_id, is_primary)
          VALUES (?, ?, ?)
        `).run(phone_number, clinicId, 1);
      } catch (phoneError) {
        console.warn('⚠️  Could not link phone number:', phoneError.message);
      }
    }

    res.json({
      success: true,
      clinic: clinic,
      api_key: issuedKey.apiKey,
      key: serializeApiKey(issuedKey.record),
      message: 'Client created successfully. Copy the API key now – it will not be shown again.'
    });
  } catch (error) {
    console.error('❌ Error creating client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.put('/api/admin/clients/:clinicId', async (req, res) => {
  try {
    const { name, phone_number, retell_agent_id, retell_agent_status, email, is_active } = req.body;
    const clinicId = req.params.clinicId;

    const existingClinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
    if (!existingClinic) {
      return res.status(404).json({
        success: false,
        error: 'Clinic not found'
      });
    }

    // Update clinic
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (retell_agent_id !== undefined) updates.retell_agent_id = retell_agent_id;
    if (retell_agent_status !== undefined) updates.retell_agent_status = retell_agent_status;
    if (email !== undefined) updates.email = email;
    if (is_active !== undefined) {
      updates.is_active = is_active === true || is_active === 1 || is_active === '1' ? 1 : 0;
    }

    // Build update query
    const fields = [];
    const values = [];
    Object.keys(updates).forEach(key => {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(clinicId);

    db.prepare(`UPDATE clinics SET ${fields.join(', ')} WHERE clinic_id = ?`).run(...values);

    // Suspend or reactivate tenant: merchant, SaaS customers, users, and sessions (provider cannot log in until reactivated)
    if (is_active !== undefined && existingClinic.merchant_id) {
      const merchantId = existingClinic.merchant_id;
      const on = updates.is_active === 1;
      try {
        db.prepare('UPDATE merchants SET status = ? WHERE id = ?').run(on ? 'active' : 'suspended', merchantId);
        db.prepare('UPDATE customers SET status = ? WHERE merchant_id = ?').run(on ? 'active' : 'suspended', merchantId);
        db.prepare('UPDATE users SET is_active = ? WHERE merchant_id = ?').run(on ? 1 : 0, merchantId);
        const custRows = db.prepare('SELECT id FROM customers WHERE merchant_id = ?').all(merchantId) || [];
        for (const row of custRows) {
          if (row.id && db.deleteCustomerSessions) db.deleteCustomerSessions(row.id);
        }
      } catch (tenantErr) {
        console.warn('⚠️ Admin tenant suspend/reactivate side effects:', tenantErr.message);
      }
    }

    // Update phone number link if changed
    if (phone_number && phone_number !== existingClinic.phone_number) {
      try {
        // Remove old phone link if exists
        db.prepare('DELETE FROM clinic_phone_numbers WHERE clinic_id = ?').run(clinicId);

        // Add new phone link
        db.prepare(`
          INSERT OR REPLACE INTO clinic_phone_numbers (phone_number, clinic_id, is_primary)
          VALUES (?, ?, ?)
        `).run(phone_number, clinicId, 1);
      } catch (phoneError) {
        console.warn('⚠️  Could not update phone number link:', phoneError.message);
      }
    }

    const updatedClinic = db.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicId);
    res.json({
      success: true,
      clinic: updatedClinic,
      message: 'Client updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating client:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const clinics = db.prepare('SELECT * FROM clinics').all();
    const allCheckouts = await db.getAllVoiceCheckouts();

    // Get real call data
    const allCalls = db.prepare('SELECT * FROM voice_call_log ORDER BY created_at DESC').all();
    const allFunctionCalls = db.prepare('SELECT * FROM function_call_log ORDER BY created_at DESC').all();
    const allErrors = db.prepare('SELECT * FROM error_log WHERE resolved = 0 ORDER BY created_at DESC').all();

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const todayCheckouts = allCheckouts.filter(c => c.created_at?.startsWith(today));
    const yesterdayCheckouts = allCheckouts.filter(c => c.created_at?.startsWith(yesterday));
    const todayCalls = allCalls.filter(c => c.created_at?.startsWith(today));
    const yesterdayCalls = allCalls.filter(c => c.created_at?.startsWith(yesterday));

    const todayRevenue = todayCheckouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const yesterdayRevenue = yesterdayCheckouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const revenueChange = yesterdayRevenue > 0
      ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100).toFixed(1)
      : 100;

    const completedOrders = todayCheckouts.filter(c => c.status === 'completed').length;
    const conversionRate = todayCalls.length > 0 ? (completedOrders / todayCalls.length) * 100 : 0;

    // Calculate real minutes from call logs
    const totalMinutes = allCalls.reduce((sum, c) => sum + (c.call_duration_seconds || 0), 0) / 60;
    const todayMinutes = todayCalls.reduce((sum, c) => sum + (c.call_duration_seconds || 0), 0) / 60;

    // Calculate real response times from function calls
    const successfulFunctionCalls = allFunctionCalls.filter(f => f.success === 1);
    const avgResponseTime = successfulFunctionCalls.length > 0
      ? successfulFunctionCalls.reduce((sum, f) => sum + (f.response_time_ms || 0), 0) / successfulFunctionCalls.length
      : 0;

    // Calculate real error rate
    const totalRequests = allCalls.length + allFunctionCalls.length;
    const errorRate = totalRequests > 0 ? (allErrors.length / totalRequests * 100) : 0;

    const totalRevenue = allCheckouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    res.json({
      success: true,
      totalClients: clinics.length,
      todayRevenue: todayRevenue,
      yesterdayRevenue: yesterdayRevenue,
      revenueChange: revenueChange,
      todayCalls: todayCalls.length,
      totalCalls: allCalls.length,
      totalMinutes: Math.round(totalMinutes),
      todayMinutes: Math.round(todayMinutes),
      avgResponseTime: Math.round(avgResponseTime),
      errorRate: errorRate.toFixed(2),
      conversionRate: conversionRate.toFixed(1),
      totalRevenue: totalRevenue,
      totalOrders: allCheckouts.filter(c => c.status === 'completed').length,
      totalErrors: allErrors.length
    });
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/performance', async (req, res) => {
  try {
    // Placeholder performance data - implement real metrics
    res.json({
      success: true,
      responseTime: {
        p50: 120,
        p95: 350,
        p99: 680
      },
      errorRate: 0.8,
      successRate: 99.2,
      slowEndpoints: [
        { endpoint: '/api/pdf-coding/process', avg: 450, p95: 890, p99: 1200, requests: 1200 },
        { endpoint: '/voice/checkout/create', avg: 320, p95: 650, p99: 980, requests: 3500 }
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/costs', async (req, res) => {
  try {
    const clinics = db.prepare('SELECT * FROM clinics').all();
    const allCalls = db.prepare('SELECT * FROM voice_call_log').all();

    // Calculate real costs from actual call data
    const totalMinutes = allCalls.reduce((sum, c) => sum + ((c.call_duration_seconds || 0) / 60), 0);
    const twilioCost = totalMinutes * 0.013; // $0.013 per minute (Twilio pricing)
    const retellCost = totalMinutes * 0.02; // $0.02 per minute (Retell pricing)
    const infraCost = 4200; // Monthly infrastructure estimate (Azure App Service)

    // Calculate costs per client
    const allVoiceCheckouts = await db.getAllVoiceCheckouts();
    const byClient = clinics.map(clinic => {
      const clinicCalls = allCalls.filter(c => c.customer_id === clinic.clinic_id);
      const clinicMinutes = clinicCalls.reduce((sum, c) => sum + ((c.call_duration_seconds || 0) / 60), 0);
      const clinicTwilioCost = clinicMinutes * 0.013;
      const clinicRetellCost = clinicMinutes * 0.02;
      const clinicInfraCost = infraCost / clinics.length; // Shared infrastructure

      // Get revenue for this client
      const clinicCheckouts = allVoiceCheckouts.filter(c => {
        // Try to match by phone number or clinic_id if stored
        return c.customer_phone && db.getClinicPhoneNumber(c.customer_phone)?.clinic_id === clinic.clinic_id;
      });
      const clinicRevenue = clinicCheckouts
        .filter(c => c.status === 'completed')
        .reduce((sum, c) => sum + (c.amount || 0), 0);

      return {
        clinic_id: clinic.clinic_id,
        name: clinic.name,
        phone_number: clinic.phone_number,
        retell_agent_id: clinic.retell_agent_id,
        infrastructure: clinicInfraCost,
        twilio: clinicTwilioCost,
        retell: clinicRetellCost,
        total: clinicInfraCost + clinicTwilioCost + clinicRetellCost,
        revenue: clinicRevenue,
        margin: clinicRevenue > 0 ? ((clinicRevenue - (clinicInfraCost + clinicTwilioCost + clinicRetellCost)) / clinicRevenue * 100) : 0,
        call_count: clinicCalls.length,
        total_minutes: Math.round(clinicMinutes)
      };
    });

    res.json({
      success: true,
      infrastructure: infraCost,
      twilio: twilioCost,
      retell: retellCost,
      total: infraCost + twilioCost + retellCost,
      total_minutes: Math.round(totalMinutes),
      byClient: byClient
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/usage', async (req, res) => {
  try {
    const allCheckouts = await db.getAllVoiceCheckouts();
    const totalMinutes = allCheckouts.length * 2;

    res.json({
      success: true,
      apiRequests: allCheckouts.length * 10, // Estimate
      voiceMinutes: totalMinutes,
      webhookEvents: allCheckouts.length * 2 // Estimate
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/logs', async (req, res) => {
  try {
    const level = req.query.level || 'all';
    const clinicId = req.query.clinic_id;
    const limit = parseInt(req.query.limit) || 100;

    let query = 'SELECT * FROM error_log WHERE 1=1';
    const params = [];

    if (clinicId) {
      query += ' AND customer_id = ?';
      params.push(clinicId);
    }

    if (level !== 'all') {
      query += ' AND severity = ?';
      params.push(level);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const errors = db.prepare(query).all(...params);

    // Get clinic names for errors
    const logs = await Promise.all(errors.map(async (error) => {
      let clinicName = 'Unknown';
      if (error.customer_id) {
        const clinic = await db.getClinicById(error.customer_id);
        if (clinic) clinicName = clinic.name;
      }

      return {
        id: error.id,
        level: error.severity,
        message: error.error_message,
        type: error.error_type,
        clinic_id: error.customer_id,
        clinic_name: clinicName,
        endpoint: error.endpoint,
        timestamp: error.created_at,
        resolved: error.resolved === 1,
        context: error.context ? JSON.parse(error.context) : null
      };
    }));

    res.json({
      success: true,
      logs: logs,
      total: errors.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/clients/:clinicId/analytics', async (req, res) => {
  try {
    const clinicId = req.params.clinicId;
    const clinic = await db.getClinicById(clinicId);

    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    // Get calls for this client
    const calls = db.prepare('SELECT * FROM voice_call_log WHERE customer_id = ? ORDER BY created_at DESC').all(clinicId);
    const functionCalls = db.prepare('SELECT * FROM function_call_log WHERE customer_id = ? ORDER BY created_at DESC').all(clinicId);
    const errors = db.prepare('SELECT * FROM error_log WHERE customer_id = ? AND resolved = 0 ORDER BY created_at DESC').all(clinicId);

    // Calculate metrics
    const totalMinutes = calls.reduce((sum, c) => sum + ((c.call_duration_seconds || 0) / 60), 0);
    const twilioCost = totalMinutes * 0.013;
    const retellCost = totalMinutes * 0.02;

    // Get revenue
    const checkouts = (await db.getAllVoiceCheckouts()).filter(c => {
      if (!c.customer_phone) return false;
      const phone = db.getClinicPhoneNumber(c.customer_phone);
      return phone && phone.clinic_id === clinicId;
    });
    const revenue = checkouts
      .filter(c => c.status === 'completed')
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    // Calculate response times
    const successfulCalls = functionCalls.filter(f => f.success === 1);
    const avgResponseTime = successfulCalls.length > 0
      ? successfulCalls.reduce((sum, f) => sum + (f.response_time_ms || 0), 0) / successfulCalls.length
      : 0;

    res.json({
      success: true,
      clinic: {
        clinic_id: clinic.clinic_id,
        name: clinic.name,
        phone_number: clinic.phone_number,
        retell_agent_id: clinic.retell_agent_id
      },
      metrics: {
        total_calls: calls.length,
        total_minutes: Math.round(totalMinutes),
        total_function_calls: functionCalls.length,
        successful_function_calls: successfulCalls.length,
        failed_function_calls: functionCalls.filter(f => f.success === 0).length,
        total_errors: errors.length,
        avg_response_time_ms: Math.round(avgResponseTime),
        revenue: revenue,
        twilio_cost: twilioCost,
        retell_cost: retellCost,
        total_cost: twilioCost + retellCost,
        margin: revenue > 0 ? ((revenue - (twilioCost + retellCost)) / revenue * 100) : 0
      },
      recent_calls: calls.slice(0, 10),
      recent_errors: errors.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/clients/:clinicId/api-keys', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    const merchantId = ensureMerchantForClinic(clinic);
    const keys = merchantId ? db.getMerchantApiKeys(merchantId).map(serializeApiKey) : [];

    res.json({
      success: true,
      merchant_id: merchantId,
      keys
    });
  } catch (error) {
    console.error('❌ Error fetching API keys:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/clients/:clinicId/api-keys', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    const merchantId = ensureMerchantForClinic(clinic);
    if (!merchantId) {
      return res.status(500).json({ success: false, error: 'Unable to provision merchant for clinic' });
    }

    if (req.body?.rotate_existing) {
      db.revokeAllMerchantApiKeys(merchantId, req.adminSession?.id || 'admin');
    }

    const issued = issueMerchantApiKey(merchantId, {
      label: req.body?.label || `${clinic.name || 'Client'} Voice Agent`,
      createdBy: req.adminSession?.id || 'admin'
    });

    res.json({
      success: true,
      merchant_id: merchantId,
      api_key: issued.apiKey,
      key: serializeApiKey(issued.record),
      message: 'New API key generated. Copy it now – it will not be shown again.'
    });
  } catch (error) {
    console.error('❌ Error creating API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/clients/:clinicId/api-keys/:keyId/revoke', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }

    const merchantId = ensureMerchantForClinic(clinic);
    const key = db.getMerchantApiKey(req.params.keyId);
    if (!key || key.merchant_id !== merchantId) {
      return res.status(404).json({ success: false, error: 'API key not found for this clinic' });
    }

    db.revokeMerchantApiKey(key.id, req.adminSession?.id || 'admin');
    const refreshed = db.getMerchantApiKey(key.id);

    res.json({
      success: true,
      key: serializeApiKey(refreshed)
    });
  } catch (error) {
    console.error('❌ Error revoking API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/clients/:clinicId/api-keys/rotate', async (req, res) => {
  try {
    const clinic = await db.getClinicById(req.params.clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, error: 'Clinic not found' });
    }
    const merchantId = ensureMerchantForClinic(clinic);
    const { apiKey, keyId } = db.rotateMerchantApiKey(merchantId, req.adminSession?.id || 'admin');
    res.json({
      success: true,
      api_key: apiKey,
      key_id: keyId,
      message: 'Store the api_key securely; it will not be shown again.'
    });
  } catch (error) {
    console.error('❌ Error rotating API key:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const status = req.query.status;

    let checkouts = await db.getAllVoiceCheckouts();

    if (status && status !== 'flagged') {
      checkouts = checkouts.filter(c => c.status === status);
    }

    checkouts = checkouts.slice(0, limit);

    res.json({
      success: true,
      transactions: checkouts,
      count: checkouts.length
    });

  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/customers', async (req, res) => {
  try {
    const allCheckouts = await db.getAllVoiceCheckouts();

    // Group by phone
    const customerMap = new Map();

    allCheckouts.forEach(checkout => {
      const phone = checkout.customer_phone;
      if (!phone) return;

      if (!customerMap.has(phone)) {
        customerMap.set(phone, {
          customer_phone: phone,
          customer_name: checkout.customer_name,
          customer_email: checkout.customer_email,
          orders: [],
          order_count: 0,
          total_spent: 0,
          first_order: checkout.created_at,
          last_order: checkout.created_at
        });
      }

      const customer = customerMap.get(phone);
      customer.orders.push(checkout);
      customer.order_count++;

      if (checkout.status === 'completed') {
        customer.total_spent += checkout.amount;
      }

      if (checkout.created_at < customer.first_order) {
        customer.first_order = checkout.created_at;
      }
      if (checkout.created_at > customer.last_order) {
        customer.last_order = checkout.created_at;
      }
    });

    const customers = Array.from(customerMap.values()).map(customer => {
      const completedOrders = customer.orders.filter(o => o.status === 'completed');

      let trustLevel = 'new';
      if (customer.order_count >= 5) {
        trustLevel = 'trusted';
      }

      return {
        ...customer,
        completed_orders: completedOrders.length,
        fraud_flags: 0,
        trust_level: trustLevel,
        avg_order_value: completedOrders.length > 0
          ? (customer.total_spent / completedOrders.length).toFixed(2)
          : 0,
        avg_fraud_score: 0
      };
    });

    customers.sort((a, b) => b.total_spent - a.total_spent);

    res.json({
      success: true,
      customers: customers,
      count: customers.length
    });

  } catch (error) {
    console.error('❌ Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/customers/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const allCheckouts = await db.getAllVoiceCheckouts();

    const orders = allCheckouts.filter(c => c.customer_phone === phone);

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const customer = {
      phone: phone,
      name: orders[0].customer_name,
      email: orders[0].customer_email,
      orders: orders,
      total_spent: orders
        .filter(o => o.status === 'completed')
        .reduce((sum, o) => sum + o.amount, 0),
      order_count: orders.length,
      first_order: orders[orders.length - 1].created_at,
      last_order: orders[0].created_at
    };

    res.json({
      success: true,
      customer: customer
    });

  } catch (error) {
    console.error('❌ Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/agent/stats', async (req, res) => {
  try {
    const merchant_id = req.query.merchant_id;

    let voiceCheckouts = await db.getAllVoiceCheckouts();

    if (merchant_id) {
      voiceCheckouts = voiceCheckouts.filter(c => c.merchant_id === merchant_id);
    }

    const today = new Date().toISOString().split('T')[0];
    const todayCalls = voiceCheckouts.filter(c =>
      c.created_at.startsWith(today)
    );

    const stats = {
      total_calls: todayCalls.length,
      successful_calls: todayCalls.filter(c => c.status === 'completed').length,
      revenue: todayCalls
        .filter(c => c.status === 'completed')
        .reduce((sum, c) => sum + c.amount, 0),
      conversion_rate: todayCalls.length > 0
        ? (todayCalls.filter(c => c.status === 'completed').length / todayCalls.length * 100).toFixed(1)
        : 0,
      avg_order_value: todayCalls.filter(c => c.status === 'completed').length > 0
        ? (todayCalls
          .filter(c => c.status === 'completed')
          .reduce((sum, c) => sum + c.amount, 0) /
          todayCalls.filter(c => c.status === 'completed').length).toFixed(2)
        : 0
    };

    res.json({
      success: true,
      stats: stats,
      recent_calls: todayCalls.slice(0, 10)
    });

  } catch (error) {
    console.error('❌ Error fetching agent stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/api-keys', async (req, res) => {
  try {
    const { customer_id, limit } = req.query;

    const filters = {};
    if (customer_id) filters.customer_id = customer_id;
    if (limit) filters.limit = parseInt(limit) || 100;

    const keys = db.getAllAPIKeys(filters);

    // Get customer info for each key
    const keysWithCustomer = keys.map(key => {
      const customer = db.getCustomer(key.customer_id);
      return {
        ...key,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          company_name: customer.company_name
        } : null
      };
    });

    res.json({
      success: true,
      api_keys: keysWithCustomer,
      count: keysWithCustomer.length
    });
  } catch (error) {
    console.error('❌ Error fetching API keys:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/api-keys/:keyId/recover', async (req, res) => {
  try {
    const { keyId } = req.params;

    const keyRecord = db.getAPIKeyById(keyId);
    if (!keyRecord) {
      return res.status(404).json({
        success: false,
        error: 'API key not found'
      });
    }

    if (!keyRecord.key_secret) {
      return res.status(404).json({
        success: false,
        error: 'API key secret not stored (cannot recover)'
      });
    }

    // Decrypt the API key
    const { decryptApiKey } = require('./utils/api-keys');
    const decryptedKey = decryptApiKey(keyRecord.key_secret);

    // Get customer info
    const customer = db.getCustomer(keyRecord.customer_id);

    res.json({
      success: true,
      api_key: decryptedKey,
      key_id: keyRecord.id,
      key_prefix: keyRecord.key_prefix,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        company_name: customer.company_name
      } : null,
      created_at: keyRecord.created_at,
      last_used_at: keyRecord.last_used_at,
      warning: 'This is a sensitive operation. The API key is only shown once here.'
    });
  } catch (error) {
    console.error('❌ Error recovering API key:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recover API key'
    });
  }
});

app.get('/api/admin/feature-requests', async (req, res) => {
  try {
    const { status, customer_id, limit } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (customer_id) filters.customer_id = customer_id;
    if (limit) filters.limit = parseInt(limit) || 100;

    const requests = db.getAllFeatureRequests(filters);

    // Get customer info for each request
    const requestsWithCustomer = requests.map(request => {
      const customer = db.getCustomer(request.customer_id);
      return {
        ...request,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          company_name: customer.company_name
        } : null
      };
    });

    res.json({
      success: true,
      feature_requests: requestsWithCustomer,
      count: requestsWithCustomer.length
    });
  } catch (error) {
    console.error('❌ Error fetching feature requests:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/feature-requests/:requestId/update', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, notes } = req.body;

    if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: pending, approved, or rejected'
      });
    }

    // Get the request to check if it exists
    const allRequests = db.getAllFeatureRequests({});
    const request = allRequests.find(r => r.id === requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Feature request not found'
      });
    }

    // Update status
    db.updateFeatureRequestStatus(requestId, status, notes || null);

    // If approved, add feature to customer's api_features
    if (status === 'approved') {
      const customer = db.getCustomer(request.customer_id);
      if (customer) {
        let apiFeatures = customer.api_features;
        if (typeof apiFeatures === 'string' && apiFeatures) {
          try {
            apiFeatures = JSON.parse(apiFeatures);
          } catch (e) {
            apiFeatures = [];
          }
        } else if (!apiFeatures) {
          apiFeatures = [];
        }

        if (!apiFeatures.includes(request.feature_name)) {
          apiFeatures.push(request.feature_name);
          db.db.prepare(`
            UPDATE customers 
            SET api_features = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(JSON.stringify(apiFeatures), customer.id);
        }
      }
    }

    res.json({
      success: true,
      message: `Feature request ${status} successfully`,
      request_id: requestId
    });
  } catch (error) {
    console.error('❌ Error updating feature request:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update feature request'
    });
  }
});

app.post('/api/admin/recover-stuck-escrow/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    
    const EscrowRecoveryService = require('./services/escrow-recovery-service');
    const result = await EscrowRecoveryService.recoverStuckEscrow(claimId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Recovery failed',
        recovered: result.recovered || [],
        errors: result.errors || []
      });
    }
    
    res.json({
      success: true,
      claimId: claimId,
      message: result.message,
      recovered: result.recovered,
      errors: result.errors
    });
  } catch (error) {
    console.error('❌ Error recovering stuck escrow:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recover stuck escrow'
    });
  }
});

app.post('/api/admin/recover-all-stuck-escrows', async (req, res) => {
  try {
    const olderThanHours = parseFloat(req.query.olderThanHours || '1');
    
    const EscrowRecoveryService = require('./services/escrow-recovery-service');
    const result = await EscrowRecoveryService.recoverAllStuckEscrows(olderThanHours);
    
    res.json({
      success: true,
      found: result.found,
      recovered: result.recovered,
      errors: result.errors,
      message: `Found ${result.found} stuck escrows, recovered ${result.recovered}`
    });
  } catch (error) {
    console.error('❌ Error recovering all stuck escrows:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recover stuck escrows'
    });
  }
});

app.post('/api/admin/escrow-timeout-notify', async (req, res) => {
  try {
    const EscrowOrchestrator = require('./services/escrow-orchestrator-service');
    const result = await EscrowOrchestrator.checkEscrowTimeoutAndNotify(db);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Escrow timeout notify error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/fee-schedules/freshness', (req, res) => {
  try {
    const { payerId } = req.query;
    
    if (!payerId) {
      return res.status(400).json({
        success: false,
        error: 'payerId query parameter is required'
      });
    }
    
    const FeeScheduleService = require('./services/fee-schedule-service');
    const freshness = FeeScheduleService.getFeeScheduleFreshness(payerId);
    
    res.json({
      success: true,
      ...freshness
    });
  } catch (error) {
    console.error('❌ Error getting fee schedule freshness:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get fee schedule freshness'
    });
  }
});

app.get('/api/admin/fee-schedules/stale', (req, res) => {
  try {
    const { payerId, olderThanDays } = req.query;
    const days = olderThanDays ? parseFloat(olderThanDays) : null;
    
    const FeeScheduleService = require('./services/fee-schedule-service');
    const staleRates = FeeScheduleService.getStaleFeeSchedules(payerId || null, days);
    
    res.json({
      success: true,
      count: staleRates.length,
      staleRates: staleRates.map(rate => ({
        payer_id: rate.payer_id,
        cpt_code: rate.cpt_code,
        allowed_amount: rate.allowed_amount,
        updated_at: rate.updated_at,
        effective_date: rate.effective_date,
        days_old: rate.updated_at ? Math.floor((Date.now() - new Date(rate.updated_at).getTime()) / (24 * 60 * 60 * 1000)) : null
      }))
    });
  } catch (error) {
    console.error('❌ Error getting stale fee schedules:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get stale fee schedules'
    });
  }
});

app.post('/api/admin/fee-schedules/mark-refreshed', (req, res) => {
  try {
    const { payerId, cptCodes } = req.body;
    
    if (!payerId) {
      return res.status(400).json({
        success: false,
        error: 'payerId is required'
      });
    }
    
    const FeeScheduleService = require('./services/fee-schedule-service');
    const updated = FeeScheduleService.markFeeScheduleRefreshed(payerId, cptCodes || []);
    
    res.json({
      success: true,
      payerId: payerId,
      updated: updated,
      message: `Marked ${updated} fee schedule rate(s) as refreshed`
    });
  } catch (error) {
    console.error('❌ Error marking fee schedule refreshed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to mark fee schedule refreshed'
    });
  }
});

app.get('/api/admin/claims/review-queue', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const raw = db.getClaimsForReviewQueue ? db.getClaimsForReviewQueue({ limit }) : [];
    const SettlementRulesService = require('./services/settlement-rules-service');
    const claims = raw.map(c => {
      let claimDetails = {};
      try {
        claimDetails = c.response_data ? (typeof c.response_data === 'string' ? JSON.parse(c.response_data) : c.response_data) : {};
      } catch (_) {}
      const codingConfidence = claimDetails?.coding?.codingConfidence ?? claimDetails?.pricing?.codingConfidence ?? null;
      const evaluation = SettlementRulesService.evaluateSettlementRules({
        claim: c,
        claimDetails,
        eobCalculation: {},
        eligibility: {}
      });
      return {
        ...c,
        codingConfidence,
        needsReview: evaluation.action === 'manual_review',
        evaluationReason: evaluation.reason
      };
    }).filter(c => c.needsReview || (c.codingConfidence != null && parseFloat(c.codingConfidence) < 0.75));
    res.json({ success: true, claims, count: claims.length });
  } catch (error) {
    console.error('❌ Review queue error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/claims/:claimId/resubmit', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = db.getClaimById(claimId);
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }
    if (claim.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: `Claim must be rejected to resubmit. Current status: ${claim.status}`
      });
    }
    db.updateInsuranceClaim(claimId, {
      status: 'draft',
      payment_status: 'pending',
      response_data: (() => {
        let rd = {};
        try {
          rd = claim.response_data ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data) : {};
        } catch (_) {}
        delete rd.rejectedAt;
        delete rd.rejectionReason;
        rd.resubmittedAt = new Date().toISOString();
        return JSON.stringify(rd);
      })()
    });
    res.json({
      success: true,
      claimId,
      status: 'draft',
      message: 'Claim reset for resubmission. Call POST /voice/insurance/submit-claim with corrected data.'
    });
  } catch (error) {
    console.error('❌ Resubmit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/insurance/claims', async (req, res) => {
  try {
    const filters = {};

    if (req.query.appointment_id) {
      filters.appointment_id = req.query.appointment_id;
    }

    if (req.query.patient_id) {
      filters.patient_id = req.query.patient_id;
    }

    if (req.query.status) {
      filters.status = req.query.status;
    }

    let claims = db.getAllClaims(filters);

    // Always return ALL claims including approved/paid so insurer can see them again
    // Don't filter out approved claims - user needs to see them
    claims = claims || [];

    res.json({
      success: true,
      claims,
      count: claims.length
    });
  } catch (error) {
    console.error('❌ Error fetching claims:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/insurance/payers', async (req, res) => {
  try {
    const search = req.query.search || null;
    const limit = parseInt(req.query.limit) || 100;
    const transactionType = req.query.transaction_type || null;

    const options = {};
    if (search) options.search = search;
    if (limit) options.limit = limit;
    if (transactionType) options.transactionType = transactionType;

    const result = await InsuranceService.fetchPayers(options);

    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching payers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/insurance/payers/search', async (req, res) => {
  try {
    const searchTerm = req.query.q || req.query.search;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: q or search'
      });
    }

    // Use cache service to minimize API calls
    const result = await PayerCacheService.searchPayer(searchTerm);

    res.json(result);
  } catch (error) {
    console.error('❌ Error searching payers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/insurance/sync-payers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;

    const result = await PayerCacheService.syncPayerList(limit);

    res.json(result);
  } catch (error) {
    console.error('❌ Error syncing payers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/insurance/payers/stats', async (req, res) => {
  try {
    const stats = PayerCacheService.getCacheStats();

    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/fee-schedules', async (req, res) => {
  try {
    const payerId = req.query.payerId;
    if (!payerId) {
      return res.status(400).json({ success: false, error: 'payerId query parameter required' });
    }
    const rows = db.getFeeSchedulesByPayer?.(payerId, 500) || [];
    res.json({ success: true, payerId, feeSchedules: rows, count: rows.length });
  } catch (error) {
    console.error('❌ Error listing fee schedules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/fee-schedules', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.payer_id || !body.cpt_code || body.allowed_amount == null) {
      return res.status(400).json({
        success: false,
        error: 'payer_id, cpt_code, and allowed_amount are required'
      });
    }
    const id = db.upsertFeeSchedule?.(body);
    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('❌ Error upserting fee schedule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/fee-schedules/bulk', async (req, res) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : body;
    if (!items.length) {
      return res.status(400).json({
        success: false,
        error: 'items array required with payer_id, cpt_code, allowed_amount'
      });
    }
    const result = db.bulkUpsertFeeSchedules?.(items) || { inserted: 0 };
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Error bulk upserting fee schedules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/metrics', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const inMemory = Metrics.getAll();
    const obfFallbackWarnThreshold = Number(process.env.OBF_FALLBACK_RATE_WARN || 0.4);
    const obfFallbackCritThreshold = Number(process.env.OBF_FALLBACK_RATE_CRIT || 0.7);
    let llmAggregates = null;
    let cacheStats = null;
    try {
      if (typeof db.getLlmUsageAggregates === 'function') {
        llmAggregates = db.getLlmUsageAggregates(days);
      }
    } catch (e) { /* ignore */ }
    try {
      const cacheService = require('./services/cache-service');
      cacheStats = cacheService.getStats();
    } catch (e) { /* ignore */ }
    let postgresSyncRetry = null;
    try {
      if (typeof db.getRetryQueueDepth === 'function') {
        postgresSyncRetry = {
          retry_queue_depth: db.getRetryQueueDepth(),
          dlq_size: db.getDLQSize()
        };
      }
    } catch (e) { /* ignore */ }
    let circuitBreaker = null;
    try {
      const cb = require('./utils/circuit-breaker');
      if (typeof cb.getMetrics === 'function') {
        circuitBreaker = cb.getMetrics();
      }
    } catch (e) { /* ignore */ }
    let tokenBudget = null;
    try {
      const tb = require('./utils/token-budget');
      if (typeof tb.getConfig === 'function') {
        tokenBudget = tb.getConfig();
      }
    } catch (e) { /* ignore */ }
    let latencyBudget = null;
    try {
      const lb = require('./config/latency-budget');
      if (typeof lb.getViolationCount === 'function') {
        latencyBudget = { violations: lb.getViolationCount() };
      }
    } catch (e) { /* ignore */ }
    let clinicRateLimit = null;
    try {
      const crl = require('./utils/clinic-rate-limiter');
      if (typeof crl.getConfig === 'function') {
        clinicRateLimit = crl.getConfig();
      }
    } catch (e) { /* ignore */ }
    let dlqToolCalls = null;
    try {
      if (typeof db.getDlqToolCallsSize === 'function') {
        dlqToolCalls = { size: db.getDlqToolCallsSize() };
      }
    } catch (e) { /* ignore */ }
    let checkoutPolicy = {
      forbidden_payment_ready_phrase_count: 0,
      stale_checkout_prepared_count: 0,
      in_progress_after_confirmed_count: 0,
      alerts: [],
      threshold_15m: 0,
      status: 'ok'
    };
    try {
      const rows = typeof db.getOpsCounters === 'function' ? db.getOpsCounters(0.25) : [];
      const violationCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_forbidden_payment_ready_phrase')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const repeatedInProgressAfterConfirmed = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_in_progress_after_confirmed')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const duplicateOtpPromptCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_duplicate_otp_prompt')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const shippingReaskAfterCaptureCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_shipping_reask_after_capture')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const resumeRequiredCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_resume_required')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const productSwitchResetCount = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_product_switch_reset')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const stagePreparedTransitions = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_stage_transition_checkout_prepared')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const stageConfirmedTransitions = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_stage_transition_payment_confirmed')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      const stageFailedTransitions = (rows || [])
        .filter((r) => String(r?.name || '') === 'checkout_stage_transition_failed')
        .reduce((sum, r) => sum + (parseInt(String(r?.count || '0'), 10) || 0), 0);
      let stalePreparedCount = 0;
      try {
        const staleRows = db.db.prepare(`
          SELECT COUNT(*) AS n
          FROM kelly_session_meta_kv s
          WHERE s.meta_key = 'checkout_stage'
            AND s.value = 'checkout_prepared'
            AND EXISTS (
              SELECT 1 FROM kelly_session_meta_kv t
              WHERE t.session_id = s.session_id
                AND t.meta_key = 'checkout_stage_updated_at_ms'
                AND CAST(t.value AS INTEGER) > 0
                AND CAST(t.value AS INTEGER) < ?
            )
        `).get(Date.now() - CHECKOUT_PREPARED_STALE_MS);
        stalePreparedCount = parseInt(String(staleRows?.n || '0'), 10) || 0;
      } catch (_) {}
      const alerts = [];
      if (violationCount > 0) {
        alerts.push({
          alert: 'checkout_forbidden_payment_ready_phrase',
          count: violationCount,
          severity: 'high',
          message:
            `${violationCount} reply(s) violated stage policy and were replaced with canonical templates. Investigate phrasing drift paths.`,
          action: 'Review [checkout-stage] policy_violation_replaced logs.'
        });
      }
      if (stalePreparedCount > 0) {
        alerts.push({
          alert: 'checkout_prepared_stale_sessions',
          count: stalePreparedCount,
          severity: 'high',
          message: `${stalePreparedCount} checkout_prepared session(s) are stale beyond threshold.`,
          action: 'Review reconciliation DLQ and stale checkout recovery.'
        });
      }
      if (repeatedInProgressAfterConfirmed > 0) {
        alerts.push({
          alert: 'checkout_in_progress_after_confirmed',
          count: repeatedInProgressAfterConfirmed,
          severity: 'medium',
          message: `${repeatedInProgressAfterConfirmed} response(s) mentioned in-progress after confirmed payment.`,
          action: 'Validate payment-status sync and copy mapping.'
        });
      }
      if (duplicateOtpPromptCount > 0) {
        alerts.push({
          alert: 'checkout_duplicate_otp_prompt',
          count: duplicateOtpPromptCount,
          severity: 'medium',
          message: `${duplicateOtpPromptCount} response(s) attempted to re-prompt OTP after verified stage.`,
          action: 'Review deterministic stage copy and fallback paths.'
        });
      }
      if (shippingReaskAfterCaptureCount > 0) {
        alerts.push({
          alert: 'checkout_shipping_reask_after_capture',
          count: shippingReaskAfterCaptureCount,
          severity: 'medium',
          message: `${shippingReaskAfterCaptureCount} response(s) asked for shipping after shipping was already captured.`,
          action: 'Review shipping persistence and stage-contract reply mapping.'
        });
      }
      checkoutPolicy = {
        forbidden_payment_ready_phrase_count: violationCount,
        stale_checkout_prepared_count: stalePreparedCount,
        in_progress_after_confirmed_count: repeatedInProgressAfterConfirmed,
        duplicate_otp_prompt_count: duplicateOtpPromptCount,
        shipping_reask_after_capture_count: shippingReaskAfterCaptureCount,
        resume_required_count: resumeRequiredCount,
        product_switch_reset_count: productSwitchResetCount,
        prepared_transition_count: stagePreparedTransitions,
        confirmed_transition_count: stageConfirmedTransitions,
        failed_transition_count: stageFailedTransitions,
        conversion_confirmed_over_prepared:
          stagePreparedTransitions > 0 ? Number((stageConfirmedTransitions / stagePreparedTransitions).toFixed(4)) : 0,
        alerts,
        threshold_15m: 0,
        slo_targets: {
          mount_failure_rate_max: 0.05,
          prepare_block_rate_max: 0.2,
          confirm_to_receipt_latency_ms_p95_max: 120000
        },
        status: alerts.length > 0 ? 'alert' : 'ok'
      };
    } catch (_) {}
    let catalogMasterStats = null;
    try {
      if (typeof db.getMasterCatalogStats === 'function') {
        catalogMasterStats = db.getMasterCatalogStats();
      }
    } catch (_) {}
    const catalogMasterKpi = buildCatalogMasterKpi(inMemory, catalogMasterStats || {});
    const obfMiss = Number(inMemory['obf.index_cache.miss.count'] || 0);
    const obfHit = Number(inMemory['obf.index_cache.hit.count'] || 0);
    const obfFallback = Number(inMemory['obf.index_cache.fallback_to_live.count'] || 0);
    const obfFallbackRate = obfMiss > 0 ? Number((obfFallback / obfMiss).toFixed(4)) : 0;
    const obfStatus = obfFallbackRate >= obfFallbackCritThreshold
      ? 'critical'
      : obfFallbackRate >= obfFallbackWarnThreshold
        ? 'warning'
        : 'ok';

    return res.json({
      success: true,
      metrics: inMemory,
      obf: {
        cache_hit: obfHit,
        cache_miss: obfMiss,
        fallback_to_live: obfFallback,
        fallback_rate: obfFallbackRate,
        thresholds: {
          warn: obfFallbackWarnThreshold,
          critical: obfFallbackCritThreshold
        },
        status: obfStatus
      },
      catalog_master: catalogMasterKpi,
      checkout_policy: checkoutPolicy,
      llm: llmAggregates,
      cache: cacheStats,
      postgres_sync_retry: postgresSyncRetry,
      circuit_breaker: circuitBreaker,
      token_budget: tokenBudget,
      latency_budget_violations: latencyBudget?.violations ?? 0,
      clinic_rate_limit: clinicRateLimit,
      dlq_tool_calls: dlqToolCalls,
      days
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/catalog/master-stats', async (req, res) => {
  try {
    const inMemory = Metrics.getAll();
    const catalogStats =
      typeof db.getMasterCatalogStats === 'function'
        ? db.getMasterCatalogStats()
        : { total_count: 0, obf_count: 0, off_count: 0 };
    return res.json({
      success: true,
      source_of_truth: 'local_master_catalog_index',
      storage: {
        obf_table: 'products_obf_index',
        off_table: 'products_off_index'
      },
      catalog: catalogStats,
      kpi: buildCatalogMasterKpi(inMemory, catalogStats)
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/dashboards/calls', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');

    const voiceCalls = db.db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status != 'completed' AND status IS NOT NULL THEN 1 ELSE 0 END) as failed
      FROM voice_call_log WHERE created_at >= ?
    `).get(cutoffStr);

    const functionCalls = db.db.prepare(`
      SELECT function_name, COUNT(*) as count, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
      FROM function_call_log WHERE created_at >= ?
      GROUP BY function_name
    `).all(cutoffStr);

    const stateTransitions = db.db.prepare(`
      SELECT current_stage, COUNT(*) as count FROM voice_call_states
      WHERE updated_at >= ? GROUP BY current_stage
    `).all(cutoffStr);

    const codingDecisions = db.db.prepare(`
      SELECT COUNT(*) as total FROM coding_decisions WHERE created_at >= ?
    `).get(cutoffStr);

    const errorRate = voiceCalls?.total > 0
      ? Math.round(((voiceCalls.failed || 0) / voiceCalls.total) * 10000) / 100
      : 0;

    return res.json({
      success: true,
      days,
      voice_calls: { total: voiceCalls?.total ?? 0, completed: voiceCalls?.completed ?? 0, failed: voiceCalls?.failed ?? 0, error_rate_pct: errorRate },
      tool_usage: functionCalls,
      state_distribution: stateTransitions,
      coding_decisions: codingDecisions?.total ?? 0,
      dlq_tool_calls_size: typeof db.getDlqToolCallsSize === 'function' ? db.getDlqToolCallsSize() : 0
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/dlq-tool-calls', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const items = typeof db.getDlqToolCalls === 'function' ? db.getDlqToolCalls(limit) : [];
    const size = typeof db.getDlqToolCallsSize === 'function' ? db.getDlqToolCallsSize() : 0;
    return res.json({ success: true, items, total: size });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/cache-stats', async (req, res) => {
  try {
    const cacheService = require('./services/cache-service');
    const stats = cacheService.getStats();
    const hitRate = stats.hits + stats.misses > 0
      ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
      : 0;
    return res.json({ success: true, cache: { ...stats, hitRatePercent: hitRate } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/cache/clear', async (req, res) => {
  try {
    const cacheService = require('./services/cache-service');
    const bucket = req.query.bucket; // optional: code_lookup, payer_guidelines, payer_pricing, coding_rules
    cacheService.clear(bucket);
    return res.json({ success: true, cleared: bucket || 'all' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/feature-flags', (req, res) => {
  try {
    const ff = require('./config/feature-flags');
    return res.json({ success: true, flags: ff.getAll() });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/feature-flags', express.json(), async (req, res) => {
  try {
    const { flag_name, enabled_globally, enabled_for_clinic_ids, rollout_pct } = req.body || {};
    if (!flag_name) return res.status(400).json({ success: false, error: 'flag_name required' });
    db.db.prepare(`
      INSERT INTO feature_flags (flag_name, enabled_globally, enabled_for_clinic_ids, rollout_pct, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(flag_name) DO UPDATE SET
        enabled_globally = COALESCE(excluded.enabled_globally, feature_flags.enabled_globally),
        enabled_for_clinic_ids = COALESCE(excluded.enabled_for_clinic_ids, feature_flags.enabled_for_clinic_ids),
        rollout_pct = COALESCE(excluded.rollout_pct, feature_flags.rollout_pct),
        updated_at = datetime('now')
    `).run(flag_name, enabled_globally ? 1 : 0, typeof enabled_for_clinic_ids === 'string' ? enabled_for_clinic_ids : JSON.stringify(enabled_for_clinic_ids || null), rollout_pct ?? 100);
    return res.json({ success: true, flag_name });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/patient-merge-events', async (req, res) => {
  try {
    const events = db.getRecentPatientMergeEvents ? db.getRecentPatientMergeEvents(100) : [];
    return res.json({ success: true, events });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/payor-review-queue/sync', express.json(), async (req, res) => {
  try {
    const policyVersion = req.body?.policy_version || null;
    const limit = Math.max(1, Math.min(Number(req.body?.limit || 1000), 10000));
    const inserted = db.enqueuePayorReviewQueueFromDecisions({
      policyVersion,
      decisions: ['merge_review_flag', 'review_candidate'],
      limit
    });
    return res.json({ success: true, inserted, policy_version: policyVersion });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/payor-review-queue', async (req, res) => {
  try {
    const status = req.query?.status || 'pending';
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 100), 500));
    const offset = Math.max(0, Number(req.query?.offset || 0));
    const items = db.listPayorReviewQueue({ status, limit, offset });
    return res.json({ success: true, status, count: items.length, items });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/payor-review-queue/:queueId', async (req, res) => {
  try {
    const queueId = req.params.queueId;
    if (!queueId) return res.status(400).json({ success: false, error: 'queueId required' });
    const item = db.getPayorReviewQueueDetails(queueId);
    if (!item) return res.status(404).json({ success: false, error: 'queue item not found' });
    return res.json({ success: true, item });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/payor-review-queue/:queueId/decision', express.json(), async (req, res) => {
  try {
    const queueId = req.params.queueId;
    const action = String(req.body?.action || '').trim();
    const rationale = req.body?.rationale || null;
    const reviewer =
      req.adminSession?.email ||
      req.admin?.email ||
      req.body?.reviewer ||
      'admin';
    if (!queueId) return res.status(400).json({ success: false, error: 'queueId required' });
    if (!action) return res.status(400).json({ success: false, error: 'action required' });
    const reviewDecisionId = db.submitPayorReviewDecision({
      queueId,
      reviewer,
      action,
      rationale
    });
    return res.json({ success: true, queue_id: queueId, review_decision_id: reviewDecisionId });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/patient-merge-events/:id/review', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ success: false, error: 'id required' });
    }
    if (db.markPatientMergeEventReviewed) {
      const reviewer = req.admin && req.admin.email ? req.admin.email : 'admin';
      db.markPatientMergeEventReviewed(id, reviewer);
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/patients/:id/insurance', async (req, res) => {
  try {
    const patientId = req.params.id;
    const insurance = db.getAllPatientInsurance(patientId) || [];
    return res.json({ success: true, patientId, insurance });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/patients/:id/eligibility', async (req, res) => {
  try {
    const patientId = req.params.id;
    let rows = db.getEligibilityChecksByPatient(patientId) || [];

    // Fallback: if no eligibility_checks, use patient_insurance (same source as patient portal)
    if (rows.length === 0) {
      const insuranceList = db.getAllPatientInsurance && db.getAllPatientInsurance(patientId);
      const primary = insuranceList && (insuranceList.find(i => i.is_primary) || insuranceList[0]);
      if (primary) {
        const payer = db.getPayerByPayerId(primary.payer_id);
        const payer_name = payer ? payer.payer_name : (primary.payer_name || primary.payer_id);
        rows = [{
          id: null,
          date_of_service: null,
          eligible: true,
          copay_amount: null,
          allowed_amount: null,
          insurance_pays: null,
          deductible_total: null,
          deductible_remaining: null,
          coinsurance_percent: null,
          plan_summary: primary.plan_name || 'Insurance on file',
          payer_id: primary.payer_id,
          payer_name,
          member_id: primary.member_id,
          service_code: null,
          created_at: null
        }];
      }
    }

    // Provide a compact view
    const elig = rows.map(r => {
      let payer_name = null;
      if (r.payer_id) {
        const payer = db.getPayerByPayerId(r.payer_id);
        payer_name = payer ? payer.payer_name : null;
      }
      return {
        id: r.id,
        date_of_service: r.date_of_service,
        eligible: !!r.eligible,
        copay_amount: r.copay_amount,
        allowed_amount: r.allowed_amount,
        insurance_pays: r.insurance_pays,
        deductible_total: r.deductible_total,
        deductible_remaining: r.deductible_remaining,
        coinsurance_percent: r.coinsurance_percent,
        plan_summary: r.plan_summary,
        payer_id: r.payer_id,
        payer_name: payer_name || r.payer_name || r.payer_id,
        member_id: r.member_id,
        service_code: r.service_code,
        created_at: r.created_at
      };
    });
    return res.json({ success: true, patientId, eligibility: elig, count: elig.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/patients/restore-stedi', async (req, res) => {
  try {
    // Use the new syncPatientsFromStedi method from FHIRService
    const result = await FHIRService.syncPatientsFromStedi();

    return res.json({
      success: true,
      message: 'Stedi patient data restoration complete',
      result
    });
  } catch (error) {
    console.error('❌ Error restoring Stedi patients:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.put('/api/admin/patients/:patientId/name', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { family, given } = req.body;

    if (!family || !given || !Array.isArray(given)) {
      return res.status(400).json({
        success: false,
        error: 'family and given (array) are required'
      });
    }

    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    const resource = typeof patient.resource_data === 'string'
      ? JSON.parse(patient.resource_data)
      : patient.resource_data;

    const oldName = resource.name?.[0]
      ? `${(resource.name[0].given || []).join(' ')} ${resource.name[0].family || ''}`.trim()
      : 'Unknown';

    // Update name
    if (!resource.name || !resource.name[0]) {
      resource.name = [{}];
    }
    resource.name[0].family = family;
    resource.name[0].given = given;
    resource.name[0].use = 'official';

    const result = db.updateFHIRPatient(patientId, resource);

    if (result && result.changes > 0) {
      const newName = `${given.join(' ')} ${family}`.trim();

      // Update appointments
      const appointments = db.getAllAppointments({}).filter(a => a.patient_id === patientId);
      appointments.forEach(appt => {
        db.updateAppointment(appt.id, { patient_name: newName });
      });

      console.log(`✅ Updated patient name: ${oldName} → ${newName}`);

      res.json({
        success: true,
        patientId,
        oldName,
        newName,
        appointmentsUpdated: appointments.length
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'No changes made'
      });
    }
  } catch (error) {
    console.error('❌ Error updating patient name:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/patients/sync-stedi', async (req, res) => {
  try {
    const result = await FHIRService.syncPatientsFromStedi();

    return res.json({
      success: true,
      message: `Synced ${result.created} new patients, linked ${result.linked} eligibility checks`,
      result
    });
  } catch (error) {
    console.error('❌ Error syncing patients from Stedi:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/patients/:id/eob', async (req, res) => {
  try {
    const patientId = req.params.id;

    // Get patient info
    const patient = db.getFHIRPatient(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    // getFHIRPatient already parses JSON, so resource_data is already an object
    const patientData = patient.resource_data || {};
    const name = patientData.name?.[0];
    const patientName = name ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim() : 'Unknown';

    // Get claims for this patient FIRST (needed for member_id lookup)
    const claims = db.getClaimsByPatient(patientId) || [];

    // Get eligibility data
    // PRIORITY: Get eligibility with deductible information (same logic as /api/patient/benefits)
    let eligibility = db.getEligibilityChecksByPatient(patientId) || [];

    // If no eligibility found by patient_id, try to find by member_id from claims
    if (eligibility.length === 0 && claims.length > 0 && claims[0].member_id) {
      const memberId = claims[0].member_id;
      console.log(`   ℹ️  No eligibility found by patient_id, searching by member_id: ${memberId}`);
      const eligibilityByMember = db.db.prepare(`
        SELECT * FROM eligibility_checks
        WHERE member_id = ?
        ORDER BY deductible_total DESC NULLS LAST, created_at DESC
      `).all(memberId);

      if (eligibilityByMember && eligibilityByMember.length > 0) {
        eligibility = eligibilityByMember;
        console.log(`   ✅ Found ${eligibility.length} eligibility record(s) by member_id`);
      }
    }

    // Find the best eligibility record (one with deductible info, or most recent)
    let latestEligibility = null;

    // First, try to find one with complete deductible information
    const eligibilityWithDeductible = eligibility.find(e =>
      e.deductible_total !== null && e.deductible_total !== undefined
    );

    if (eligibilityWithDeductible) {
      latestEligibility = eligibilityWithDeductible;
      console.log(`   ✅ Using eligibility record with deductible: $${latestEligibility.deductible_total} total, $${latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : 0} remaining`);
    } else if (eligibility.length > 0) {
      // Fallback to most recent eligibility check
      latestEligibility = eligibility[0];
      console.log(`   ⚠️  Using most recent eligibility record (no deductible info): ${latestEligibility.id}`);

      // Try to find eligibility by member_id from claims if no deductible info
      if (claims.length > 0 && claims[0].member_id) {
        const memberId = claims[0].member_id;
        console.log(`   ℹ️  Searching for eligibility with deductible by member_id: ${memberId}`);
        const eligibilityByMemberWithDeductible = db.db.prepare(`
          SELECT * FROM eligibility_checks
          WHERE member_id = ? 
            AND deductible_total IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        `).get(memberId);

        if (eligibilityByMemberWithDeductible) {
          latestEligibility = eligibilityByMemberWithDeductible;
          console.log(`   ✅ Found eligibility record with deductible by member_id: $${latestEligibility.deductible_total} total, $${latestEligibility.deductible_remaining || 0} remaining`);

          // Link this eligibility to the current patient if it's not already linked
          if (!latestEligibility.patient_id || latestEligibility.patient_id !== patientId) {
            try {
              db.db.prepare(`
                UPDATE eligibility_checks 
                SET patient_id = ?
                WHERE id = ?
              `).run(patientId, latestEligibility.id);
              console.log(`   ✅ Linked eligibility record ${latestEligibility.id} to patient ${patientId}`);
              latestEligibility.patient_id = patientId;
            } catch (updateError) {
              console.warn(`   ⚠️  Could not link eligibility record: ${updateError.message}`);
            }
          }
        }
      }
    } else {
      console.log('   ℹ️  No eligibility data found for patient');

      // Last resort: try to find eligibility by member_id from claims
      if (claims.length > 0 && claims[0].member_id) {
        const memberId = claims[0].member_id;
        console.log(`   ℹ️  Last resort: searching for eligibility by member_id: ${memberId}`);
        const anyEligibility = db.db.prepare(`
          SELECT * FROM eligibility_checks
          WHERE member_id = ?
          ORDER BY deductible_total DESC NULLS LAST, created_at DESC
          LIMIT 1
        `).get(memberId);

        if (anyEligibility) {
          latestEligibility = anyEligibility;
          console.log(`   ✅ Found eligibility record by member_id: $${latestEligibility.deductible_total || 'N/A'} total, $${latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : 'N/A'} remaining`);

          // Link this eligibility to the current patient if it's not already linked
          if (!latestEligibility.patient_id || latestEligibility.patient_id !== patientId) {
            try {
              db.db.prepare(`
                UPDATE eligibility_checks 
                SET patient_id = ?
                WHERE id = ?
              `).run(patientId, latestEligibility.id);
              console.log(`   ✅ Linked eligibility record ${latestEligibility.id} to patient ${patientId}`);
              latestEligibility.patient_id = patientId;
            } catch (updateError) {
              console.warn(`   ⚠️  Could not link eligibility record: ${updateError.message}`);
            }
          }
        }
      }
    }

    // Get appointments for this patient
    const appointments = db.getAllAppointments({}).filter(a => a.patient_id === patientId);

    // Build EOB data combining claims, eligibility, and appointments
    const eobServices = [];

    for (const claim of claims) {
      // Parse response data to get detailed breakdown
      let responseData = {};
      try {
        if (claim.response_data) {
          responseData = typeof claim.response_data === 'string'
            ? JSON.parse(claim.response_data)
            : claim.response_data;
        }
      } catch (e) {
        console.warn('Failed to parse claim response_data:', e);
      }

      // Get appointment if linked
      const appointment = claim.appointment_id
        ? appointments.find(a => a.id === claim.appointment_id)
        : null;

      // Calculate EOB fields - Match the approved claim numbers from EOB image
      // Approved claim shows: $1800 billed, $200 allowed, $200 plan paid, $35 copay, $165 deductible, $1600 not covered, $1800 patient owes
      const amountBilled = claim.total_amount || 0;

      // Get allowed amount from eligibility data (REAL DATA, NO STATIC VALUES)
      // Priority: eligibility data > claim data > calculated
      let allowedAmount = 0;
      if (latestEligibility?.allowed_amount && latestEligibility.allowed_amount > 0) {
        // Use actual allowed amount from eligibility check
        allowedAmount = latestEligibility.allowed_amount;
      } else if (responseData.pricing && responseData.pricing.breakdown && responseData.pricing.breakdown.length > 0) {
        // Sum allowed amounts from pricing breakdown
        allowedAmount = responseData.pricing.breakdown.reduce((sum, item) =>
          sum + (parseFloat(item.allowed_amount) || 0), 0
        );
      } else if (responseData.allowed_amount) {
        allowedAmount = parseFloat(responseData.allowed_amount);
      } else if (claim.insurance_amount && claim.insurance_amount > 0) {
        // Use insurance amount from claim
        allowedAmount = claim.insurance_amount;
      } else if (amountBilled > 0) {
        // Calculate based on eligibility coinsurance if available
        // If deductible is met, insurance typically pays 80-90% after deductible
        if (latestEligibility && latestEligibility.deductible_remaining === 0) {
          // Deductible met - insurance pays coinsurance percentage
          const coinsurancePercent = latestEligibility.coinsurance_percent || 80;
          allowedAmount = amountBilled * (coinsurancePercent / 100);
        } else {
          // Deductible not met - use standard in-network rate
          allowedAmount = amountBilled * 0.85; // Standard 85% for in-network
        }
      }

      // Get copay from eligibility data (REAL DATA, NO STATIC VALUES)
      const copay = latestEligibility?.copay_amount || claim.copay_amount || 0;

      // Parse response data for detailed breakdown
      const deductibleApplied = responseData.deductible_applied || 0;
      const coinsuranceApplied = responseData.coinsurance_applied || 0;

      // Calculate plan paid, deductible, and coinsurance from REAL eligibility data
      // NO STATIC VALUES - use actual insurance data
      let planPaid = 0;
      let deductible = 0;
      let coinsurance = 0;

      if (latestEligibility && latestEligibility.eligible && allowedAmount > 0) {
        // Get deductible remaining from eligibility (REAL DATA)
        const deductibleRemaining = latestEligibility.deductible_remaining !== null
          ? latestEligibility.deductible_remaining
          : (latestEligibility.deductible_total || 0);

        // Apply deductible if there's remaining deductible
        if (deductibleRemaining > 0 && allowedAmount > 0) {
          // Deductible applies to allowed amount
          deductible = Math.min(deductibleRemaining, allowedAmount);
        }

        // Calculate amount after deductible
        const amountAfterDeductible = Math.max(0, allowedAmount - deductible);

        // Calculate coinsurance from eligibility data (REAL DATA)
        if (latestEligibility.coinsurance_percent && latestEligibility.coinsurance_percent > 0 && amountAfterDeductible > 0) {
          // Coinsurance is patient's share after deductible
          // If coinsurance is 10%, patient pays 10%, insurance pays 90%
          const patientCoinsuranceShare = (amountAfterDeductible * latestEligibility.coinsurance_percent) / 100;
          coinsurance = patientCoinsuranceShare;
        }

        // Plan paid = allowed amount - deductible - patient coinsurance share
        // OR use insurance_pays from eligibility if available
        if (latestEligibility.insurance_pays && latestEligibility.insurance_pays > 0) {
          planPaid = latestEligibility.insurance_pays;
        } else {
          // Calculate: allowed amount minus deductible minus patient coinsurance
          planPaid = Math.max(0, allowedAmount - deductible - coinsurance);
        }
      } else if (claim.insurance_amount && claim.insurance_amount > 0) {
        // Fallback to claim insurance_amount if eligibility not available
        planPaid = claim.insurance_amount;
      } else if (allowedAmount > 0) {
        // Last resort: use allowed amount as plan paid
        planPaid = allowedAmount;
      }

      // Use parsed values from claim response_data if available (from actual claim processing)
      if (deductibleApplied > 0) deductible = deductibleApplied;
      if (coinsuranceApplied > 0) coinsurance = coinsuranceApplied;

      const otherInsurancePaid = 0; // Usually 0

      // Amount not covered (difference between billed and allowed)
      // For approved claim: $1800 - $200 = $1600
      const amountNotCovered = Math.max(0, amountBilled - allowedAmount);

      // What you owe = Copay + Deductible + Coinsurance + Amount Not Covered
      // This matches the EOB image: $35 + $165 + $0 + $1600 = $1800
      const whatYouOwe = copay + deductible + coinsurance + amountNotCovered;

      // Get service type from CPT code
      const serviceType = claim.service_code
        ? `CPT ${claim.service_code}`
        : (appointment?.appointment_type || 'Mental Health Consultation');

      eobServices.push({
        // A. Date of Service
        date_of_service: appointment?.date || claim.submitted_at?.split('T')[0] || new Date().toISOString().split('T')[0],

        // B. Type of Service
        type_of_service: serviceType,

        // C. Amount Billed
        amount_billed: amountBilled,

        // D. Allowed Amount
        allowed_amount: allowedAmount,

        // E. Your Plan Paid
        plan_paid: planPaid,

        // F. Your Other Insurance Paid
        other_insurance_paid: otherInsurancePaid,

        // G. Copay
        copay: copay,

        // H. Coinsurance
        coinsurance: coinsurance,

        // I. Deductible
        deductible: deductible,

        // J. Amount Not Covered
        amount_not_covered: amountNotCovered,

        // K. What You Owe
        what_you_owe: whatYouOwe,

        // L. Claim Detail
        claim_detail: responseData.claim_detail_codes || [claim.status?.toUpperCase() || 'PENDING'],

        // Additional info
        claim_id: claim.id,
        x12_claim_id: claim.x12_claim_id,
        status: claim.status,
        diagnosis_code: claim.diagnosis_code,
        service_code: claim.service_code
      });
    }

    // Calculate totals
    const totals = {
      amount_billed: eobServices.reduce((sum, s) => sum + s.amount_billed, 0),
      allowed_amount: eobServices.reduce((sum, s) => sum + s.allowed_amount, 0),
      plan_paid: eobServices.reduce((sum, s) => sum + s.plan_paid, 0),
      other_insurance_paid: eobServices.reduce((sum, s) => sum + s.other_insurance_paid, 0),
      copay: eobServices.reduce((sum, s) => sum + s.copay, 0),
      coinsurance: eobServices.reduce((sum, s) => sum + s.coinsurance, 0),
      deductible: eobServices.reduce((sum, s) => sum + s.deductible, 0),
      amount_not_covered: eobServices.reduce((sum, s) => sum + s.amount_not_covered, 0),
      what_you_owe: eobServices.reduce((sum, s) => sum + s.what_you_owe, 0)
    };

    return res.json({
      success: true,
      patient: {
        id: patientId,
        name: patientName,
        subscriber_id: latestEligibility?.member_id || 'N/A',
        group_number: null,
        payer: latestEligibility?.payer_id || 'N/A'
      },
      eligibility: latestEligibility ? {
        plan_summary: latestEligibility.plan_summary || 'N/A',
        deductible_total: latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined ? latestEligibility.deductible_total : null,
        deductible_remaining: latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : null,
        coinsurance_percent: latestEligibility.coinsurance_percent !== null && latestEligibility.coinsurance_percent !== undefined ? latestEligibility.coinsurance_percent : null,
        copay_amount: latestEligibility.copay_amount !== null && latestEligibility.copay_amount !== undefined ? latestEligibility.copay_amount : null,
        allowed_amount: latestEligibility.allowed_amount !== null && latestEligibility.allowed_amount !== undefined ? latestEligibility.allowed_amount : null,
        insurance_pays: latestEligibility.insurance_pays !== null && latestEligibility.insurance_pays !== undefined ? latestEligibility.insurance_pays : null,
        eligible: latestEligibility.eligible === 1 || latestEligibility.eligible === true
      } : null,
      services: eobServices,
      totals: totals,
      claim_count: eobServices.length
    });
  } catch (error) {
    console.error('❌ Error fetching EOB data:', error);
    console.error('Error stack:', error.stack);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

app.get('/api/admin/billing/eob', async (req, res) => {
  try {
    const patients = db.db.prepare('SELECT resource_id, name, phone, email FROM fhir_patients').all();

    const billingData = await Promise.all(patients.map(async (patient) => {
      try {
        // Get claims for this patient
        const claims = db.getClaimsByPatient(patient.resource_id) || [];
        const eligibility = db.getEligibilityChecksByPatient(patient.resource_id) || [];
        const latestEligibility = eligibility[0] || null;

        // Calculate totals
        const totalBilled = claims.reduce((sum, c) => sum + (c.total_amount || 0), 0);
        const totalPaid = claims.reduce((sum, c) => sum + (c.insurance_amount || 0), 0);
        const totalOwed = claims.reduce((sum, c) => {
          const copay = c.copay_amount || 0;
          return sum + copay;
        }, 0);

        return {
          patient_id: patient.resource_id,
          patient_name: patient.name || 'Unknown',
          patient_phone: patient.phone || null,
          patient_email: patient.email || null,
          payer: latestEligibility?.payer_id || null,
          member_id: latestEligibility?.member_id || null,
          claim_count: claims.length,
          total_billed: totalBilled,
          total_paid: totalPaid,
          total_owed: totalOwed,
          latest_claim_date: claims[0]?.submitted_at || null
        };
      } catch (error) {
        console.error(`Error processing patient ${patient.resource_id}:`, error);
        return null;
      }
    }));

    const filtered = billingData.filter(p => p !== null);

    return res.json({
      success: true,
      patients: filtered,
      count: filtered.length
    });
  } catch (error) {
    console.error('❌ Error fetching billing EOB list:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/insurance/cache/refresh', async (req, res) => {
  try {
    const search = req.query.search || null;
    const limit = parseInt(req.query.limit) || 200;

    if (search) {
      // Force fetch from Stedi and cache
      const result = await InsuranceService.fetchPayers({ search, limit });
      if (result.success && result.payers?.length) {
        // Cache via PayerCacheService by re-searching (it will cache)
        await PayerCacheService.searchPayer(search);
      }
      return res.json({ success: result.success, cached: result.count || 0 });
    }

    // Bulk sync
    const sync = await PayerCacheService.syncPayerList(limit);
    return res.json(sync);
  } catch (error) {
    console.error('❌ Error refreshing payer cache:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/appointments/:id/clinical-prep', async (req, res) => {
  try {
    const appointmentId = String(req.params.id || '').trim();
    if (!appointmentId) return res.status(400).json({ success: false, error: 'appointment id required' });

    const appt = db.getAppointment ? await db.getAppointment(appointmentId) : null;
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found' });

    let caseSummaryRow = null;
    let caseSummary = null;
    try {
      caseSummaryRow = db.db.prepare('SELECT * FROM case_summaries WHERE appointment_id = ? LIMIT 1').get(appointmentId);
      if (caseSummaryRow?.summary_json) {
        caseSummary = typeof caseSummaryRow.summary_json === 'string'
          ? JSON.parse(caseSummaryRow.summary_json)
          : caseSummaryRow.summary_json;
      }
    } catch (_) {}

    const { resolveTriageSessionIdForAppointment } = require('../services/clinical-prep-session-resolve');
    const triageSessionId =
      caseSummaryRow?.session_id || resolveTriageSessionIdForAppointment(appointmentId, appt);
    const triage = triageSessionId && db.getTriageSession ? db.getTriageSession(triageSessionId) : null;
    const triageMedia = triageSessionId && db.getTriageMediaForSession ? (db.getTriageMediaForSession(triageSessionId) || []) : [];
    const phiAllowed = _canViewClinicalPhi(req);

    const documentItems = triageMedia.map(m => {
      const type = (m.mime_type || '').startsWith('image/') ? 'image' : (m.media_type || 'document');
      const detailUrl = m.storage_url || `/api/media/${encodeURIComponent(m.id)}`;
      const aiSummary = (() => {
        try {
          return (typeof m.ai_analysis === 'string' ? JSON.parse(m.ai_analysis) : m.ai_analysis)?.summary || null;
        } catch (_) {
          return null;
        }
      })();
      return {
        id: m.id,
        title: m.file_name || m.context_note || '',
        type,
        detail_url: detailUrl,
        ai_summary: aiSummary
      };
    });

    const categoryCounts = documentItems.reduce((acc, d) => {
      const k = String(d.type || 'document').toLowerCase();
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    const prep = {
      appointment: {
        id: appt.id,
        status: appt.status,
        appointment_type: appt.appointment_type,
        provider: appt.provider || null,
        date: appt.date,
        time: appt.time,
        timezone: appt.timezone || 'America/New_York',
        patient_id: appt.patient_id || null,
        patient_name: phiAllowed ? (appt.patient_name || '') : ((appt.patient_name || '').split(' ').map(n => n.slice(0, 1).toUpperCase()).join('') || 'N/A'),
        patient_phone: phiAllowed ? (appt.patient_phone || '') : _maskPhone(appt.patient_phone),
        patient_email: phiAllowed ? (appt.patient_email || '') : _maskEmail(appt.patient_email)
      },
      phi_allowed: phiAllowed,
      case_summary: caseSummary ? {
        chief_complaint: caseSummary.chief_complaint || '',
        target_specialty: caseSummary.target_specialty || null,
        urgency: caseSummary.urgency || null,
        safety_level: caseSummary.safety_level || null,
        red_flags: (() => {
          const out = [];
          if ((caseSummary.safety_level || '').toLowerCase() === 'high') out.push('high_safety_level');
          if ((caseSummary.urgency || '').toLowerCase() === 'emergency') out.push('emergency_urgency');
          if (String(caseSummary.soap_note || '').toLowerCase().includes('chest pain')) out.push('chest_pain_mentioned');
          if (String(caseSummary.soap_note || '').toLowerCase().includes('shortness of breath')) out.push('shortness_of_breath_mentioned');
          return out;
        })(),
        soap_note: caseSummary.soap_note || '',
        key_problems: (() => {
          const v = caseSummary?.opqrst?.associated_sx;
          if (Array.isArray(v)) return v.slice(0, 8);
          if (typeof v === 'string' && v.trim()) return v.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).slice(0, 8);
          return [];
        })()
      } : null,
      triage_session: triage ? {
        session_id: triageSessionId,
        onset: triage.onset,
        provocation: triage.provocation,
        quality: triage.quality,
        radiation: triage.radiation,
        severity: triage.severity,
        timing: triage.timing,
        associated_sx: triage.associated_sx,
        medications: triage.medications,
        allergies: triage.allergies,
        prior_diagnoses: triage.prior_diagnoses,
        prior_workups: triage.prior_workups,
        family_history: triage.family_history,
        alcohol_use: triage.alcohol_use,
        smoking_status: triage.smoking_status,
        phq2_score: triage.phq2_score,
        gad2_score: triage.gad2_score,
        safety_screen: triage.safety_screen,
        soap_note: triage.soap_note,
        target_specialty: triage.target_specialty,
        urgency: triage.urgency,
        safety_level: triage.safety_level,
        red_flags: (() => {
          const out = [];
          if ((triage.safety_level || '').toLowerCase() === 'high') out.push('high_safety_level');
          if ((triage.urgency || '').toLowerCase() === 'emergency') out.push('emergency_urgency');
          if (triage.referred_to_911) out.push('referred_to_911');
          if (String(triage.safety_screen || '').toLowerCase().includes('suic')) out.push('suicidality_screen_positive');
          return out;
        })()
      } : null,
      documents: {
        triage_session_id: triageSessionId,
        count: documentItems.length,
        categories: categoryCounts,
        items: documentItems
      },
      activity: {
        has_case_summary: !!caseSummary,
        summary_ready_at: caseSummaryRow?.created_at || null,
        triage_linked: !!triageSessionId
      },
      section_status: {
        case_summary: caseSummary ? { ready: true, error: null } : { ready: false, error: 'No case summary linked yet.' },
        triage: triage ? { ready: true, error: null } : { ready: false, error: 'No triage session linked yet.' },
        documents: documentItems.length > 0
          ? { ready: true, count: documentItems.length, error: null }
          : { ready: false, count: 0, error: 'No triage-linked documents yet.' },
        ehr: { ready: false, error: 'Use EHR tab to load synced chart data.' }
      }
    };

    try {
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'staff',
        actor_id: req?.user?.sub || req?.providerId || req?.headers?.['x-provider-id'] || 'unknown',
        patient_id: appt.patient_id || null,
        resource_type: 'appointment',
        resource_id: appointmentId,
        action: 'clinical_prep_read',
        metadata: { phi_allowed: phiAllowed, triage_session_id: triageSessionId, doc_count: triageMedia.length }
      });
    } catch (_) {}

    return res.json({ success: true, prep });
  } catch (error) {
    console.error('❌ Error fetching clinical prep payload:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/appointments', async (req, res) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7741/ingest/60c91aef-af1c-44d6-9853-4dc7e0e1d879',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'965a10'},body:JSON.stringify({sessionId:'965a10',location:'admin-platform.js:appointments',message:'GET /api/admin/appointments',data:{hasResolver:typeof resolveClinicIdFromRequest,date:req.query.date},timestamp:Date.now(),hypothesisId:'A',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    let clinicId = resolveClinicIdFromRequest(req);
    if (!clinicId && db.db) {
      try {
        const firstClinic = db.db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
        clinicId = firstClinic?.clinic_id || null;
      } catch (_) { /* clinics table may not exist */ }
    }
    // Support both start_date/end_date (YYYY-MM-DD) and start/end (ISO timestamps)
    let startDate = req.query.start_date;
    let endDate = req.query.end_date;
    if (req.query.start && !startDate) {
      const m = String(req.query.start).match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) startDate = m[1];
    }
    if (req.query.end && !endDate) {
      const m = String(req.query.end).match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) endDate = m[1];
    }
    const filters = {
      status: req.query.status,
      date: req.query.date,
      start_date: startDate,
      end_date: endDate,
      provider: req.query.provider,
      clinic_id: clinicId || undefined
    };

    const appointments = db.getAllAppointments(filters);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      success: true,
      appointments,
      count: appointments.length
    });
  } catch (error) {
    console.error('❌ Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/appointments/upcoming', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    let clinicId = resolveClinicIdFromRequest(req);
    if (!clinicId && db.db) {
      try {
        const firstClinic = db.db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
        clinicId = firstClinic?.clinic_id || null;
      } catch (_) { /* clinics table may not exist */ }
    }
    const appointments = db.getUpcomingAppointments(limit, clinicId || null);

    res.json({
      success: true,
      appointments,
      count: appointments.length
    });
  } catch (error) {
    console.error('❌ Error fetching upcoming appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/appointments/:id/todos', async (req, res) => {
  try {
    ensureAppointmentTodosTable();
    const apptId = String(req.params.id || '').trim();
    if (!apptId) return res.status(400).json({ success: false, error: 'Missing appointment id' });
    const rows = db.db.prepare(`
      SELECT id, content, completed, created_at, updated_at
      FROM appointment_todos
      WHERE appointment_id = ?
      ORDER BY created_at ASC
    `).all(apptId);
    return res.json({
      success: true,
      todos: (rows || []).map(r => ({
        id: r.id,
        content: r.content,
        completed: !!r.completed,
        created_at: r.created_at,
        updated_at: r.updated_at
      }))
    });
  } catch (error) {
    console.error('❌ Error reading appointment todos:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/appointments/:id/todos', async (req, res) => {
  try {
    ensureAppointmentTodosTable();
    const apptId = String(req.params.id || '').trim();
    if (!apptId) return res.status(400).json({ success: false, error: 'Missing appointment id' });
    const inputTodos = Array.isArray(req.body?.todos) ? req.body.todos : null;
    if (!inputTodos) {
      return res.status(400).json({ success: false, error: 'Body must include todos[]' });
    }
    const cleaned = inputTodos
      .map(t => ({
        id: String(t?.id || '').trim(),
        content: String(t?.content || '').trim(),
        completed: !!t?.completed
      }))
      .filter(t => t.id && t.content);

    const delStmt = db.db.prepare(`DELETE FROM appointment_todos WHERE appointment_id = ?`);
    const insStmt = db.db.prepare(`
      INSERT INTO appointment_todos (id, appointment_id, content, completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const tx = db.db.transaction((rows) => {
      delStmt.run(apptId);
      for (const t of rows) insStmt.run(t.id, apptId, t.content, t.completed ? 1 : 0);
    });
    tx(cleaned);
    return res.json({ success: true, count: cleaned.length });
  } catch (error) {
    console.error('❌ Error saving appointment todos:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/patients/search', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.name || '').trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10) || 10, 50));
    if (q.length < 2) {
      return res.json({ success: true, patients: [] });
    }
    const pattern = `%${q.toLowerCase()}%`;
    const fetchCap = Math.min(Math.max(limit * 12, 48), 300);
    const rawRows = db.db.prepare(`
      SELECT
        patient_name AS name,
        patient_phone AS phone,
        patient_email AS email,
        datetime(COALESCE(start_time, created_at)) AS last_seen_at
      FROM appointments
      WHERE deleted_at IS NULL
        AND patient_name IS NOT NULL
        AND (
          LOWER(COALESCE(patient_name, '')) LIKE ?
          OR LOWER(COALESCE(patient_phone, '')) LIKE ?
          OR LOWER(COALESCE(patient_email, '')) LIKE ?
        )
      ORDER BY datetime(COALESCE(start_time, created_at)) DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, fetchCap);

    const {
      adminPatientSearchDedupeKey,
      formatE164Prefer,
      normalizePatientName,
      normalizeEmail
    } = require('./services/patient-contact-canonical');

    const seen = new Set();
    const patients = [];
    for (const row of rawRows || []) {
      const key = adminPatientSearchDedupeKey(row.name, row.phone, row.email);
      if (seen.has(key)) continue;
      seen.add(key);
      const emailNorm = normalizeEmail(row.email);
      patients.push({
        name: normalizePatientName(row.name),
        phone: row.phone ? formatE164Prefer(row.phone) : row.phone,
        email: emailNorm || row.email || null,
        last_seen_at: row.last_seen_at
      });
      if (patients.length >= limit) break;
    }
    return res.json({ success: true, patients });
  } catch (error) {
    console.error('❌ Error searching patients for admin create-appointment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/patients/:id/external-ids', async (req, res) => {
  try {
    const patientId = String(req.params.id || '').trim();
    if (!patientId) return res.status(400).json({ success: false, error: 'Missing patient id' });
    const rows = db.getPatientExternalIds(patientId);
    return res.json({ success: true, external_ids: rows || [] });
  } catch (error) {
    console.error('❌ Error fetching patient external IDs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/patients/:id/external-ids', async (req, res) => {
  try {
    const patientId = String(req.params.id || '').trim();
    if (!patientId) return res.status(400).json({ success: false, error: 'Missing patient id' });
    const {
      source_system,
      tenant_id,
      external_patient_id,
      mrn = null,
      status = 'active',
      metadata_json = null
    } = req.body || {};
    const row = db.upsertPatientExternalId({
      patient_id: patientId,
      source_system,
      tenant_id,
      external_patient_id,
      mrn,
      status,
      metadata_json
    });
    return res.json({ success: true, external_id: row });
  } catch (error) {
    console.error('❌ Error upserting patient external ID:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/appointments/create', async (req, res) => {
  try {
    const {
      patient_name,
      patient_phone,
      patient_email,
      appointment_type,
      date,
      time,
      provider,
      notes,
      timezone,
      clinic_id,
      customer_id
    } = req.body;

    if (!patient_name || !patient_phone || !date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: patient_name, patient_phone, date, and time are required'
      });
    }

    let clinicId = clinic_id || resolveClinicIdFromRequest(req);
    if (!clinicId && db.db) {
      try {
        const firstClinic = db.db.prepare('SELECT clinic_id FROM clinics LIMIT 1').get();
        clinicId = firstClinic?.clinic_id || null;
        if (!clinicId) {
          clinicId = 'clinic-default';
          try {
            await db.createClinic({
              clinic_id: clinicId,
              name: 'Default Clinic',
              slug: 'default',
              phone_number: process.env.DEFAULT_CLINIC_PHONE || '+15550000000',
              email: process.env.DEFAULT_CLINIC_EMAIL || 'clinic@callsomo.com'
            });
          } catch (e) {
            if (!e.message?.includes('UNIQUE') && !e.message?.includes('duplicate')) throw e;
            /* clinic already exists */
          }
        }
      } catch (_) { /* clinics table may not exist */ }
    }
    if (!clinicId) {
      return res.status(400).json({
        success: false,
        error: 'clinic_id is required. Set DEFAULT_CLINIC_ID in .env or add a clinic in Admin.'
      });
    }

    const result = await BookingService.createFutureAppointment({
      patient_name,
      patient_phone,
      patient_email,
      appointment_type: appointment_type || 'Mental Health Consultation',
      date,
      time,
      provider: provider || 'Skin & Care Mental Health Team',
      notes: notes || '',
      timezone: timezone || 'America/New_York',
      clinic_id: clinicId,
      customer_id: customer_id || null
    });

    // Lifecycle trigger: queue outbound EHR sync (best-effort, non-blocking).
    try {
      const createdApptId = result?.appointment?.id;
      if (createdApptId) {
        const apptRow = await db.getAppointment(createdApptId);
        if (apptRow?.patient_id) {
          db.enqueueEhrSyncJob({
            event_type: 'appointment_created',
            patient_id: apptRow.patient_id,
            appointment_id: createdApptId,
            source_system: 'athena',
            tenant_id: apptRow.clinic_id || 'clinic-default',
            idempotency_key: `appointment_created:${createdApptId}`,
            payload_json: {
              appointment_id: createdApptId,
              patient_name: apptRow.patient_name || null,
              date: apptRow.date || null,
              time: apptRow.time || null
            }
          });
        }
      }
    } catch (e) {
      console.warn('⚠️  Could not enqueue EHR sync job (appointment_created):', e.message);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error creating appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/appointments/:id/send-video-link', async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    const phone = appointment.patient_phone;
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'Patient has no phone number on file' });
    }
    const baseUrl = process.env.DASHBOARD_BASE_URL || process.env.BASE_URL || process.env.API_BASE_URL || `https://${req.headers.host || 'callsomo.com'}`;
    const roomName = appointment.video_room_name || `appt-${appointmentId}`;
    const videoUrl = `${baseUrl.replace(/\/$/, '')}/patients/video-call.html?room=${encodeURIComponent(roomName)}`;
    const message = `Your telehealth video visit: ${videoUrl}\n\nClick to join when it\'s time for your appointment.`;
    const result = await SMSService.sendSMS(phone, message);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || 'Failed to send SMS' });
    }
    res.json({ success: true, message: 'Video link sent via SMS' });
  } catch (error) {
    console.error('❌ Send video link error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/patient-sessions/revoke', async (req, res) => {
  try {
    const { email, patient_id } = req.body || {};
    if (!email && !patient_id) {
      return res.status(400).json({ success: false, error: 'email or patient_id required' });
    }
    if (email) {
      db.revokePatientSessionsByEmail && db.revokePatientSessionsByEmail(email);
    }
    if (patient_id) {
      db.revokePatientSessionsByPatientId && db.revokePatientSessionsByPatientId(patient_id);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Error revoking patient sessions:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to revoke sessions' });
  }
});

app.get('/api/admin/billing', async (req, res) => {
  try {
    const appointments = db.getAllAppointments({});

    // Helper: start of current ISO week (Monday)
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day; // adjust so Monday is start
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const byPatient = new Map();

    appointments.forEach(appt => {
      const key = appt.patient_id || appt.patient_phone || appt.patient_email || appt.patient_name;
      if (!key) return;

      if (!byPatient.has(key)) {
        byPatient.set(key, {
          patient_id: appt.patient_id || null,
          patient_name: appt.patient_name || 'Unknown',
          patient_phone: appt.patient_phone || null,
          patient_email: appt.patient_email || null,
          total_appointments: 0,
          confirmed_appointments: 0,
          cancelled_appointments: 0,
          week_appointments: 0,
          total_amount: 0,
          week_amount: 0,
          last_appointment_at: null
        });
      }

      const record = byPatient.get(key);
      record.total_appointments += 1;
      if (appt.status === 'confirmed') record.confirmed_appointments += 1;
      if (appt.status === 'cancelled') record.cancelled_appointments += 1;

      // Determine appointment start date for week calc
      const startIso = appt.start_time || (appt.date ? `${appt.date}T${(appt.time || '00:00')}:00` : null);
      const apptDate = startIso ? new Date(startIso) : null;
      if (apptDate && apptDate >= monday) {
        record.week_appointments += 1;
      }

      // Estimated billed amount using visit_pricing (falls back to defaults if missing)
      const { DEFAULT_FALLBACK } = require('./config/pricing-fallbacks');
      const price = db.getEffectiveVisitPrice(appt.clinic_id || null, appt.appointment_type || 'General Consult')?.effective_price ?? DEFAULT_FALLBACK;
      record.total_amount = Number((record.total_amount + price).toFixed(2));
      if (apptDate && apptDate >= monday) {
        record.week_amount = Number((record.week_amount + price).toFixed(2));
      }

      if (!record.last_appointment_at || (apptDate && apptDate > new Date(record.last_appointment_at))) {
        record.last_appointment_at = apptDate ? apptDate.toISOString() : record.last_appointment_at;
      }
    });

    const results = Array.from(byPatient.values()).sort((a, b) => (b.last_appointment_at || '').localeCompare(a.last_appointment_at || ''));

    res.json({
      success: true,
      pricing_source: 'visit_pricing',
      patients: results,
      count: results.length
    });
  } catch (error) {
    console.error('❌ Error building billing summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/patient-portal/sessions', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const rows = db.db.prepare(`
      SELECT id, email, patient_id, verified, verified_at, expires_at, last_seen_at, created_at, ip_address
      FROM patient_portal_sessions
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, sessions: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/patient-portal/appointments', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const rows = db.db.prepare(`
      SELECT id, clinic_id, patient_email, patient_phone, patient_id, status, payment_status, start_time, end_time, created_at, updated_at
      FROM appointments
      ORDER BY datetime(start_time) DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, appointments: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/patient-portal/payments', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const checkouts = db.db.prepare(`
      SELECT id, appointment_id, customer_email, customer_phone, amount, payment_method, status, payment_intent_id, created_at, completed_at
      FROM voice_checkouts
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    const receipts = db.db.prepare(`
      SELECT id, checkout_id, appointment_id, patient_email, amount, currency, status, issued_at, created_at
      FROM payment_receipts
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, checkouts, receipts });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/ops/summary', apiLimiter, requireAdminAuth, async (req, res) => {
  try {
    const notif = db.getNotificationQueueStats ? db.getNotificationQueueStats() : { success: true, by_status: {} };
    const dead = db.listDeadNotificationJobs ? db.listDeadNotificationJobs(50) : [];
    const counters = db.getOpsCounters ? db.getOpsCounters(24) : [];
    return res.json({
      success: true,
      notification_queue: notif.success ? notif.by_status : {},
      notification_dead_letter: dead,
      ops_counters_24h: counters
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/ehr/connections', async (req, res) => {
  try {
    const { provider_id } = req.query;
    const connections = provider_id
      ? db.getEHRConnectionsByProvider(provider_id)
      : db.getActiveEHRConnections();

    res.json({
      success: true,
      connections: connections.map(conn => ({
        id: conn.id,
        ehr_name: conn.ehr_name,
        provider_id: conn.provider_id,
        connected_at: conn.connected_at,
        expires_at: conn.expires_at
      }))
    });
  } catch (error) {
    console.error('Error fetching EHR connections:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/ehr/sync-jobs', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '50', 10) || 50, 200));
    const rows = status
      ? db.db.prepare(`
          SELECT * FROM ehr_sync_jobs
          WHERE status = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(status, limit)
      : db.db.prepare(`
          SELECT * FROM ehr_sync_jobs
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit);
    res.json({ success: true, jobs: rows || [] });
  } catch (error) {
    console.error('Error fetching EHR sync jobs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/appointments/:id/ehr-summary', async (req, res) => {
  try {
    const { id } = req.params;
    const summary = db.getEHRSummaryForAppointment(id);

    if (!summary) {
      return res.json({
        success: true,
        synced: false,
        message: 'No EHR data found for this appointment'
      });
    }

    res.json({
      success: true,
      synced: true,
      encounter: {
        id: summary.encounter.id,
        start_time: summary.encounter.start_time,
        end_time: summary.encounter.end_time,
        status: summary.encounter.status
      },
      conditions: summary.conditions.map(c => ({
        icd10_code: c.icd10_code,
        description: c.description,
        is_primary: c.is_primary === 1
      })),
      procedures: summary.procedures.map(p => ({
        cpt_code: p.cpt_code,
        modifier: p.modifier,
        description: p.description
      })),
      observations: summary.observations.map(o => ({
        type: o.type,
        value: o.value,
        unit: o.unit
      }))
    });
  } catch (error) {
    console.error('Error fetching EHR summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/admin/patients/:id/ehr-summary', async (req, res) => {
  try {
    const { id } = req.params;

    // Get FHIR patient ID from resource_id
    const fhirPatient = db.getFHIRPatient(id);
    if (!fhirPatient) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    const summaries = db.getEHRSummaryForPatient(fhirPatient.resource_id);

    res.json({
      success: true,
      patient_id: id,
      encounters: summaries.map(summary => ({
        encounter: {
          id: summary.encounter.id,
          start_time: summary.encounter.start_time,
          end_time: summary.encounter.end_time,
          status: summary.encounter.status
        },
        conditions: summary.conditions.map(c => ({
          icd10_code: c.icd10_code,
          description: c.description,
          is_primary: c.is_primary === 1
        })),
        procedures: summary.procedures.map(p => ({
          cpt_code: p.cpt_code,
          modifier: p.modifier,
          description: p.description
        })),
        observations: summary.observations.map(o => ({
          type: o.type,
          value: o.value,
          unit: o.unit
        }))
      }))
    });
  } catch (error) {
    console.error('Error fetching patient EHR summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
}

module.exports = { registerAdminPlatformRoutes };
