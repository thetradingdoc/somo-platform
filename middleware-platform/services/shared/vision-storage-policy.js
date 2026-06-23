function isVisionConsentRequired() {
  const v = String(process.env.VISION_REQUIRE_CONSENT || 'true').toLowerCase().trim();
  return v !== 'false' && v !== '0' && v !== 'no';
}

function hasValidConsent(payload = {}) {
  if (!isVisionConsentRequired()) return true;
  return payload?.consent_acknowledged === true || payload?.consent_acknowledged === 'true' || payload?.consent_acknowledged === 1;
}

function isSecureFrameUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    // Require signed-url shape in production-like mode.
    const strict = String(process.env.VISION_REQUIRE_SIGNED_URL || 'true').toLowerCase().trim() !== 'false';
    if (!strict) return true;
    const keys = Array.from(u.searchParams.keys()).map((k) => k.toLowerCase());
    const hasExpiry = keys.includes('expires') || keys.includes('x-amz-expires') || keys.includes('x-amz-date') || keys.includes('exp');
    const hasSig = keys.includes('signature') || keys.includes('x-amz-signature') || keys.includes('sig');
    return hasExpiry && hasSig;
  } catch (_) {
    return false;
  }
}

function extractSignedUrlExpiry(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    const expRaw =
      u.searchParams.get('expires') ||
      u.searchParams.get('exp') ||
      u.searchParams.get('Expires') ||
      null;
    if (expRaw && /^\d+$/.test(String(expRaw))) {
      const n = Number(expRaw);
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const amzDate = u.searchParams.get('X-Amz-Date');
    const amzExpires = u.searchParams.get('X-Amz-Expires');
    if (amzDate && amzExpires && /^\d+$/.test(String(amzExpires))) {
      const s = String(amzDate);
      const stamp = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
      const baseMs = Date.parse(stamp);
      if (Number.isFinite(baseMs)) {
        return new Date(baseMs + Number(amzExpires) * 1000).toISOString();
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

function defaultSignedUrlExpiry() {
  const minutes = Number(process.env.VISION_SIGNED_URL_TTL_MINUTES || 20);
  const ttlMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 20;
  return new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
}

function isSignedUrlActive(expiresAt) {
  if (!expiresAt) return true;
  const ms = Date.parse(String(expiresAt));
  if (!Number.isFinite(ms)) return false;
  return ms > Date.now();
}

function canReadVisionArtifacts(userRole) {
  const role = String(userRole || '').trim().toLowerCase();
  const raw = String(process.env.VISION_ARTIFACT_READ_ROLES || 'provider,admin,system,assistant')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!role) return false;
  return raw.includes(role);
}

function retentionExpiresAt(days = null) {
  const d = Number(days ?? process.env.VISION_RETENTION_DAYS ?? 30);
  const safeDays = Number.isFinite(d) && d > 0 ? d : 30;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  isVisionConsentRequired,
  hasValidConsent,
  isSecureFrameUrl,
  extractSignedUrlExpiry,
  defaultSignedUrlExpiry,
  isSignedUrlActive,
  canReadVisionArtifacts,
  retentionExpiresAt
};
