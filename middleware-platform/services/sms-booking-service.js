/**
 * SMS Booking Service
 * Call deflection (P2): Handles appointment booking via SMS to reduce voice call volume.
 *
 * Flow: book -> pick date -> pick slot -> confirm -> done
 * Supports: book, cancel, reschedule, hours, help
 */

const db = require('../database');
const BookingService = require('./booking-service');
const SMSService = require('./sms-service');

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const sessions = new Map(); // phone -> { step, data, clinicId, updatedAt }

function getSession(phone) {
  const s = sessions.get(phone);
  if (!s) return null;
  if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
    sessions.delete(phone);
    return null;
  }
  return s;
}

function setSession(phone, data) {
  sessions.set(phone, { ...data, updatedAt: Date.now() });
}

function clearSession(phone) {
  sessions.delete(phone);
}

function resolveClinicFromToNumber(toNumber) {
  if (!toNumber) return null;
  const normalized = SMSService.formatPhoneNumber(toNumber);
  const clinicPhone = db.getClinicPhoneNumber?.(normalized);
  if (clinicPhone?.clinic_id) return clinicPhone.clinic_id;
  const customer = db.getCustomerByTwilioNumber?.(normalized);
  if (customer?.id) return customer.id; // customer_id used as clinic_id for SaaS
  return null;
}

/**
 * Process incoming SMS and return response text.
 * @param {string} from - Sender phone
 * @param {string} to - Our Twilio number
 * @param {string} body - Message text
 * @returns {string} Response to send
 */
async function processIncoming(from, to, body) {
  const msg = (body || '').trim().toLowerCase();
  const clinicId = resolveClinicFromToNumber(to);

  // Quick replies (no session)
  if (msg === 'hours' || msg === 'hour') {
    return "Our office hours are Mon-Fri 9am-5pm. Need to book? Reply BOOK.";
  }
  if (msg === 'help' || msg === 'hi' || msg === 'hello') {
    return "Reply BOOK to schedule, CANCEL to cancel, or HOURS for office hours.";
  }
  if (msg === 'cancel') {
    return "To cancel an appointment, please call us or reply with your confirmation number.";
  }

  // Start booking
  if (msg === 'book' || msg === 'appointment' || msg === 'schedule') {
    if (!clinicId) {
      return "Sorry, we couldn't identify your clinic. Please call to book.";
    }
    clearSession(from);
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const dates = [];
    for (let d = new Date(today); d <= nextWeek; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(d.toISOString().slice(0, 10));
      }
    }
    setSession(from, { step: 'pick_date', clinicId, dates: dates.slice(0, 5) });
    return `Choose a date (reply 1-5):\n${dates.slice(0, 5).map((d, i) => `${i + 1}. ${d}`).join('\n')}`;
  }

  const session = getSession(from);
  if (!session) {
    return "Session expired. Reply BOOK to start over.";
  }

  if (session.step === 'pick_date') {
    const n = parseInt(msg, 10);
    if (n >= 1 && n <= session.dates.length) {
      const date = session.dates[n - 1];
      const slots = await BookingService.getAvailableSlots(date, null, null, 'America/New_York', session.clinicId);
      const slotList = (slots.available_slots || slots.slots || []).slice(0, 8);
      if (slotList.length === 0) {
        clearSession(from);
        return `No slots on ${date}. Reply BOOK for other dates.`;
      }
      setSession(from, { ...session, step: 'pick_slot', date, slots: slotList });
      return `Slots on ${date}:\n${slotList.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nReply 1-${slotList.length} to choose.`;
    }
  }

  if (session.step === 'pick_slot') {
    const n = parseInt(msg, 10);
    if (n >= 1 && n <= (session.slots?.length || 0)) {
      const time = session.slots[n - 1];
      setSession(from, { ...session, step: 'confirm', time });
      return `Confirm: ${session.date} at ${time}? Reply YES to book.`;
    }
  }

  if (session.step === 'confirm' && (msg === 'yes' || msg === 'y')) {
    try {
      const result = await BookingService.scheduleAppointment({
        patient_name: 'SMS Booking',
        patient_phone: from,
        patient_email: null,
        date: session.date,
        time: session.time,
        timezone: 'America/New_York',
        clinic_id: session.clinicId,
        appointment_type: 'Mental Health Consultation'
      });
      clearSession(from);
      if (result.success && result.appointment) {
        return `Booked! Confirmation: ${result.appointment.id || 'see email'}. We'll send a reminder.`;
      }
      return result.message || result.error || "Booking failed. Please call us.";
    } catch (e) {
      clearSession(from);
      return `Sorry, ${e.message}. Please call to book.`;
    }
  }

  if (msg === 'no' || msg === 'n') {
    clearSession(from);
    return "No problem. Reply BOOK when you're ready.";
  }

  return "Sorry, I didn't understand. Reply HELP for options.";
}

module.exports = {
  processIncoming,
  getSession,
  setSession,
  clearSession
};
