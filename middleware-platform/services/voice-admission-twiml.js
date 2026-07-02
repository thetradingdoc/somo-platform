'use strict';

function escapeTwimlText(text) {
  return String(text || '').replace(/[<>&"']/g, '');
}

/**
 * Build Twilio TwiML for an admission decision (PSTN forward or hangup).
 * @param {{ allowed?: boolean, action?: string, message?: string, transferNumber?: string|null }} admission
 */
function buildAdmissionTwiml(admission) {
  const msg = escapeTwimlText(admission?.message || 'This office is not available right now.');
  const action = admission?.action || (admission?.allowed ? 'connect' : 'hangup');
  const pstn =
    action === 'forward_pstn' && admission?.transferNumber
      ? escapeTwimlText(admission.transferNumber)
      : null;

  if (pstn) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${msg}</Say>
  <Dial>${pstn}</Dial>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${msg}</Say>
  <Hangup/>
</Response>`;
}

module.exports = { buildAdmissionTwiml, escapeTwimlText };
