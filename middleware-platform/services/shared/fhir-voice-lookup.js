'use strict';

/**
 * Voice-path FHIR lookup — requires verified clinic scope when flagged.
 */
function findFHIRPatientForVoice(db, { phone, clinicId, customerId, merchantId, requireClinicScope = true } = {}) {
  if (!db?.getFHIRPatientByPhone || !phone) return null;
  return db.getFHIRPatientByPhone(phone, {
    clinicId,
    customerId,
    merchantId,
    requireClinicScope: requireClinicScope && !clinicId ? true : requireClinicScope
  });
}

module.exports = {
  findFHIRPatientForVoice
};
