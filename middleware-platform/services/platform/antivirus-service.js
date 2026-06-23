/**
 * Antivirus / content scanning for patient document uploads (PATIENT_WEB_PORTAL_TODO 12.2.3).
 * Wire into /upload and /api/patient/documents with clear error paths for blocked files.
 *
 * To enable: set ENABLE_ANTIVIRUS_SCAN=1
 * Optional: set CLAMAV_SOCKET=/path/to/clamd.sock for ClamAV daemon
 * Without ClamAV configured, performs basic content checks only.
 */

const fs = require('fs');
const path = require('path');

const ENABLED = process.env.ENABLE_ANTIVIRUS_SCAN === '1' || process.env.ENABLE_ANTIVIRUS_SCAN === 'true';
const CLAMAV_SOCKET = process.env.CLAMAV_SOCKET || null;

/** Dangerous patterns in first 64KB (minimal heuristic; ClamAV is authoritative) */
const SUSPICIOUS_PATTERNS = [
  /\x4d\x5a/,           // PE executable
  /\x7fELF/,             // ELF executable
  /script\s*[>=]|<script/i,
  /javascript:/i,
  /vbscript:/i,
  /\.exe\s/i,
  /eval\s*\(/i
];

/**
 * Scan a file for malicious content.
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<{ safe: boolean, error?: string }>}
 */
async function scanFile(filePath) {
  if (!ENABLED) return { safe: true };

  if (!filePath || !fs.existsSync(filePath)) {
    return { safe: false, error: 'File not found for scanning' };
  }

  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const slice = buf.slice(0, read);

    for (const pat of SUSPICIOUS_PATTERNS) {
      if (pat.test(slice)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return {
          safe: false,
          error: 'File blocked: content appears potentially harmful. Please upload only medical documents (PDF, images).'
        };
      }
    }

    if (CLAMAV_SOCKET) {
      const clamResult = await scanWithClamAV(filePath);
      if (!clamResult.safe) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return clamResult;
      }
    }

    return { safe: true };
  } catch (e) {
    console.warn('[antivirus] Scan error:', e?.message || e);
    return { safe: true }; // Fail open; log and allow
  }
}

async function scanWithClamAV(filePath) {
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const exec = promisify(execFile);
    await exec('clamscan', ['--no-summary', filePath], { timeout: 15000, maxBuffer: 2048 });
    return { safe: true };
  } catch (e) {
    if (e.code === 1 && (e.stdout || e.stderr || '').includes('FOUND')) {
      return { safe: false, error: 'File blocked: antivirus scan detected a threat. Please upload only medical documents.' };
    }
    console.warn('[antivirus] ClamAV error:', e?.message || e);
    return { safe: true };
  }
}

/**
 * Scan a buffer in memory (e.g. from multer memoryStorage).
 * Writes to a temp file and delegates to scanFile.
 * @param {Buffer} buf
 * @returns {Promise<{ safe: boolean, error?: string }>}
 */
async function scanBuffer(buf) {
  if (!ENABLED) return { safe: true };
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    return { safe: false, error: 'No file data to scan' };
  }
  const os = require('os');
  const tmpPath = path.join(os.tmpdir(), `avscan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    fs.writeFileSync(tmpPath, buf);
    return await scanFile(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

module.exports = {
  scanFile,
  scanBuffer,
  ENABLED,
  BLOCKED_MESSAGE: 'Your file could not be saved because it did not pass our security scan. Please upload only medical documents (PDF, JPEG, PNG).'
};
