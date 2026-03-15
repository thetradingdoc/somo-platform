/**
 * Escrow Timeout Policy (Task 45)
 * Config for when escrow is considered timed out and when to notify providers.
 *
 * Env:
 *   ESCROW_TIMEOUT_HOURS - Hours before escrow is considered timed out (default: 24)
 *   ESCROW_NOTIFY_ON_TIMEOUT - '1' to send provider notification when escrow times out
 */

const TIMEOUT_HOURS = parseFloat(process.env.ESCROW_TIMEOUT_HOURS || '24');
const NOTIFY_ON_TIMEOUT = process.env.ESCROW_NOTIFY_ON_TIMEOUT === '1' || process.env.ESCROW_NOTIFY_ON_TIMEOUT === 'true';

function getEscrowTimeoutHours() {
  return TIMEOUT_HOURS;
}

function shouldNotifyOnTimeout() {
  return NOTIFY_ON_TIMEOUT;
}

function isEscrowTimedOut(createdAt) {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  const now = new Date();
  const hoursElapsed = (now - created) / (1000 * 60 * 60);
  return hoursElapsed >= TIMEOUT_HOURS;
}

module.exports = {
  getEscrowTimeoutHours,
  shouldNotifyOnTimeout,
  isEscrowTimedOut
};
