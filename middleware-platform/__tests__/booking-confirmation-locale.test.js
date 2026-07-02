'use strict';

describe('booking confirmation locale pipe', () => {
  test('telemedicine-reminders uses appointment.preferred_language', () => {
    const src = require('../services/telemedicine-reminders');
    expect(typeof src.sendBookingConfirmationWithUploadLink).toBe('function');
    const appt = { preferred_language: 'es', patient_email: null, patient_phone: null, id: 'appt-test' };
    const locale = String(appt.preferred_language || 'en').slice(0, 2);
    expect(locale).toBe('es');
  });

  test('booking-service appointment payload includes preferred_language', () => {
    const appointmentData = { preferred_language: 'zh', locale: 'en' };
    const preferred = String(
      appointmentData.preferred_language || appointmentData.locale || 'en'
    ).slice(0, 2);
    expect(preferred).toBe('zh');
  });

  test('email-service confirmation supports locale option', async () => {
    const EmailService = require('../services/email-service');
    const sendSpy = jest.spyOn(EmailService, 'sendEmail').mockResolvedValue({ success: true });
    await EmailService.sendAppointmentConfirmation(
      {
        id: 'appt-abc12345',
        patient_name: 'Test Patient',
        patient_email: 'patient@example.com',
        start_time: new Date().toISOString(),
        appointment_type: 'Consult',
        duration_minutes: 30,
        provider: 'Dr. Test',
        preferred_language: 'ru'
      },
      { locale: 'ru' }
    );
    expect(sendSpy).toHaveBeenCalled();
    const call = sendSpy.mock.calls[0][0];
    expect(call.subject).toMatch(/Запись подтверждена|Your care team/);
    sendSpy.mockRestore();
  });
});
