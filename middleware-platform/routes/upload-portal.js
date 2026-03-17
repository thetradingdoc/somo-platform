/**
 * Telemedicine Phase 4 — Patient upload portal.
 * Task 25: GET /upload?token=... — validate token, 410 if invalid/used/expired, else show UI.
 * Task 26: Token is the only auth; mark token used after first successful upload.
 * Task 27: Upload UI (drag-drop, file picker, progress, success/error, mobile-first).
 * Task 28: Server-side MIME validation (magic bytes).
 * Task 29: HEIC → JPEG on ingest (heic-convert).
 * Task 30: Max 10 files, 50 MB total per session (413 if exceeded).
 * Task 31: Upload to Azure Blob; insert patient_uploads.
 * Task 32: Success message + confirmation email (no PHI).
 * Task 33: Audit log per upload (actor_type=patient, action=upload, resource_type=Upload).
 */
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { verifyUploadToken } = require('../utils/upload-token');
const { isAllowedMime, getDetectedType } = require('../utils/mime-validate');
const blobService = require('../services/patient-upload-blob');
const EmailService = require('../services/email-service');

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TOTAL_BYTES },
  fileFilter: (req, file, cb) => cb(null, true) // We validate MIME by magic bytes in handler
});

function getPatientEmail(patientId) {
  try {
    const patient = db.getFHIRPatient(patientId);
    if (!patient || !patient.resource_data) return null;
    const telecom = patient.resource_data.telecom || [];
    const email = telecom.find(t => t.system === 'email');
    return email ? email.value : null;
  } catch {
    return null;
  }
}

function buildConfirmationEmail(to) {
  return {
    to,
    subject: 'Your documents have been received',
    text: 'Your documents have been received. Thank you for submitting them before your visit.',
    html: '<p>Your documents have been received. Thank you for submitting them before your visit.</p>'
  };
}

/**
 * GET /upload?token=...
 * Validate token (HMAC + expiry + not used). Invalid/expired/used → 410 "Upload window closed".
 */
function getUploadPage(req, res) {
  const token = (req.query.token || '').trim();
  if (!token) {
    res.status(410).send(uploadClosedHtml());
    return;
  }
  const payload = verifyUploadToken(token);
  if (!payload) {
    res.status(410).send(uploadClosedHtml());
    return;
  }
  const row = db.getUploadToken && db.getUploadToken(token);
  if (!row || row.used) {
    res.status(410).send(uploadClosedHtml());
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(uploadPageHtml(token));
}

function uploadClosedHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload window closed</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:1rem;text-align:center;}
h1{font-size:1.25rem;} p{color:#555;}</style></head>
<body><h1>Upload window closed</h1>
<p>This link has expired or has already been used. If you need to upload documents, please request a new link.</p></body></html>`;
}

function uploadPageHtml(token) {
  const apiUrl = '/api/patient/upload';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Upload your documents</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 1rem; min-height: 100vh; background: #f5f5f5; }
    .container { max-width: 480px; margin: 0 auto; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .sub { color: #666; font-size: 0.9rem; margin-bottom: 1.25rem; }
    .zone { border: 2px dashed #ccc; border-radius: 8px; padding: 2rem; text-align: center; background: #fff; cursor: pointer; transition: border-color .2s, background .2s; }
    .zone.dragover { border-color: #0a7ea4; background: #e8f4f8; }
    .zone.disabled { pointer-events: none; opacity: 0.7; }
    .zone p { margin: 0; color: #555; }
    .zone .accepted { font-size: 0.85rem; color: #888; margin-top: 0.5rem; }
    input[type="file"] { display: none; }
    .btn { display: inline-block; margin-top: 1rem; padding: 0.75rem 1.5rem; background: #0a7ea4; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
    .btn:disabled { background: #999; cursor: not-allowed; }
    .progress { margin-top: 1rem; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden; display: none; }
    .progress.show { display: block; }
    .progress .bar { height: 100%; background: #0a7ea4; width: 0%; transition: width .2s; }
    .list { margin-top: 1rem; font-size: 0.9rem; color: #333; }
    .list div { padding: 0.35rem 0; border-bottom: 1px solid #eee; }
    .msg { margin-top: 1rem; padding: 1rem; border-radius: 6px; display: none; }
    .msg.show { display: block; }
    .msg.success { background: #e6f4ea; color: #1e7e34; }
    .msg.error { background: #fce8e6; color: #c5221f; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Upload your documents</h1>
    <p class="sub">Lab results (PDF) and photos (JPEG, PNG, HEIC). Max 10 files, 50 MB total.</p>
    <form id="f">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <div class="zone" id="zone" role="button" tabindex="0">
        <p>Drop files here or click to choose</p>
        <p class="accepted">PDF, JPEG, PNG, HEIC</p>
      </div>
      <input type="file" id="input" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic,image/heif">
      <div class="progress" id="progress"><div class="bar" id="bar"></div></div>
      <div class="list" id="list"></div>
      <button type="submit" class="btn" id="submit" disabled>Upload</button>
    </form>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    var zone = document.getElementById('zone');
    var input = document.getElementById('input');
    var list = document.getElementById('list');
    var progress = document.getElementById('progress');
    var bar = document.getElementById('bar');
    var submit = document.getElementById('submit');
    var msg = document.getElementById('msg');
    var files = [];
    function escapeHtml(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
    function updateList(){
      list.innerHTML = files.map(function(f){ return '<div>' + escapeHtml(f.name) + ' (' + (f.size/1024).toFixed(1) + ' KB)</div>'; }).join('');
      submit.disabled = files.length === 0;
    }
    zone.addEventListener('click', function(){ input.click(); });
    zone.addEventListener('dragover', function(e){ e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function(){ zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e){
      e.preventDefault();
      zone.classList.remove('dragover');
      var added = Array.from(e.dataTransfer.files || []);
      for (var i = 0; i < added.length; i++) files.push(added[i]);
      if (files.length > ${MAX_FILES}) files = files.slice(0, ${MAX_FILES});
      updateList();
    });
    input.addEventListener('change', function(){
      var added = Array.from(input.files || []);
      for (var i = 0; i < added.length; i++) files.push(added[i]);
      input.value = '';
      if (files.length > ${MAX_FILES}) files = files.slice(0, ${MAX_FILES});
      updateList();
    });
    document.getElementById('f').addEventListener('submit', function(e){
      e.preventDefault();
      if (files.length === 0) return;
      var total = files.reduce(function(s,f){ return s + f.size; }, 0);
      if (total > ${MAX_TOTAL_BYTES}) {
        msg.className = 'msg show error'; msg.textContent = 'Total size must be 50 MB or less.';
        return;
      }
      var fd = new FormData();
      fd.append('token', document.querySelector('input[name=token]').value);
      for (var i = 0; i < files.length; i++) fd.append('files', files[i]);
      submit.disabled = true;
      zone.classList.add('disabled');
      progress.classList.add('show');
      bar.style.width = '0%';
      var xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', function(ev){ if (ev.lengthComputable) bar.style.width = (100*ev.loaded/ev.total)+'%'; });
      xhr.addEventListener('load', function(){
        progress.classList.remove('show');
        if (xhr.status === 200) {
          msg.className = 'msg show success'; msg.textContent = 'Your documents have been received.';
          files = []; updateList(); zone.classList.remove('disabled'); submit.disabled = true;
        } else {
          var err = 'Upload failed. Please try again or request a new link.';
          try { var j = JSON.parse(xhr.responseText); if (j.error) err = j.error; } catch(_){}
          msg.className = 'msg show error'; msg.textContent = err;
          zone.classList.remove('disabled'); submit.disabled = false;
        }
      });
      xhr.addEventListener('error', function(){
        progress.classList.remove('show');
        msg.className = 'msg show error'; msg.textContent = 'Network error. Please try again.';
        zone.classList.remove('disabled'); submit.disabled = false;
      });
      xhr.open('POST', '${apiUrl}');
      xhr.send(fd);
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * POST /api/patient/upload — multipart: token + files (max 10, 50 MB total).
 * Validates token, MIME by magic bytes, HEIC→JPEG, Blob, patient_uploads, audit, mark used, confirmation email.
 */
async function postUpload(req, res) {
  const tokenValue = (req.body && req.body.token != null) ? String(req.body.token).trim() : null;
  const files = (req.files && req.files.files) ? (Array.isArray(req.files.files) ? req.files.files : [req.files.files]) : [];

  if (!tokenValue || typeof tokenValue !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing or invalid token' });
  }
  const payload = verifyUploadToken(tokenValue.trim());
  if (!payload) {
    return res.status(410).json({ success: false, error: 'Upload window closed' });
  }
  const tokenRow = db.getUploadToken && db.getUploadToken(tokenValue.trim());
  if (!tokenRow || tokenRow.used) {
    return res.status(410).json({ success: false, error: 'Upload window closed' });
  }
  if (files.length === 0) {
    return res.status(400).json({ success: false, error: 'No files selected' });
  }
  if (files.length > MAX_FILES) {
    return res.status(413).json({ success: false, error: `Maximum ${MAX_FILES} files allowed` });
  }
  let totalBytes = 0;
  for (const f of files) totalBytes += (f.size || f.buffer?.length || 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return res.status(413).json({ success: false, error: 'Total size must be 50 MB or less' });
  }

  const patientId = payload.patient_id;
  const appointmentId = payload.appointment_id || null;
  const ip = req.ip || '';
  const ua = req.get('User-Agent') || '';
  let tokenMarkedUsed = false;
  const uploadedIds = [];

  try {
    let heicConvert;
    try {
      heicConvert = require('heic-convert');
    } catch (e) {
      heicConvert = null;
    }

    for (const file of files) {
      const buffer = file.buffer;
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) continue;
      if (!isAllowedMime(buffer)) {
        return res.status(415).json({ success: false, error: 'File type not allowed. Use PDF, JPEG, PNG, or HEIC.' });
      }
      let finalBuffer = buffer;
      let contentType = getDetectedType(buffer);
      let filename = (file.originalname || file.name || 'file').replace(/\s+/g, ' ');
      if (contentType === 'image/heic' || contentType === 'image/heif') {
        if (heicConvert) {
          try {
            // heic-convert v2 returns Uint8Array; Azure Blob needs Buffer
            const converted = await heicConvert({ buffer, format: 'JPEG', quality: 0.9 });
            finalBuffer = Buffer.from(converted);
            contentType = 'image/jpeg';
            filename = filename.replace(/\.[^.]+$/i, '.jpg');
          } catch (e) {
            return res.status(415).json({ success: false, error: 'HEIC conversion failed. Try uploading as JPEG or PNG.' });
          }
        } else {
          return res.status(415).json({ success: false, error: 'HEIC not supported on this server. Please convert to JPEG or PNG.' });
        }
      }

      let storagePath = null;
      if (blobService.isConfigured()) {
        const result = await blobService.uploadBuffer(patientId, appointmentId, filename, finalBuffer, contentType);
        if (result) storagePath = result.storagePath;
      }
      const uploadId = uuidv4();
      const now = new Date().toISOString();

      // Legacy table: patient_uploads
      db.createPatientUpload({
        id: uploadId,
        patient_id: patientId,
        appointment_id: appointmentId,
        encounter_id: null,
        filename,
        storage_path: storagePath || '',
        file_type: (contentType || '').split('/')[0],
        mime_type: contentType,
        size_bytes: finalBuffer.length,
        source: 'portal',
        uploaded_at: now,
        uploaded_by: null
      });

      // New unified table: patient_documents (for portal visibility)
      if (db.createPatientDocument) {
        try {
          db.createPatientDocument({
            patient_id: patientId,
            appointment_id: appointmentId,
            encounter_id: null,
            file_name: filename,
            file_type: contentType,
            storage_path: storagePath || '',
            uploaded_by: 'patient'
          });
        } catch (e) {
          console.warn('[upload-portal] Failed to mirror upload into patient_documents:', e.message);
        }
      }

      uploadedIds.push(uploadId);
      if (db.auditLog) {
        db.auditLog('patient', patientId, 'upload', 'Upload', uploadId, ip, ua, 'success');
      }
      if (!tokenMarkedUsed && db.markUploadTokenUsed) {
        db.markUploadTokenUsed(tokenValue.trim());
        tokenMarkedUsed = true;
      }
    }

    const emailTo = getPatientEmail(patientId);
    if (emailTo) {
      const conf = buildConfirmationEmail(emailTo);
      EmailService.sendEmail({ to: conf.to, subject: conf.subject, html: conf.html, text: conf.text }).catch(err => {
        console.warn('[upload-portal] Confirmation email failed:', err.message);
      });
    }

    return res.json({ success: true, message: 'Your documents have been received.', count: uploadedIds.length });
  } catch (err) {
    console.error('[upload-portal] Error:', err);
    return res.status(500).json({ success: false, error: 'Upload failed. Please try again.' });
  }
}

// Multer for multipart: token (field) + files (max 10)
const uploadFields = [
  { name: 'token', maxCount: 1 },
  { name: 'files', maxCount: MAX_FILES }
];
const uploadMiddleware = upload.fields(uploadFields);

// Export a ready-to-mount router. Mount in server.js:
//   app.use('/', uploadPortalRouter)           → GET /upload
//   app.use('/api/patient', uploadPortalRouter) → POST /api/patient/upload
const uploadPortalRouter = express.Router();
uploadPortalRouter.get('/upload', getUploadPage);
uploadPortalRouter.post('/upload', uploadMiddleware, postUpload);

module.exports = uploadPortalRouter;
module.exports.getUploadPage = getUploadPage;
module.exports.postUpload = postUpload;
module.exports.uploadMiddleware = uploadMiddleware;
module.exports.MAX_FILES = MAX_FILES;
module.exports.MAX_TOTAL_BYTES = MAX_TOTAL_BYTES;
