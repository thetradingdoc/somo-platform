'use strict';

const { handlePatientTriageFromRequest } = require('../services/kelly-triage-turn-service');
const { isValidIanaTimezone } = require('../lib/is-valid-iana-timezone');

function registerPatientBookingRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    ensureRoutineTables,
    ensureBillingTables,
    ensurePatientShelfInventoryColumns,
    loadPatientShelfProductRows,
    formatShelfProductApiRow,
    parseBillingDocumentUpload,
    safeParseJsonArray,
    isIsoDateOnly,
    localDateFromIso,
    isoFromLocalDate,
    weekdayKeyForIsoLocal,
    enumerateIsoDates,
    issuePatientDocumentDownloadUrl,
    fetchBillingAggregatesByDay,
    fieldsFromSqlAggRow,
    PatientPortalService,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    getPatientStep3Status,
    ensureProductsPhase2Tables,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
    withIdempotency,
    assertPatientOwnsAppointmentOrThrow,
    validatePatientAvailableSlotsQuery,
    validatePatientBookingScheduleBody,
    validatePatientTriageBody,
    requireCsrfForCookieAuth,
    rotatePatientSessionIfNeeded,
    auditBookingEvent,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
  } = deps;
  

app.get('/api/patient/appointments', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const sessionValidation = req.patientSession;
    const { patientId } = resolvePatientIdFromSession(sessionValidation);
    if (!patientId) {
      return res.status(404).json({ success: false, error: 'Patient not found for this session' });
    }

    // Migration bridge (Batch 3):
    // Ensure we have a FHIR Encounter per appointment so reads can be FHIR-first,
    // while keeping appointment mutation flows on the legacy appointments table for now.
    try {
      const FHIRResources = require('./models/fhir-resources');
      const legacy = PatientPortalService.getPatientAppointments(req.patientSessionId);
      if (legacy && legacy.success && Array.isArray(legacy.appointments)) {
        for (const apt of legacy.appointments) {
          const encId = apt.id; // align with DiagnosticReportForAppointment encounter ref: Encounter/{appointmentId}
          const existing = db.getFHIREncounter ? db.getFHIREncounter(encId) : null;

          const encStatus =
            apt.status === 'completed' ? 'finished' :
            apt.status === 'canceled' ? 'cancelled' :
            apt.status === 'live' ? 'in-progress' :
            'planned';

          const startTime = apt.start_time || null;
          const endTime = apt.end_time || null;
          const resource = FHIRResources.createEncounter({
            id: encId,
            patientId,
            patientName: apt.patient_name || '',
            callId: encId,
            status: encStatus,
            type: apt.appointment_type || 'Telehealth visit',
            startTime: startTime || new Date().toISOString(),
            ...(endTime ? { endTime } : {})
          });

          // Preserve the legacy appointment status for round-tripping UI states.
          resource.extension = Array.isArray(resource.extension) ? resource.extension : [];
          resource.extension.push({
            url: fhirIds.extensionUrlCanonical('appointment-status'),
            valueString: apt.status || 'unknown'
          });
          if (apt.payment_status) {
            resource.extension.push({
              url: fhirIds.extensionUrlCanonical('payment-status'),
              valueString: apt.payment_status
            });
          }

          if (!existing && db.createFHIREncounter) {
            db.createFHIREncounter(resource);
          } else if (existing && db.updateFHIREncounter) {
            db.updateFHIREncounter(encId, resource);
          }
        }
      }
    } catch (_) {}

    // FHIR-first read: Encounter search by patient
    const encounters = db.getPatientEncounters ? db.getPatientEncounters(patientId, 200) : [];

    // Return the legacy appointment response shape, derived from FHIR Encounters.
    // This keeps the patient UI stable while we migrate to fully FHIR-native objects.
    const pendingByAppt = {};
    for (const enc of encounters) {
      const apptId = enc.resource_id || enc.id || enc.resource_data?.id;
      if (!apptId) continue;
      const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(apptId);
      if (pending) {
        pendingByAppt[apptId] = {
          payment_status: pending.payment_status,
          payment_link: pending.payment_link,
          amount_due: pending.checkout?.amount ?? null,
          currency: pending.checkout?.currency ?? 'USD'
        };
        continue;
      }
      const latest = db.getLatestCheckoutForAppointment && db.getLatestCheckoutForAppointment(apptId);
      if (latest && latest.status === 'completed') {
        pendingByAppt[apptId] = { payment_status: 'paid', payment_link: null };
      }
    }

    const appts = await Promise.all(encounters.map(async (enc) => {
      const r = enc.resource_data || {};
      const apptId = r.id || enc.resource_id || enc.id;
      if (apptId && db.db) {
        try {
          const tomb = db.db.prepare('SELECT deleted_at FROM appointments WHERE id = ?').get(apptId);
          if (tomb && tomb.deleted_at) return null;
        } catch (_) {}
      }
      const subject = r.subject || {};
      const period = r.period || {};
      const typeText = (r.type && r.type[0] && (r.type[0].text || (r.type[0].coding && r.type[0].coding[0] && r.type[0].coding[0].display))) || '';
      const ext = Array.isArray(r.extension) ? r.extension : [];
      const legacyStatus = fhirIds.findExtension(ext, 'appointment-status')?.valueString;
      const status =
        legacyStatus ||
        (r.status === 'finished' ? 'completed' :
         r.status === 'cancelled' ? 'canceled' :
         r.status === 'in-progress' ? 'live' :
         'scheduled');

      const payInfo = pendingByAppt[apptId] || {};
      const startIso = period.start || null;
      const dt = startIso ? new Date(startIso) : null;
      // Use appointment.date when available (avoids UTC date-shift; appointments use clinic-local date)
      let date = null;
      let time = null;
      let legacyAppt = null;
      try {
        legacyAppt = apptId ? await db.getAppointment(apptId) : null;
        if (legacyAppt && legacyAppt.date) {
          date = legacyAppt.date;
          time = legacyAppt.time || (dt ? dt.toISOString().slice(11, 16) : null);
        }
      } catch (_) {}
      if (!date) {
        date = dt ? dt.toISOString().slice(0, 10) : null;
        time = dt ? dt.toISOString().slice(11, 16) : null;
      }
      if (!time && dt) time = dt.toISOString().slice(11, 16);

      const visitMode =
        (legacyAppt && legacyAppt.visit_mode) ||
        (() => {
          const vmExt = fhirIds.findExtension(ext, 'visit-mode');
          return vmExt && (vmExt.valueString || vmExt.valueCode);
        })() ||
        'sync_video';

      const extPaymentStatus = fhirIds.findExtension(ext, 'payment-status')?.valueString || null;
      let paymentStatusOut = payInfo.payment_status || null;
      if (!paymentStatusOut && extPaymentStatus) paymentStatusOut = extPaymentStatus;
      if (!paymentStatusOut && legacyAppt && legacyAppt.payment_status) paymentStatusOut = legacyAppt.payment_status;

      return {
        id: apptId,
        patient_name: subject.display || '',
        appointment_type: typeText || 'Telehealth visit',
        provider: legacyAppt && legacyAppt.provider ? legacyAppt.provider : null,
        date,
        time,
        timezone: (legacyAppt && legacyAppt.timezone) ? legacyAppt.timezone : 'America/New_York',
        start_time: startIso,
        end_time: period.end || null,
        status,
        datetime_display: date && time ? PatientPortalService._formatDateTime(date, time) : '',
        can_reschedule: ['scheduled', 'confirmed'].includes(status),
        can_cancel: ['scheduled', 'confirmed'].includes(status),
        video_room: apptId,
        visit_mode: visitMode,
        payment_status: paymentStatusOut,
        payment_link: payInfo.payment_link || null,
        amount_due: (payInfo.amount_due != null ? payInfo.amount_due : null),
        currency: payInfo.currency || 'USD',
        fhir: { encounter_id: apptId }
      };
    }));

    const appointmentsOut = (appts || []).filter(Boolean);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({ success: true, appointments: appointmentsOut });
  } catch (error) {
    console.error('❌ Error getting patient appointments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Create Stripe Checkout Session for an appointment (Phase 1 web checkout)
// C3: Idempotency-Key prevents duplicate Stripe Checkout sessions on double-submit (BE4).
app.post(
  '/api/patient/appointments/:id/checkout',
  apiLimiter,
  requirePatientSession,
  withIdempotency('patient_checkout'),
  express.json(),
  async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    if (!stripe) {
      return res.status(503).json({ success: false, error: 'Stripe is not configured', request_id: req.id });
    }

    const sessionValidation = req.patientSession;
    const { patientId, patientEmail } = resolvePatientIdFromSession(sessionValidation);
    const appointmentId = req.params.id;

    const appt = await db.getAppointment(appointmentId);
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found', request_id: req.id });

    // Ownership + authz
    try {
      assertPatientOwnsAppointmentOrThrow(sessionValidation, appt);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message, request_id: req.id });
    }

    const clinicId = appt.clinic_id || resolveClinicIdFromRequest(req) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id missing for appointment checkout', request_id: req.id });

    // If a pending voice checkout already exists, reuse its checkout_id (prevents duplicate voice_checkouts).
    const pending = db.getPendingCheckoutForAppointment && db.getPendingCheckoutForAppointment(appointmentId);
    let voiceCheckout = null;
    let checkoutId = null;
    if (pending && pending.checkout) {
      voiceCheckout = pending.checkout;
      checkoutId = voiceCheckout.id;
    }

    if (voiceCheckout && voiceCheckout.stripe_checkout_session_id) {
      let url = null;
      try {
        const s = await stripe.checkout.sessions.retrieve(voiceCheckout.stripe_checkout_session_id);
        url = s?.url || null;
      } catch (_) {}
      return res.json({
        success: true,
        checkout_id: voiceCheckout.id,
        stripe_checkout_session_id: voiceCheckout.stripe_checkout_session_id,
        checkout_url: url,
        request_id: req.id
      });
    }

    // Charge amount: server-resolved only (never trust req.body.amount_due for capture).
    // Order: pending voice checkout row (if any) → visit_pricing for clinic + appointment type.
    let amount = null;
    if (voiceCheckout != null && voiceCheckout.amount != null) {
      amount = parseFloat(voiceCheckout.amount);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      try {
        const pricing = db.getEffectiveVisitPrice(clinicId, appt.appointment_type || 'General Consult');
        amount = pricing?.effective_price != null ? parseFloat(pricing.effective_price) : null;
      } catch (_) {}
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Unable to resolve price for checkout',
        request_id: req.id
      });
    }
    const clientHint = req.body?.amount_due;
    if (clientHint != null && Number.isFinite(parseFloat(clientHint))) {
      const ch = parseFloat(clientHint);
      if (Math.abs(ch - amount) > 0.009) {
        console.warn('[patient checkout] Ignoring client amount_due mismatch', {
          appointmentId,
          client_amount_due: ch,
          server_amount: amount,
          request_id: req.id
        });
      }
    }

    const { v4: uuidv4 } = require('uuid');
    let checkout = voiceCheckout;
    if (!checkout) {
      // Create checkout record only when a pending one doesn't already exist.
      checkoutId = uuidv4();
      checkout = {
        id: checkoutId,
        merchant_id: (await db.getClinicById(clinicId))?.merchant_id,
        product_id: 'APPOINTMENT',
        product_name: appt.appointment_type ? `Appointment - ${appt.appointment_type}` : 'Appointment',
        quantity: 1,
        amount,
        customer_phone: appt.patient_phone || '0000000000',
        customer_name: appt.patient_name || 'Patient',
        customer_email: patientEmail || appt.patient_email || null,
        appointment_id: appointmentId,
        status: 'pending',
        clinic_id: clinicId
      };

      if (!checkout.merchant_id) {
        return res.status(500).json({ success: false, error: 'Clinic merchant is not configured', request_id: req.id });
      }
      await db.createVoiceCheckout(checkout);
    } else {
      // Ensure the checkout_id is consistent even when voiceCheckout was used.
      checkoutId = checkout.id;
    }

    const baseUrl = process.env.BASE_URL || process.env.API_BASE_URL || `http://localhost:${PORT}`;
    const ttlMinutes = parseInt(process.env.APPOINTMENT_PAYMENT_TTL_MINUTES || '30', 10);
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(10, ttlMinutes) * 60;

    const successUrl = `${baseUrl}/unified-dashboard/patients/payment-success.html?checkout_id=${encodeURIComponent(checkoutId)}&appointment_id=${encodeURIComponent(appointmentId)}`;
    const cancelUrl = `${baseUrl}/unified-dashboard/patients/wallet.html`;

    // Phase 4.2: Pre-auth for sync_video (capture at case report); capture immediately for async_review
    const visitMode = (appt.visit_mode || 'sync_video').toString();
    const usePreAuth = visitMode === 'sync_video';
    const paymentIntentData = {
      metadata: {
        checkout_id: checkoutId,
        appointment_id: appointmentId,
        patient_id: patientId || ''
      }
    };
    if (usePreAuth) {
      paymentIntentData.capture_method = 'manual';
    }

    // Tenant-scoped Stripe customer (clinic/merchant -> internal tenant customer -> Stripe customer).
    // This avoids relying on Stripe's "create customer from email" behavior for multi-tenant reporting.
    let stripeCustomerId = null;
    try {
      const tenantCustomerId =
        db.getCustomerIdForClinic?.(clinicId) ||
        db.ensureCustomerIdForClinic?.(clinicId) ||
        null;

      const tenantCustomer = tenantCustomerId ? db.getCustomer(tenantCustomerId) : null;
      if (tenantCustomer?.stripe_customer_id) {
        stripeCustomerId = tenantCustomer.stripe_customer_id;
      } else if (tenantCustomer?.email && stripe?.customers?.create) {
        const stripeCustomer = await stripe.customers.create({
          email: tenantCustomer.email,
          name: tenantCustomer.name || tenantCustomer.company_name || clinicId,
          metadata: {
            customer_id: tenantCustomer.id,
            clinic_id: clinicId,
          }
        });
        stripeCustomerId = stripeCustomer.id;
        if (stripeCustomerId) {
          db.updateCustomer && db.updateCustomer(tenantCustomer.id, { stripe_customer_id: stripeCustomerId });
        }
      }
    } catch (tenantStripeErr) {
      console.warn('⚠️ tenant Stripe customer resolution failed:', tenantStripeErr.message);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: expiresAt,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: checkout.product_name },
            unit_amount: Math.round(amount * 100)
          },
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: stripeCustomerId || undefined,
      customer_email: checkout.customer_email || undefined,
      payment_intent_data: paymentIntentData,
      metadata: {
        checkout_id: checkoutId,
        appointment_id: appointmentId,
        patient_id: patientId || '',
        request_id: req.id || ''
      }
    });

    await db.updateVoiceCheckout(checkoutId, {
      stripe_checkout_session_id: session.id,
      stripe_session_expires_at: new Date(expiresAt * 1000).toISOString()
    });

    auditBookingEvent(req, 'create_checkout', 'VoiceCheckout', checkoutId, 'success');

    // Expose the session URL to the patient UI
    return res.json({
      success: true,
      checkout_id: checkoutId,
      appointment_id: appointmentId,
      amount_due: amount,
      currency: 'USD',
      checkout_url: session.url,
      request_id: req.id
    });
  } catch (error) {
    console.error('❌ Error creating patient appointment checkout session:', error);
    return res.status(500).json({ success: false, error: error.message, request_id: req.id });
  }
  }
);

// Patient: Poll appointment/checkout payment status after Stripe redirect (BE7)
app.get('/api/patient/appointments/:id/payment-status', apiLimiter, requirePatientSession, async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const sessionValidation = req.patientSession;
    const appt = await db.getAppointment(appointmentId);
    if (!appt) return res.status(404).json({ success: false, error: 'Appointment not found', request_id: req.id });
    try {
      assertPatientOwnsAppointmentOrThrow(sessionValidation, appt);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message, request_id: req.id });
    }

    const checkout = db.getLatestCheckoutForAppointment ? db.getLatestCheckoutForAppointment(appointmentId) : null;
    const paymentSettled = String(appt.payment_status || '').toLowerCase() === 'paid'
      || String(checkout?.status || '').toLowerCase() === 'completed';

    auditBookingEvent(req, 'read_payment_status', 'Appointment', appointmentId, 'success');
    return res.json({
      success: true,
      appointment_id: appointmentId,
      payment_status: appt.payment_status || null,
      checkout_status: checkout?.status || null,
      checkout_id: checkout?.id || null,
      settled: paymentSettled,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.get('/api/patient/booking/available-slots', apiLimiter, requirePatientSession, validatePatientAvailableSlotsQuery, async (req, res) => {
  try {
    const args = req.query || {};
    const date = (args.date || '').toString().trim();
    const BookingService = require('../services/booking-service');
    const appointmentType = args.appointment_type || 'General Consult';
    const timezone = args.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Use a valid IANA timezone (e.g., America/New_York).', request_id: req.id });
    }
    const clinicId = resolveClinicIdFromRequest(req, args) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id required', request_id: req.id });
    const result = await BookingService.getAvailableSlots(date, null, appointmentType, timezone, clinicId, null);
    return res.json({ ...result, request_id: req.id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/patient/booking/schedule', apiLimiter, requirePatientSession, validatePatientBookingScheduleBody, withIdempotency('patient_booking_schedule'), express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const BookingService = require('../services/booking-service');
    const PatientPortalService = require('../services/patient-portal-service');

    const args = req.body || {};
    const clinicId = resolveClinicIdFromRequest(req, args) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id required', request_id: req.id });

    const sid = req.patientSessionId;
    const sessionValidation = PatientPortalService.validateSession(sid);
    const email = sessionValidation?.email || null;
    const mappedPatientId = sessionValidation?.patient_id || null;

    // Prefer canonical intake for name/phone
    let intake = null;
    try {
      const row = mappedPatientId ? db.getFHIRPatient(mappedPatientId) : null;
      const r = row?.resource_data ? (typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data) : null;
      if (r) {
        const PatientIntakeService = require('../services/patient-intake-service');
        intake = PatientIntakeService.canonicalFromPatientResource
          ? PatientIntakeService.canonicalFromPatientResource(r)
          : null;
      }
    } catch (_) {}

    const patient_name =
      args.patient_name ||
      [intake?.first_name, intake?.last_name].filter(Boolean).join(' ').trim() ||
      'Patient';

    const patient_phone = args.patient_phone || intake?.phone || null;
    const appointment_type = args.appointment_type || 'General Consult';
    const date = args.date;
    const time = args.time;
    const timezone = args.timezone || 'America/New_York';
    const notes = args.reason || args.notes || null;

    if (!email) return res.status(400).json({ success: false, error: 'Patient session missing email', request_id: req.id });
    if (!date || !time) return res.status(400).json({ success: false, error: 'date and time required', request_id: req.id });
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Use a valid IANA timezone (e.g., America/New_York).', request_id: req.id });
    }

    const result = await BookingService.scheduleAppointment({
      clinic_id: clinicId,
      patient_name,
      patient_phone,
      patient_email: email,
      appointment_type,
      date,
      time,
      timezone,
      notes,
      patient_id: mappedPatientId || null,
      visit_mode: args.visit_mode || 'sync_video'
    });
    if (result.success) invalidateSlotAvailabilityCache();
    if (!result.success) return res.status(400).json({ ...result, request_id: req.id });

    auditBookingEvent(req, 'schedule_appointment', 'Appointment', result.appointment?.id || null, 'success');

    return res.json({
      success: true,
      appointment: result.appointment,
      request_id: req.id
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

// Phase 2.4: POST /api/patient/async-review — Create async review case, returns appointment_id for payment
app.post('/api/patient/async-review', apiLimiter, requirePatientSession, express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const PatientPortalService = require('../services/patient-portal-service');
    const BookingService = require('../services/booking-service');

    const sid = req.patientSessionId;
    const sessionValidation = PatientPortalService.validateSession(sid);
    const email = sessionValidation?.email || null;
    const mappedPatientId = sessionValidation?.patient_id || null;
    const clinicId = resolveClinicIdFromRequest(req, req.body || {}) || FALLBACK_CLINIC_ID;
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id required' });
    if (!email) return res.status(400).json({ success: false, error: 'Patient session missing email' });

    const body = req.body || {};
    const timezone = body.timezone || 'America/New_York';
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ success: false, error: 'Invalid timezone. Expected a valid IANA timezone like "America/New_York".' });
    }
    const patient_name = body.patient_name || [sessionValidation?.first_name, sessionValidation?.last_name].filter(Boolean).join(' ').trim() || 'Patient';
    const patient_phone = body.patient_phone || sessionValidation?.phone || null;
    const result = await BookingService.createAsyncReviewAppointment({
      patient_name,
      patient_phone,
      patient_email: email,
      clinic_id: clinicId,
      reason: body.reason || body.notes || '',
      attachment_ids: body.attachment_ids || [],
      customer_id: body.customer_id || null,
      patient_id: mappedPatientId || null,
      timezone
    });

    return res.json({
      success: true,
      appointment_id: result.appointment.id,
      ...result
    });
  } catch (e) {
    console.error('POST /api/patient/async-review error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/patient/orchestrate', apiLimiter, requirePatientSession, blockChatWhenDisabled, requireCsrfForCookieAuth, validatePatientTriageBody, express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const out = await handlePatientTriageFromRequest(req);
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.post('/api/patient/triage/message', apiLimiter, requirePatientSession, blockChatWhenDisabled, requireCsrfForCookieAuth, validatePatientTriageBody, express.json(), async (req, res) => {
  try {
    await rotatePatientSessionIfNeeded(req, res);
    const out = await handlePatientTriageFromRequest(req);
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, request_id: req.id });
  }
});

app.get('/api/patient/triage/history', apiLimiter, requirePatientSession, blockChatWhenDisabled, async (req, res) => {
  try {
    const session_id = (req.query.session_id || '').toString().trim();
    if (!session_id) return res.json({ success: true, history: [], state: null });
    const row = db.getOrchestrateSessionBySessionId?.(session_id);
    if (!row) return res.json({ success: true, history: [], state: null });
    const hist = row.conversation_history ? (typeof row.conversation_history === 'string' ? JSON.parse(row.conversation_history) : row.conversation_history) : [];
    const fs = row.flow_state ? (typeof row.flow_state === 'string' ? JSON.parse(row.flow_state) : row.flow_state) : null;
    return res.json({ success: true, history: hist, state: fs, session_id: row.session_id });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Patient: Mark appointment as completed (end of video visit)
app.post('/api/patient/appointments/:id/complete', apiLimiter, requirePatientSession, requireCsrfForCookieAuth, withIdempotency('patient_appt_complete'), async (req, res) => {
  try {
    const sessionValidation = req.patientSession;

    const appointmentId = req.params.id;
    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    // Ownership + authz (mvp-27)
    try {
      assertPatientOwnsAppointmentOrThrow(sessionValidation, appointment);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message });
    }

    // Mark as completed
    try {
      db.updateAppointmentStatus(appointmentId, 'completed', null, appointment.clinic_id || null);
        console.log('[Appointments] ✅ Appointment completed', {
          appointment_id: appointmentId,
          patient_id: appointment.patient_id || null
        });
    } catch (e) {
      return res.status(409).json({ success: false, error: e.message });
    }

    // Dual-write: keep FHIR Encounter in sync (Batch 5)
    try { await syncFhirEncounterFromAppointment(appointmentId); } catch (_) {}

    try {
      db.insertAuditEvent && db.insertAuditEvent({
        actor_type: 'patient',
        actor_id: null,
        patient_id: appointment.patient_id || sessionValidation.patient_id || null,
        resource_type: 'appointment',
        resource_id: appointmentId,
        action: 'completed',
        metadata: {}
      });
    } catch (_) {}

    // Optionally trigger FHIR DiagnosticReport creation for this appointment.
    try {
      if (FHIRService && typeof FHIRService.createDiagnosticReportForAppointment === 'function') {
        await FHIRService.createDiagnosticReportForAppointment(appointmentId);
      }
    } catch (e) {
      console.warn('⚠️  Failed to create DiagnosticReport for completed appointment:', e.message);
    }

    // Post-visit notification (mvp-48). Failure must not block response.
    try {
      const EmailService = require('../services/email-service');
      const { v4: uuidv4 } = require('uuid');
      const idem = `appt:${appointmentId}:patient_post_visit_summary_ready`;
      if (db.enqueueNotificationJob) {
        db.enqueueNotificationJob({
          id: uuidv4(),
          channel: 'email',
          type: 'patient_post_visit_summary_ready',
          to_address: appointment.patient_email,
          patient_id: appointment.patient_id || null,
          appointment_id: appointmentId,
          idempotency_key: idem,
          payload_json: JSON.stringify({ appointment }),
          max_attempts: 6
        });
      } else if (EmailService && typeof EmailService.sendPostVisitSummaryReady === 'function') {
        await EmailService.sendPostVisitSummaryReady(appointment);
      }
    } catch (e) {
      console.warn('⚠️  Post-visit email failed:', e.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error completing appointment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Patient: Get benefits data (for patient dashboard)
// Protected by general API rate limiter
app.get('/api/patient/benefits', apiLimiter, async (req, res) => {
  try {
    const { patientName, patientPhone, patientId, memberId, patient_id: patientIdSnake } = req.query;
    const resolvedPatientId = patientId || patientIdSnake;

    console.log('\n🏥 PATIENT BENEFITS: Fetching benefits data');
    console.log('   Query params:', { patientName, patientPhone, patientId: resolvedPatientId, memberId });

    let patient = null;

    // Find patient by ID, phone, name, or member_id (insurance number) — V-1: support patient_id from collect_insurance
    if (resolvedPatientId) {
      console.log('   Searching by patient ID:', resolvedPatientId);
      patient = db.getFHIRPatient(resolvedPatientId);
    } else if (memberId) {
      // Search by insurance member_id (for voice agent)
      // PRIORITY: Find patient that has BOTH claims AND eligibility data (most complete data)
      console.log('   Searching by insurance member ID:', memberId);
      try {
        // STRATEGY 1: Find patient via claims (claims have the most complete data)
        // This ensures we get the patient that actually has billing history
        // CRITICAL: Prioritize patients with the MOST claims AND non-zero billing amounts
        const claimRecord = db.db.prepare(`
          SELECT patient_id, COUNT(*) as claim_count, SUM(CASE WHEN total_amount > 0 THEN total_amount ELSE 0 END) as total_billed
          FROM insurance_claims 
          WHERE member_id = ? AND patient_id IS NOT NULL
          GROUP BY patient_id
          ORDER BY claim_count DESC, total_billed DESC, patient_id
          LIMIT 1
        `).get(memberId);

        if (claimRecord && claimRecord.patient_id) {
          const foundPatient = db.getFHIRPatient(claimRecord.patient_id);
          if (foundPatient && !foundPatient.is_deleted) {
            patient = foundPatient;
            console.log(`   ✅ Found patient via claims (${claimRecord.claim_count} claims, $${claimRecord.total_billed || 0} billed): ${patient.resource_id}`);
          } else {
            console.warn(`   ⚠️  Patient ${claimRecord.patient_id} found via claims but is deleted or invalid`);
          }
        } else {
          console.log('   ℹ️  No claims found for member_id, will try other strategies');
        }

        // STRATEGY 2: If no claims found, try eligibility_checks with deductible data
        // PRIORITIZE: Patients with eligibility that have phone numbers (more reliable identity)
        if (!patient) {
          const eligibilityRecord = db.db.prepare(`
            SELECT e.patient_id, p.phone
            FROM eligibility_checks e
            LEFT JOIN fhir_patients p ON e.patient_id = p.resource_id AND p.is_deleted = 0
            WHERE e.member_id = ? 
              AND e.patient_id IS NOT NULL 
              AND e.deductible_total IS NOT NULL
            ORDER BY p.phone DESC, e.created_at DESC 
            LIMIT 1
          `).get(memberId);

          if (eligibilityRecord && eligibilityRecord.patient_id) {
            const foundPatient = db.getFHIRPatient(eligibilityRecord.patient_id);
            if (foundPatient && !foundPatient.is_deleted) {
              patient = foundPatient;
              console.log(`   ✅ Found patient via eligibility record (with deductible data, phone: ${eligibilityRecord.phone ? 'yes' : 'no'}): ${patient.resource_id}`);
            }
          }
        }

        // STRATEGY 3: If still not found, try any eligibility record
        // PRIORITIZE: Patients with phone numbers (more reliable identity)
        if (!patient) {
          const eligibilityRecord = db.db.prepare(`
            SELECT e.patient_id, p.phone
            FROM eligibility_checks e
            LEFT JOIN fhir_patients p ON e.patient_id = p.resource_id AND p.is_deleted = 0
            WHERE e.member_id = ? 
              AND e.patient_id IS NOT NULL
            ORDER BY p.phone DESC, e.created_at DESC 
            LIMIT 1
          `).get(memberId);

          if (eligibilityRecord && eligibilityRecord.patient_id) {
            const foundPatient = db.getFHIRPatient(eligibilityRecord.patient_id);
            if (foundPatient && !foundPatient.is_deleted) {
              patient = foundPatient;
              console.log(`   ✅ Found patient via eligibility record (phone: ${eligibilityRecord.phone ? 'yes' : 'no'}): ${patient.resource_id}`);
            }
          }
        }

        // STRATEGY 4: Try patient_insurance table as fallback
        // PRIORITIZE: Patients with phone numbers (more reliable identity)
        if (!patient) {
          const insuranceRecord = db.db.prepare(`
            SELECT i.patient_id, p.phone
            FROM patient_insurance i
            LEFT JOIN fhir_patients p ON i.patient_id = p.resource_id AND p.is_deleted = 0
            WHERE i.member_id = ? 
            ORDER BY p.phone DESC, i.is_primary DESC, i.created_at DESC 
            LIMIT 1
          `).get(memberId);

          if (insuranceRecord && insuranceRecord.patient_id) {
            const foundPatient = db.getFHIRPatient(insuranceRecord.patient_id);
            if (foundPatient && !foundPatient.is_deleted) {
              patient = foundPatient;
              console.log(`   ✅ Found patient via insurance record (phone: ${insuranceRecord.phone ? 'yes' : 'no'}): ${patient.resource_id}`);
            }
          }
        }

        // STRATEGY 5: If we have patientName, try to match by name + member_id in claims
        if (!patient && patientName) {
          console.log('   Trying to find patient by name + member_id in claims...');
          const claimRecordByName = db.db.prepare(`
            SELECT patient_id FROM insurance_claims 
            WHERE member_id = ? 
            ORDER BY submitted_at DESC 
            LIMIT 1
          `).get(memberId);

          if (claimRecordByName && claimRecordByName.patient_id) {
            const potentialPatient = db.getFHIRPatient(claimRecordByName.patient_id);
            // Verify name matches
            if (potentialPatient) {
              const patientData = typeof potentialPatient.resource_data === 'string'
                ? JSON.parse(potentialPatient.resource_data)
                : potentialPatient.resource_data;
              const name = patientData.name?.[0];
              const fullName = name
                ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim().toLowerCase()
                : '';

              if (fullName.includes(patientName.toLowerCase()) || patientName.toLowerCase().includes(fullName)) {
                patient = potentialPatient;
                console.log(`   ✅ Found patient via claim record (name verified): ${patient.resource_id}`);
              }
            }
          }
        }
      } catch (error) {
        console.warn('⚠️  Error searching by member_id:', error.message);
      }
    } else if (patientPhone) {
      console.log('   Searching by phone:', patientPhone);
      patient = db.getFHIRPatientByPhone(patientPhone);
    } else if (patientName) {
      // Search by name - try exact match first, then partial
      console.log('   Searching by name:', patientName);
      const patients = db.searchFHIRPatients({ name: patientName });
      console.log(`   Found ${patients ? patients.length : 0} patient(s) with name "${patientName}"`);

      if (patients && patients.length > 0) {
        // Try to find exact match first
        const exactMatch = patients.find(p => {
          const name = p.name || '';
          return name.toLowerCase().includes(patientName.toLowerCase());
        });
        patient = exactMatch || patients[0];
      }

      // If no match, try searching with just first or last name
      if (!patient && patientName.includes(' ')) {
        const nameParts = patientName.split(' ');
        for (const namePart of nameParts) {
          if (namePart.length > 2) {
            const partialPatients = db.searchFHIRPatients({ name: namePart });
            if (partialPatients && partialPatients.length > 0) {
              patient = partialPatients[0];
              console.log(`   Found patient with partial name match: "${namePart}"`);
              break;
            }
          }
        }
      }
    }

    if (!patient) {
      console.log('   ❌ Patient not found');
      return res.status(404).json({
        success: false,
        error: `Patient not found${patientName ? `: ${patientName}` : ''}`,
        suggestion: 'Ensure the patient has been created and synced into the system before requesting benefits.'
      });
    }

    console.log(`   ✅ Found patient: ${patient.name || patient.resource_id}`);

    const patientResourceId = patient.resource_id;

    // Get patient insurance
    let insurance = db.getPatientInsurance(patientResourceId);

    // Get eligibility checks for this patient
    // PRIORITY: Get the most recent eligibility check that has COMPLETE deductible information
    let eligibilityChecks = db.getEligibilityChecksByPatient(patientResourceId) || [];

    // Also check eligibility by member_id (in case patient has multiple records)
    if (memberId && eligibilityChecks.length === 0) {
      console.log('   ℹ️  No eligibility found by patient_id, searching by member_id...');
      const eligibilityByMember = db.db.prepare(`
        SELECT * FROM eligibility_checks
        WHERE member_id = ? AND (patient_id = ? OR patient_id IS NULL)
        ORDER BY created_at DESC
      `).all(memberId, patientResourceId);

      if (eligibilityByMember && eligibilityByMember.length > 0) {
        eligibilityChecks = eligibilityByMember;
        console.log(`   ✅ Found ${eligibilityChecks.length} eligibility record(s) by member_id`);
      }
    }

    // Filter to get the best eligibility record (one with deductible info, or most recent)
    let latestEligibility = null;

    // First, try to find one with complete deductible information
    const eligibilityWithDeductible = eligibilityChecks.find(e =>
      e.deductible_total !== null && e.deductible_total !== undefined
    );

    if (eligibilityWithDeductible) {
      latestEligibility = eligibilityWithDeductible;
      console.log(`   ✅ Using eligibility record with deductible: $${latestEligibility.deductible_total} total, $${latestEligibility.deductible_remaining || 0} remaining`);
    } else if (eligibilityChecks.length > 0) {
      // Fallback to most recent eligibility check
      latestEligibility = eligibilityChecks[0];
      console.log(`   ⚠️  Using most recent eligibility record (no deductible info): ${latestEligibility.id}`);
    } else {
      console.log('   ℹ️  No eligibility data found for patient');
    }

    // If we still don't have eligibility but have member_id, try to find ANY eligibility for this member_id
    if (!latestEligibility && memberId) {
      console.log('   ℹ️  Searching for eligibility by member_id across all patients...');
      const anyEligibility = db.db.prepare(`
        SELECT * FROM eligibility_checks
        WHERE member_id = ?
        ORDER BY deductible_total DESC NULLS LAST, created_at DESC
        LIMIT 1
      `).get(memberId);

      if (anyEligibility) {
        latestEligibility = anyEligibility;
        console.log(`   ✅ Found eligibility record by member_id: ${anyEligibility.id}`);
        console.log(`   Deductible: $${anyEligibility.deductible_total || 0} total, $${anyEligibility.deductible_remaining || 0} remaining`);

        // If this eligibility doesn't have a patient_id or has a different patient_id, update it to match current patient
        if (!anyEligibility.patient_id || (anyEligibility.patient_id && anyEligibility.patient_id !== patientResourceId)) {
          try {
            db.db.prepare(`
              UPDATE eligibility_checks 
              SET patient_id = ?
              WHERE id = ?
            `).run(patientResourceId, anyEligibility.id);
            console.log(`   ✅ Linked eligibility record ${anyEligibility.id} to patient ${patientResourceId}`);
            // Update the latestEligibility object to reflect the change
            latestEligibility.patient_id = patientResourceId;
          } catch (updateError) {
            console.warn(`   ⚠️  Could not update eligibility record with patient_id: ${updateError.message}`);
            if (anyEligibility.patient_id && anyEligibility.patient_id !== patientResourceId) {
              console.log(`   ⚠️  Eligibility record has different patient_id (${anyEligibility.patient_id}), but using it for benefits`);
            }
          }
        }
      }
    }

    // If no insurance record exists, create it from eligibility or default data
    if (!insurance) {
      if (latestEligibility) {
        // Create insurance from eligibility data
        console.log('   📝 Creating insurance record from eligibility...');
        try {
          const { v4: uuidv4 } = require('uuid');
          db.upsertPatientInsurance({
            id: `ins_${uuidv4()}`,
            patient_id: patientResourceId,
            payer_id: latestEligibility.payer_id,
            payer_name: latestEligibility.payer_name || latestEligibility.payer_id,
            member_id: latestEligibility.member_id,
            group_number: null,
            plan_name: latestEligibility.plan_summary ? latestEligibility.plan_summary.split(' - ')[0] : null,
            relationship_code: 'self',
            is_primary: true,
            is_verified: true,
            verified_at: new Date().toISOString()
          });
          insurance = db.getPatientInsurance(patientResourceId);
          console.log('   ✅ Created insurance record from eligibility');
        } catch (error) {
          console.error('   ❌ Error creating insurance from eligibility:', error.message);
        }
      }
    }

    // Get payer info if available (for better payer name resolution)
    let payerInfo = null;
    let resolvedPayerName = null;
    if (insurance && insurance.payer_id) {
      payerInfo = db.getPayerByPayerId(insurance.payer_id);
      resolvedPayerName = payerInfo ? payerInfo.payer_name : insurance.payer_name;
      // If we still don't have a good name, try to map common payer IDs
      if (!resolvedPayerName || resolvedPayerName === insurance.payer_id) {
        const payerNameMap = {
          'BCBS': 'Blue Cross Blue Shield',
          'AETNA': 'Aetna',
          'UHG': 'UnitedHealthcare',
          'CIGNA': 'Cigna',
          'ANTHEM': 'Anthem',
          'HUMANA': 'Humana'
        };
        resolvedPayerName = payerNameMap[insurance.payer_id] || insurance.payer_id;
      }
    }

    // Get all claims for this patient
    const claims = db.getClaimsByPatient(patientResourceId) || [];

    // Calculate stats
    const pendingClaims = claims.filter(c => c.status === 'pending' || c.status === 'submitted').length;
    const totalBills = claims.reduce((sum, c) => sum + (parseFloat(c.total_amount) || 0), 0);

    // Parse patient data
    const patientData = typeof patient.resource_data === 'string'
      ? JSON.parse(patient.resource_data)
      : patient.resource_data;

    const name = patientData.name?.[0];
    const patientDisplayName = name
      ? `${(name.given || []).join(' ')} ${name.family || ''}`.trim()
      : 'Unknown Patient';

    return res.json({
      success: true,
      patient: {
        id: patientResourceId,
        name: patientDisplayName,
        phone: patient.phone,
        email: patient.email,
        birthDate: patientData.birthDate
      },
      insurance: insurance ? {
        payer_id: insurance.payer_id,
        payer_name: resolvedPayerName,
        member_id: insurance.member_id,
        group_number: insurance.group_number,
        plan_name: insurance.plan_name,
        is_primary: insurance.is_primary,
        is_verified: insurance.is_verified
      } : null,
      eligibility: latestEligibility ? {
        eligible: !!latestEligibility.eligible,
        copay_amount: latestEligibility.copay_amount || 0,
        allowed_amount: latestEligibility.allowed_amount || 0,
        insurance_pays: latestEligibility.insurance_pays || 0,
        deductible_total: latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined
          ? latestEligibility.deductible_total
          : null,
        deductible_remaining: latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined
          ? latestEligibility.deductible_remaining
          : (latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined
            ? latestEligibility.deductible_total
            : null),
        deductible_met: (latestEligibility.deductible_total !== null && latestEligibility.deductible_total !== undefined)
          ? (latestEligibility.deductible_total - (latestEligibility.deductible_remaining !== null && latestEligibility.deductible_remaining !== undefined ? latestEligibility.deductible_remaining : 0))
          : 0,
        coinsurance_percent: latestEligibility.coinsurance_percent || 0,
        plan_summary: latestEligibility.plan_summary || 'Plan details available',
        prior_auth_indicator: latestEligibility.prior_auth_indicator || null,
        prior_auth_notes: latestEligibility.prior_auth_notes
          ? (typeof latestEligibility.prior_auth_notes === 'string'
            ? (() => { try { return JSON.parse(latestEligibility.prior_auth_notes); } catch (_) { return []; } })()
            : latestEligibility.prior_auth_notes)
          : [],
        service_code: latestEligibility.service_code,
        date_of_service: latestEligibility.date_of_service,
        created_at: latestEligibility.created_at,
        // Parse additional data from response_data if available
        response_data: latestEligibility.response_data
          ? (typeof latestEligibility.response_data === 'string'
            ? JSON.parse(latestEligibility.response_data)
            : latestEligibility.response_data)
          : null
      } : null,
      stats: {
        pending_claims: pendingClaims,
        total_bills: totalBills,
        total_claims: claims.length
      },
      claims: await Promise.all(claims.slice(0, 10).map(async (c) => {
        // Parse response_data to get detailed claim information
        let responseData = {};
        try {
          if (c.response_data) {
            responseData = typeof c.response_data === 'string'
              ? JSON.parse(c.response_data)
              : c.response_data;
          }
        } catch (e) {
          console.warn('Failed to parse claim response_data:', e);
        }

        // For approved claims, use stored EOB from response_data if available
        // This ensures "What You Owe" reflects the final approved amounts
        let fullClaimDetails = null;

        // Check if claim has stored EOB (especially for approved claims)
        if (responseData.eob && (c.status === 'approved' || c.status === 'paid')) {
          // Use stored EOB for approved claims - this has the final approved amounts
          fullClaimDetails = {
            eob: responseData.eob,
            diagnosisCodes: [],
            pricing: responseData.pricing || null
          };

          // Extract diagnosis codes from response_data
          const DiagnosisCodeMapper = require('../services/diagnosis-code-mapper');
          if (responseData.coding && responseData.coding.icd10) {
            fullClaimDetails.diagnosisCodes = responseData.coding.icd10.map(d => ({
              code: typeof d === 'string' ? d : d.code || d,
              description: typeof d === 'object' && d.description
                ? d.description
                : DiagnosisCodeMapper.getDiagnosisDescription(typeof d === 'string' ? d : (d.code || d))
            }));
          } else if (c.diagnosis_code) {
            c.diagnosis_code.split(',').forEach(code => {
              const trimmedCode = code.trim();
              if (trimmedCode && trimmedCode !== 'N/A') {
                fullClaimDetails.diagnosisCodes.push({
                  code: trimmedCode,
                  description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
                });
              }
            });
          }
        } else if (!responseData.pricing && !responseData.coding && c.id) {
          // For non-approved claims or claims without stored EOB, calculate on the fly
          try {
            // Get eligibility for this patient
            const eligibilityChecks = db.getEligibilityChecksByPatient(patientResourceId) || [];
            const latestEligibility = eligibilityChecks[0] || null;

            // Calculate EOB if we have eligibility data
            if (latestEligibility) {
              const EOBCalculationService = require('../services/eob-calculation-service');
              try {
                const eobCalculation = EOBCalculationService.calculateEOBFromClaim(
                  c,
                  latestEligibility,
                  responseData
                );

                // Extract diagnosis codes
                const DiagnosisCodeMapper = require('../services/diagnosis-code-mapper');
                const diagnosisCodes = [];

                if (responseData.coding && responseData.coding.icd10) {
                  diagnosisCodes.push(...responseData.coding.icd10.map(d => ({
                    code: typeof d === 'string' ? d : d.code || d,
                    description: typeof d === 'string'
                      ? DiagnosisCodeMapper.getDiagnosisDescription(d)
                      : (d.description || DiagnosisCodeMapper.getDiagnosisDescription(d.code || d))
                  })));
                } else if (c.diagnosis_code) {
                  c.diagnosis_code.split(',').forEach(code => {
                    const trimmedCode = code.trim();
                    if (trimmedCode && trimmedCode !== 'N/A') {
                      diagnosisCodes.push({
                        code: trimmedCode,
                        description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
                      });
                    }
                  });
                }

                fullClaimDetails = {
                  eob: eobCalculation,
                  diagnosisCodes: diagnosisCodes,
                  pricing: eobCalculation.lineItems ? {
                    breakdown: eobCalculation.lineItems.map(item => ({
                      code: item.cptCode,
                      description: item.description,
                      charge: item.billedAmount,
                      allowed_amount: item.allowedAmount,
                      patient_owes: item.patientOwes
                    }))
                  } : null
                };
              } catch (eobError) {
                console.warn(`Failed to calculate EOB for claim ${c.id}:`, eobError.message);
              }
            }
          } catch (error) {
            console.warn(`Failed to get full claim details for ${c.id}:`, error.message);
          }
        } else if (responseData.pricing || responseData.coding) {
          // Claim has pricing/coding data but no EOB - extract what we can
          const DiagnosisCodeMapper = require('../services/diagnosis-code-mapper');
          const diagnosisCodes = [];

          if (responseData.coding && responseData.coding.icd10) {
            responseData.coding.icd10.forEach(d => {
              const codeStr = typeof d === 'string' ? d : (d.code || d);
              if (codeStr && codeStr !== 'N/A') {
                diagnosisCodes.push({
                  code: codeStr,
                  description: typeof d === 'object' && d.description
                    ? d.description
                    : DiagnosisCodeMapper.getDiagnosisDescription(codeStr)
                });
              }
            });
          } else if (c.diagnosis_code) {
            c.diagnosis_code.split(',').forEach(code => {
              const trimmedCode = code.trim();
              if (trimmedCode && trimmedCode !== 'N/A') {
                diagnosisCodes.push({
                  code: trimmedCode,
                  description: DiagnosisCodeMapper.getDiagnosisDescription(trimmedCode)
                });
              }
            });
          }

          fullClaimDetails = {
            eob: null,
            diagnosisCodes: diagnosisCodes,
            pricing: responseData.pricing || null
          };
        }

        return {
          id: c.id,
          status: c.status,
          total_amount: c.total_amount,
          copay_amount: c.copay_amount,
          insurance_amount: c.insurance_amount,
          submitted_at: c.submitted_at,
          payment_status: c.payment_status,
          service_code: c.service_code,
          diagnosis_code: c.diagnosis_code,
          member_id: c.member_id,
          payer_id: c.payer_id,
          // Include detailed breakdown if available
          response_data: responseData,
          // Extract pricing breakdown for easier access
          pricing: fullClaimDetails?.pricing || responseData.pricing || null,
          coding: responseData.coding || null,
          // Include EOB calculation if available
          eob: fullClaimDetails?.eob || null,
          diagnosisCodes: fullClaimDetails?.diagnosisCodes || []
        };
      }))
    });
  } catch (error) {
    console.error('❌ Error getting patient benefits:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Reschedule appointment (requirePatientSession sets usedCookieAuth so CSRF is enforced only for cookie auth)
app.put('/api/patient/appointments/:id/reschedule', requirePatientSession, requireCsrfForCookieAuth, withIdempotency('patient_appt_reschedule'), async (req, res) => {
  try {
    const session = req.patientSession;
    const appointmentId = req.params.id;
    const { new_date, new_time } = req.body;

    if (!validateYyyyMmDd(new_date) || !validateHhMm(new_time)) {
      return res.status(400).json({ success: false, error: 'Invalid new_date or new_time' });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Ownership + authz (mvp-27)
    try {
      assertPatientOwnsAppointmentOrThrow(session, appointment);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message });
    }

    // State machine enforcement (mvp-22)
    if (!['scheduled', 'confirmed', 'pending', 'pending_payment'].includes((appointment.status || '').toLowerCase())) {
      return res.status(409).json({ success: false, error: `Cannot reschedule appointment in status '${appointment.status}'` });
    }

    const clinicId = appointment.clinic_id || null;

    // Use existing reschedule endpoint logic
    const result = await BookingService.rescheduleAppointment(
      appointmentId,
      new_date,
      new_time,
      null,
      null,
      clinicId
    );
    if (result.success) invalidateSlotAvailabilityCache();

    if (result.success) {
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: session.patient_id || null,
          resource_type: 'appointment',
          resource_id: appointmentId,
          action: 'rescheduled',
          metadata: { new_date, new_time }
        });
      } catch (_) {}
      // Dual-write: keep FHIR Encounter in sync (Batch 5)
      try { await syncFhirEncounterFromAppointment(appointmentId); } catch (_) {}
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error rescheduling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Patient: Cancel appointment (requirePatientSession sets usedCookieAuth so CSRF enforced only for cookie auth)
app.delete('/api/patient/appointments/:id', requirePatientSession, requireCsrfForCookieAuth, withIdempotency('patient_appt_cancel'), async (req, res) => {
  try {
    const session = req.patientSession;
    const appointmentId = req.params.id;
    const { reason } = req.body;

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Ownership + authz (mvp-27)
    try {
      assertPatientOwnsAppointmentOrThrow(session, appointment);
    } catch (e) {
      return res.status(e.status || 403).json({ success: false, error: e.message });
    }

    // State machine enforcement (mvp-22)
    if (!['scheduled', 'confirmed', 'pending', 'pending_payment'].includes((appointment.status || '').toLowerCase())) {
      return res.status(409).json({ success: false, error: `Cannot cancel appointment in status '${appointment.status}'` });
    }

    const clinicId = appointment.clinic_id || null;

    // Use existing cancel endpoint logic
    const result = await BookingService.cancelAppointment(appointmentId, reason, clinicId);
    if (result.success) invalidateSlotAvailabilityCache();

    if (result.success) {
      try {
        db.insertAuditEvent && db.insertAuditEvent({
          actor_type: 'patient',
          actor_id: null,
          patient_id: session.patient_id || null,
          resource_type: 'appointment',
          resource_id: appointmentId,
          action: 'canceled',
          metadata: { reason: reason || '' }
        });
      } catch (_) {}
      // Dual-write: keep FHIR Encounter in sync (Batch 5)
      try { await syncFhirEncounterFromAppointment(appointmentId); } catch (_) {}
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('❌ Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
}

module.exports = { registerPatientBookingRoutes };
