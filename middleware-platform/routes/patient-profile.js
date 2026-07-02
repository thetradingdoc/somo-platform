'use strict';

function registerPatientProfileRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    PatientPortalService,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    withIdempotency,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
    requireAdminAuth,
    sendUploadLinkHandler,
    issuePatientDocumentDownloadUrl,
    parseBillingDocumentUpload,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
  } = deps;

app.get('/api/patient/support-config', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    // Resolve patient -> clinic_id (best effort)
    let clinicId = null;
    try {
      if (sessionValidation.patient_id && db.getPatientClinicIds) {
        const ids = db.getPatientClinicIds(sessionValidation.patient_id);
        clinicId = (ids && ids[0]) || null;
      }
    } catch (_) {}

    const fromDb = (k) => {
      try {
        if (!clinicId) return null;
        const row = db.db.prepare(`SELECT value FROM clinic_settings WHERE clinic_id = ? AND key = ? LIMIT 1`).get(clinicId, k);
        return row ? row.value : null;
      } catch (_) { return null; }
    };

    const phone = fromDb('support_phone') || process.env.CLINIC_SUPPORT_PHONE || '';
    const email = fromDb('support_email') || process.env.CLINIC_SUPPORT_EMAIL || '';
    const hours = fromDb('support_hours') || process.env.CLINIC_SUPPORT_HOURS || '';

    const { getClinicBusinessHours } = require('./config/clinic-business-hours');
    const clinicHours = clinicId ? getClinicBusinessHours(clinicId) : null;
    const timezone = clinicHours?.timezone || process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York';

    const slotHoldTtl = parseInt(process.env.APPOINTMENT_PAYMENT_TTL_MINUTES || '30', 10);

    return res.json({
      success: true,
      clinic_id: clinicId,
      support: { phone, email, hours },
      timezone,
      slot_hold_ttl_minutes: Math.max(10, Math.min(60, slotHoldTtl))
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/me', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const patientId = sessionValidation.patient_id || null;

    // Resolve FHIR Patient (best effort)
    let patientRow = null;
    try {
      if (patientId && db.getFHIRPatient) patientRow = db.getFHIRPatient(patientId);
      if (!patientRow && sessionValidation.email && db.getFHIRPatientByEmail) patientRow = db.getFHIRPatientByEmail(sessionValidation.email);
      if (!patientRow && sessionValidation.phone && db.getFHIRPatientByPhone) patientRow = db.getFHIRPatientByPhone(sessionValidation.phone);
    } catch (_) {}

    let displayName = 'Patient';
    let resolvedId = patientRow?.resource_id || patientId || null;
    let canonicalIntake = null;
    let onboarding = { onboarding_complete: false, missing_fields: ['first_name', 'last_name', 'dob', 'phone', 'country', 'city'] };
    try {
      const r = patientRow?.resource_data
        ? (typeof patientRow.resource_data === 'string' ? JSON.parse(patientRow.resource_data) : patientRow.resource_data)
        : null;
      if (r && r.name && r.name[0]) {
        const given = Array.isArray(r.name[0].given) ? r.name[0].given.join(' ') : (r.name[0].given || '');
        const family = r.name[0].family || '';
        const nm = `${given} ${family}`.trim();
        if (nm) displayName = nm;
      } else if (patientRow?.name) {
        displayName = patientRow.name;
      }
      if (r && PatientIntakeService && PatientIntakeService.canonicalFromPatientResource) {
        canonicalIntake = PatientIntakeService.canonicalFromPatientResource(r);
        onboarding = PatientIntakeService.onboardingStatusFromCanonical(canonicalIntake);
      }
    } catch (_) {}

    return res.json({
      success: true,
      patient: {
        id: resolvedId,
        name: displayName
      },
      onboarding: onboarding,
      intake: canonicalIntake
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/intake', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId, patientRow } = resolvePatientIdFromSession(sessionValidation);
    const resource = patientRow?.resource_data
      ? (typeof patientRow.resource_data === 'string' ? JSON.parse(patientRow.resource_data) : patientRow.resource_data)
      : null;
    const canonical = resource && PatientIntakeService.canonicalFromPatientResource
      ? PatientIntakeService.canonicalFromPatientResource(resource)
      : {
        first_name: '',
        last_name: '',
        dob: '',
        phone: '',
        email: (sessionValidation?.email || '').toString(),
        country: '',
        city: '',
        address_line1: '',
        postal_code: '',
        city_place_id: ''
      };
    const status = PatientIntakeService.onboardingStatusFromCanonical(canonical);
    const step3 = getPatientStep3Status({ sessionId: req.patientSessionId, patientId: patientId || null });
    const onboarding_complete = !!status.onboarding_complete && !!step3.completed;
    return res.json({
      success: true,
      patient_id: patientId || null,
      intake: canonical,
      ...status,
      onboarding_complete,
      onboarding_profile_complete: !!status.onboarding_complete,
      onboarding_step3_complete: !!step3.completed,
      onboarding_step3_reason: step3.reason || null
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/patient/intake', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const payload = req.body && typeof req.body === 'object' ? req.body : {};

    const patientId = await PatientIntakeService.resolveOrCreatePatientIdFromSession(sessionValidation, payload);
    if (!patientId) {
      return res.status(500).json({ success: false, error: 'Unable to resolve or create patient record' });
    }

    const result = await PatientIntakeService.upsertIntakeByPatientId(patientId, payload);
    if (!result.success) return res.status(400).json(result);

    // Persist patient_id onto the portal session row for faster resolution later
    try {
      db.db.prepare(`
        UPDATE patient_portal_sessions
        SET patient_id = COALESCE(patient_id, ?)
        WHERE id = ?
      `).run(patientId, req.patientSessionId);
    } catch (_) {}

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/identity', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId, patientRow } = resolvePatientIdFromSession(sessionValidation);
    const resource = patientRow?.resource_data
      ? (typeof patientRow.resource_data === 'string' ? JSON.parse(patientRow.resource_data) : patientRow.resource_data)
      : null;
    const canonical = resource && PatientIntakeService.canonicalFromPatientResource
      ? PatientIntakeService.canonicalFromPatientResource(resource)
      : {
        first_name: '',
        last_name: '',
        dob: '',
        phone: (sessionValidation?.phone || '').toString(),
        email: (sessionValidation?.email || '').toString(),
        country: '',
        city: '',
        address_line1: '',
        postal_code: '',
        city_place_id: ''
      };
    const canConnect = PatientIntakeService.canConnectRecordsFromIntake
      ? PatientIntakeService.canConnectRecordsFromIntake(canonical)
      : false;
    return res.json({
      success: true,
      patient_id: patientId || null,
      identity: canonical,
      can_connect_records: !!canConnect
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/features', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  let portalMode = 'full';
  let officeType = null;
  try {
    const sessionValidation = req.patientSession;
    let clinicId = null;
    if (sessionValidation.patient_id && db.getPatientClinicIds) {
      const ids = db.getPatientClinicIds(sessionValidation.patient_id);
      clinicId = (ids && ids[0]) || null;
    }
    if (clinicId && db.getClinicById) {
      const clinic = db.getClinicById(clinicId);
      officeType = clinic?.office_type || null;
      if (String(officeType || '').toLowerCase() === 'dental') {
        portalMode = 'dental_pay_only';
      }
    }
  } catch (_) {}

  return res.json({
    success: true,
    features: {
      wallet_enabled: isPatientWalletEnabled(),
      chat_enabled: isPatientChatEnabled(),
      portal_mode: portalMode,
      office_type: officeType,
      schedule_enabled: portalMode !== 'dental_pay_only',
      triage_enabled: portalMode !== 'dental_pay_only'
    }
  });
});

app.post('/api/patient/analytics/event', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const event = String(body.event || '').trim();
    const allowedClient = new Set([
      'home_summary_viewed',
      'billing_first_scan_started',
      'billing_review_completed',
      'billing_event_tracked',
      'billing_upgrade_prompt_shown'
    ]);
    if (!allowedClient.has(event)) {
      return res.status(400).json({ success: false, error_code: 'INVALID_EVENT', error: 'Unsupported analytics event.' });
    }
    let metadata = body.metadata;
    if (metadata != null && typeof metadata !== 'object') metadata = {};
    recordPatientPortalEvent(req, event, metadata || {});
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/health/catalog', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    const hasProductsCatalog = dbTableExists('products_catalog');
    const hasObf = dbTableExists('products_obf_index');
    const hasOff = dbTableExists('products_off_index');
    const catalog_ok = Boolean(hasProductsCatalog || hasObf || hasOff);
    return res.json({
      success: true,
      catalog_ok,
      indexes: {
        products_catalog: hasProductsCatalog,
        products_obf_index: hasObf,
        products_off_index: hasOff
      },
      message: catalog_ok
        ? null
        : 'Product lookup indexes are not available on this server. Barcode and name search may be limited until indexes are installed.'
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/documents/export', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) patient = db.getFHIRPatient(sessionValidation.patient_id);
    if (!patient && sessionValidation.email) patient = db.getFHIRPatientByEmail(sessionValidation.email);
    if (!patient && sessionValidation.phone) patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    const patientId = patient ? patient.resource_id : sessionValidation.patient_id;
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found' });

    const docs = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];
    const base = `${req.protocol}://${req.get('host')}`;
    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);

    const exported = [];
    for (const d of docs) {
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
      db.createPatientDocumentDownloadToken && db.createPatientDocumentDownloadToken({
        token,
        doc_id: d.id,
        patient_id: patientId,
        expires_at: expiresAtIso
      });
      exported.push({
        id: d.id,
        file_name: d.file_name,
        file_type: d.file_type,
        status: d.status,
        created_at: d.created_at,
        download_url: `${base}/api/patient/documents/download/${token}`
      });
    }

    return res.json({ success: true, documents: exported });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/profile', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const result = PatientPortalService.getPatientProfile(req.patientSessionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('❌ Error getting patient profile:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.put('/api/patient/profile', apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'x-session-id required' });
    }

    const {
      name,
      first_name: firstNameRaw,
      last_name: lastNameRaw,
      dob,
      phone,
      email: emailRaw
    } = req.body || {};

    const firstName = firstNameRaw || (name ? name.split(' ')[0] : null);
    const lastName =
      lastNameRaw || (name ? name.split(' ').slice(1).join(' ') || null : null);

    if (!firstName && !lastName && !dob && !phone && !emailRaw) {
      return res.status(400).json({ success: false, error: 'No profile fields provided' });
    }

    // Resolve existing FHIR patient via portal session
    const sessionValidation = PatientPortalService.validateSession(sessionId);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    let patient = null;
    let emailPatient = null;
    let phonePatient = null;
    if (sessionValidation.email) {
      emailPatient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (sessionValidation.phone) {
      phonePatient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }

    // Decide primary vs secondary when email/phone resolve different patients
    if (emailPatient && phonePatient && emailPatient.resource_id !== phonePatient.resource_id) {
      const primary = emailPatient; // prefer email-based identity
      const secondary = phonePatient;
      console.warn('[PatientPortal] ⚠️ Email/phone map to different patients, merging', {
        primary_id: primary.resource_id,
        secondary_id: secondary.resource_id
      });
      try {
        if (FHIRService && typeof FHIRService.mergePatients === 'function') {
          FHIRService.mergePatients(primary.resource_id, secondary.resource_id);
        }
      } catch (e) {
        console.warn('[PatientPortal] ⚠️ mergePatients failed:', e.message);
      }
      patient = primary;
    } else {
      patient = emailPatient || phonePatient || null;
    }

    // Canonical email: always prefer verified email from session
    const email = sessionValidation.email || emailRaw || null;

    // If no patient exists yet, create via FHIRService.getOrCreatePatient
    let patientId;
    if (!patient) {
      const getOrCreateResult = await FHIRService.getOrCreatePatient(
        {
          name: name || [firstName, lastName].filter(Boolean).join(' '),
          firstName,
          lastName,
          phone,
          email
        },
        false
      );
      const fhirPatient = getOrCreateResult.patient;
      patientId = fhirPatient.id || getOrCreateResult.resource_id || null;
    } else {
      patientId = patient.resource_id;
    }

    if (!patientId) {
      return res.status(500).json({ success: false, error: 'Unable to resolve or create patient record' });
    }

    // Update FHIR Patient record in DB
    try {
      const existing = db.getFHIRPatient(patientId);
      let resource = existing && existing.resource_data
        ? (typeof existing.resource_data === 'string'
          ? JSON.parse(existing.resource_data)
          : existing.resource_data)
        : { resourceType: 'Patient' };

      // Name
      if (firstName || lastName) {
        resource.name = resource.name || [{}];
        resource.name[0].given = [firstName || resource.name[0].given?.[0] || ''];
        resource.name[0].family = lastName || resource.name[0].family || '';
      }

      // Birth date
      if (dob) {
        resource.birthDate = dob;
      }

      // Telecom
      resource.telecom = resource.telecom || [];
      const upsertTelecom = (system, value) => {
        if (!value) return;
        const existingEntry = resource.telecom.find(t => t.system === system);
        if (existingEntry) {
          existingEntry.value = value;
        } else {
          resource.telecom.push({ system, value });
        }
      };
      if (phone) upsertTelecom('phone', phone);
      if (email) upsertTelecom('email', email);

      const displayName = name || [firstName, lastName].filter(Boolean).join(' ');

      db.upsertFHIRPatient
        ? db.upsertFHIRPatient(patientId, resource, { phone, email, name: displayName })
        : db.db.prepare(`
            UPDATE fhir_patients
            SET resource_data = ?, phone = COALESCE(?, phone), email = COALESCE(?, email), name = COALESCE(?, name),
                profile_verified = 1,
                profile_verified_at = datetime('now'),
                updated_at = datetime('now')
            WHERE resource_id = ?
          `).run(JSON.stringify(resource), phone || null, email || null, displayName || null, patientId);
    } catch (e) {
      console.error('❌ Failed to update FHIR patient profile:', e.message);
      return res.status(500).json({ success: false, error: 'Failed to update profile' });
    }

    console.log('[PatientPortal] ✅ Profile updated', {
      session_id: sessionId,
      patient_id: patientId,
      has_phone: !!phone,
      has_email: !!email
    });

    // Update patient_sessions mapping if present
    try {
      if (db.updatePatientSession) {
        db.updatePatientSession(sessionId, { patient_id: patientId, email: email || sessionValidation.email });
      }
    } catch (e) {
      console.warn('⚠️  Failed to update patient_sessions from profile update:', e.message);
    }

    return res.json({ success: true, patient_id: patientId });
  } catch (error) {
    console.error('❌ Error updating patient profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/patient/my-records', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found for this session' });

    // FHIR-first read:
    // - DiagnosticReport: visit summaries
    // - DocumentReference: uploaded/available documents
    const drRows = db.getDiagnosticReportsByPatientId
      ? db.getDiagnosticReportsByPatientId(patientId, 50)
      : [];
    let docRefs = db.getFHIRDocumentReferencesByPatientId
      ? db.getFHIRDocumentReferencesByPatientId(patientId, 500).map(r => r.resource_data).filter(Boolean)
      : [];
    if (docRefs.length === 0) {
      const docRows = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];
      docRefs = [];
      for (const r of docRows) {
        const dr = buildDocumentReferenceFromPatientDocRow(r, req);
        docRefs.push(dr);
        try { db.createFHIRDocumentReference && db.createFHIRDocumentReference(dr); } catch (_) {}
      }
    }

    const records = [];
    for (const r of drRows) {
      const resource = r.resource_data || null;
      records.push({
        type: 'DiagnosticReport',
        id: r.resource_id || r.id,
        encounter_id: r.encounter_id || (resource?.encounter?.reference || '').replace(/^Encounter\//, '') || null,
        status: r.status || resource?.status || 'unknown',
        created_at: r.created_at || null,
        summary: (resource?.conclusion || r.case_report_text || '').toString().slice(0, 400),
        fhir: resource
      });
    }
    for (const dr of docRefs) {
      const att = dr.content?.[0]?.attachment || {};
      records.push({
        type: 'DocumentReference',
        id: dr.id,
        encounter_id: (dr.context?.encounter?.[0]?.reference || '').replace(/^Encounter\//, '') || null,
        status: dr.status || 'current',
        created_at: dr.date || null,
        summary: att.title || dr.description || 'Document',
        download_url: att.url || null,
        fhir: dr
      });
    }

    return res.json({ success: true, patient_id: patientId, records });
  } catch (error) {
    console.error('[api/patient/my-records] error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal error'
    });
  }
});

app.post('/api/patient/records/query', apiLimiter, requirePatientSession, express.json(), async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found for this session' });

    const query = (req.body?.query || req.body?.q || '').toString().trim();
    if (!query) return res.status(400).json({ success: false, error: 'query required' });

    const PatientRecordsQueryService = require('./services/patient-records-query-service');
    const { answer, sources } = await PatientRecordsQueryService.queryPatientRecords(patientId, query);
    return res.json({ success: true, answer, sources });
  } catch (error) {
    console.error('[api/patient/records/query] error:', error);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

app.get('/api/patient/receipts', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) {
      patient = db.getFHIRPatient(sessionValidation.patient_id);
    }
    if (!patient && sessionValidation.email) {
      patient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (!patient && sessionValidation.phone) {
      patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }

    const patientId = patient ? patient.resource_id : (sessionValidation.patient_id || null);
    const receipts = db.getMergedReceiptsForPatient
      ? db.getMergedReceiptsForPatient(patientId, sessionValidation.email || null, 50)
      : db.getPaymentReceiptsForPatient
        ? db.getPaymentReceiptsForPatient(patientId, sessionValidation.email || null, 50)
        : [];
    return res.json({ success: true, receipts });
  } catch (error) {
    console.error('❌ Error fetching patient receipts:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
}

module.exports = { registerPatientProfileRoutes };
