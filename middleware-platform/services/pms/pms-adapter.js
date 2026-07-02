'use strict';

const { PmsError, PMS_ERROR } = require('./pms-errors');

class BasePmsAdapter {
  constructor(clinicId, settings = {}) {
    this.clinicId = clinicId;
    this.settings = settings;
    this.pmsType = 'none';
  }

  async healthCheck() {
    return { ok: true, pms_type: this.pmsType, message: 'ok' };
  }

  async lookupPatient() {
    throw new PmsError(PMS_ERROR.UNSUPPORTED, `${this.pmsType} lookupPatient not implemented`);
  }

  async getSchedule() {
    throw new PmsError(PMS_ERROR.UNSUPPORTED, `${this.pmsType} getSchedule not implemented`);
  }

  async bookAppointment() {
    throw new PmsError(PMS_ERROR.UNSUPPORTED, `${this.pmsType} bookAppointment not implemented`);
  }

  async rescheduleAppointment() {
    throw new PmsError(PMS_ERROR.UNSUPPORTED, `${this.pmsType} rescheduleAppointment not implemented`);
  }

  async cancelAppointment() {
    throw new PmsError(PMS_ERROR.UNSUPPORTED, `${this.pmsType} cancelAppointment not implemented`);
  }

  async writeNote() {
    throw new PmsError(PMS_ERROR.UNSUPPORTED, `${this.pmsType} writeNote not implemented`);
  }
}

module.exports = { BasePmsAdapter };
