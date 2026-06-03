'use strict';

const db = require('../database');

function parsePayload(row) {
  if (!row?.payload_json) return {};
  try {
    return typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
  } catch (_) {
    return {};
  }
}

function resolvePatientName(patientId) {
  if (!patientId) return null;
  try {
    const fhir = db.getFHIRPatient?.(patientId);
    if (fhir?.name) return fhir.name;
  } catch (_) {}
  return null;
}

function formatActivityRow(row) {
  const payload = parsePayload(row);
  const patientId = payload.patient_id || null;
  const patientName = payload.patient_name || resolvePatientName(patientId) || 'Patient';
  const base = {
    id: row.id,
    at: row.created_at,
    event_type: row.event_type,
    session_id: row.session_id || row.call_id || null,
    patient_id: patientId,
    payment_id: payload.payment_id || null,
  };

  switch (row.event_type) {
    case 'appointment_booked': {
      const apptType = payload.appointment_type || payload.specialty || 'visit';
      return {
        ...base,
        icon: 'calendar-days',
        headline: `Kelly booked ${patientName}`,
        subline: apptType,
        href: payload.patient_id
          ? `patient-case.html?patient_id=${encodeURIComponent(payload.patient_id)}`
          : 'calendar.html',
      };
    }
    case 'payment_link_sent':
    case 'collection_outreach': {
      const amt = payload.amount != null ? `$${Number(payload.amount).toFixed(2)}` : '';
      return {
        ...base,
        icon: 'credit-card',
        headline: `Payment link sent · ${patientName}${amt ? ` · ${amt}` : ''}`,
        subline: row.event_type === 'collection_outreach' ? 'Collection outreach via Kelly' : 'Secure pay link',
        href: 'revenue.html?tab=payments',
      };
    }
    case 'language_detected': {
      const lang = payload.language || 'unknown';
      return {
        ...base,
        icon: 'microphone',
        headline: `Kelly detected ${lang} on call`,
        subline: 'Language session started',
        href: 'agent.html',
      };
    }
    case 'call_completed': {
      const disposition = payload.disposition || 'completed';
      return {
        ...base,
        icon: 'phone',
        headline: `Kelly call ${disposition.replace(/_/g, ' ')}`,
        subline: payload.final_lane ? `Lane: ${payload.final_lane}` : '',
        href: 'agent.html',
      };
    }
    case 'runtime_blocked':
      return {
        ...base,
        icon: 'exclamation-triangle',
        headline: 'Kelly blocked an unsafe action',
        subline: payload.runtime || 'Runtime guard',
        href: 'agent.html',
      };
    case 'turn_resolved': {
      const tools = (payload.tools_used || []).map((t) => String(t).toLowerCase());
      if (tools.some((t) => t.includes('schedule_appointment'))) {
        return {
          ...base,
          icon: 'calendar-days',
          headline: `Kelly booked ${patientName}`,
          subline: 'Appointment scheduled',
          href: patientId ? `patient-case.html?patient_id=${encodeURIComponent(patientId)}` : 'calendar.html',
        };
      }
      if (tools.some((t) => t.includes('request_patient_payment'))) {
        return {
          ...base,
          icon: 'credit-card',
          headline: `Kelly sent payment link · ${patientName}`,
          subline: 'Patient collection',
          href: 'revenue.html?tab=payments',
        };
      }
      return null;
    }
    default:
      return null;
  }
}

function listActivityForClinic(clinicId, { limit = 20, since = null } = {}) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = db.listKellyCallEventsForClinic
    ? db.listKellyCallEventsForClinic(String(clinicId), { limit: cap * 3, since })
    : [];

  const items = [];
  for (const row of rows) {
    const formatted = formatActivityRow(row);
    if (formatted) items.push(formatted);
    if (items.length >= cap) break;
  }
  return items;
}

module.exports = {
  listActivityForClinic,
  formatActivityRow,
  parsePayload,
};
