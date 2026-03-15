const db = require('../database');

class VisitBundleService {
  /**
   * Build a FHIR-style bundle for a visit/encounter suitable for export or EHR sync.
   * This is a lightweight, internal representation; mapping to full FHIR occurs in fhir-adapter.
   */
  static buildVisitBundle(appointmentId) {
    const appt = db.getAppointment(appointmentId);
    if (!appt) {
      throw new Error(`Appointment not found: ${appointmentId}`);
    }

    const patient = appt.patient_id ? db.getFHIRPatient?.(appt.patient_id) : null;
    const claim = db.getInsuranceClaimByAppointmentId
      ? db.getInsuranceClaimByAppointmentId(appointmentId)
      : null;

    const eligibilityChecks = appt.patient_id && db.getEligibilityChecksByPatient
      ? db.getEligibilityChecksByPatient(appt.patient_id)
      : [];

    const latestEligibility = eligibilityChecks && eligibilityChecks.length > 0
      ? eligibilityChecks[0]
      : null;

    const resources = [];

    if (patient) {
      resources.push({
        resourceType: 'Patient',
        id: patient.resource_id,
        doclittle_source: 'db'
      });
    }

    resources.push({
      resourceType: 'Encounter',
      id: `enc-${appointmentId}`,
      status: appt.status,
      class: { code: 'AMB' },
      period: {
        start: appt.start_time || null,
        end: appt.end_time || null
      },
      doclittle: {
        appointment_id: appt.id,
        clinic_id: appt.clinic_id,
        appointment_type: appt.appointment_type
      }
    });

    if (claim) {
      resources.push({
        resourceType: 'Claim',
        id: claim.id,
        status: claim.status,
        type: { coding: [{ code: 'professional' }] },
        total: { value: claim.total_amount, currency: 'USD' },
        doclittle: {
          member_id: claim.member_id,
          payer_id: claim.payer_id,
          service_code: claim.service_code,
          diagnosis_code: claim.diagnosis_code
        }
      });
    }

    if (latestEligibility) {
      resources.push({
        resourceType: 'CoverageEligibilityResponse',
        id: latestEligibility.id,
        status: latestEligibility.eligible ? 'active' : 'inactive',
        outcome: latestEligibility.eligible ? 'complete' : 'error',
        doclittle: {
          payer_id: latestEligibility.payer_id,
          member_id: latestEligibility.member_id,
          copay_amount: latestEligibility.copay_amount,
          allowed_amount: latestEligibility.allowed_amount,
          insurance_pays: latestEligibility.insurance_pays
        }
      });
    }

    return {
      resourceType: 'Bundle',
      type: 'document',
      timestamp: new Date().toISOString(),
      entry: resources.map(r => ({ resource: r }))
    };
  }
}

module.exports = VisitBundleService;

