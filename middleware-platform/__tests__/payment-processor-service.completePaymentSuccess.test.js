const db = require('../database');
const { completePaymentSuccess } = require('../services/payment-processor-service');

describe('PaymentProcessorService.completePaymentSuccess', () => {
  test('marks appointment paid and confirmed', async () => {
    const apptId = 'appt-test-1';
    db.db.prepare(`DELETE FROM appointments WHERE id = ?`).run(apptId);
    db.db.prepare(`
      INSERT INTO appointments (id, patient_name, date, time, start_time, end_time, duration_minutes, status, payment_status)
      VALUES (?, 'Test', '2025-01-01', '10:00', '2025-01-01T10:00:00', '2025-01-01T11:00:00', 60, 'scheduled', 'unpaid')
    `).run(apptId);

    const checkout = {
      id: 'checkout-1',
      amount: 100,
      appointment_id: apptId,
      clinic_id: null,
      merchant_id: null,
      customer_email: null,
      customer_phone: null
    };

    await completePaymentSuccess({ checkout, amount: 100, paymentMethod: 'card', paymentIntentId: 'pi_test' });

    const appt = db.db.prepare(`SELECT status, payment_status FROM appointments WHERE id = ?`).get(apptId);
    expect(appt.payment_status).toBe('paid');
    expect(['confirmed', 'completed']).toContain(appt.status);
  });
});

