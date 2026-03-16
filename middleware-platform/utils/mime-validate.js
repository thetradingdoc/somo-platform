/**
 * Telemedicine Phase 4 — Task 28: Server-side MIME validation by magic bytes.
 * Allowed: PDF, JPEG, PNG, HEIC. Reject anything else (HTTP 415).
 */
const MAGIC = {
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  heic: (buf) => {
    if (buf.length < 12) return false;
    const ftyp = buf.indexOf('ftyp');
    if (ftyp < 4) return false;
    const brand = buf.slice(ftyp + 4, ftyp + 8).toString('ascii');
    return ['heic', 'heix', 'hevc', 'hevx', 'mif1'].includes(brand);
  }
};

const ALLOWED = {
  'application/pdf': (buf) => buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC.pdf),
  'image/jpeg': (buf) => buf.length >= 3 && buf.subarray(0, 3).equals(MAGIC.jpeg),
  'image/png': (buf) => buf.length >= 8 && buf.subarray(0, 8).equals(MAGIC.png),
  'image/heic': (buf) => MAGIC.heic(buf),
  'image/heif': (buf) => MAGIC.heic(buf)
};

function getDetectedType(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 4).equals(MAGIC.pdf)) return 'application/pdf';
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(MAGIC.jpeg)) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(MAGIC.png)) return 'image/png';
  if (MAGIC.heic(buffer)) return 'image/heic';
  return null;
}

function isAllowedMime(buffer) {
  const detected = getDetectedType(buffer);
  return detected && Object.prototype.hasOwnProperty.call(ALLOWED, detected);
}

module.exports = { getDetectedType, isAllowedMime, ALLOWED };
