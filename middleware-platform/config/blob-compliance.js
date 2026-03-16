/**
 * Telemedicine Phase 1 — Task 10: SAS token policy.
 * Maximum expiry for any blob direct-access URL is 1 hour. Use this constant whenever generating SAS tokens.
 */
const SAS_MAX_EXPIRY_SECONDS = 3600; // 1 hour
const SAS_MAX_EXPIRY_MS = SAS_MAX_EXPIRY_SECONDS * 1000;

module.exports = {
  SAS_MAX_EXPIRY_SECONDS,
  SAS_MAX_EXPIRY_MS
};
