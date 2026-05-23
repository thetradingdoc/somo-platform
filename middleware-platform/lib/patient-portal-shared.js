'use strict';

const crypto = require('crypto');
const db = require('../database');

function safeParseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function isIsoDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function localDateFromIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoFromLocalDate(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekdayKeyForIsoLocal(iso) {
  const d = localDateFromIso(iso);
  if (!d) return 'mon';
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
}

function enumerateIsoDates(startIso, endIso) {
  const out = [];
  const start = localDateFromIso(startIso);
  const end = localDateFromIso(endIso);
  if (!start || !end || start > end) return out;
  const cur = new Date(start.getTime());
  while (cur <= end) {
    out.push(isoFromLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function issuePatientDocumentDownloadUrl(req, patientId, docId) {
  try {
    if (!db.createPatientDocumentDownloadToken) return null;
    const ttlSeconds = parseInt(process.env.PATIENT_DOCUMENT_SIGNED_URL_TTL_SECONDS || '300', 10);
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAtIso = new Date(Date.now() + Math.max(30, ttlSeconds) * 1000).toISOString();
    const created = db.createPatientDocumentDownloadToken({
      token,
      doc_id: docId,
      patient_id: patientId,
      expires_at: expiresAtIso,
    });
    if (!created || !created.success) return null;
    return `${req.protocol}://${req.get('host')}/api/patient/documents/download/${token}`;
  } catch (_) {
    return null;
  }
}

module.exports = {
  safeParseJsonArray,
  isIsoDateOnly,
  localDateFromIso,
  isoFromLocalDate,
  weekdayKeyForIsoLocal,
  enumerateIsoDates,
  issuePatientDocumentDownloadUrl,
};
