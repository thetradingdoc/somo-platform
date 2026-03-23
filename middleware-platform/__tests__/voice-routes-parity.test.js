/**
 * C11: Reschedule must require session id when REQUIRE_TRIAGE_FOR_VOICE is on, but must NOT
 * apply the full OPQRST/triage DB block (asymmetric vs schedule). Guard with source inspection.
 */
const fs = require('fs');
const path = require('path');

describe('Voice reschedule asymmetry (§3.1)', () => {
  it('/voice/appointments/reschedule uses requireVoiceSessionIdForTriageParity but not enforceVoiceTriageGuardrailsForSession', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/appointments/reschedule'");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("app.post('/voice/appointments/cancel'", start);
    const block = src.slice(start, end > start ? end : start + 3000);
    expect(block).toContain('requireVoiceSessionIdForTriageParity');
    expect(block).not.toContain('enforceVoiceTriageGuardrailsForSession');
  });
});

/** impl-12: insurance uses shared enforce with bumpOp insurance (not a separate guard implementation). */
describe('/voice/insurance/collect (§6.5)', () => {
  it('delegates triage DB gates to enforceVoiceTriageGuardrailsForSession(..., insurance)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/insurance/collect'");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('// Optional: patient_id to link insurance', start);
    const block = src.slice(start, end > start ? end : start + 2500);
    expect(block).toContain("enforceVoiceTriageGuardrailsForSession(insuranceSessionId");
    expect(block).toContain("'insurance'");
  });
});

describe('/api/patient/booking/available-slots (BE3)', () => {
  it('validates date query parameter before calling BookingService.getAvailableSlots', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.get('/api/patient/booking/available-slots'");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("app.post('/api/patient/booking/schedule'", start);
    const block = src.slice(start, end > start ? end : start + 2500);
    expect(block).toContain('validatePatientAvailableSlotsQuery');
    expect(block).toContain('BookingService.getAvailableSlots');
  });
});

describe('Patient booking/triage validators (BE1)', () => {
  it('applies validatePatientBookingScheduleBody on patient schedule route', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/api/patient/booking/schedule'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 600);
    expect(block).toContain('validatePatientBookingScheduleBody');
  });

  it('applies validatePatientTriageBody on triage routes', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const orchStart = src.indexOf("app.post('/api/patient/orchestrate'");
    const triageStart = src.indexOf("app.post('/api/patient/triage/message'");
    expect(orchStart).toBeGreaterThan(-1);
    expect(triageStart).toBeGreaterThan(-1);
    expect(src.slice(orchStart, orchStart + 500)).toContain('validatePatientTriageBody');
    expect(src.slice(triageStart, triageStart + 500)).toContain('validatePatientTriageBody');
  });
});

describe('Payment status polling endpoint (BE7)', () => {
  it('defines patient payment-status endpoint', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect(src).toContain("app.get('/api/patient/appointments/:id/payment-status'");
  });
});

describe('Retell parity closure verification (A1/A5)', () => {
  it('passes session_id + metadata.session_id in handleScheduleAppointment', () => {
    const src = fs.readFileSync(path.join(__dirname, '../webhooks/retell-websocket.js'), 'utf8');
    const start = src.indexOf('async handleScheduleAppointment(callId, args)');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 12000);
    expect(block).toContain('session_id: callId');
    expect(block).toContain('metadata: { session_id: callId }');
  });
});

describe('Legacy API guarded parity (A8/A9)', () => {
  it('applies triage guardrails on /api/appointments/schedule when session id present', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/api/appointments/schedule'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 3500);
    expect(block).toContain('resolveVoiceSessionIdForGuard');
    expect(block).toContain("enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'schedule')");
  });

  it('applies triage guardrails on /api/appointments/available-slots when session id present', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const getStart = src.indexOf("app.get('/api/appointments/available-slots'");
    const postStart = src.indexOf("app.post('/api/appointments/available-slots'");
    expect(getStart).toBeGreaterThan(-1);
    expect(postStart).toBeGreaterThan(-1);
    expect(src.slice(getStart, getStart + 2200)).toContain("enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'slots')");
    expect(src.slice(postStart, postStart + 2200)).toContain("enforceVoiceTriageGuardrailsForSession(sessionIdForGuard, args, res, 'slots')");
  });
});

describe('Single auto-checkout path (A2)', () => {
  it('uses shared autoCheckoutAfterSchedule helper in Kelly executor schedule flow', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    const start = src.indexOf("case 'schedule_appointment'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 9000);
    expect(block).toContain('autoCheckoutAfterSchedule');
  });
});

describe('Checkout payload contract (A4/A10)', () => {
  it('mirrors patient_* fields in Retell create checkout call', () => {
    const src = fs.readFileSync(path.join(__dirname, '../webhooks/retell-websocket.js'), 'utf8');
    const start = src.indexOf('async handleCreateAppointmentCheckout(callId, args)');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1400);
    expect(block).toContain('patient_name:');
    expect(block).toContain('patient_email:');
    expect(block).toContain('patient_phone:');
    expect(block).toContain('customer_name:');
    expect(block).toContain('customer_email:');
    expect(block).toContain('customer_phone:');
  });
});

describe('Slot cache invalidation (A6)', () => {
  it('invalidates slot availability cache on schedule/reschedule/cancel mutations', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect(src).toContain('function invalidateSlotAvailabilityCache()');
    expect(src).toContain('if (result.success) invalidateSlotAvailabilityCache();');
    expect(src).toContain('if (result?.success) invalidateSlotAvailabilityCache();');
  });
});

describe('Kelly function executor de-duplication (A3)', () => {
  it('delegates legacy kelly-function-executor to KellyToolExecutor', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-function-executor.js'), 'utf8');
    expect(src).toContain("require('./kelly-tool-executor')");
    expect(src).toContain('KellyToolExecutor.execute(functionName');
  });
});

describe('Mapping contracts (V1/V2/V3)', () => {
  it('documents checkout + slot + clinic resolution contracts in VOICE_TRIAGE_PARITY.md', () => {
    const src = fs.readFileSync(path.join(__dirname, '../docs/VOICE_TRIAGE_PARITY.md'), 'utf8');
    expect(src).toContain('Field contracts (V1/V2/V3)');
    expect(src).toContain('customer_name');
    expect(src).toContain('slot_bundles');
    expect(src).toContain('clinic_id resolution priority');
  });

  it('synthesizes slot_bundles in standard slot endpoints', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect(src).toContain('function ensureSlotBundles');
    expect(src).toContain('const result = ensureSlotBundles(resultRaw, date, practitionerId)');
  });

  it('prefers phone-mapped clinic before env fallback in resolveClinicIdFromRequest', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf('function resolveClinicIdFromRequest(req, args = {})');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1200);
    const idxPhone = block.indexOf('const fromPhone');
    const idxFallback = block.indexOf('if (FALLBACK_CLINIC_ID)');
    expect(idxPhone).toBeGreaterThan(-1);
    expect(idxFallback).toBeGreaterThan(-1);
    expect(idxPhone).toBeLessThan(idxFallback);
  });
});

describe('Race/consistency hardening (R1/R2/R3)', () => {
  it('applies stale/new-session clinical-state reset policy for chat triage', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf('async function handlePatientTriageMessage(req)');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 9000);
    expect(block).toContain('CHAT_SESSION_STALE_RESET_HOURS');
    expect(block).toContain('explicitSessionReset');
    expect(block).toContain('staleSessionReset');
    expect(block).toContain('db.wipeChatSessionClinicalState(session_id)');
  });

  it('uses one business-day normalizer in KellyToolExecutor (no duplicate weekend block)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-tool-executor.js'), 'utf8');
    expect(src).toContain('static _normalizeToBusinessDate(dateStr, clinicId)');
    expect(src).toContain('getClinicBusinessHours');
    expect(src).toContain('getNextBusinessDay');
    expect(src).not.toContain('Weekend date ${args.date}');
  });

  it('keeps eligibility naming hardened with both eligibility_checks and eligibilityChecks aliases', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/appointments/checkout'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 4200);
    expect(block).toContain('const eligibility_checks');
    expect(block).toContain('const eligibilityChecks = eligibility_checks;');
  });
});

describe('Schedule/checkout gap hardening (S1-S4, Chk-C2/C3/C4)', () => {
  it('returns actionable duplicate-patient 409 in voice schedule flow', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/appointments/schedule'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 5200);
    expect(block).toContain('DUPLICATE_PATIENT_PHONE_CONFIRMATION_REQUIRED');
    expect(block).toContain('confirmed_patient_id');
  });

  it('adds name-mismatch confirmation gate for known patient_id scheduling', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/appointments/schedule'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 4300);
    expect(block).toContain('confirm_name_mismatch');
    expect(block).toContain("error: 'NAME_MISMATCH'");
  });

  it('rejects invalid appointment_id in checkout and uses merchant fallback', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/appointments/checkout'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 10000);
    expect(block).toContain('INVALID_APPOINTMENT_ID');
    expect(block).toContain('ensureMerchantForClinic(clinic)');
  });

  it('uses longer timeout + retry for auto-checkout helper', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/auto-checkout-after-schedule.js'), 'utf8');
    expect(src).toContain('AUTO_CHECKOUT_TIMEOUT_MS');
    expect(src).toContain('runCreateCheckout');
    expect(src).toContain('attempt < 2');
  });

  it('uses practitioner-scoped conflict checks when scheduling/rescheduling', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/booking-service.js'), 'utf8');
    expect(src).toContain('appointmentData.practitioner_id || null');
    expect(src).toContain('appointment.practitioner_id || null');
    expect(src).toContain('getAppointmentsByDate(date, clinicId || null, practitionerId || null)');
  });
});

describe('UX/supporting hardening (U1-U7)', () => {
  it('adds clear_chips flag for chat chip reset behavior', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf('async function handlePatientTriageMessage(req)');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 6500);
    expect(block).toContain('clear_chips');
  });

  it('returns structured verify-code errors with next-step guidance', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/voice/checkout/verify'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 2200);
    expect(block).toContain('MISSING_VERIFY_FIELDS');
    expect(block).toContain('INVALID_PAYMENT_TOKEN');
    expect(block).toContain('VERIFICATION_CODE_EXPIRED');
    expect(block).toContain('INVALID_VERIFICATION_CODE');
    expect(block).toContain('next_step');
  });

  it('simulates SMS for configured test numbers', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/sms-service.js'), 'utf8');
    expect(src).toContain('isTestNumber(');
    expect(src).toContain('SMS_TEST_NUMBERS');
    expect(src).toContain('SMS simulated for test number');
  });

  it('returns storage-unavailable response in upload portal when blob write fails', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/upload-portal.js'), 'utf8');
    expect(src).toContain('Upload storage is temporarily unavailable');
  });

  it('returns explicit upload temp-file missing error in patient documents upload', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = src.indexOf("app.post('/api/patient/documents'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 6000);
    expect(block).toContain('UPLOAD_TEMP_FILE_MISSING');
  });

  it('returns explicit next_step for Kelly rate-limit degraded replies', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/kelly-agent-service.js'), 'utf8');
    expect(src).toContain('rate_limited_retry_30s');
    expect(src).toContain('rate_limited_hold_and_retry');
  });
});
