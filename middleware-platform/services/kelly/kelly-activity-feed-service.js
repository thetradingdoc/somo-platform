'use strict';

const db = require('../../database');

const PRIORITY_EVENT_TYPES = new Set([
  'appointment_booked',
  'appointment_cancelled',
  'appointment_rescheduled',
  'payment_link_sent',
  'tool_completed'
]);

const TOOL_COMPLETED_HEADLINES = {
  schedule_appointment: { icon: 'calendar-days', verb: 'booked' },
  cancel_appointment: { icon: 'calendar-xmark', verb: 'canceled an appointment for' },
  reschedule_appointment: { icon: 'calendar-days', verb: 'rescheduled' },
  request_patient_payment: { icon: 'credit-card', verb: 'sent a payment link to' }
};

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

function callDetailHref(sessionId) {
  if (!sessionId) return 'calls.html';
  return `calls.html?session=${encodeURIComponent(sessionId)}`;
}

function calendarApptHref(payload, sessionId) {
  if (payload.appointment_id) {
    return `calendar.html?id=${encodeURIComponent(payload.appointment_id)}`;
  }
  if (sessionId) return callDetailHref(sessionId);
  return 'calendar.html';
}

function formatToolCompletedRow(base, payload, patientName) {
  const toolName = String(payload.tool_name || payload.tool || '').toLowerCase();
  const spec = TOOL_COMPLETED_HEADLINES[toolName];
  if (!spec) return null;

  if (toolName === 'request_patient_payment') {
    const amt = payload.amount != null ? `$${Number(payload.amount).toFixed(2)}` : '';
    return {
      ...base,
      icon: spec.icon,
      headline: `Kelly sent payment link · ${patientName}${amt ? ` · ${amt}` : ''}`,
      subline: 'Secure pay link',
      href: base.session_id ? callDetailHref(base.session_id) : 'revenue.html?tab=payments'
    };
  }

  if (toolName === 'schedule_appointment') {
    const apptType = payload.appointment_type || payload.specialty || 'visit';
    return {
      ...base,
      icon: spec.icon,
      headline: `Kelly booked ${patientName}`,
      subline: apptType,
      href: calendarApptHref(payload, base.session_id)
    };
  }

  if (toolName === 'cancel_appointment') {
    return {
      ...base,
      icon: spec.icon,
      headline: `Kelly canceled appointment for ${patientName}`,
      subline: payload.appointment_type || 'Canceled via Kelly',
      href: calendarApptHref(payload, base.session_id)
    };
  }

  if (toolName === 'reschedule_appointment') {
    const when = payload.when || payload.appointment_time || '';
    return {
      ...base,
      icon: spec.icon,
      headline: `Kelly rescheduled ${patientName}`,
      subline: when ? `New time: ${when}` : 'Appointment rescheduled',
      href: calendarApptHref(payload, base.session_id)
    };
  }

  return null;
}

function formatActivityRow(row) {
  const payload = parsePayload(row);
  const patientId = payload.patient_id || null;
  const patientName = payload.patient_name || resolvePatientName(patientId) || 'Patient';
  const sessionId = row.session_id || row.call_id || payload.session_id || null;
  const base = {
    id: row.id,
    at: row.created_at,
    event_type: row.event_type,
    session_id: sessionId,
    appointment_id: payload.appointment_id || null,
    patient_id: patientId,
    payment_id: payload.payment_id || null
  };

  switch (row.event_type) {
    case 'appointment_booked': {
      const apptType = payload.appointment_type || payload.specialty || 'visit';
      return {
        ...base,
        icon: 'calendar-days',
        headline: `Kelly booked ${patientName}`,
        subline: apptType,
        href: calendarApptHref(payload, sessionId)
      };
    }
    case 'appointment_cancelled':
      return {
        ...base,
        icon: 'calendar-xmark',
        headline: `Kelly canceled appointment for ${patientName}`,
        subline: payload.appointment_type || 'Canceled via Kelly',
        href: calendarApptHref(payload, sessionId)
      };
    case 'appointment_rescheduled': {
      const when = payload.when || [payload.date, payload.time].filter(Boolean).join(' at ');
      return {
        ...base,
        icon: 'calendar-days',
        headline: `Kelly rescheduled ${patientName}`,
        subline: when || 'Appointment rescheduled',
        href: calendarApptHref(payload, sessionId)
      };
    }
    case 'tool_completed':
      return formatToolCompletedRow(base, payload, patientName);
    case 'payment_link_sent':
    case 'collection_outreach': {
      const amt = payload.amount != null ? `$${Number(payload.amount).toFixed(2)}` : '';
      return {
        ...base,
        icon: 'credit-card',
        headline: `Payment link sent · ${patientName}${amt ? ` · ${amt}` : ''}`,
        subline: row.event_type === 'collection_outreach' ? 'Collection outreach via Kelly' : 'Secure pay link',
        href: sessionId ? callDetailHref(sessionId) : 'revenue.html?tab=payments'
      };
    }
    case 'language_detected': {
      const lang = payload.language || 'unknown';
      return {
        ...base,
        icon: 'microphone',
        headline: `Kelly detected ${lang} on call`,
        subline: 'Language session started',
        href: callDetailHref(sessionId)
      };
    }
    case 'call_completed': {
      const disposition = payload.disposition || 'completed';
      return {
        ...base,
        icon: 'phone',
        headline: `Kelly call ${disposition.replace(/_/g, ' ')}`,
        subline: payload.final_lane ? `Lane: ${payload.final_lane}` : '',
        href: callDetailHref(sessionId)
      };
    }
    case 'runtime_blocked':
      return {
        ...base,
        icon: 'exclamation-triangle',
        headline: 'Kelly blocked an unsafe action',
        subline: payload.runtime || 'Runtime guard',
        href: callDetailHref(sessionId)
      };
    case 'turn_resolved':
      return null;
    default:
      return null;
  }
}

function eventPriority(row) {
  if (PRIORITY_EVENT_TYPES.has(row.event_type)) {
    if (row.event_type === 'tool_completed') return 0;
    return 1;
  }
  if (row.event_type === 'turn_resolved') return 100;
  return 50;
}

function listActivityForClinic(clinicId, { limit = 20, since = null } = {}) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = db.listKellyCallEventsForClinic
    ? db.listKellyCallEventsForClinic(String(clinicId), { limit: cap * 4, since })
    : [];

  const sorted = [...rows].sort((a, b) => {
    const pri = eventPriority(a) - eventPriority(b);
    if (pri !== 0) return pri;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });

  const items = [];
  for (const row of sorted) {
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
  PRIORITY_EVENT_TYPES
};
