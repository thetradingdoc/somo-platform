/**
 * M-Doc.2: Patient Document Extraction
 * Extracts text from patient documents (PDF, images) via pdf-parse and GPT vision.
 * Stores results in patient_document_extracts for RAG query.
 */

const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Extract text from PDF buffer
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractFromPDF(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return '';
  try {
    const data = await pdfParse(buffer);
    return (data.text || '').trim();
  } catch (e) {
    console.warn('[patient-document-extraction] PDF extract failed:', e.message);
    return '';
  }
}

/**
 * Extract text from image via GPT-4o vision (OCR)
 * @param {string} imagePath - Path to image file
 * @param {string} mimeType - e.g. image/jpeg
 * @returns {Promise<string>}
 */
async function extractFromImage(imagePath, mimeType = 'image/jpeg') {
  if (!OPENAI_API_KEY) {
    console.warn('[patient-document-extraction] OPENAI_API_KEY not set, skipping vision OCR');
    return '';
  }
  try {
    await fs.access(imagePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[patient-document-extraction] Image not found:', imagePath);
      return '';
    }
    throw err;
  }

  const buffer = await fs.readFile(imagePath);
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all text visible in this image. Return the raw text exactly as you see it, preserving structure (line breaks, columns) where possible. Include any medical terms, lab values, dates, and notes. If there is no readable text, respond with "No text found".'
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' }
            }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI vision API error ${res.status}: ${errBody}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const text = content.trim();
  if (text.toLowerCase() === 'no text found') return '';
  return text;
}

/**
 * Extract text from file (PDF or image)
 * @param {Object} opts - { storagePath, buffer, mimeType, fileName }
 * @returns {Promise<{text: string, method: string}>}
 */
async function extractText(opts) {
  const { storagePath, buffer, mimeType, fileName } = opts;
  const mime = (mimeType || '').toLowerCase();
  const ext = (fileName && path.extname(fileName).toLowerCase()) || (storagePath && path.extname(storagePath).toLowerCase()) || '';
  const isPDF = mime.includes('pdf') || ext === '.pdf';

  if (isPDF && buffer) {
    const text = await extractFromPDF(buffer);
    return { text, method: 'pdf-parse' };
  }
  if (isPDF && storagePath) {
    const buf = await fs.readFile(storagePath);
    const text = await extractFromPDF(buf);
    return { text, method: 'pdf-parse' };
  }

  const imageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const isImage = imageMimes.some(m => mime.includes(m)) ||
    ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);

  if (isImage) {
    const p = storagePath || (buffer && await writeTempImage(buffer, mimeType));
    if (!p) return { text: '', method: 'vision' };
    try {
      const text = await extractFromImage(p, mimeType);
      return { text, method: 'vision' };
    } finally {
      if (!storagePath && p) {
        try { await fs.unlink(p); } catch (_) {}
      }
    }
  }

  return { text: '', method: 'unsupported' };
}

async function writeTempImage(buffer, mimeType) {
  const tmpDir = path.join(__dirname, '..', 'uploads', 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const ext = mimeType?.includes('png') ? '.png' : mimeType?.includes('gif') ? '.gif' : '.jpg';
  const tmpPath = path.join(tmpDir, `extract-${uuidv4()}${ext}`);
  await fs.writeFile(tmpPath, buffer);
  return tmpPath;
}

/**
 * Extract and persist to patient_document_extracts
 * @param {Object} doc - { id, patient_id, storage_path, file_name, file_type }
 * @param {Buffer} [buffer] - Optional in-memory buffer (when storage_path not yet written)
 * @param {Object} db - Database module
 */
async function extractAndStore(doc, buffer, db) {
  if (!doc?.id || !doc?.patient_id) return;
  const dbMod = db || require('../database');

  let storagePath = doc.storage_path;
  let buf = buffer;
  if (!storagePath && !buf) {
    console.warn('[patient-document-extraction] No storage_path or buffer for doc', doc.id);
    return;
  }
  if (storagePath) {
    try {
      await fs.access(storagePath);
    } catch (e) {
      if (e.code === 'ENOENT' && buf) {
        storagePath = null;
      } else {
        console.warn('[patient-document-extraction] File not found:', storagePath);
        return;
      }
    }
  }

  try {
    const { text, method } = await extractText({
      storagePath,
      buffer: buf,
      mimeType: doc.file_type || null,
      fileName: doc.file_name
    });

    if (!text) return;

    const createExtract = dbMod.createPatientDocumentExtract;
    if (createExtract) {
      createExtract({
        id: `extract-${doc.id}-${Date.now()}`,
        doc_id: doc.id,
        patient_id: doc.patient_id,
        extracted_text: text,
        extraction_method: method
      });
    }
  } catch (e) {
    console.warn('[patient-document-extraction] Extract failed for', doc.id, e.message);
  }
}

module.exports = {
  extractText,
  extractAndStore,
  extractFromPDF,
  extractFromImage
};
