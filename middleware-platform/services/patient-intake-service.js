const db = require('../database');
const FHIRService = require('./fhir-service');
const SMSService = require('./sms-service');
const { v4: uuidv4 } = require('uuid');

const PLACE_ID_EXT_URL = 'http://doclittle.ai/fhir/StructureDefinition/placeId';

function safeJson(v) {
  try {
    if (!v) return null;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (_) {
    return null;
  }
}

function getTelecom(resource, system) {
  const telecom = Array.isArray(resource?.telecom) ? resource.telecom : [];
  return telecom.find(t => t && t.system === system && t.value) || null;
}

function upsertTelecom(resource, system, value) {
  if (!value) return;
  resource.telecom = Array.isArray(resource.telecom) ? resource.telecom : [];
  const existing = resource.telecom.find(t => t && t.system === system);
  const next = { system, value, use: 'home' };
  if (existing) {
    existing.value = value;
    if (!existing.use) existing.use = 'home';
  } else {
    resource.telecom.push(next);
  }
}

function extractPlaceIdFromAddress(address) {
  const exts = Array.isArray(address?.extension) ? address.extension : [];
  const ext = exts.find(e => e && e.url === PLACE_ID_EXT_URL);
  return (ext && typeof ext.valueString === 'string') ? ext.valueString : '';
}

function upsertPlaceIdOnAddress(address, placeId) {
  if (!placeId) return;
  address.extension = Array.isArray(address.extension) ? address.extension : [];
  const ext = address.extension.find(e => e && e.url === PLACE_ID_EXT_URL);
  if (ext) {
    ext.valueString = placeId;
  } else {
    address.extension.push({ url: PLACE_ID_EXT_URL, valueString: placeId });
  }
}

function canonicalFromPatientResource(resource) {
  const name0 = Array.isArray(resource?.name) ? resource.name[0] : null;
  const first_name = Array.isArray(name0?.given) ? (name0.given[0] || '') : (name0?.given || '');
  const last_name = (name0 && name0.family) ? String(name0.family) : '';
  const dob = resource?.birthDate ? String(resource.birthDate) : '';

  const email = (getTelecom(resource, 'email')?.value || '').toString();
  const phone = (getTelecom(resource, 'phone')?.value || '').toString();

  const addr0 = Array.isArray(resource?.address) ? resource.address[0] : null;
  const country = (addr0?.country || '').toString();
  const city = (addr0?.city || '').toString();
  const address_line1 = Array.isArray(addr0?.line) ? (addr0.line[0] || '') : (addr0?.line || '');
  const postal_code = (addr0?.postalCode || '').toString();
  const city_place_id = extractPlaceIdFromAddress(addr0);

  return {
    first_name,
    last_name,
    dob,
    phone,
    email,
    country,
    city,
    address_line1,
    postal_code,
    city_place_id
  };
}

function onboardingStatusFromCanonical(intake) {
  const missing = [];
  const req = (k) => {
    if (!intake[k] || !String(intake[k]).trim()) missing.push(k);
  };
  req('first_name');
  req('last_name');
  req('dob');
  req('phone');
  req('country');
  req('city');
   // postal_code is not required for care, only for connect-records; keep it out of onboarding completeness for now.
  return { onboarding_complete: missing.length === 0, missing_fields: missing };
}

async function resolveOrCreatePatientIdFromSession(sessionValidation, incoming = {}) {
  const email = (sessionValidation?.email || incoming.email || '').toString().toLowerCase().trim();
  const phoneRaw = (incoming.phone || '').toString().trim();
  const phone = phoneRaw ? (SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(phoneRaw) : phoneRaw) : '';

  // Try resolve
  let row = null;
  try {
    if (sessionValidation?.patient_id && db.getFHIRPatient) row = db.getFHIRPatient(sessionValidation.patient_id);
    if (!row && email && db.getFHIRPatientByEmail) row = db.getFHIRPatientByEmail(email);
    if (!row && phone && db.getFHIRPatientByPhone) row = db.getFHIRPatientByPhone(phone);
  } catch (_) {}
  if (row?.resource_id) return row.resource_id;

  // Create minimal if possible
  if (!FHIRService || typeof FHIRService.getOrCreatePatient !== 'function') return null;

  const name = [incoming.first_name, incoming.last_name].filter(Boolean).join(' ').trim() || incoming.name || 'Unknown';
  const created = await FHIRService.getOrCreatePatient({ name, phone: phone || undefined, email: email || undefined }, false);
  const patient = created?.patient || null;
  return patient?.id || null;
}

async function upsertIntakeByPatientId(patientId, payload = {}) {
  if (!patientId) return { success: false, error: 'patient_id required' };

  const existingRow = db.getFHIRPatient ? db.getFHIRPatient(patientId) : null;
  let resource = existingRow?.resource_data ? safeJson(existingRow.resource_data) : null;
  if (!resource) {
    resource = { resourceType: 'Patient', id: patientId, active: true };
  }

  // Profile fields
  const first = (payload.first_name || '').toString().trim();
  const last = (payload.last_name || '').toString().trim();
  const dob = (payload.dob || '').toString().trim();

  const phoneRaw = (payload.phone || '').toString().trim();
  const phone = phoneRaw ? (SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(phoneRaw) : phoneRaw) : '';
  const email = (payload.email || '').toString().toLowerCase().trim();

  if (first || last) {
    resource.name = Array.isArray(resource.name) ? resource.name : [{}];
    const n0 = resource.name[0] || {};
    if (first) n0.given = [first];
    if (last) n0.family = last;
    resource.name[0] = n0;
  }
  if (dob) resource.birthDate = dob;
  if (phone) upsertTelecom(resource, 'phone', phone);
  if (email) upsertTelecom(resource, 'email', email);

  // Location fields
  const country = (payload.country || '').toString().trim();
  const city = (payload.city || '').toString().trim();
  const cityPlaceId = (payload.city_place_id || '').toString().trim();
  const address_line1 = (payload.address_line1 || '').toString().trim();
  const postal_code = (payload.postal_code || '').toString().trim();
  if (country || city || cityPlaceId || address_line1 || postal_code) {
    resource.address = Array.isArray(resource.address) ? resource.address : [{}];
    const a0 = resource.address[0] || {};
    if (country) a0.country = country;
    if (city) a0.city = city;
    if (address_line1) {
      a0.line = Array.isArray(a0.line) ? a0.line : [];
      if (a0.line.length === 0) a0.line.push(address_line1);
      else a0.line[0] = address_line1;
    }
    if (postal_code) a0.postalCode = postal_code;
    if (cityPlaceId) upsertPlaceIdOnAddress(a0, cityPlaceId);
    resource.address[0] = a0;
  }

  resource.meta = resource.meta || {};
  resource.meta.lastUpdated = new Date().toISOString();
  resource.meta.versionId = String((parseInt(resource.meta.versionId || '0', 10) || 0) + 1);

  // Persist patient
  try {
    if (db.updateFHIRPatient) db.updateFHIRPatient(patientId, resource);
  } catch (e) {
    return { success: false, error: e.message || 'Failed to update patient' };
  }

  // Insurance (optional)
  const insurance = payload.insurance && typeof payload.insurance === 'object' ? payload.insurance : null;
  if (insurance) {
    const payer_name = (insurance.payer_name || '').toString().trim();
    const payer_id = (insurance.payer_id || '').toString().trim();
    const member_id = (insurance.member_id || '').toString().trim();
    const plan_name = (insurance.plan_name || '').toString().trim();
    if (payer_name || payer_id || member_id) {
      try {
        if (db.upsertPatientInsurance) {
          db.upsertPatientInsurance({
            patient_id: patientId,
            payer_id: payer_id || null,
            payer_name: payer_name || null,
            member_id: member_id || null,
            plan_name: plan_name || null,
            is_primary: 1
          });
        }
      } catch (e) {
        // Non-fatal; still return patient intake
      }
    }
  }

  const canonical = canonicalFromPatientResource(resource);
  const status = onboardingStatusFromCanonical(canonical);

  return {
    success: true,
    patient_id: patientId,
    intake: canonical,
    ...status
  };
}

function canConnectRecordsFromIntake(intake) {
  const hasName = !!((intake.first_name || '').toString().trim() && (intake.last_name || '').toString().trim());
  const hasDob = !!(intake.dob || '').toString().trim();
  const hasContact = !!((intake.email || '').toString().trim() || (intake.phone || '').toString().trim());
  const hasPostal = !!((intake.postal_code || '').toString().trim());
  return hasName && hasDob && hasContact && hasPostal;
}

function matchConfidence(local, candidate) {
  if (!local || !candidate) return 'low';
  let score = 0;
  const norm = (v) => (v || '').toString().trim().toLowerCase();
  if (norm(local.first_name) && norm(candidate.first_name) && norm(local.first_name) === norm(candidate.first_name)) score += 2;
  if (norm(local.last_name) && norm(candidate.last_name) && norm(local.last_name) === norm(candidate.last_name)) score += 2;
  if ((local.dob || '').toString() && (candidate.dob || '').toString() && local.dob === candidate.dob) score += 3;
  if (norm(local.postal_code) && norm(candidate.postal_code) && norm(local.postal_code) === norm(candidate.postal_code)) score += 2;
  if (norm(local.city) && norm(candidate.city) && norm(local.city) === norm(candidate.city)) score += 1;
  if (norm(local.email) && norm(candidate.email) && norm(local.email) === norm(candidate.email)) score += 2;
  if (norm(local.phone) && norm(candidate.phone) && norm(local.phone) === norm(candidate.phone)) score += 2;
  if (score >= 9) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

module.exports = {
  PLACE_ID_EXT_URL,
  canonicalFromPatientResource,
  onboardingStatusFromCanonical,
  resolveOrCreatePatientIdFromSession,
  upsertIntakeByPatientId,
  canConnectRecordsFromIntake,
  matchConfidence
};

