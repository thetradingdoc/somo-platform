/**
 * getAvailableSlotsWithSpecialist
 *
 * Drop-in for specialist-centric slot lookup. Uses SpecialistResolverService
 * when clinic has provider_profiles, otherwise falls back to standard slots.
 *
 *   1. Accepts a provider map from SpecialistResolverService
 *   2. Aggregates availability across those specific providers
 *   3. Returns slots bundled to a specific practitioner_id
 *   4. Handles sync (calendar-based) and async (quota-based) lanes separately
 */

const db = require('../database');

const DEFAULT_SLOT_INTERVAL = 15;
const DEFAULT_APPOINTMENT_DURATION = 50;
const DEFAULT_BUFFER = 10;

const SPECIALTIES = new Set(['Cardiology', 'Dermatology', 'Psychiatry', 'Orthopedics', 'Neurology', 'Pulmonology', 'Gastroenterology', 'Endocrinology', 'PrimaryCare', 'Pediatrics', 'ObstetricsGynecology', 'ENT', 'Ophthalmology', 'InfectiousDisease', 'Oncology', 'EmergencyMedicine']);

/**
 * @param {Object} params
 * @param {string}          params.date         - YYYY-MM-DD
 * @param {string}          params.lane         - 'sync' | 'async'
 * @param {Map}             params.providerMap  - Map<provider_id, attributes> from SpecialistResolverService
 * @param {string}          params.clinicId
 * @param {string}          [params.timezone]
 * @param {string}          [params.appointmentType]
 * @param {number}          [params.durationMinutes]
 * @returns {Promise<SlotBundle[]>}
 */
async function getAvailableSlotsWithSpecialist(params) {
  const {
    date,
    lane = 'sync',
    providerMap,
    clinicId,
    timezone = 'America/New_York',
    appointmentType = 'General Consult',
    durationMinutes = DEFAULT_APPOINTMENT_DURATION
  } = params;

  if (!providerMap || providerMap.size === 0) {
    return [];
  }

  if (lane === 'async') {
    return _buildAsyncSlots(providerMap, date);
  }

  return _buildSyncSlots({ date, providerMap, clinicId, timezone, durationMinutes, appointmentType });
}

function _buildAsyncSlots(providerMap, date) {
  const slots = [];

  for (const [providerId, attrs] of providerMap) {
    const quota = attrs.quota_remaining;
    if (quota === null || quota <= 0) continue;

    slots.push({
      time: 'ASYNC',
      practitioner_id: providerId,
      practitioner_name: attrs.display_name,
      specialty: Array.isArray(attrs.specialty) ? attrs.specialty[0] : attrs.specialty,
      language: _primaryLanguage(attrs.languages),
      price_tier: attrs.price_tier,
      lane: 'async',
      match_reason: attrs.match_reason || '',
      slot_start_iso: null,
      is_async: true,
      quota_remaining: quota,
      estimated_response_hours: _estimateAsyncResponse(attrs)
    });
  }

  return slots.sort((a, b) => (b.quota_remaining || 0) - (a.quota_remaining || 0));
}

async function _buildSyncSlots({ date, providerMap, clinicId, timezone, durationMinutes, appointmentType }) {
  const allSlots = [];
  const totalBlock = durationMinutes + DEFAULT_BUFFER * 2;

  let clinicHours;
  try {
    const { getClinicBusinessHours } = require('../config/clinic-business-hours');
    clinicHours = getClinicBusinessHours(clinicId);
  } catch (_) {
    clinicHours = { start: 9, end: 17 };
  }

  for (const [providerId, attrs] of providerMap) {
    const booked = _getBookedBlocks(providerId, date);
    const availBlocks = _getProviderAvailabilityBlocks(providerId, attrs.email, date);

    const workStart = availBlocks.length > 0 ? availBlocks[0].start : clinicHours.start;
    const workEnd = availBlocks.length > 0 ? availBlocks[availBlocks.length - 1].end : clinicHours.end;

    const specialty = Array.isArray(attrs.specialty) ? attrs.specialty[0] : (attrs.specialty || 'General');

    for (let h = workStart; h < workEnd; h++) {
      for (let m = 0; m < 60; m += DEFAULT_SLOT_INTERVAL) {
        const slotMinutes = h * 60 + m;
        const slotEndMinutes = slotMinutes + totalBlock;

        if (slotEndMinutes > workEnd * 60) continue;
        if (_hasConflict(slotMinutes, slotEndMinutes, booked)) continue;
        if (availBlocks.length > 0 && !_inAvailabilityBlock(slotMinutes, slotEndMinutes, availBlocks)) continue;

        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const slotStartIso = new Date(`${date}T${timeStr}:00`).toISOString();

        allSlots.push({
          time: timeStr,
          practitioner_id: providerId,
          practitioner_name: attrs.display_name,
          specialty,
          language: _primaryLanguage(attrs.languages),
          price_tier: attrs.price_tier,
          lane: 'sync',
          match_reason: attrs.match_reason || '',
          slot_start_iso: slotStartIso,
          is_async: false
        });
      }
    }
  }

  const seen = new Set();
  return allSlots.filter(slot => {
    const key = slot.time;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.time.localeCompare(b.time));
}

function _hasConflict(slotStart, slotEnd, bookedBlocks) {
  for (const b of bookedBlocks) {
    if (slotStart < b.end && slotEnd > b.start) return true;
  }
  return false;
}

function _inAvailabilityBlock(slotStart, slotEnd, blocks) {
  for (const b of blocks) {
    const blockStart = b.start * 60;
    const blockEnd = b.end * 60;
    if (slotStart >= blockStart && slotEnd <= blockEnd) return true;
  }
  return false;
}

function _getBookedBlocks(providerId, date) {
  try {
    const rows = db.db.prepare(`
      SELECT start_time, end_time FROM appointments
      WHERE (practitioner_id = ? OR provider = ?)
        AND date = ?
        AND status NOT IN ('cancelled', 'completed')
    `).all(providerId, providerId, date);

    return rows.map(r => {
      const s = new Date(r.start_time);
      const e = new Date(r.end_time);
      return {
        start: s.getHours() * 60 + s.getMinutes(),
        end: e.getHours() * 60 + e.getMinutes()
      };
    });
  } catch (_) { return []; }
}

// provider_availability_blocks uses provider_email, start_datetime, end_datetime
// Filter blocks that overlap the requested date and convert to {start, end} hours
function _getProviderAvailabilityBlocks(providerId, providerEmail, date) {
  try {
    const identifier = (providerEmail || providerId || '').toString().trim().toLowerCase();
    if (!identifier) return [];
    const rows = db.db.prepare(`
      SELECT start_datetime, end_datetime FROM provider_availability_blocks
      WHERE provider_email = ? AND block_type = 'available'
        AND date(start_datetime) <= date(?)
        AND date(end_datetime) >= date(?)
      ORDER BY start_datetime
    `).all(identifier, date, date);

    const blocks = [];
    for (const r of rows) {
      const startDt = new Date(r.start_datetime);
      const endDt = new Date(r.end_datetime);
      blocks.push({
        start: startDt.getHours() + startDt.getMinutes() / 60,
        end: endDt.getHours() + endDt.getMinutes() / 60
      });
    }
    return blocks.sort((a, b) => a.start - b.start);
  } catch (_) { return []; }
}

function _primaryLanguage(languages) {
  if (!Array.isArray(languages) || languages.length === 0) return 'en';
  const nonEn = languages.find(l => l !== 'en');
  return nonEn || 'en';
}

function _estimateAsyncResponse(attrs) {
  const remaining = attrs.quota_remaining || 0;
  const total = attrs.review_capacity || 5;
  const fillRate = 1 - (remaining / total);
  if (fillRate < 0.5) return 2;
  if (fillRate < 0.8) return 4;
  return 8;
}

/**
 * Check if appointment_type looks like a specialty (for resolver path)
 */
function isSpecialtyType(appointmentType) {
  if (!appointmentType || typeof appointmentType !== 'string') return false;
  const normalized = appointmentType.trim();
  if (SPECIALTIES.has(normalized)) return true;
  if (SPECIALTIES.has(normalized.replace(/\s+/g, ''))) return true;
  // "Primary Care", "Mental Health" etc
  if (/\b(Primary|Cardiology|Dermatology|Psychiatry|Neurology|Orthopedic|Pulmonology|Gastro|Endocrine|Pediatric|OB|GYN|ENT|Eye|Oncology|Emergency)\b/i.test(normalized)) return true;
  return false;
}

module.exports = {
  getAvailableSlotsWithSpecialist,
  isSpecialtyType
};
