'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MP = path.join(__dirname, '../../..');
const CATALOG_PATH = path.join(MP, 'tests/fixtures/commerce-supplement-catalog.json');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function ensureMerchant(db, merchantId) {
  if (db.getMerchant?.(merchantId)) return merchantId;
  db.createMerchant?.({
    id: merchantId,
    name: 'Somo Supplements Test',
    api_key: `pstn-fixture-${crypto.randomBytes(4).toString('hex')}`,
    api_url: process.env.API_BASE_URL || 'http://localhost:4000',
    subdomain: `somo-pstn-${crypto.randomBytes(3).toString('hex')}`,
    enabled_platforms: ['voice', 'acp', 'ap2']
  });
  return merchantId;
}

function seedSupplementCatalog(db) {
  const catalog = loadCatalog();
  const merchantId = catalog.merchant_id;
  ensureMerchant(db, merchantId);
  let created = 0;
  let updated = 0;

  for (const p of catalog.products || []) {
    const id = p.product_id;
    const payload = {
      merchant_id: merchantId,
      name: p.name,
      description: p.description || '',
      price: p.price,
      inventory: p.inventory ?? 0,
      category: p.category || 'supplement',
      tags: p.search_terms || []
    };

    const existing = db.getProduct?.(id);
    if (existing) {
      db.updateProduct?.(id, payload);
      updated += 1;
    } else {
      db.createProduct?.({ id, ...payload });
      created += 1;
    }
  }

  return { merchantId, clinicId: catalog.clinic_id, created, updated, productCount: catalog.products.length };
}

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function resolveGoldenDate(token) {
  const raw = String(token || 'tomorrow').toLowerCase().trim();
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  if (raw === 'today') return localDateStr(today);
  if (raw === 'tomorrow') return localDateStr(addDays(today, 1));

  const rel = raw.match(/^(this|next)_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (rel) {
    const target = WEEKDAYS.indexOf(rel[2]);
    let diff = (target - today.getDay() + 7) % 7;
    if (rel[1] === 'next') {
      diff = diff === 0 ? 7 : diff + 7;
    }
    return localDateStr(addDays(today, diff));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return localDateStr(addDays(today, 1));
}

function buildAppointmentTimes(dateStr, timeStr, durationMinutes = 30) {
  const [hhRaw, mmRaw] = String(timeStr || '10:00').split(':');
  const hh = parseInt(hhRaw, 10) || 10;
  const mm = parseInt(mmRaw, 10) || 0;
  const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const start = new Date(`${dateStr}T${time}:00`);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    date: dateStr,
    time,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_minutes: durationMinutes
  };
}

function uniqueTimeFromId(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const minutes = 9 * 60 + (h % (8 * 60));
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeGoldenAppointment(appt, call, clinicId) {
  const meta = call.call_metadata || {};
  const callerPhone = meta.caller_id || '+15551000000';
  const id = appt.id || `apt_pstn_${crypto.randomBytes(4).toString('hex')}`;
  const patientName = appt.patient_name || 'PSTN Replay Patient';
  const dateStr = resolveGoldenDate(appt.date);
  const timeStr = appt.time || uniqueTimeFromId(id);
  const times = buildAppointmentTimes(dateStr, timeStr, appt.duration_minutes || 30);
  const provider = appt.provider || process.env.RCM_E2E_PROVIDER_EMAIL || 'provider@callsomo.com';

  return {
    id,
    clinic_id: clinicId || meta.clinic_id || 'clinic-default',
    patient_name: patientName,
    patient_phone: appt.patient_phone || appt.phone || callerPhone,
    patient_email:
      appt.patient_email ||
      appt.email ||
      `${patientName.toLowerCase().replace(/\s+/g, '.')}@pstn-replay.test`,
    patient_id: appt.patient_id || null,
    appointment_type: appt.appointment_type || appt.visit_type || 'supplement_consult',
    provider,
    status: appt.status || 'scheduled',
    visit_mode: appt.visit_mode || 'sync_video',
    notes: appt.notes || null,
    created_at: appt.created_at || new Date().toISOString(),
    ...times
  };
}

async function seedOneAppointment(db, appt, call, clinicId) {
  const row = normalizeGoldenAppointment(appt, call, clinicId);
  const existing = await db.getAppointment?.(row.id, clinicId);
  if (existing) return row.id;
  await db.createAppointment(row);
  return row.id;
}

async function seedCallPreconditions(db, sessionId, call, merchantId) {
  const pre = call.preconditions || {};
  const sessionSeed = pre.session_seed || {};
  const clinicId = call.call_metadata?.clinic_id || 'clinic-default';

  if (sessionSeed.cart_session_id && Array.isArray(sessionSeed.items)) {
    for (const item of sessionSeed.items) {
      try {
        db.upsertCommerceCartItem?.({
          session_id: sessionId,
          provider_id: merchantId,
          product_id: item.product_id,
          quantity: item.quantity || 1
        });
      } catch (_) {
        /* cart table may use different API */
      }
    }
  }

  if (Array.isArray(pre.appointments)) {
    for (const appt of pre.appointments) {
      try {
        await seedOneAppointment(db, appt, call, clinicId);
      } catch (e) {
        console.warn(`[pstn-replay] appointment seed skipped (${call.id}): ${e.message}`);
      }
    }
  }

  if (sessionSeed.appointment_id && !pre.appointments?.some((a) => a.id === sessionSeed.appointment_id)) {
    try {
      await seedOneAppointment(
        db,
        { id: sessionSeed.appointment_id, patient_name: 'PSTN Replay Patient' },
        call,
        clinicId
      );
    } catch (e) {
      console.warn(`[pstn-replay] session appointment seed skipped (${call.id}): ${e.message}`);
    }
  }

  if (
    sessionSeed.existing_appointment &&
    (!Array.isArray(pre.appointments) || pre.appointments.length === 0)
  ) {
    const searchArgs = (call.turns || []).find((t) => t.tool_call?.name === 'search_appointments')
      ?.tool_call?.args;
    const schedArgs = (call.turns || []).find((t) => t.tool_call?.name === 'schedule_appointment')
      ?.tool_call?.args;
    const src = searchArgs || schedArgs || {};
    try {
      await seedOneAppointment(
        db,
        {
          id: `apt_${call.id}`,
          patient_name: src.patient_name || 'PSTN Replay Patient',
          date: src.date || 'this_friday',
          time: src.time || uniqueTimeFromId(call.id),
          patient_email: src.email || undefined
        },
        call,
        clinicId
      );
    } catch (e) {
      console.warn(`[pstn-replay] existing_appointment seed skipped (${call.id}): ${e.message}`);
    }
  }
}

function newSessionId(callId) {
  return `pstn_${callId}_${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  CATALOG_PATH,
  loadCatalog,
  seedSupplementCatalog,
  seedCallPreconditions,
  normalizeGoldenAppointment,
  resolveGoldenDate,
  buildAppointmentTimes,
  newSessionId
};
