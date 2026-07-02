'use strict';

const { BasePmsAdapter } = require('./pms-adapter');
const { PmsError, PMS_ERROR } = require('./pms-errors');

class EaglesoftAdapter extends BasePmsAdapter {
  constructor(clinicId, settings = {}) {
    super(clinicId, settings);
    this.pmsType = 'eaglesoft';
  }

  _blocked() {
    throw new PmsError(
      PMS_ERROR.NOT_CONFIGURED,
      'Eaglesoft adapter requires partner API access (Phase 3B)'
    );
  }

  async healthCheck() {
    return {
      ok: false,
      pms_type: 'eaglesoft',
      message: 'Eaglesoft partner access required (Phase 3B)'
    };
  }

  async lookupPatient() { return this._blocked(); }
  async getSchedule() { return this._blocked(); }
  async bookAppointment() { return this._blocked(); }
  async rescheduleAppointment() { return this._blocked(); }
  async cancelAppointment() { return this._blocked(); }
  async writeNote() { return this._blocked(); }
}

module.exports = { EaglesoftAdapter };
