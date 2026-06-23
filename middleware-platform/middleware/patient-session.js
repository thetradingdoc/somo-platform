'use strict';

const crypto = require('crypto');
const db = require('../database');
const PatientPortalService = require('../services/patient/patient-portal-service');
const { ensurePatientPortalEventsTable } = require('../lib/patient-portal-events');

function requirePatientSession(req, res, next) {
  const headerSession = req.headers['x-session-id'];
  const cookieSession = req.cookies?.patient_session_id;
  const sessionId = headerSession || cookieSession;
  if (!sessionId) {
    return res.status(401).json({ success: false, error: 'x-session-id required' });
  }
  req.usedCookieAuth = !headerSession && !!cookieSession;
  const sessionValidation = PatientPortalService.validateSession(sessionId);
  if (!sessionValidation.valid) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
  req.patientSessionId = sessionId;
  req.patientSession = sessionValidation;
  return next();
}

function resolvePatientIdFromSession(sessionValidation) {
  try {
    if (!sessionValidation) return { patientId: null, patientRow: null };
    if (sessionValidation.patient_id && db.getFHIRPatient) {
      const r = db.getFHIRPatient(sessionValidation.patient_id);
      return { patientId: sessionValidation.patient_id, patientRow: r || null };
    }
    if (sessionValidation.email && db.getFHIRPatientByEmail) {
      const r = db.getFHIRPatientByEmail(sessionValidation.email);
      return { patientId: r ? r.resource_id : null, patientRow: r || null };
    }
    if (sessionValidation.phone && db.getFHIRPatientByPhone) {
      const r = db.getFHIRPatientByPhone(sessionValidation.phone);
      return { patientId: r ? r.resource_id : null, patientRow: r || null };
    }
    return { patientId: sessionValidation.patient_id || null, patientRow: null };
  } catch (_) {
    return { patientId: sessionValidation?.patient_id || null, patientRow: null };
  }
}

function recordPatientPortalEvent(req, eventName, metadata = {}) {
  try {
    ensurePatientPortalEventsTable();
    const name = String(eventName || '').trim();
    if (!name) return;
    const sessionId = req.patientSessionId;
    if (!sessionId) return;
    const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
    let metaStr = '{}';
    try {
      metaStr = JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {});
    } catch (_) {
      metaStr = '{}';
    }
    if (metaStr.length > 4000) metaStr = `${metaStr.slice(0, 3997)}...`;
    const id = `ppe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    db.db.prepare(`
      INSERT INTO patient_portal_events (id, session_id, patient_id, event_name, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, sessionId, patientId || null, name, metaStr);
  } catch (_) {}
}

function issueCsrfCookie(res) {
  const isSecure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  const token = crypto.randomBytes(20).toString('hex');
  res.cookie('patient_csrf', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 24 * 60 * 60 * 1000,
  });
  return token;
}

function requireCsrfForCookieAuth(req, res, next) {
  const method = (req.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (!unsafe) return next();
  if (!req.usedCookieAuth) return next();

  const cookieToken = (req.cookies?.patient_csrf || '').toString();
  const headerToken = (req.headers['x-csrf-token'] || '').toString();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ success: false, error: 'CSRF validation failed' });
  }
  return next();
}

async function rotatePatientSessionIfNeeded(req, res) {
  if (!req.usedCookieAuth) return;
  const hours = parseInt(process.env.PATIENT_SESSION_ROTATE_HOURS || '6', 10);
  const rotateMs = Math.max(1, hours) * 60 * 60 * 1000;
  try {
    const row = db.db
      .prepare(`
      SELECT id, email, phone, patient_id, verified, verified_at
      FROM patient_portal_sessions
      WHERE id = ? LIMIT 1
    `)
      .get(req.patientSessionId);
    if (!row || !row.verified) return;
    const verifiedAtMs = row.verified_at ? new Date(row.verified_at).getTime() : NaN;
    if (Number.isNaN(verifiedAtMs)) return;
    if (Date.now() - verifiedAtMs < rotateMs) return;

    const { v4: uuidv4 } = require('uuid');
    const newId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.db
      .prepare(`
      INSERT INTO patient_portal_sessions
        (id, patient_id, phone, email, verification_code, verified, verified_at, expires_at, created_at, last_seen_at)
      VALUES
        (?, ?, ?, ?, NULL, 1, datetime('now'), ?, datetime('now'), datetime('now'))
    `)
      .run(newId, row.patient_id || null, row.phone || null, row.email || null, expiresAt);

    db.db
      .prepare(`
      UPDATE patient_portal_sessions
      SET revoked_at = datetime('now'), rotated_to = ?
      WHERE id = ?
    `)
      .run(newId, row.id);

    const isSecure = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
    res.cookie('patient_session_id', newId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 24 * 60 * 60 * 1000,
    });
    issueCsrfCookie(res);
  } catch (e) {
    console.warn('rotatePatientSessionIfNeeded failed:', e?.message || e);
  }
}

module.exports = {
  requirePatientSession,
  resolvePatientIdFromSession,
  recordPatientPortalEvent,
  issueCsrfCookie,
  requireCsrfForCookieAuth,
  rotatePatientSessionIfNeeded,
  PatientPortalService,
};
