'use strict';

function registerPatientBillingPortalRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    ensureRoutineTables,
    ensureBillingTables,
    ensurePatientShelfInventoryColumns,
    loadPatientShelfProductRows,
    formatShelfProductApiRow,
    parseBillingDocumentUpload,
    safeParseJsonArray,
    isIsoDateOnly,
    localDateFromIso,
    isoFromLocalDate,
    weekdayKeyForIsoLocal,
    enumerateIsoDates,
    issuePatientDocumentDownloadUrl,
    fetchBillingAggregatesByDay,
    fieldsFromSqlAggRow,
    PatientPortalService,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    getPatientStep3Status,
    ensureProductsPhase2Tables,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
    withIdempotency,
    assertPatientOwnsAppointmentOrThrow,
    validatePatientAvailableSlotsQuery,
    validatePatientBookingScheduleBody,
    validatePatientTriageBody,
    requireCsrfForCookieAuth,
    auditBookingEvent,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
  } = deps;
  

app.get('/api/patient/billing/subscription', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    const sub = resolveBillingSubscription(req);
    return billingOk(res, { subscription: { tier: sub.tier, status: sub.status }, pricing_policy: resolveBillingPricingPolicy() });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/pricing-policy', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  return billingOk(res, { pricing_policy: resolveBillingPricingPolicy() });
});

app.get('/api/patient/billing/contracts', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  ensureBillingTables();
  return billingOk(res, {
    entities: [
      'billing_event',
      'document',
      'care_episode',
      'payment_attempt',
      'coverage_context',
      'account_subscription'
    ],
    canonical_fields: ['provider_name', 'service_date', 'amount_cents', 'document_type', 'confidence_score', 'status'],
    lifecycle_statuses: ['needs_review', 'tracked', 'due', 'paid', 'disputed']
  });
});

app.post('/api/patient/billing/documents', (req, res, next) => apiLimiter(req, res, next), parseBillingDocumentUpload, express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureBillingTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const uploadFile = req.file || (Array.isArray(req.files) ? req.files[0] : null);
    const metadata = parseBillingDocumentMetadata(body.metadata);
    let effectiveBody = body;
    if (uploadFile && uploadFile.buffer) {
      let uploadedRef = null;
      const gcsBillingStorage = require('../services/gcs-billing-storage');
      const sessionResolved = resolveBillingSubscription(req);
      const uploaded = await gcsBillingStorage.uploadBuffer({
        buffer: uploadFile.buffer,
        contentType: uploadFile.mimetype,
        patientId: sessionResolved.patientId || sessionResolved.sessionId || 'session',
        fileName: uploadFile.originalname
      });
      uploadedRef = uploaded.storageRef;
      effectiveBody = {
        ...body,
        file_name: body.file_name || uploadFile.originalname,
        mime_type: body.mime_type || uploadFile.mimetype,
        storage_ref: body.storage_ref || uploadedRef,
        metadata: {
          ...metadata,
          upload: {
            provider: uploaded.provider,
            bucket: uploaded.bucket || null,
            key: uploaded.key || null,
            size_bytes: uploadFile.size || null
          }
        }
      };
    }
    const validated = validateBillingDocumentPayload(effectiveBody);
    if (!validated.valid) {
      return billingErr(res, 400, 'VALIDATION_ERROR', validated.errors.join('; '), { fields: validated.errors });
    }

    const sub = resolveBillingSubscription(req);
    const freeScanLimit = Math.max(1, Number(process.env.BILLING_FREE_SCAN_LIMIT || 15));
    const isScannable = ['scan', 'upload'].includes(validated.normalized.sourceType);
    if (sub.tier !== 'plus' && isScannable) {
      const monthStartIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const whereSql = sub.patientId
        ? `WHERE (patient_id = ? OR session_id = ?) AND source_type IN ('scan','upload') AND datetime(created_at) >= datetime(?)`
        : `WHERE session_id = ? AND source_type IN ('scan','upload') AND datetime(created_at) >= datetime(?)`;
      const params = sub.patientId ? [sub.patientId, sub.sessionId, monthStartIso] : [sub.sessionId, monthStartIso];
      const usage = db.db.prepare(`SELECT COUNT(*) AS c FROM patient_billing_documents ${whereSql}`).get(...params)?.c || 0;
      if (usage >= freeScanLimit) {
        return billingErr(res, 402, 'ENTITLEMENT_PLUS_REQUIRED', 'Free scan limit reached. Upgrade to Plus for unlimited scans.', {
          tier: sub.tier,
          limit: freeScanLimit,
          current_usage: usage,
          upgrade_required: true
        });
      }
    }

    const docId = `bdoc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_billing_documents (
        id, session_id, patient_id, source_type, file_name, mime_type, storage_ref, parse_status, confidence_score, notes, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      docId,
      sub.sessionId,
      sub.patientId || null,
      validated.normalized.sourceType,
      validated.normalized.fileName,
      validated.normalized.mimeType,
      encryptBillingField(validated.normalized.storageRef),
      validated.normalized.parseStatus,
      validated.normalized.confidenceScore,
      encryptBillingField(validated.normalized.notes),
      encryptBillingField(normalizeBillingMetadata(effectiveBody.metadata))
    );
    recordPatientPortalEvent(req, 'billing_document_created', { billing_document_id: docId, source_type: validated.normalized.sourceType, parse_status: validated.normalized.parseStatus });
    return billingOk(res, {
      document: {
        id: docId,
        source_type: validated.normalized.sourceType,
        file_name: validated.normalized.fileName,
        mime_type: validated.normalized.mimeType,
        parse_status: validated.normalized.parseStatus,
        confidence_score: validated.normalized.confidenceScore
      },
      entitlement: { tier: sub.tier }
    });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/documents', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
    const whereSql = sub.patientId ? `WHERE (patient_id = ? OR session_id = ?)` : `WHERE session_id = ?`;
    const params = sub.patientId ? [sub.patientId, sub.sessionId, limit] : [sub.sessionId, limit];
    const rows = db.db.prepare(`
      SELECT id, source_type, file_name, mime_type, storage_ref, parse_status, confidence_score, notes, metadata_json, created_at, updated_at
      FROM patient_billing_documents
      ${whereSql}
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(...params);
    const safeRows = rows.map((row) => ({
      ...row,
      storage_ref: decryptBillingField(row.storage_ref),
      notes: decryptBillingField(row.notes),
      metadata_json: parseBillingMetadata(row.metadata_json)
    }));
    recordPatientPortalEvent(req, 'billing_documents_accessed', { count: safeRows.length });
    return billingOk(res, { documents: safeRows, entitlement: { tier: sub.tier } });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/documents/:documentId/extract', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, async (req, res) => {
  try {
    ensureBillingTables();
    const documentId = String(req.params?.documentId || '').trim();
    if (!documentId) return billingErr(res, 400, 'DOCUMENT_ID_REQUIRED', 'document id is required.');
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId
      ? `WHERE id = ? AND (patient_id = ? OR session_id = ?)`
      : `WHERE id = ? AND session_id = ?`;
    const params = sub.patientId ? [documentId, sub.patientId, sub.sessionId] : [documentId, sub.sessionId];
    const doc = db.db.prepare(`
      SELECT id, file_name, mime_type, confidence_score, storage_ref, metadata_json
      FROM patient_billing_documents
      ${whereSql}
      LIMIT 1
    `).get(...params);
    if (!doc) return billingErr(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

    const decryptedStorageRef = decryptBillingField(doc.storage_ref);
    const gcsBillingStorage = require('../services/gcs-billing-storage');
    const extractionService = require('../services/patient-document-extraction');
    const billingOcrParser = require('../services/billing-ocr-parser');
    let ocrText = '';
    let extractionMethod = 'fallback';
    try {
      const buf = await gcsBillingStorage.downloadBuffer(decryptedStorageRef);
      if (buf && Buffer.isBuffer(buf)) {
        const extracted = await extractionService.extractText({
          storagePath: null,
          buffer: buf,
          mimeType: doc.mime_type || null,
          fileName: doc.file_name || null
        });
        ocrText = String(extracted?.text || '').trim();
        extractionMethod = String(extracted?.method || 'unknown');
      }
    } catch (e) {
      console.warn('[billing/extract] OCR read failed:', e.message);
    }
    let extraction;
    try {
      extraction = ocrText
        ? billingOcrParser.parseBillingFieldsFromText({
            text: ocrText,
            mimeType: doc.mime_type,
            fileName: doc.file_name
          })
        : normalizeExtractedDocumentFields(doc);
    } catch (e) {
      console.warn('[billing/extract] parser error:', e.message);
      extraction = normalizeExtractedDocumentFields(doc);
    }
    const mergedMeta = {
      ...parseBillingMetadata(doc.metadata_json),
      extraction,
      extraction_artifact: {
        method: extractionMethod,
        extracted_text: ocrText || null
      }
    };
    if (sub.patientId && ocrText && db.createPatientDocumentExtract) {
      try {
        db.createPatientDocumentExtract({
          id: `extract-${documentId}-${Date.now()}`,
          doc_id: documentId,
          patient_id: sub.patientId,
          extracted_text: ocrText,
          extraction_method: extractionMethod
        });
      } catch (e) {
        console.warn('[billing/extract] createPatientDocumentExtract failed:', e.message);
      }
    }
    db.db.prepare(`
      UPDATE patient_billing_documents
      SET parse_status = ?, confidence_score = ?, metadata_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(extraction.status === 'needs_review' ? 'needs_review' : 'ready', extraction.confidence_score, normalizeBillingMetadata(mergedMeta), documentId);
    const linkedUpdated = applyDocumentExtractionToLinkedEvents(documentId, extraction);
    console.info(
      '[billing/extract]',
      JSON.stringify({
        document_id: documentId,
        method: extractionMethod,
        ocr_len: ocrText.length,
        confidence: extraction.confidence_score,
        status: extraction.status,
        linked_events_updated: linkedUpdated
      })
    );
    recordPatientPortalEvent(req, 'billing_document_extracted', {
      billing_document_id: documentId,
      confidence_score: extraction.confidence_score,
      extraction_method: extractionMethod,
      ocr_text_length: ocrText.length,
      linked_events_updated: linkedUpdated
    });
    return billingOk(res, { extraction, document_id: documentId, linked_events_updated: linkedUpdated });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/documents/:documentId', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const documentId = String(req.params?.documentId || '').trim();
    if (!documentId) return billingErr(res, 400, 'DOCUMENT_ID_REQUIRED', 'document id is required.');
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId
      ? `WHERE id = ? AND (patient_id = ? OR session_id = ?)`
      : `WHERE id = ? AND session_id = ?`;
    const params = sub.patientId ? [documentId, sub.patientId, sub.sessionId] : [documentId, sub.sessionId];
    const row = db.db.prepare(`
      SELECT id, source_type, file_name, mime_type, storage_ref, parse_status, confidence_score, notes, metadata_json, created_at, updated_at
      FROM patient_billing_documents
      ${whereSql}
      LIMIT 1
    `).get(...params);
    if (!row) return billingErr(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    recordPatientPortalEvent(req, 'billing_document_accessed', { billing_document_id: documentId });
    return billingOk(res, {
      document: {
        ...row,
        storage_ref: decryptBillingField(row.storage_ref),
        notes: decryptBillingField(row.notes),
        metadata_json: parseBillingMetadata(row.metadata_json)
      }
    });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/documents/confirm', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const documentId = String(body.document_id || '').trim();
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    if (!documentId) return billingErr(res, 400, 'DOCUMENT_ID_REQUIRED', 'document_id is required.');
    const payload = validateBillingEventPayload({
      event_type: 'bill',
      title: String(fields.provider_name || 'Billing event').slice(0, 200),
      provider_name: fields.provider_name,
      service_date: fields.service_date,
      amount_cents: fields.amount_cents,
      status: fields.status || 'needs_review',
      confidence_score: fields.confidence_score
    });
    if (!payload.valid) return billingErr(res, 400, 'VALIDATION_ERROR', payload.errors.join('; '), { fields: payload.errors });
    const sub = resolveBillingSubscription(req);
    const docWhere = sub.patientId
      ? `WHERE id = ? AND (patient_id = ? OR session_id = ?)`
      : `WHERE id = ? AND session_id = ?`;
    const docParams = sub.patientId ? [documentId, sub.patientId, sub.sessionId] : [documentId, sub.sessionId];
    const doc = db.db.prepare(`SELECT id, metadata_json FROM patient_billing_documents ${docWhere} LIMIT 1`).get(...docParams);
    if (!doc) return billingErr(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

    const eventId = `bev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_billing_events (
        id, session_id, patient_id, event_type, title, provider_name, service_date, amount_cents, currency, status, confidence_score, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      eventId,
      sub.sessionId,
      sub.patientId || null,
      payload.normalized.eventType,
      payload.normalized.title,
      payload.normalized.providerName,
      payload.normalized.serviceDate,
      payload.normalized.amountCents,
      payload.normalized.currency,
      payload.normalized.status,
      payload.normalized.confidenceScore,
      normalizeBillingMetadata({ source_document_id: documentId, confirmed: true })
    );
    db.db.prepare(`
      INSERT OR IGNORE INTO patient_billing_event_documents (id, billing_event_id, billing_document_id, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(`bed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, eventId, documentId);

    const episodeId = maybeLinkBillingEventToEpisode({
      eventId,
      sessionId: sub.sessionId,
      patientId: sub.patientId,
      providerName: payload.normalized.providerName,
      serviceDate: payload.normalized.serviceDate
    });
    db.db.prepare(`
      UPDATE patient_billing_documents
      SET parse_status = 'ready', metadata_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(normalizeBillingMetadata({ ...parseBillingMetadata(doc.metadata_json), confirmed_event_id: eventId }), documentId);
    recordPatientPortalEvent(req, 'billing_document_confirmed', { billing_document_id: documentId, billing_event_id: eventId, episode_id: episodeId });
    return billingOk(res, { event: { id: eventId, status: payload.normalized.status }, episode: { id: episodeId } });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/events', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const validated = validateBillingEventPayload(body);
    if (!validated.valid) {
      return billingErr(res, 400, 'VALIDATION_ERROR', validated.errors.join('; '), { fields: validated.errors });
    }
    const sub = resolveBillingSubscription(req);
    const eventId = `bev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_billing_events (
        id, session_id, patient_id, event_type, title, provider_name, service_date, amount_cents, currency, status, confidence_score, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      eventId,
      sub.sessionId,
      sub.patientId || null,
      validated.normalized.eventType,
      validated.normalized.title,
      validated.normalized.providerName,
      validated.normalized.serviceDate,
      validated.normalized.amountCents,
      validated.normalized.currency,
      validated.normalized.status,
      validated.normalized.confidenceScore,
      normalizeBillingMetadata(body.metadata)
    );

    const documentId = body.document_id ? String(body.document_id).trim() : '';
    if (documentId) {
      const whereSql = sub.patientId
        ? `WHERE id = ? AND (patient_id = ? OR session_id = ?)`
        : `WHERE id = ? AND session_id = ?`;
      const params = sub.patientId ? [documentId, sub.patientId, sub.sessionId] : [documentId, sub.sessionId];
      const doc = db.db.prepare(`SELECT id FROM patient_billing_documents ${whereSql} LIMIT 1`).get(...params);
      if (doc) {
        db.db.prepare(`
          INSERT OR IGNORE INTO patient_billing_event_documents (id, billing_event_id, billing_document_id, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).run(`bed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, eventId, documentId);
      }
    }

    recordPatientPortalEvent(req, 'billing_event_created', { billing_event_id: eventId, event_type: validated.normalized.eventType, status: validated.normalized.status });
    return billingOk(res, {
      event: {
        id: eventId,
        event_type: validated.normalized.eventType,
        title: validated.normalized.title,
        status: validated.normalized.status,
        amount_cents: validated.normalized.amountCents,
        currency: validated.normalized.currency
      }
    });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/events/from-document', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const documentId = String(body.document_id || '').trim();
    if (!documentId) return billingErr(res, 400, 'DOCUMENT_ID_REQUIRED', 'document_id is required.');
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId
      ? `WHERE id = ? AND (patient_id = ? OR session_id = ?)`
      : `WHERE id = ? AND session_id = ?`;
    const params = sub.patientId ? [documentId, sub.patientId, sub.sessionId] : [documentId, sub.sessionId];
    const doc = db.db.prepare(`
      SELECT id, file_name, confidence_score, parse_status, metadata_json
      FROM patient_billing_documents
      ${whereSql}
      LIMIT 1
    `).get(...params);
    if (!doc) return billingErr(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found.');

    const meta = parseBillingMetadata(doc.metadata_json);
    const ex = meta.extraction && typeof meta.extraction === 'object' ? meta.extraction : {};
    const fallbackTitle = String(ex.provider_name || doc.file_name || 'Imported billing document')
      .trim()
      .slice(0, 200);
    const providerName =
      ex.provider_name != null && String(ex.provider_name).trim()
        ? String(ex.provider_name).trim().slice(0, 200)
        : null;
    const serviceDate =
      ex.service_date != null && isIsoDateOnly(String(ex.service_date).trim())
        ? String(ex.service_date).trim().slice(0, 10)
        : null;
    const amountCents =
      ex.amount_cents != null && Number.isFinite(Number(ex.amount_cents)) ? Math.round(Number(ex.amount_cents)) : null;
    let status = String(ex.status || 'needs_review').trim().toLowerCase();
    if (!ALLOWED_SYNCED_BILLING_STATUS.has(status)) status = 'needs_review';
    const confScore =
      ex.confidence_score != null && Number.isFinite(Number(ex.confidence_score))
        ? Math.max(0, Math.min(1, Number(ex.confidence_score)))
        : Number.isFinite(Number(doc.confidence_score))
          ? Number(doc.confidence_score)
          : null;

    const eventId = `bev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_billing_events (
        id, session_id, patient_id, event_type, title, provider_name, service_date, amount_cents, currency, status, confidence_score, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'bill', ?, ?, ?, ?, 'USD', ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      eventId,
      sub.sessionId,
      sub.patientId || null,
      fallbackTitle,
      providerName,
      serviceDate,
      amountCents,
      status,
      confScore,
      normalizeBillingMetadata({ source_document_id: documentId, parse_status: doc.parse_status, metadata_snapshot: meta })
    );
    db.db.prepare(`
      INSERT OR IGNORE INTO patient_billing_event_documents (id, billing_event_id, billing_document_id, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(`bed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, eventId, documentId);
    const episodeId = maybeLinkBillingEventToEpisode({
      eventId,
      sessionId: sub.sessionId,
      patientId: sub.patientId,
      providerName: providerName || fallbackTitle,
      serviceDate: serviceDate || new Date().toISOString().slice(0, 10)
    });
    recordPatientPortalEvent(req, 'billing_event_created_from_document', {
      billing_event_id: eventId,
      billing_document_id: documentId,
      episode_id: episodeId,
      has_service_date: Boolean(serviceDate),
      has_amount: amountCents != null
    });
    return billingOk(res, { event: { id: eventId, title: fallbackTitle, status: 'needs_review' }, episode: { id: episodeId }, source_document_id: documentId });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/events', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;
    const sortRaw = String(req.query?.sort || '').trim().toLowerCase();
    const orderSql =
      sortRaw === 'created_at' || sortRaw === 'created_at_desc'
        ? 'ORDER BY datetime(e.created_at) DESC'
        : `ORDER BY (CASE WHEN e.service_date IS NULL OR trim(COALESCE(e.service_date,'')) = '' OR length(e.service_date) < 10 THEN 1 ELSE 0 END) ASC,
            e.service_date DESC,
            datetime(e.created_at) DESC`;
    const whereSql = sub.patientId ? `WHERE (e.patient_id = ? OR e.session_id = ?)` : `WHERE e.session_id = ?`;
    const params = sub.patientId ? [sub.patientId, sub.sessionId, limit] : [sub.sessionId, limit];
    const rows = db.db.prepare(`
      SELECT
        e.id, e.event_type, e.title, e.provider_name, e.service_date, e.amount_cents, e.currency,
        e.status, e.confidence_score, e.metadata_json, e.created_at, e.updated_at,
        (SELECT l2.billing_document_id FROM patient_billing_event_documents l2
          WHERE l2.billing_event_id = e.id
          ORDER BY datetime(l2.created_at) DESC
          LIMIT 1) AS document_id
      FROM patient_billing_events e
      ${whereSql}
      ${orderSql}
      LIMIT ?
    `).all(...params);
    return billingOk(res, { events: rows });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.patch('/api/patient/billing/events/:eventId', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const eventId = String(req.params?.eventId || '').trim();
    if (!eventId) return billingErr(res, 400, 'EVENT_ID_REQUIRED', 'event id is required.');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const statusRaw = String(body.status || '').trim().toLowerCase();
    const allowed = new Set(['needs_review', 'tracked', 'due', 'paid', 'disputed', 'pending']);
    if (!allowed.has(statusRaw)) return billingErr(res, 400, 'INVALID_STATUS', 'Invalid lifecycle status.');
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId
      ? `WHERE id = ? AND (patient_id = ? OR session_id = ?)`
      : `WHERE id = ? AND session_id = ?`;
    const params = sub.patientId ? [eventId, sub.patientId, sub.sessionId] : [eventId, sub.sessionId];
    const existing = db.db.prepare(`SELECT id FROM patient_billing_events ${whereSql} LIMIT 1`).get(...params);
    if (!existing) return billingErr(res, 404, 'EVENT_NOT_FOUND', 'Billing event not found.');
    db.db.prepare(`
      UPDATE patient_billing_events
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(statusRaw, eventId);
    recordPatientPortalEvent(req, 'billing_event_updated', { billing_event_id: eventId, status: statusRaw });
    return billingOk(res, { event: { id: eventId, status: statusRaw } });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/money-summary', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId ? `WHERE (patient_id = ? OR session_id = ?)` : `WHERE session_id = ?`;
    const params = sub.patientId ? [sub.patientId, sub.sessionId] : [sub.sessionId];
    const totals = db.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'due' THEN COALESCE(amount_cents, 0) ELSE 0 END) AS due_cents,
        SUM(CASE WHEN status = 'paid' THEN COALESCE(amount_cents, 0) ELSE 0 END) AS paid_cents,
        SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) AS decline_count,
        SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count
      FROM patient_billing_events
      ${whereSql}
    `).get(...params) || {};
    const recentAttempts = db.db.prepare(`
      SELECT id, billing_event_id, amount_cents, currency, status, decline_reason, attempted_at
      FROM patient_billing_payment_attempts
      ${whereSql}
      ORDER BY datetime(attempted_at) DESC
      LIMIT 5
    `).all(...params);
    return billingOk(res, {
      snapshots: {
        due_cents: Number(totals.due_cents || 0),
        paid_cents: Number(totals.paid_cents || 0),
        decline_count: Number(totals.decline_count || 0),
        needs_review_count: Number(totals.needs_review_count || 0),
      },
      payment_attempts: recentAttempts,
      entitlement: { tier: sub.tier }
    });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/actions/:action', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const action = String(req.params?.action || '').trim().toLowerCase();
    const allowed = new Set(['reconcile', 'pay', 'submit_reimbursement', 'export_packet']);
    if (!allowed.has(action)) return billingErr(res, 400, 'INVALID_ACTION', 'Unsupported action.');
    const sub = resolveBillingSubscription(req);
    if (['submit_reimbursement', 'export_packet'].includes(action) && sub.tier !== 'plus') {
      return billingErr(res, 402, 'ENTITLEMENT_PLUS_REQUIRED', 'Upgrade to Plus to use this action.', {
        tier: sub.tier,
        upgrade_required: true,
        pricing_policy: resolveBillingPricingPolicy()
      });
    }
    if (action === 'pay') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (!body.confirm_payment) {
        return billingErr(res, 400, 'PAYMENT_CONFIRMATION_REQUIRED', 'Explicit payment confirmation is required before submission.');
      }
      const amountCents = Math.max(0, Math.round(Number(body.amount_cents || 0)));
      db.db.prepare(`
        INSERT INTO patient_billing_payment_attempts (
          id, session_id, patient_id, billing_event_id, amount_cents, currency, status, decline_reason, attempted_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, datetime('now'), ?)
      `).run(
        `bpay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sub.sessionId,
        sub.patientId || null,
        body.billing_event_id ? String(body.billing_event_id) : null,
        amountCents,
        amountCents > 0 ? 'submitted' : 'declined',
        amountCents > 0 ? null : 'invalid_amount',
        encryptBillingField(normalizeBillingMetadata({ action: 'pay', explicit_confirmation: true }))
      );
    }
    recordPatientPortalEvent(req, 'billing_quick_action', { action, tier: sub.tier });
    if (action === 'export_packet') {
      recordPatientPortalEvent(req, 'billing_export_accessed', { tier: sub.tier });
    }
    return billingOk(res, { action, status: 'accepted', entitlement: { tier: sub.tier } });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/insights', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, requirePlusForBillingFeature('Advanced billing insights'), (req, res) => {
  return billingOk(res, {
    insights: {
      deductible_progress_pct: 55,
      oop_progress_pct: 19,
      annual_spend_projection_cents: 248500
    },
    entitlement: { tier: req.billingSubscription?.tier || 'plus' }
  });
});

app.get('/api/patient/billing/export', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, requirePlusForBillingFeature('Full proof bundle export'), (req, res) => {
  recordPatientPortalEvent(req, 'billing_export_accessed', { tier: req.billingSubscription?.tier || 'plus' });
  return billingOk(res, {
    export: {
      status: 'ready',
      format: 'json',
      message: 'Export scaffolding ready. Full PDF/ZIP bundle generation to be implemented next.'
    },
    entitlement: { tier: req.billingSubscription?.tier || 'plus' }
  });
});

app.get('/api/patient/billing/retention-policy', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId ? `WHERE (patient_id = ? OR session_id = ?)` : `WHERE session_id = ?`;
    const params = sub.patientId ? [sub.patientId, sub.sessionId] : [sub.sessionId];
    const row = db.db.prepare(`
      SELECT retain_days, auto_delete_enabled, updated_at
      FROM patient_billing_retention_policies
      ${whereSql}
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `).get(...params);
    return billingOk(res, {
      retention_policy: {
        retain_days: Number(row?.retain_days || 365),
        auto_delete_enabled: Number(row?.auto_delete_enabled || 0) === 1,
        updated_at: row?.updated_at || null
      }
    });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/retention-policy', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const retainDays = Math.max(30, Math.min(3650, Math.floor(Number(body.retain_days) || 365)));
    const autoDeleteEnabled = Number(body.auto_delete_enabled) === 1 || body.auto_delete_enabled === true ? 1 : 0;
    db.db.prepare(`
      INSERT INTO patient_billing_retention_policies (id, session_id, patient_id, retain_days, auto_delete_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(`brp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, sub.sessionId, sub.patientId || null, retainDays, autoDeleteEnabled);
    recordPatientPortalEvent(req, 'billing_retention_policy_updated', { retain_days: retainDays, auto_delete_enabled: Boolean(autoDeleteEnabled) });
    return billingOk(res, { retention_policy: { retain_days: retainDays, auto_delete_enabled: Boolean(autoDeleteEnabled) } });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.post('/api/patient/billing/data-deletion-request', (req, res, next) => apiLimiter(req, res, next), express.json(), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const reason = String(body.reason || 'user_requested').slice(0, 400);
    const requestId = `bdr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.db.prepare(`
      INSERT INTO patient_billing_deletion_requests (id, session_id, patient_id, status, reason, requested_at)
      VALUES (?, ?, ?, 'queued', ?, datetime('now'))
    `).run(requestId, sub.sessionId, sub.patientId || null, reason);
    recordPatientPortalEvent(req, 'billing_data_deletion_requested', { request_id: requestId });
    return billingOk(res, { deletion_request: { id: requestId, status: 'queued' } });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

app.get('/api/patient/billing/rollout-config', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  return billingOk(res, {
    rollout: {
      billing_v1_enabled: parseBooleanFlag(process.env.FEATURE_BILLING_V1_ENABLED, true),
      billing_v1_phase: String(process.env.FEATURE_BILLING_V1_PHASE || 'internal'),
      billing_v1_requires_plus_for_export: true
    }
  });
});

app.get('/api/patient/billing/kpi-snapshot', (req, res, next) => apiLimiter(req, res, next), requirePatientSession, (req, res) => {
  try {
    ensureBillingTables();
    const sub = resolveBillingSubscription(req);
    const whereSql = sub.patientId ? `WHERE (patient_id = ? OR session_id = ?)` : `WHERE session_id = ?`;
    const params = sub.patientId ? [sub.patientId, sub.sessionId] : [sub.sessionId];
    const docsCount = db.db.prepare(`SELECT COUNT(*) AS c FROM patient_billing_documents ${whereSql}`).get(...params)?.c || 0;
    const trackedCount = db.db.prepare(`SELECT COUNT(*) AS c FROM patient_billing_events ${whereSql} AND status IN ('tracked','paid')`).get(...params)?.c || 0;
    const reviewCount = db.db.prepare(`SELECT COUNT(*) AS c FROM patient_billing_events ${whereSql} AND status = 'needs_review'`).get(...params)?.c || 0;
    return billingOk(res, {
      kpis: {
        first_scan_completion: docsCount > 0 ? 1 : 0,
        review_completion_events: Number(trackedCount || 0),
        weekly_tracked_events: Number(trackedCount || 0),
        free_to_plus_conversion_eligible: sub.tier === 'free' && docsCount > 0 ? 1 : 0,
        pending_review_events: Number(reviewCount || 0)
      },
      entitlement: { tier: sub.tier }
    });
  } catch (e) {
    return billingErr(res, 500, 'SERVER_ERROR', e.message);
  }
});

}

module.exports = { registerPatientBillingPortalRoutes };
