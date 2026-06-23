'use strict';

const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

/**
 * Proxies multipart face image to teamkelly inference (GPU service).
 * Set FACE_READ_INFERENCE_BASE_URL=http://127.0.0.1:8765 (or your DGX URL).
 */
function registerFaceReadPublicRoute(app, { apiLimiter }) {
  app.post('/api/public/face-read', apiLimiter, upload.single('image'), async (req, res) => {
    const base = String(process.env.FACE_READ_INFERENCE_BASE_URL || '').trim().replace(/\/$/, '');
    if (!base) {
      return res.status(503).json({
        success: false,
        error: 'face_read_service_not_configured',
        hint: 'Set FACE_READ_INFERENCE_BASE_URL in middleware .env (e.g. http://127.0.0.1:8765)'
      });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'missing_image',
        detail: 'Send multipart/form-data with field name "image" (JPEG or PNG)'
      });
    }
    if (typeof Blob === 'undefined') {
      return res.status(500).json({
        success: false,
        error: 'face_read_proxy_requires_node_18',
        detail: 'Blob API required for multipart proxy'
      });
    }
    try {
      const mime = req.file.mimetype || 'image/jpeg';
      const u8 = Buffer.isBuffer(req.file.buffer) ? new Uint8Array(req.file.buffer) : req.file.buffer;
      const form = new FormData();
      form.append('image', new Blob([u8], { type: mime }), req.file.originalname || 'photo.jpg');

      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 90000);
      const r = await fetch(`${base}/v1/face-read`, {
        method: 'POST',
        body: form,
        signal: ac.signal
      });
      clearTimeout(tid);

      const text = await r.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = { raw: text };
      }
      return res.status(r.ok ? 200 : r.status).json({
        success: r.ok,
        face_read: parsed,
        request_id: req.id
      });
    } catch (e) {
      const msg =
        e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')
          ? 'face_read_timeout'
          : e.message || 'face_read_proxy_failed';
      return res.status(502).json({ success: false, error: msg, request_id: req.id });
    }
  });
}

module.exports = { registerFaceReadPublicRoute };
