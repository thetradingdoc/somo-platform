'use strict';

/**
 * R-06-4 — When Retell WS transfer_number does not ring PSTN on custom Twilio,
 * redirect the live Twilio leg with <Dial>.
 */

function normalizeE164(num) {
  const s = String(num || '').trim();
  if (!s) return null;
  if (s.startsWith('+')) return s;
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return s;
}

async function attemptTwilioTransfer(callSid, transferNumber) {
  if (process.env.RETELL_TRANSFER_TWILIO_FALLBACK === '0') return { attempted: false, reason: 'disabled' };
  const sid = String(callSid || '').trim();
  const to = normalizeE164(transferNumber);
  if (!sid || !to) return { attempted: false, reason: 'missing_sid_or_number' };

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return { attempted: false, reason: 'no_twilio_creds' };

  try {
    const twilio = require('twilio')(accountSid, authToken);
    const safe = to.replace(/[<>&"']/g, '');
    await twilio.calls(sid).update({
      twiml: `<Response><Say voice="Polly.Joanna">Connecting you now.</Say><Dial>${safe}</Dial></Response>`
    });
    return { attempted: true, call_sid: sid, transfer_number: to };
  } catch (e) {
    return { attempted: false, reason: e.message || 'twilio_update_failed' };
  }
}

module.exports = { attemptTwilioTransfer };
