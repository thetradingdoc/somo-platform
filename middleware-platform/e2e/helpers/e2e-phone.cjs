'use strict';

/** Valid E.164 test phone: +1 + 10 digits (+1555 + 7-digit suffix). */
function e2eTestPhoneE164() {
  const suffix = String(Date.now()).slice(-7).padStart(7, '0');
  return `+1555${suffix}`;
}

module.exports = { e2eTestPhoneE164 };
