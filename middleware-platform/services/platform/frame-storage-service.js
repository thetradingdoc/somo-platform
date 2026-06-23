/**
 * Frame Storage Service
 * Temp file handling for video consult frames. Writes base64 to temp, cleans after processing.
 * Auto-delete after 24h (or configured TTL). Used by perception layer for vision analysis.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const TEMP_DIR = process.env.VIDEO_CONSULT_TEMP_DIR || path.join(require('os').tmpdir(), 'video-consult-frames');
const TTL_MS = parseInt(process.env.VIDEO_CONSULT_FRAME_TTL_MS || String(24 * 60 * 60 * 1000), 10);
const trackedFiles = new Map();

async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

/**
 * Write base64 frame to temp file. Returns path for vision encoder.
 * @param {string} base64 - Data URL or raw base64
 * @param {string} [ext] - .jpg or .png
 * @returns {Promise<{path: string, cleanup: function}>}
 */
async function writeFrame(base64, ext = '.jpg') {
  await ensureTempDir();
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `frame_${id}${ext}`;
  const filePath = path.join(TEMP_DIR, filename);

  let data = base64;
  if (data.startsWith('data:image/')) {
    data = data.replace(/^data:image\/\w+;base64,/, '');
  }
  const buffer = Buffer.from(data, 'base64');
  await fs.writeFile(filePath, buffer);

  const cleanup = () => deleteFrame(filePath);
  trackedFiles.set(filePath, { createdAt: Date.now(), cleanup });

  return { path: filePath, cleanup };
}

/**
 * Delete a frame file.
 */
async function deleteFrame(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[frame-storage] delete failed:', e.message);
  }
  trackedFiles.delete(filePath);
}

/**
 * Cleanup expired files (older than TTL).
 */
async function cleanupExpired() {
  const now = Date.now();
  for (const [p, meta] of trackedFiles.entries()) {
    if (now - meta.createdAt > TTL_MS) {
      await meta.cleanup();
    }
  }
}

/**
 * Cleanup all tracked files.
 */
async function cleanupAll() {
  for (const meta of trackedFiles.values()) {
    await meta.cleanup();
  }
}

/**
 * Process base64 frame: write to temp, run fn(path), then cleanup.
 * @param {string} base64
 * @param {Function} fn - async (filePath) => result
 * @returns {Promise<result>}
 */
async function withTempFrame(base64, fn) {
  const { path: filePath, cleanup } = await writeFrame(base64);
  try {
    return await fn(filePath);
  } finally {
    await cleanup();
  }
}

module.exports = {
  writeFrame,
  deleteFrame,
  cleanupExpired,
  cleanupAll,
  withTempFrame,
  TEMP_DIR,
  TTL_MS
};
