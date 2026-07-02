'use strict';

const { SomoAdapter } = require('./somo-adapter');
const { AthenaAdapter } = require('./athena-adapter');
const { DentrixAdapter } = require('./dentrix-adapter');
const { EaglesoftAdapter } = require('./eaglesoft-adapter');
const { PmsError, PMS_ERROR } = require('./pms-errors');
const {
  getClinicPmsSettings,
  updateClinicPms,
  findIdempotentWrite,
  insertPmsWriteLog,
  setAppointmentPmsFields
} = require('./pms-store');

const LOOKUP_TIMEOUT_MS = parseInt(process.env.PMS_LOOKUP_TIMEOUT_MS || '2000', 10);
const contextCache = new Map();
const CONTEXT_TTL_MS = 15 * 60 * 1000;
const { getOrCreate } = require('../../utils/circuit-breaker');
const pmsBreaker = () => getOrCreate('PMS_HUB');

function breakerExecute(fn) {
  return pmsBreaker().execute(fn);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new PmsError(PMS_ERROR.TIMEOUT, `${label} timed out`)), ms);
    })
  ]);
}

function createAdapter(clinicId, settings) {
  const type = (settings.pms_type || 'somo').toLowerCase();
  if (type === 'none') return null;
  switch (type) {
    case 'athena':
      return new AthenaAdapter(clinicId, settings.pms_config || {});
    case 'dentrix':
      return new DentrixAdapter(clinicId, settings.pms_config || {});
    case 'eaglesoft':
      return new EaglesoftAdapter(clinicId, settings.pms_config || {});
    case 'somo':
    default:
      return new SomoAdapter(clinicId, settings.pms_config || {});
  }
}

class PmsHub {
  constructor(clinicId, settings) {
    this.clinicId = clinicId;
    this.settings = settings;
    this.adapter = createAdapter(clinicId, settings);
    if (!this.adapter) {
      throw new PmsError(PMS_ERROR.NOT_ENABLED, 'PMS adapter not configured');
    }
    this.pmsType = settings.pms_type || 'somo';
  }

  static forClinic(clinicId) {
    if (!clinicId) {
      throw new PmsError(PMS_ERROR.NOT_ENABLED, 'clinic_id required');
    }
    const settings = getClinicPmsSettings(clinicId);
    if (!settings) {
      throw new PmsError(PMS_ERROR.NOT_ENABLED, `Clinic not found: ${clinicId}`);
    }
    if (!settings.pms_enabled || String(settings.pms_type || '').toLowerCase() === 'none') {
      throw new PmsError(PMS_ERROR.NOT_ENABLED, 'PMS integration disabled for clinic');
    }
    return new PmsHub(clinicId, settings);
  }

  static tryForClinic(clinicId) {
    try {
      return PmsHub.forClinic(clinicId);
    } catch (_) {
      return null;
    }
  }

  _audit(action, resourceType, resourceId, patientId, ip) {
    try {
      const db = require('../../database');
      if (db.insertHipaaAccessLog) {
        db.insertHipaaAccessLog({
          resource_type: resourceType || 'PMS',
          resource_id: resourceId || this.clinicId,
          patient_id: patientId || null,
          action,
          ip_address: ip || null
        });
      }
      if (db.auditLog) {
        db.auditLog('system', this.clinicId, action, resourceType || 'PMS', resourceId, ip, null, 'success');
      }
    } catch (_) {}
  }

  async healthCheck() {
    const result = await this.adapter.healthCheck();
    return {
      ...result,
      clinic_id: this.clinicId,
      pms_enabled: this.settings.pms_enabled,
      last_sync_at: this.settings.pms_last_sync_at,
      last_error: this.settings.pms_last_error
    };
  }

  async lookupPatient(criteria = {}) {
    try {
      const patient = await breakerExecute(() =>
        withTimeout(this.adapter.lookupPatient(criteria), LOOKUP_TIMEOUT_MS, 'lookupPatient')
      );
      this._audit('PMS_LOOKUP', 'Patient', patient?.id, patient?.id);
      if (patient && criteria.phone) {
        /* high confidence only for single phone match */
      }
      return patient;
    } catch (e) {
      if (e instanceof PmsError && e.code === PMS_ERROR.AMBIGUOUS_MATCH) throw e;
      console.warn('[PmsHub] lookupPatient failed:', e.message);
      const db = require('../../database');
      if (db.incrementOpsCounter) try { db.incrementOpsCounter('pms_lookup_fail'); } catch (_) {}
      throw e;
    }
  }

  async getSchedule(params) {
    return breakerExecute(() =>
      this.adapter.getSchedule({ ...params, clinic_id: this.clinicId })
    );
  }

  async bookAppointment(data, { idempotency_key, ip } = {}) {
    if (idempotency_key) {
      const prior = findIdempotentWrite(idempotency_key);
      if (prior?.resource_id) {
        return {
          success: true,
          idempotent: true,
          appointment: { id: prior.resource_id },
          pms_external_id: prior.resource_id
        };
      }
    }
    const result = await breakerExecute(() =>
      this.adapter.bookAppointment({
        ...data,
        clinic_id: data.clinic_id || this.clinicId
      })
    );
    const apptId = result?.appointment?.id || result?.appointment_id || result?.id;
    if (result?.success && apptId) {
      setAppointmentPmsFields(apptId, {
        pms_source: result.pms_source || this.pmsType,
        pms_external_id: result.pms_external_id || apptId,
        pms_sync_status: 'synced'
      });
      insertPmsWriteLog({
        clinic_id: this.clinicId,
        action: 'book_appointment',
        resource_type: 'appointment',
        resource_id: apptId,
        status: 'success',
        idempotency_key: idempotency_key || null,
        payload_json: { date: data.date, time: data.time }
      });
      this._audit('PMS_BOOK', 'Appointment', apptId, data.patient_id, ip);
      updateClinicPms(this.clinicId, {
        pms_last_sync_at: new Date().toISOString(),
        pms_last_error: null
      });
    } else if (!result?.success) {
      insertPmsWriteLog({
        clinic_id: this.clinicId,
        action: 'book_appointment',
        resource_type: 'appointment',
        status: 'failed',
        error: result?.error || 'book failed',
        idempotency_key: idempotency_key || null
      });
      updateClinicPms(this.clinicId, { pms_last_error: result?.error || 'book failed' });
    }
    return result;
  }

  async rescheduleAppointment(appointmentId, newDate, newTime, reason, timezone, opts = {}) {
    const result = await this.adapter.rescheduleAppointment(
      appointmentId,
      newDate,
      newTime,
      reason,
      timezone
    );
    insertPmsWriteLog({
      clinic_id: this.clinicId,
      action: 'reschedule_appointment',
      resource_type: 'appointment',
      resource_id: appointmentId,
      status: result?.success ? 'success' : 'failed',
      error: result?.error || null,
      idempotency_key: opts.idempotency_key || null
    });
    return result;
  }

  async cancelAppointment(appointmentId, reason, opts = {}) {
    const result = await this.adapter.cancelAppointment(appointmentId, reason);
    insertPmsWriteLog({
      clinic_id: this.clinicId,
      action: 'cancel_appointment',
      resource_type: 'appointment',
      resource_id: appointmentId,
      status: result?.success ? 'success' : 'failed',
      error: result?.error || null,
      idempotency_key: opts.idempotency_key || null
    });
    return result;
  }

  async writeNote(params, opts = {}) {
    try {
      const result = await breakerExecute(() => this.adapter.writeNote(params));
      insertPmsWriteLog({
        clinic_id: this.clinicId,
        action: 'write_note',
        resource_type: params.appointment_id ? 'appointment' : 'patient',
        resource_id: params.appointment_id || params.patient_id,
        status: result?.success ? 'success' : 'failed',
        error: result?.error || null,
        idempotency_key: opts.idempotency_key || null,
        payload_json: { note_type: params.note_type, text: params.text }
      });
      if (result?.success) {
        this._audit('PMS_WRITE_NOTE', 'Note', params.appointment_id || params.patient_id, params.patient_id, opts.ip);
        updateClinicPms(this.clinicId, { pms_last_sync_at: new Date().toISOString(), pms_last_error: null });
      }
      return result;
    } catch (e) {
      insertPmsWriteLog({
        clinic_id: this.clinicId,
        action: 'write_note',
        resource_type: 'note',
        status: 'failed',
        error: e.message,
        idempotency_key: opts.idempotency_key || null,
        payload_json: params
      });
      throw e;
    }
  }

  async getPatientContext({ caller_phone, dob, patient_id, call_id } = {}) {
    const cacheKey = call_id || `${this.clinicId}:${caller_phone}:${patient_id || ''}`;
    const cached = contextCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CONTEXT_TTL_MS) {
      return cached.value;
    }

    const degraded = { success: true, patient: null, degraded: true, pms_type: this.pmsType };

    try {
      let patient = null;
      if (patient_id) {
        patient = await withTimeout(
          this.adapter.lookupPatient({ patient_id, phone: caller_phone, dob }),
          LOOKUP_TIMEOUT_MS,
          'getPatientContext'
        );
      } else if (caller_phone) {
        patient = await withTimeout(
          this.adapter.lookupPatient({ phone: caller_phone, dob }),
          LOOKUP_TIMEOUT_MS,
          'getPatientContext'
        );
      }

      if (patient && patient.match_confidence === 'low') {
        patient = null;
      }

      let next_appointment = null;
      let balance_flag = false;
      let has_insurance = false;

      if (patient?.id && this.adapter.getNextAppointment) {
        next_appointment = await this.adapter.getNextAppointment(patient.id);
      }

      if (patient?.id) {
        const db = require('../../database');
        if (db.db) {
          const elig = db.db.prepare(`
            SELECT eligible FROM eligibility_checks
            WHERE patient_id = ? ORDER BY datetime(created_at) DESC LIMIT 1
          `).get(patient.id);
          has_insurance = elig != null;
          const unpaid = db.db.prepare(`
            SELECT COUNT(*) AS c FROM appointments
            WHERE patient_id = ? AND clinic_id = ? AND payment_status = 'unpaid'
              AND status IN ('scheduled', 'confirmed')
          `).get(patient.id, this.clinicId);
          balance_flag = (unpaid?.c || 0) > 0;
        }
      }

      const ctx = {
        success: true,
        patient,
        next_appointment,
        balance_flag,
        has_insurance,
        is_returning: !!patient?.is_returning,
        pms_type: this.pmsType,
        degraded: false
      };

      contextCache.set(cacheKey, { ts: Date.now(), value: ctx });
      return ctx;
    } catch (e) {
      if (e instanceof PmsError && e.code === PMS_ERROR.AMBIGUOUS_MATCH) {
        return { ...degraded, error: e.message, ambiguous: true };
      }
      console.warn('[PmsHub] getPatientContext degraded:', e.message);
      return { ...degraded, error: e.message };
    }
  }
}

function clearContextCache() {
  contextCache.clear();
}

module.exports = { PmsHub, createAdapter, clearContextCache, withTimeout };
