'use strict';

function registerPatientDocumentsRoutes(app, deps) {
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

app.post('/api/patient/send-upload-link', sendUploadLinkHandler);

// Phase 8: POST /api/patient/visits/:id/feedback — Token-validated feedback (no session required)
app.post('/api/patient/visits/:id/feedback', apiLimiter, express.json(), async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const { token, rating, helpful, comment } = req.body || {};
    const { verifyFeedbackToken } = require('./utils/upload-token');

    const payload = verifyFeedbackToken(token);
    if (!payload || payload.appointment_id !== appointmentId) {
      return res.status(400).json({ success: false, error: 'Invalid or expired feedback link. Please use the link from your email.' });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) return res.status(404).json({ success: false, error: 'Appointment not found' });

    const { v4: uuidv4 } = require('uuid');
    const id = 'fb-' + uuidv4();
    const ratingInt = rating != null ? (parseInt(rating, 10) >= 1 && parseInt(rating, 10) <= 5 ? parseInt(rating, 10) : null) : null;
    const helpfulInt = helpful != null ? (helpful === true || helpful === 1 || helpful === '1' ? 1 : 0) : null;
    const commentStr = typeof comment === 'string' ? comment.trim().slice(0, 2000) : '';

    db.db.prepare(`
      INSERT INTO visit_feedbacks (id, appointment_id, patient_id, rating, helpful, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, appointmentId, appointment.patient_id || null, ratingInt, helpfulInt, commentStr || null);

    return res.json({ success: true, message: 'Thank you for your feedback.' });
  } catch (e) {
    console.error('POST /api/patient/visits/:id/feedback error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/patient/documents', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) return res.status(404).json({ success: false, error: 'Patient not found' });

    // FHIR-first read: DocumentReference table is canonical.
    let documentReferences = db.getFHIRDocumentReferencesByPatientId
      ? db.getFHIRDocumentReferencesByPatientId(patientId, 500).map(r => r.resource_data).filter(Boolean)
      : [];

    // Migration bridge: if none exist, derive from patient_documents and persist.
    if (documentReferences.length === 0) {
      const rows = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];
      documentReferences = [];
      for (const r of rows) {
        const dr = buildDocumentReferenceFromPatientDocRow(r, req);
        documentReferences.push(dr);
        try { db.createFHIRDocumentReference && db.createFHIRDocumentReference(dr); } catch (_) {}
      }
    }

    // Back-compat for existing UI: return a "documents" list derived from the DocumentReferences.
    const documents = documentReferences.map(dr => {
      const att = (dr.content && dr.content[0] && dr.content[0].attachment) ? dr.content[0].attachment : {};
      return {
        id: dr.id,
        patient_id: patientId,
        file_name: att.title || dr.description || 'Document',
        file_type: att.contentType || null,
        status: 'available',
        created_at: dr.date || null,
        fhir: { document_reference_id: dr.id, binary_url: att.url || null }
      };
    });

    res.json({ success: true, patient_id: patientId, documentReferences, documents });
  } catch (error) {
    console.error('❌ Error fetching patient documents:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/patient/documents/:id/download', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const sessionValidation = req.patientSession;
    const docId = req.params.id;
    const doc = db.getPatientDocumentById ? db.getPatientDocumentById(docId) : null;
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });

    // Resolve patient and verify ownership
    let patient = null;
    if (sessionValidation.patient_id && db.getFHIRPatient) patient = db.getFHIRPatient(sessionValidation.patient_id);
    if (!patient && sessionValidation.email) patient = db.getFHIRPatientByEmail(sessionValidation.email);
    if (!patient && sessionValidation.phone) patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    const patientId = patient ? patient.resource_id : sessionValidation.patient_id;
    if (!patientId || doc.patient_id !== patientId) {
      return res.status(403).json({ success: false, error: 'Not allowed to access this document' });
    }

    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
    if (db.createPatientDocumentDownloadToken) {
      const created = db.createPatientDocumentDownloadToken({
        token,
        doc_id: docId,
        patient_id: patientId,
        expires_at: expiresAtIso
      });
      if (!created.success) {
        return res.status(500).json({ success: false, error: 'Failed to issue download token' });
      }
    }

    // Audit log
    try {
      db.insertHipaaAccessLog && db.insertHipaaAccessLog({
        user_id: null,
        patient_id: patientId,
        resource_type: 'patient_document',
        resource_id: docId,
        action: 'download_link_issued',
        ip_address: req.ip
      });
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'patient',
        actor_id: null,
        patient_id: patientId,
        resource_type: 'document',
        resource_id: docId,
        action: 'download_link_issued',
        metadata: { ip: req.ip || null }
      });
    } catch (_) {}

    return res.json({
      success: true,
      url: `${req.protocol}://${req.get('host')}/api/patient/documents/download/${token}`,
      expires_in_seconds: Math.max(30, ttlSeconds)
    });
  } catch (error) {
    console.error('❌ Error issuing document download link:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/patient/documents/download/:token', apiLimiter, async (req, res) => {
  try {
    const token = (req.params.token || '').toString();
    const entry = db.getPatientDocumentDownloadToken ? db.getPatientDocumentDownloadToken(token) : null;
    if (!entry) return res.status(404).send('Not found');
    if (entry.revoked_at) return res.status(410).send('Expired');
    if (entry.used_at) return res.status(410).send('Expired');
    if (entry.expires_at && Date.now() > new Date(entry.expires_at).getTime()) return res.status(410).send('Expired');

    const doc = db.getPatientDocumentById ? db.getPatientDocumentById(entry.doc_id) : null;
    if (!doc) return res.status(404).send('Not found');
    if (doc.patient_id !== entry.patient_id) return res.status(403).send('Forbidden');

    // One-time use (durable)
    if (db.markPatientDocumentDownloadTokenUsed) {
      db.markPatientDocumentDownloadTokenUsed(token);
    }

    // Audit
    try {
      db.insertHipaaAccessLog && db.insertHipaaAccessLog({
        user_id: null,
        patient_id: entry.patient_id,
        resource_type: 'patient_document',
        resource_id: entry.doc_id,
        action: 'download',
        ip_address: req.ip
      });
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'patient',
        actor_id: null,
        patient_id: entry.patient_id,
        resource_type: 'document',
        resource_id: entry.doc_id,
        action: 'download',
        metadata: { ip: req.ip || null }
      });
    } catch (_) {}

    // If stored in cloud, redirect to provider-signed URL (mvp-68)
    if (doc.storage_provider === 'azure') {
      const BlobStorage = require('./services/blob-storage');
      if (BlobStorage && BlobStorage.isAzureConfigured && BlobStorage.isAzureConfigured() && doc.storage_key) {
        const signed = BlobStorage.generateSignedUrl({
          blobName: doc.storage_key,
          expiresInSeconds: 120,
          contentDispositionFilename: doc.file_name || 'document'
        });
        return res.redirect(signed);
      }
    }

    const p = doc.storage_path;
    if (!p || !fs.existsSync(p)) return res.status(404).send('Not found');
    res.setHeader('Content-Type', doc.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name || 'document')}"`);
    return fs.createReadStream(p).pipe(res);
  } catch (error) {
    console.error('❌ Error streaming document:', error);
    return res.status(500).send('Internal error');
  }
});

app.post('/api/patient/documents', apiLimiter, withIdempotency('patient_docs_upload'), async (req, res, next) => {
  // Defer to multer middleware; require it here to avoid startup failure if not installed
  let multer;
  try {
    multer = require('multer');
  } catch (e) {
    console.error('❌ Multer is required for file uploads. Install with "npm install multer".');
    return res.status(500).json({ success: false, error: 'File upload backend not configured' });
  }

  const uploadDir = path.join(__dirname, 'uploads', 'patients');
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {
    console.error('❌ Failed to ensure upload directory:', e.message);
  }

  const storage = multer.diskStorage({
    destination: (req2, file, cb) => cb(null, uploadDir),
    filename: (req2, file, cb) => {
      const { v4: uuidv4 } = require('uuid');
      const ext = path.extname(file.originalname || '');
      cb(null, `${uuidv4()}${ext}`);
    }
  });

  const maxMb = parseInt(process.env.PATIENT_UPLOAD_MAX_MB || '10', 10);
  const maxFiles = Math.max(1, Math.min(parseInt(process.env.PATIENT_UPLOAD_MAX_FILES || '30', 10) || 30, 100));
  const allowed = new Set([
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ]);
  const upload = multer({
    storage,
    limits: { fileSize: Math.max(1, maxMb) * 1024 * 1024, files: maxFiles },
    fileFilter: (req2, file, cb) => {
      if (!allowed.has(file.mimetype)) {
        return cb(new Error('Unsupported file type'));
      }
      cb(null, true);
    }
  }).array('files', maxFiles);

  upload(req, res, async (err) => {
    if (err) {
      console.error('❌ Error handling upload:', err);
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          error: `Too many files in one request (max ${maxFiles}). Choose fewer files, or upload in batches.`,
          error_code: 'LIMIT_FILE_COUNT',
          max_files: maxFiles
        });
      }
      const msg = (err.message && String(err.message).trim()) || 'Upload failed';
      return res.status(400).json({ success: false, error: msg });
    }

    try {
      const sessionId = req.headers['x-session-id'];
      if (!sessionId) return res.status(401).json({ success: false, error: 'x-session-id required' });
      const sessionValidation = PatientPortalService.validateSession(sessionId);
      if (!sessionValidation.valid) return res.status(401).json({ success: false, error: 'Invalid or expired session' });

      let patient = null;
      if (sessionValidation.email) {
        patient = db.getFHIRPatientByEmail(sessionValidation.email);
      }
      if (!patient && sessionValidation.phone) {
        patient = db.getFHIRPatientByPhone(sessionValidation.phone);
      }
      if (!patient) {
        return res.status(404).json({ success: false, error: 'Patient not found' });
      }
      const patientId = patient.resource_id;

      const saved = [];
      if (req.files && db.createPatientDocument) {
        for (const f of req.files) {
          try {
            // Minimal magic-byte validation (mvp-40)
            try {
              const fd = fs.openSync(f.path, 'r');
              const buf = Buffer.alloc(16);
              fs.readSync(fd, buf, 0, 16, 0);
              fs.closeSync(fd);
              const sig = buf.toString('hex');
              const isPdf = sig.startsWith('25504446'); // %PDF
              const isPng = sig.startsWith('89504e470d0a1a0a');
              const isJpg = sig.startsWith('ffd8ff');
              if (
                (f.mimetype === 'application/pdf' && !isPdf) ||
                (f.mimetype === 'image/png' && !isPng) ||
                (f.mimetype === 'image/jpeg' && !isJpg)
              ) {
                try { fs.unlinkSync(f.path); } catch (_) {}
                continue;
              }
            } catch (_) {}

            // Antivirus / content scan (PATIENT_WEB_PORTAL_TODO 12.2.3)
            const AntivirusService = require('./services/antivirus-service');
            if (!f.path || !fs.existsSync(f.path)) {
              return res.status(400).json({
                success: false,
                error: 'Uploaded file could not be read (temporary file missing). Please upload again.',
                error_code: 'UPLOAD_TEMP_FILE_MISSING'
              });
            }
            const avResult = await AntivirusService.scanFile(f.path);
            if (!avResult.safe) {
              const msg = avResult.error || AntivirusService.BLOCKED_MESSAGE;
              return res.status(403).json({ success: false, error: msg });
            }

            // Document lifecycle (mvp-69): uploaded -> processing -> available/failed
            let storage_provider = 'local';
            let storage_bucket = null;
            let storage_key = null;
            let storage_path = f.path;
            let status = 'processing';

            // Optional: upload to Azure Blob (mvp-68)
            try {
              const BlobStorage = require('./services/blob-storage');
              if (BlobStorage && BlobStorage.isAzureConfigured && BlobStorage.isAzureConfigured()) {
                const buf = fs.readFileSync(f.path);
                const { v4: uuidv4 } = require('uuid');
                const ext = path.extname(f.originalname || '') || '';
                const blobName = `patients/${patientId}/${uuidv4()}${ext}`;
                const uploaded = await BlobStorage.uploadBuffer({
                  buffer: buf,
                  contentType: f.mimetype,
                  blobName
                });
                storage_provider = uploaded.provider;
                storage_bucket = uploaded.bucket;
                storage_key = uploaded.key;
                storage_path = null;
                // Remove local temp file after blob upload
                try { fs.unlinkSync(f.path); } catch (_) {}
              }
            } catch (_) {}

            // Malware scanning MVP (mvp-69): after magic bytes validation, mark available
            status = 'available';

            const result = db.createPatientDocument({
              patient_id: patientId,
              file_name: f.originalname,
              file_type: f.mimetype,
              storage_path,
              storage_provider,
              storage_bucket,
              storage_key,
              uploaded_by: 'patient',
              status
            });
            saved.push(result.id);

            // Dual-write (triage): when session_id provided (triage chat), also create case_report_media so RAG can use upload context
            const triageSessionId = (req.body && req.body.session_id) ? String(req.body.session_id).trim() : null;
            if (triageSessionId && db.createCaseReportMedia) {
              try {
                db.createCaseReportMedia({
                  session_id: triageSessionId,
                  patient_id: patientId,
                  media_type: (f.mimetype || '').startsWith('image/') ? 'image' : 'document',
                  mime_type: f.mimetype,
                  file_name: f.originalname,
                  file_size_bytes: f.size,
                  storage_provider,
                  storage_key: storage_key || result.id,
                  context_note: f.originalname,
                  uploaded_during: 'triage'
                });
              } catch (e3) {
                console.warn('[patient/documents] Dual-write case_report_media:', e3.message);
              }
            }

            // Dual-write (Batch 5): persist a FHIR DocumentReference as the canonical metadata record.
            try {
              const rowForFhir = {
                id: result.id,
                patient_id: patientId,
                encounter_id: null,
                file_name: f.originalname,
                file_type: f.mimetype,
                created_at: new Date().toISOString()
              };
              const docRef = buildDocumentReferenceFromPatientDocRow(rowForFhir, req);
              if (db.createFHIRDocumentReference) db.createFHIRDocumentReference(docRef);
            } catch (_) {}
          } catch (e2) {
            console.error('❌ Failed to save patient_document record:', e2.message);
          }
        }
      }

      try {
        if (saved.length > 0 && db.insertAuditEvent) {
          for (const docId of saved) {
            db.insertAuditEvent({
              actor_type: 'patient',
              actor_id: null,
              patient_id: patientId,
              resource_type: 'document',
              resource_id: docId,
              action: 'upload',
              metadata: {}
            });
          }
        }
      } catch (_) {}

      res.json({ success: true, uploaded: saved.length, document_ids: saved });
    } catch (error) {
      console.error('❌ Error processing uploaded documents:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
});
}

module.exports = { registerPatientDocumentsRoutes };
