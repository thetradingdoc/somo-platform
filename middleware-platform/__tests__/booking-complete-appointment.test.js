'use strict';

jest.mock('../database', () => ({
  getAppointment: jest.fn(),
  updateAppointmentStatus: jest.fn()
}));

jest.mock('../services/fhir-service', () => ({
  createDiagnosticReportForAppointment: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../database');
const BookingService = require('../services/booking-service');

describe('BookingService.completeAppointment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks scheduled appointment as completed', async () => {
    db.getAppointment.mockResolvedValue({
      id: 'appt-1',
      status: 'scheduled',
      clinic_id: 'clinic-1'
    });

    await BookingService.completeAppointment('appt-1', 'clinic-1');

    expect(db.updateAppointmentStatus).toHaveBeenCalledWith('appt-1', 'completed', null, 'clinic-1');
  });

  it('no-ops when already completed', async () => {
    db.getAppointment.mockResolvedValue({
      id: 'appt-2',
      status: 'completed',
      clinic_id: 'clinic-1'
    });

    await BookingService.completeAppointment('appt-2', 'clinic-1');

    expect(db.updateAppointmentStatus).not.toHaveBeenCalled();
  });
});
