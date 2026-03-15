/**
 * Visit Charge Timing (Task 14)
 * Config for when the main visit charge occurs: pre-auth, post-capture, session_end.
 * Ledger entries use status 'pending' until capture; 'settled' after.
 *
 * Env:
 *   VISIT_CHARGE_TIMING  - 'pre_auth' | 'post_capture' | 'session_end'
 *   DEPOSIT_HOLD_ENABLED - '1' to use Stripe capture_method: manual for appointments
 *
 * pre_auth:    Authorize at booking; capture on session start (or no-show fee)
 * post_capture: Charge immediately when payment completes (current default)
 * session_end: Charge only after SOAP sign-off / visit completion
 */

const TIMING = (process.env.VISIT_CHARGE_TIMING || 'post_capture').toLowerCase();
const DEPOSIT_HOLD = process.env.DEPOSIT_HOLD_ENABLED === '1' || process.env.DEPOSIT_HOLD_ENABLED === 'true';

function getVisitChargeTiming() {
  return TIMING;
}

function useDepositHold() {
  return DEPOSIT_HOLD;
}

function shouldAuthorizeOnlyForAppointment() {
  return useDepositHold() || TIMING === 'pre_auth';
}

function getLedgerStatusOnPayment() {
  if (TIMING === 'post_capture') return 'settled';
  if (TIMING === 'pre_auth' || useDepositHold()) return 'pending';
  return 'pending';
}

module.exports = {
  getVisitChargeTiming,
  useDepositHold,
  shouldAuthorizeOnlyForAppointment,
  getLedgerStatusOnPayment
};
