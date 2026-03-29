/**
 * Booking Service - DocLittle Mental Health Telehealth Platform
 *
 * Handles appointment scheduling, confirmation, and cancellation
 * Integrates with Google Calendar API for calendar management
 */

// Google APIs (optional - for Calendar integration)
let google;
try {
  google = require('googleapis').google;
} catch (error) {
  console.warn('⚠️  googleapis not available - Calendar features will be disabled');
  google = null;
}
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const FHIRService = require('./fhir-service');
const PatientIntakeService = require('./patient-intake-service');
const EmailService = require('./email-service');
const { getClinicBusinessHours, isBusinessDay, getNextBusinessDay, DAY_NAMES, normalizeDateStr } = require('../config/clinic-business-hours');
const { getClinicCalendarConfig, useSingleCalendarPerEnv } = require('../config/clinic-calendar-config');
const ProviderService = require('./provider-service');
const CALENDAR_REQUIRED_FOR_SYNC = String(process.env.CALENDAR_REQUIRED_FOR_SYNC || 'false').toLowerCase() === 'true';
const BLOCKS_ONLY_ALLOWED = String(process.env.BLOCKS_ONLY_ALLOWED === undefined ? 'true' : process.env.BLOCKS_ONLY_ALLOWED).toLowerCase() !== 'false';
const PREFER_SYNCED_PROVIDERS = String(process.env.PREFER_SYNCED_PROVIDERS || 'true').toLowerCase() !== 'false';

// Prevent log spam: only warn once per clinic when calendar integration is disabled.
const SUPPRESS_CALENDAR_WARNING =
  process.env.SUPPRESS_CALENDAR_WARNING === '1' || process.env.SUPPRESS_CALENDAR_WARNING === 'true';
const warnedCalendarIntegrationByClinic = new Set();
let warnedGoogleCalendarCredentials = false;
const calendarMetricsWindow = {
  started_at: Date.now(),
  confidence: { high: 0, medium: 0, low: 0 },
  blocks_only_bookings: 0,
  total_bookings: 0,
  no_bookable_provider_failures: {}
};

/**
 * Appointment Type Configuration
 * Defines different appointment types with their durations and buffer times
 */
const APPOINTMENT_TYPES = {
  'Mental Health Consultation': {
    duration_minutes: 50,
    buffer_before_minutes: 10,  // 10 min buffer before appointment
    buffer_after_minutes: 10,    // 10 min buffer after appointment
    color: 'blue'
  },
  'Crisis Intervention': {
    duration_minutes: 30,
    buffer_before_minutes: 5,   // Shorter buffer for urgent cases
    buffer_after_minutes: 15,   // Longer buffer after to allow recovery
    color: 'red'
  },
  'Follow-up Session': {
    duration_minutes: 30,
    buffer_before_minutes: 10,
    buffer_after_minutes: 10,
    color: 'green'
  },
  'Initial Assessment': {
    duration_minutes: 60,
    buffer_before_minutes: 10,
    buffer_after_minutes: 10,
    color: 'purple'
  },
  'Group Therapy': {
    duration_minutes: 90,
    buffer_before_minutes: 15,
    buffer_after_minutes: 15,
    color: 'orange'
  },
  'Medication Review': {
    duration_minutes: 20,
    buffer_before_minutes: 5,
    buffer_after_minutes: 5,
    color: 'yellow'
  },
  'Video Consultation': {
    duration_minutes: 30,
    buffer_before_minutes: 5,
    buffer_after_minutes: 5,
    color: 'teal',
    is_video: true
  },
  'External Calendar Event': {
    duration_minutes: 0,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    color: 'gray'
  }
};

/**
 * Business Hours Configuration
 */
const BUSINESS_HOURS = {
  start: 9,   // 9 AM
  end: 19,    // 7 PM (19:00) - Extended for 6pm demo appointments (50min duration)
  timezone: process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York',
  slot_interval_minutes: 15  // Minimum slot interval (15 minutes)
};

class BookingService {
  /**
   * Initialize Google Calendar client
   * Uses service account or OAuth2 credentials
   */
  static _createOAuthClient() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return null;
    }

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      `${process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000'}/auth/google/calendar/callback`;

    if (!google || !google.auth) {
      return null;
    }

    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  }

  static _captureUpdatedCalendarCredentials(context) {
    if (!context || !context.user || !context.auth) return;

    const credentials = context.auth.credentials || {};
    const tokens = {};

    if (credentials.access_token !== undefined) {
      tokens.access_token = credentials.access_token || null;
    }

    if (credentials.refresh_token !== undefined) {
      tokens.refresh_token = credentials.refresh_token || null;
    }

    if (credentials.expiry_date !== undefined) {
      tokens.token_expiry = credentials.expiry_date || null;
    }

    if (Object.keys(tokens).length > 0) {
      try {
        db.updateUserCalendarTokens(context.user.id, tokens);
      } catch (error) {
        console.warn('⚠️  Failed to update stored calendar credentials:', error.message);
      }
    }
  }

  /**
   * Get Google Calendar client (Tasks 1, 5)
   * Task 1: Single calendar per env - clinicId is ignored for calendar selection.
   * Uses GOOGLE_CALENDAR_ID (or primary) for all clinics when CALENDAR_SINGLE_PER_ENV=1.
   * @param {string} clinicId - Ignored for calendar selection (single calendar per env)
   * @param {string} userEmail - Optional: User email for OAuth calendar fallback
   * @returns {Object|null} - Calendar client context or null if not configured
   */
  static getCalendarClient(clinicId = null, userEmail = null) {
    try {
      const clinicConfig = useSingleCalendarPerEnv() ? null : (clinicId ? getClinicCalendarConfig(clinicId) : null);
      const preferUserEmail = (clinicConfig?.userEmail || userEmail);
      const providerSelectedCalendarId = clinicConfig?.calendarId || null;

      // Deterministic order:
      // 1) provider user selected calendar (from provider user row, if present)
      // 2) provider primary calendar (same provider with google connected)
      // 3) clinic calendar fallback (clinic config)
      // 4) env shared calendar fallback (GOOGLE_CALENDAR_ID/primary)

      // Option 1: Service Account - single calendar ID from env (Task 1)
      if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        if (!google || !google.auth) {
          return null;
        }

        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/calendar']
        });
        const calendarId = providerSelectedCalendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
        return {
          client: google ? google.calendar({ version: 'v3', auth }) : null,
          calendarId,
          authType: 'service_account',
          calendar_resolution_source: providerSelectedCalendarId ? 'clinic_selected_calendar' : (process.env.GOOGLE_CALENDAR_ID ? 'env_shared_calendar' : 'primary')
        };
      }

      // Option 2: OAuth2 - single calendar per env (Task 1)
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        let user = null;

        if (preferUserEmail) {
          user = db.getUserCalendarSettingsByEmail(preferUserEmail);
        }

        if (!user) {
          user = db.getFirstCalendarConnectedUser ? db.getFirstCalendarConnectedUser() : null;
        }

        if (user && user.google_refresh_token) {
          const oauth2Client = this._createOAuthClient();
          if (!oauth2Client) {
            console.warn('⚠️  Google OAuth client not configured properly.');
            return null;
          }

          oauth2Client.setCredentials({
            refresh_token: user.google_refresh_token,
            access_token: user.google_access_token || undefined,
            expiry_date: user.google_token_expiry || undefined
          });

          const calendarId = user.google_calendar_id || providerSelectedCalendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
          const resolutionSource = user.google_calendar_id
            ? 'provider_user_selected_calendar'
            : (providerSelectedCalendarId
              ? 'clinic_selected_calendar'
              : (process.env.GOOGLE_CALENDAR_ID ? 'env_shared_calendar' : 'primary'));
          return {
            client: google ? google.calendar({ version: 'v3', auth: oauth2Client }) : null,
            calendarId,
            auth: oauth2Client,
            user,
            authType: 'oauth',
            calendar_resolution_source: resolutionSource
          };
        }
      }

      const isMock = process.env.GOOGLE_CALENDAR_MOCK === '1' || process.env.GOOGLE_CALENDAR_MOCK === 'true';
      if (!SUPPRESS_CALENDAR_WARNING && !warnedGoogleCalendarCredentials) {
        console.warn(
          `⚠️  Google Calendar credentials not configured. Running in ${isMock ? 'MOCK mode (GOOGLE_CALENDAR_MOCK=1)' : 'mock mode'} — external events ignored; double-booking risk when calendar not configured.`
        );
        warnedGoogleCalendarCredentials = true;
      }
      return null;

    } catch (error) {
      console.error('❌ Error initializing Google Calendar:', error);
      return null;
    }
  }

  static _trackCalendarObservability(eventName, payload = {}) {
    try {
      if (db.incrementOpsCounter) db.incrementOpsCounter(eventName);
      if (eventName === 'booking_calendar_confidence_high') calendarMetricsWindow.confidence.high += 1;
      if (eventName === 'booking_calendar_confidence_medium') calendarMetricsWindow.confidence.medium += 1;
      if (eventName === 'booking_calendar_confidence_low') calendarMetricsWindow.confidence.low += 1;
      if (eventName === 'booking_blocks_only_booking') calendarMetricsWindow.blocks_only_bookings += 1;
      if (eventName === 'booking_total_bookings') calendarMetricsWindow.total_bookings += 1;
      if (eventName === 'booking_no_bookable_provider_failure') {
        const clinic = payload.clinic_id || 'unknown';
        calendarMetricsWindow.no_bookable_provider_failures[clinic] =
          (calendarMetricsWindow.no_bookable_provider_failures[clinic] || 0) + 1;
      }
    } catch (_) {}
  }

  static getCalendarObservabilitySnapshot() {
    const conf = calendarMetricsWindow.confidence;
    const totalConf = conf.high + conf.medium + conf.low;
    const blocksRatio = calendarMetricsWindow.total_bookings > 0
      ? calendarMetricsWindow.blocks_only_bookings / calendarMetricsWindow.total_bookings
      : 0;
    return {
      window_started_at: new Date(calendarMetricsWindow.started_at).toISOString(),
      confidence_counts: { ...conf, total: totalConf },
      confidence_percentages: {
        high: totalConf ? Number(((conf.high / totalConf) * 100).toFixed(2)) : 0,
        medium: totalConf ? Number(((conf.medium / totalConf) * 100).toFixed(2)) : 0,
        low: totalConf ? Number(((conf.low / totalConf) * 100).toFixed(2)) : 0
      },
      booking_counts: {
        total: calendarMetricsWindow.total_bookings,
        blocks_only: calendarMetricsWindow.blocks_only_bookings
      },
      blocks_only_ratio: Number(blocksRatio.toFixed(4)),
      no_bookable_provider_failures_by_clinic: { ...calendarMetricsWindow.no_bookable_provider_failures },
      alerts: {
        blocks_only_drift: blocksRatio >= 0.35
      }
    };
  }

  /**
   * Schedule a new appointment
   * @param {Object} appointmentData - Appointment details
   * @returns {Object} - Created appointment with calendar event ID
   */
  static async scheduleAppointment(appointmentData) {
    console.log('\n📅 BOOKING SERVICE: Schedule Appointment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // Validate required fields
      const validation = this._validateAppointmentData(appointmentData);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      const clinicId = this._ensureClinicId(
        appointmentData.clinic_id,
        'scheduling appointments'
      );

      try {
        const { enforceCanonicalPatientPhone } = require('./patient-contact-canonical');
        enforceCanonicalPatientPhone(appointmentData, { logTag: '[BookingService.schedule]' });
      } catch (e) {
        console.warn('[BookingService.schedule] Canonical patient phone skipped:', e.message);
      }

      const clinicHours = getClinicBusinessHours(clinicId);
      let dateStr = normalizeDateStr(appointmentData.date) || appointmentData.date;
      if (!isBusinessDay(dateStr, clinicHours)) {
        // Instead of hard-failing (which can cause the LLM to retry indefinitely),
        // auto-advance to the next available business day.
        const nextOpen = getNextBusinessDay(dateStr, clinicHours);
        const d = new Date(dateStr + 'T12:00:00');
        const dayName = isNaN(d.getTime()) ? '' : DAY_NAMES[d.getDay()] || '';
        const nextDayName = nextOpen ? DAY_NAMES[new Date(nextOpen + 'T12:00:00').getDay()] : '';
        const hint = nextOpen ? ` Next available: ${nextDayName} ${nextOpen}.` : '';

        if (nextOpen) {
          console.log(`[BookingService] Weekend/holiday date ${dateStr} (${dayName}) → auto-advancing to ${nextOpen}`);
          appointmentData.date = nextOpen;
          dateStr = nextOpen;
        } else {
          throw new Error(
            `We're open Monday–Friday. ${dayName ? dayName + ' isn\'t available. ' : ''}Please select a weekday.${hint}`
          );
        }
      }

      // Get appointment type configuration
      const appointmentType = appointmentData.appointment_type || 'Mental Health Consultation';
      const typeConfig = APPOINTMENT_TYPES[appointmentType] || APPOINTMENT_TYPES['Mental Health Consultation'];

      // Parse date/time with timezone awareness (Task 51: clinic timezone)
      const appointmentDateTime = this._parseDateTime(
        appointmentData.date,
        appointmentData.time,
        appointmentData.timezone || clinicHours.timezone,
        typeConfig.duration_minutes
      );

      // Check if slot is available (with buffer times)
      const availabilityCheck = await this._checkSlotAvailability(
        appointmentDateTime.startISO,
        appointmentDateTime.endISO,
        typeConfig,
        appointmentDateTime.date,
        appointmentDateTime.timezone,
        clinicId,
        null, // No appointment to exclude for new bookings
        appointmentData.practitioner_id || null
      );

      if (!availabilityCheck.available) {
        throw new Error(`Slot not available: ${availabilityCheck.reason}`);
      }

      // Create appointment ID
      const appointmentId = `appt-${uuidv4()}`;

      // Calculate total time including buffers
      const totalDurationMinutes = typeConfig.duration_minutes +
        typeConfig.buffer_before_minutes +
        typeConfig.buffer_after_minutes;

      // Upsert FHIR patient record to ensure a longitudinal EHR
      // RULE: Each person has a unique identity. If similar names exist, phone number must be confirmed.
      let fhirPatientId = appointmentData.patient_id || null;
      try {
        const shouldResolvePatient = !fhirPatientId;
        const patientResult = shouldResolvePatient
          ? await FHIRService.getOrCreatePatient({
              name: appointmentData.patient_name,
              phone: appointmentData.patient_phone,
              email: appointmentData.patient_email,
              timezone: appointmentData.timezone || BUSINESS_HOURS.timezone
            }, true) // requirePhoneConfirmation = true
          : null;

        // Check if duplicate was detected (Task 8: phone or email confirmation)
        if (patientResult?.duplicate && patientResult.requiresPhoneConfirmation) {
          console.warn('🚨 DUPLICATE DETECTED: Similar name found, confirmation required');

          return {
            success: false,
            duplicate: true,
            requiresPhoneConfirmation: true,
            requiresEmailConfirmation: patientResult.requiresEmailConfirmation || false,
            error: patientResult.message,
            duplicates: patientResult.duplicates || [],
            provided_name: patientResult.provided_name,
            provided_phone: patientResult.provided_phone,
            provided_email: patientResult.provided_email,
            message: patientResult.message,
            voice_agent_instruction: patientResult.voice_agent_instruction || 'Ask the caller to confirm their phone number or email. If it matches an existing patient, use that record.'
          };
        }

        // Patient was found or created successfully
        if (patientResult?.patient) {
          fhirPatientId = patientResult.patient.id || patientResult.patient.resource_id;
          console.log(`✅ Patient record ${patientResult.foundBy}: ${fhirPatientId}`);

          // Best-effort: populate canonical intake fields so web + voice share the same data format.
          // Voice often lacks DOB/city/country; those remain missing and will trigger web onboarding later.
          try {
            if (PatientIntakeService && PatientIntakeService.upsertIntakeByPatientId) {
              const full = (appointmentData.patient_name || '').toString().trim();
              const parts = full.split(' ').filter(Boolean);
              const first_name = parts[0] || '';
              const last_name = parts.slice(1).join(' ') || '';
              await PatientIntakeService.upsertIntakeByPatientId(fhirPatientId, {
                first_name,
                last_name,
                phone: appointmentData.patient_phone || '',
                email: appointmentData.patient_email || ''
              });
            }
          } catch (_) {}
        }
      } catch (e) {
        console.warn('⚠️  FHIR patient upsert failed:', e.message);

        // If error is about phone number required, return helpful error
        if (e.message && e.message.includes('Phone number is required')) {
          return {
            success: false,
            error: e.message,
            requiresPhone: true,
            message: 'Phone number is required to create a new patient record. Please provide your phone number to schedule an appointment.'
          };
        }

        // For other errors, continue (don't block appointment scheduling, but log warning)
        console.warn('⚠️  Continuing without patient record - appointment will be scheduled but not linked to patient');
      }

      // Prepare appointment record
      const isVideoConsult = (typeConfig.is_video === true) || (appointmentType === 'Video Consultation');
      // W3-S4.2: primary_icd10, primary_cpt from triage for billing (eligibility, claims)
      const appointment = {
        id: appointmentId,
        clinic_id: clinicId,
        customer_id: appointmentData.customer_id || null, // Include customer_id for tenant isolation
        patient_name: appointmentData.patient_name,
        patient_phone: appointmentData.patient_phone,
        patient_email: appointmentData.patient_email,
        patient_id: fhirPatientId || null,
        appointment_type: appointmentType,
        video_room_name: appointmentId, // Every appointment gets a stable room (appt-{uuid}) for video + agent tracking
        date: appointmentDateTime.date,
        time: appointmentDateTime.time,
        start_time: appointmentDateTime.startISO,
        end_time: appointmentDateTime.endISO,
        duration_minutes: typeConfig.duration_minutes,
        buffer_before_minutes: typeConfig.buffer_before_minutes,
        buffer_after_minutes: typeConfig.buffer_after_minutes,
        provider: appointmentData.provider || 'DocLittle Mental Health Team',
        practitioner_id: appointmentData.practitioner_id || null,
        status: 'scheduled',
        visit_mode: appointmentData.visit_mode || 'sync_video',
        slot_state: 'soft_reserved',
        notes: appointmentData.notes || '',
        reminder_sent: false,
        calendar_event_id: null,
        timezone: appointmentData.timezone || BUSINESS_HOURS.timezone,
        created_at: new Date().toISOString(),
        primary_icd10: appointmentData.primary_icd10 || null,
        primary_cpt: appointmentData.primary_cpt || null
      };

      try {
        const { enforceCanonicalPatientPhone } = require('./patient-contact-canonical');
        enforceCanonicalPatientPhone(appointment, { logTag: '[BookingService.schedule.final]' });
      } catch (e) {
        console.warn('[BookingService.schedule.final] Canonical patient phone skipped:', e.message);
      }

      appointmentData.patient_phone = appointment.patient_phone;
      if (fhirPatientId && PatientIntakeService && PatientIntakeService.upsertIntakeByPatientId) {
        try {
          const full = (appointment.patient_name || '').toString().trim();
          const parts = full.split(' ').filter(Boolean);
          const first_name = parts[0] || '';
          const last_name = parts.slice(1).join(' ') || '';
          await PatientIntakeService.upsertIntakeByPatientId(fhirPatientId, {
            first_name,
            last_name,
            phone: appointment.patient_phone || '',
            email: appointment.patient_email || ''
          });
        } catch (_) {}
      }

      console.log('📋 Appointment Details:', {
        id: appointment.id,
        patient: appointment.patient_name,
        type: appointment.appointment_type,
        datetime: appointmentDateTime.displayTime
      });

      // Try to create Google Calendar event (per-clinic calendar)
      const calendarContext = this.getCalendarClient(clinicId);
      if (calendarContext && calendarContext.client) {
        const { client: calendar, calendarId } = calendarContext;
        try {
          const event = await this._createCalendarEvent(calendar, calendarId, appointment, appointmentData);
          appointment.calendar_event_id = event.id;
          appointment.calendar_link = event.htmlLink;
          console.log('✅ Google Calendar event created:', event.id);

          this._captureUpdatedCalendarCredentials(calendarContext);
        } catch (calendarError) {
          console.warn('⚠️  Calendar event creation failed:', calendarError.message);
          // Continue without calendar event
        }
      } else {
        console.log('ℹ️  Running in mock mode - no calendar event created');
      }

      // SECURITY: Save to database with conflict check
      // Note: There's still a small race condition window between availability check and insert
      // For production, consider adding database-level unique constraints on (clinic_id, start_time, status)
      try {
        await db.createAppointment(appointment);
        console.log('✅ Appointment saved to database');
      } catch (dbError) {
        // Task 9: Slot conflict - return alternative slots for retry
        if (dbError.message && dbError.message.includes('UNIQUE constraint')) {
          console.error('❌ Appointment conflict detected - slot may have been booked by another request');
          let alternativeSlots = [];
          let slotsWithDisplay = [];
          try {
            const alt = await this.getAvailableSlots(
              appointmentData.date,
              appointmentData.provider,
              appointmentType,
              appointmentData.timezone || clinicHours?.timezone || 'America/New_York',
              clinicId,
              appointmentData.practitioner_id || null
            );
            if (alt.success) {
              alternativeSlots = alt.slots || alt.available_slots || [];
              slotsWithDisplay = alt.slots_with_display || [];
            }
          } catch (_) {}
          const err = new Error('This time slot was just booked by another patient. Please select a different time.');
          err.slot_conflict = true;
          err.alternative_slots = alternativeSlots;
          err.slots_with_display = slotsWithDisplay;
          throw err;
        }
        throw dbError;
      }

      // Phase 5 Task 35: Send SMS + email with appointment time and upload portal link; set reminder_booking_sent
      try {
        const TelemedicineReminders = require('./telemedicine-reminders');
        await TelemedicineReminders.sendBookingConfirmationWithUploadLink(appointment);
      } catch (reminderError) {
        console.warn('⚠️  Booking confirmation (Phase 5) failed:', reminderError.message);
        if (appointment.patient_email) {
          try {
            await EmailService.sendAppointmentConfirmation(appointment);
            console.log('✅ Confirmation email sent (fallback)');
          } catch (emailError) {
            console.warn('⚠️  Email confirmation failed:', emailError.message);
          }
        }
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: true,
        appointment: {
          id: appointment.id,
          confirmation_number: appointment.id.substring(5, 13).toUpperCase(),
          clinic_id: clinicId,
          patient_name: appointment.patient_name,
          appointment_type: appointment.appointment_type,
          datetime: appointmentDateTime.displayTime,
          date: appointment.date,
          time: appointment.time,
          provider: appointment.provider,
          duration_minutes: appointment.duration_minutes,
          status: appointment.status,
          calendar_link: appointment.calendar_link,
          calendar_event_id: appointment.calendar_event_id,
          instructions: 'You will receive a reminder 24 hours before your appointment.'
        }
      };

    } catch (error) {
      console.error('❌ Error scheduling appointment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Phase 2.4: Create async review appointment (visit_mode=async_review, status=pending_review).
   * Bypasses slot validation; stores attachments in notes.
   * @param {Object} data - { patient_name, patient_phone, patient_email, clinic_id, reason, attachment_ids?, customer_id?, patient_id? }
   * @returns {Object} - { success, appointment: { id, ... } }
   */
  static async createAsyncReviewAppointment(data) {
    const appointmentId = `appt-${uuidv4()}`;
    const clinicId = this._ensureClinicId(data.clinic_id, 'async review');
    const clinicHours = getClinicBusinessHours(clinicId);
    const tz = data.timezone || clinicHours?.timezone || BUSINESS_HOURS.timezone;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD

    let fhirPatientId = data.patient_id || null;
    if (!fhirPatientId && (data.patient_phone || data.patient_email)) {
      try {
        const patientResult = await FHIRService.getOrCreatePatient({
          name: data.patient_name,
          phone: data.patient_phone,
          email: data.patient_email,
          timezone: tz
        }, false);
        if (patientResult?.patient) {
          fhirPatientId = patientResult.patient.id || patientResult.patient.resource_id;
        }
      } catch (_) {}
    }

    const notesObj = { reason: data.reason || '', attachment_ids: data.attachment_ids || [] };
    const notes = JSON.stringify(notesObj);

    const appointment = {
      id: appointmentId,
      clinic_id: clinicId,
      customer_id: data.customer_id || null,
      patient_name: data.patient_name,
      patient_phone: data.patient_phone || null,
      patient_email: data.patient_email || null,
      patient_id: fhirPatientId,
      appointment_type: data.appointment_type || 'General Consult',
      date: today,
      time: '12:00',
      start_time: null,
      end_time: null,
      duration_minutes: 15,
      provider: data.provider || 'DocLittle Specialist Team',
      status: 'pending_review',
      visit_mode: 'async_review',
      notes,
      calendar_event_id: null,
      calendar_link: null,
      video_room_name: appointmentId,
      timezone: tz,
      created_at: new Date().toISOString()
    };

    try {
      const { enforceCanonicalPatientPhone } = require('./patient-contact-canonical');
      enforceCanonicalPatientPhone(appointment, { logTag: '[BookingService.asyncReview]' });
    } catch (e) {
      console.warn('[BookingService.asyncReview] Canonical patient phone skipped:', e.message);
    }

    await db.createAppointment(appointment);
    return {
      success: true,
      appointment: {
        id: appointment.id,
        confirmation_number: appointment.id.substring(5, 13).toUpperCase(),
        clinic_id: clinicId,
        patient_name: appointment.patient_name,
        appointment_type: appointment.appointment_type,
        status: appointment.status,
        visit_mode: appointment.visit_mode
      }
    };
  }

  /**
   * Confirm an existing appointment
   * @param {String} appointmentId - Appointment ID or confirmation number
   * @returns {Object} - Confirmation result
   */
  static async confirmAppointment(appointmentId, clinicId = null) {
    console.log('\n✅ BOOKING SERVICE: Confirm Appointment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // Find appointment
      const appointment = await db.getAppointment(appointmentId, clinicId || null);
      if (!appointment) {
        throw new Error(clinicId ? 'Appointment not found for this clinic' : 'Appointment not found');
      }

      if (clinicId && appointment.clinic_id && appointment.clinic_id !== clinicId) {
        throw new Error('Appointment does not belong to this clinic');
      }

      const scopedClinicId = appointment.clinic_id || clinicId || null;

      console.log('📋 Found appointment:', appointment.id);

      // Check if already confirmed
      if (appointment.status === 'confirmed') {
        return {
          success: true,
          message: 'Appointment was already confirmed',
          appointment: this._formatAppointment(appointment)
        };
      }

      // Update status
      db.updateAppointmentStatus(appointmentId, 'confirmed', null, scopedClinicId);
      // Phase 4.1: Set slot_state = hard_locked when payment succeeds
      if (db.updateAppointment) {
        try {
          db.updateAppointment(appointmentId, { slot_state: 'hard_locked' }, scopedClinicId);
        } catch (_) {}
      }
      console.log('✅ Appointment confirmed');

      const updatedAppointment = await db.getAppointment(appointmentId, scopedClinicId);

      // Send confirmation email if email provided
      if (updatedAppointment.patient_email) {
        try {
          await EmailService.sendAppointmentConfirmation(updatedAppointment);
          console.log('✅ Confirmation email sent');
        } catch (emailError) {
          console.warn('⚠️  Email confirmation failed:', emailError.message);
        }
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: true,
        message: 'Appointment confirmed successfully',
        appointment: this._formatAppointment(updatedAppointment)
      };

    } catch (error) {
      console.error('❌ Error confirming appointment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mark an appointment as completed (used by video consult end_session).
   * Safe to call multiple times; if status is already 'completed', it is a no-op.
   * @param {String} appointmentId
   * @param {String|null} clinicId
   */
  static async completeAppointment(appointmentId, clinicId = null) {
    if (!appointmentId) return;
    try {
      const appointment = await db.getAppointment(appointmentId, clinicId || null);
      if (!appointment) {
        console.warn(`[BookingService.completeAppointment] Appointment not found: ${appointmentId}`);
        return;
      }

      const scopedClinicId = appointment.clinic_id || clinicId || null;

      if ((appointment.status || '').toLowerCase() === 'completed') {
        return;
      }

      db.updateAppointmentStatus(appointmentId, 'completed', null, scopedClinicId);
      console.log(`✅ Appointment ${appointmentId} marked completed`);

      // Trigger downstream FHIR DiagnosticReport creation (non-blocking best-effort).
      try {
        if (FHIRService && typeof FHIRService.createDiagnosticReportForAppointment === 'function') {
          await FHIRService.createDiagnosticReportForAppointment(appointmentId);
        }
      } catch (e) {
        console.warn(
          `[BookingService.completeAppointment] Failed to create DiagnosticReport for ${appointmentId}:`,
          e.message
        );
      }
    } catch (error) {
      console.warn(`[BookingService.completeAppointment] Failed for ${appointmentId}:`, error.message);
    }
  }

  /**
   * Reschedule an existing appointment
   * @param {String} appointmentId - Appointment ID or confirmation number
   * @param {String} newDate - New date in YYYY-MM-DD format
   * @param {String} newTime - New time (HH:MM or "2:00 PM")
   * @param {String} reason - Reschedule reason (optional)
   * @param {String} timezone - Timezone (optional)
   * @returns {Object} - Reschedule result
   */
  static async rescheduleAppointment(appointmentId, newDate, newTime, reason = null, timezone = null, clinicId = null) {
    console.log('\n🔄 BOOKING SERVICE: Reschedule Appointment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // Find appointment
      const appointment = await db.getAppointment(appointmentId, clinicId || null);
      if (!appointment) {
        throw new Error(clinicId ? 'Appointment not found for this clinic' : 'Appointment not found');
      }

      if (clinicId && appointment.clinic_id && appointment.clinic_id !== clinicId) {
        throw new Error('Appointment does not belong to this clinic');
      }

      const scopedClinicId = appointment.clinic_id || clinicId || null;

      console.log('📋 Found appointment:', appointment.id);
      console.log(`   Current: ${appointment.date} at ${appointment.time}`);
      console.log(`   New: ${newDate} at ${newTime}`);

      // Check if already cancelled
      if (appointment.status === 'cancelled') {
        throw new Error('Cannot reschedule a cancelled appointment');
      }

      // Get appointment type configuration
      const appointmentType = appointment.appointment_type || 'Mental Health Consultation';
      const typeConfig = APPOINTMENT_TYPES[appointmentType] || APPOINTMENT_TYPES['Mental Health Consultation'];

      // Parse new date/time
      const appointmentDateTime = this._parseDateTime(
        newDate,
        newTime,
        timezone || appointment.timezone || BUSINESS_HOURS.timezone,
        typeConfig.duration_minutes
      );

      // Check if new slot is available
      const availabilityCheck = await this._checkSlotAvailability(
        appointmentDateTime.startISO,
        appointmentDateTime.endISO,
        typeConfig,
        appointmentDateTime.date,
        appointmentDateTime.timezone,
        scopedClinicId,
        appointment.id, // Exclude current appointment from conflict check
        appointment.practitioner_id || null
      );

      if (!availabilityCheck.available) {
        throw new Error(`New slot not available: ${availabilityCheck.reason}`);
      }

      // Update Google Calendar event if it exists
      if (appointment.calendar_event_id) {
        const calendarContext = this.getCalendarClient();
        if (calendarContext && calendarContext.client) {
          const { client: calendar, calendarId } = calendarContext;
          try {
            const updatedEvent = {
              summary: `${appointment.appointment_type}: ${appointment.patient_name}`,
              description: `
Mental Health Appointment

Patient: ${appointment.patient_name}
Phone: ${appointment.patient_phone || 'N/A'}
Email: ${appointment.patient_email || 'N/A'}
Type: ${appointment.appointment_type}
Provider: ${appointment.provider}

Notes: ${appointment.notes || 'None'}

Appointment ID: ${appointment.id}
Rescheduled from: ${appointment.date} at ${appointment.time}
              `.trim(),
              start: {
                dateTime: appointmentDateTime.startISO,
                timeZone: timezone || appointment.timezone || BUSINESS_HOURS.timezone
              },
              end: {
                dateTime: appointmentDateTime.endISO,
                timeZone: timezone || appointment.timezone || BUSINESS_HOURS.timezone
              },
              reminders: {
                useDefault: false,
                overrides: [
                  { method: 'email', minutes: 24 * 60 },
                  { method: 'popup', minutes: 60 }
                ]
              }
            };

            await calendar.events.update({
              calendarId: calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
              eventId: appointment.calendar_event_id,
              resource: updatedEvent
            });
            console.log('✅ Google Calendar event updated');

            this._captureUpdatedCalendarCredentials(calendarContext);
          } catch (calendarError) {
            console.warn('⚠️  Calendar event update failed:', calendarError.message);
            // Continue with database update even if calendar fails
          }
        }
      }

      // Update appointment in database
      const updateData = {
        date: appointmentDateTime.date,
        time: appointmentDateTime.time,
        start_time: appointmentDateTime.startISO,
        end_time: appointmentDateTime.endISO,
        timezone: timezone || appointment.timezone || BUSINESS_HOURS.timezone
      };

      // Update database
      db.updateAppointment(appointmentId, updateData, scopedClinicId);

      // Add reschedule note
      let notes = appointment.notes || '';
      const rescheduleNote = `Rescheduled from ${appointment.date} at ${appointment.time}. Reason: ${reason || 'Not specified'}`;
      notes = notes ? `${notes}\n${rescheduleNote}` : rescheduleNote;
      db.updateAppointment(appointmentId, { notes }, scopedClinicId);

      const updatedAppointment = await db.getAppointment(appointmentId, scopedClinicId);

      // Notify patient (mvp-47)
      try {
        const { v4: uuidv4 } = require('uuid');
        const idem = `appt:${updatedAppointment.id}:patient_appt_rescheduled`;
        if (db.enqueueNotificationJob) {
          db.enqueueNotificationJob({
            id: uuidv4(),
            channel: 'email',
            type: 'patient_appt_rescheduled',
            to_address: updatedAppointment.patient_email,
            patient_id: updatedAppointment.patient_id || null,
            appointment_id: updatedAppointment.id,
            idempotency_key: idem,
            payload_json: JSON.stringify({
              appointment: updatedAppointment,
              details: {
                previous_datetime: `${appointment.date} at ${appointment.time}`,
                new_datetime: appointmentDateTime.displayTime
              }
            }),
            max_attempts: 6
          });
        } else if (EmailService && typeof EmailService.sendAppointmentRescheduled === 'function') {
          await EmailService.sendAppointmentRescheduled(updatedAppointment, {
            previous_datetime: `${appointment.date} at ${appointment.time}`,
            new_datetime: appointmentDateTime.displayTime
          });
        }
      } catch (e) {
        console.warn('⚠️  Reschedule email failed:', e.message);
      }

      console.log('✅ Appointment rescheduled successfully');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: true,
        message: 'Appointment rescheduled successfully',
        appointment: this._formatAppointment(updatedAppointment),
        previous_datetime: `${appointment.date} at ${appointment.time}`,
        new_datetime: appointmentDateTime.displayTime,
        reschedule_reason: reason
      };

    } catch (error) {
      console.error('❌ Error rescheduling appointment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cancel an appointment
   * @param {String} appointmentId - Appointment ID or confirmation number
   * @param {String} reason - Cancellation reason (optional)
   * @returns {Object} - Cancellation result
   */
  static async cancelAppointment(appointmentId, reason = null, clinicId = null) {
    console.log('\n❌ BOOKING SERVICE: Cancel Appointment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // Find appointment
      const appointment = await db.getAppointment(appointmentId, clinicId || null);
      if (!appointment) {
        throw new Error(clinicId ? 'Appointment not found for this clinic' : 'Appointment not found');
      }

      if (clinicId && appointment.clinic_id && appointment.clinic_id !== clinicId) {
        throw new Error('Appointment does not belong to this clinic');
      }

      const scopedClinicId = appointment.clinic_id || clinicId || null;

      console.log('📋 Found appointment:', appointment.id);

      // Check if already cancelled
      if (appointment.status === 'cancelled') {
        return {
          success: true,
          message: 'Appointment was already cancelled',
          appointment: this._formatAppointment(appointment)
        };
      }

      // Delete from Google Calendar if event exists (per-clinic)
      if (appointment.calendar_event_id) {
        const calendarContext = this.getCalendarClient(scopedClinicId || appointment.clinic_id);
        if (calendarContext && calendarContext.client) {
          const { client: calendar, calendarId } = calendarContext;
          try {
            const { withRetry } = require('../utils/retry');
            await withRetry(() => calendar.events.delete({
              calendarId: calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
              eventId: appointment.calendar_event_id
            }), { maxAttempts: 3 });
            console.log('✅ Calendar event deleted');

            this._captureUpdatedCalendarCredentials(calendarContext);
          } catch (calendarError) {
            console.warn('⚠️  Calendar event deletion failed:', calendarError.message);
          }
        }
      }

      // Update status
      db.updateAppointmentStatus(appointmentId, 'cancelled', reason, scopedClinicId);
      console.log('✅ Appointment cancelled');

      // Refund any completed payment for this appointment (Stripe only)
      let refundResult = null;
      try {
        const PaymentProcessorService = require('./payment-processor-service');
        const checkout = await db.getCompletedCheckoutByAppointmentId(appointmentId);
        if (checkout) {
          refundResult = await PaymentProcessorService.refundCheckout(checkout, {
            reason: 'requested_by_customer',
            amount: parseFloat(checkout.amount) || undefined
          });
          if (refundResult.success) {
            console.log(`✅ Refund issued: ${refundResult.refund_id}, $${refundResult.amount_refunded}`);
          } else {
            console.warn('⚠️  Refund skipped or failed:', refundResult.error);
          }
        }
      } catch (refundErr) {
        console.warn('⚠️  Refund on cancel failed:', refundErr.message);
        refundResult = { success: false, error: refundErr.message };
      }

      const updatedAppointment = await db.getAppointment(appointmentId, scopedClinicId);

      // Notify patient (mvp-47)
      try {
        const { v4: uuidv4 } = require('uuid');
        const idem = `appt:${updatedAppointment.id}:patient_appt_canceled`;
        if (db.enqueueNotificationJob) {
          db.enqueueNotificationJob({
            id: uuidv4(),
            channel: 'email',
            type: 'patient_appt_canceled',
            to_address: updatedAppointment.patient_email,
            patient_id: updatedAppointment.patient_id || null,
            appointment_id: updatedAppointment.id,
            idempotency_key: idem,
            payload_json: JSON.stringify({ appointment: updatedAppointment }),
            max_attempts: 6
          });
        } else if (EmailService && typeof EmailService.sendAppointmentCanceled === 'function') {
          await EmailService.sendAppointmentCanceled(updatedAppointment);
        }
      } catch (e) {
        console.warn('⚠️  Cancel email failed:', e.message);
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const result = {
        success: true,
        message: 'Appointment cancelled successfully',
        appointment: this._formatAppointment(updatedAppointment),
        cancellation_reason: reason
      };
      if (refundResult !== null) {
        result.refund = refundResult;
      }
      return result;

    } catch (error) {
      console.error('❌ Error cancelling appointment:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get available time slots for a specific date
   * @param {String} date - Date in YYYY-MM-DD format
   * @param {String} provider - Provider name (optional)
   * @param {String} appointmentType - Type of appointment (optional, filters by duration)
   * @param {String} timezone - Timezone for the date (optional)
   * @param {String} clinicId - Clinic ID (required)
   * @param {String} practitionerId - Practitioner ID for provider-level availability (Task 4)
   * @returns {Object} - Available slots with timezone-aware display (Task 51)
   * @note P2-4: Multi-provider filtering not yet implemented. practitionerId accepted but slots
   *       are aggregated at clinic level (single calendar per clinic). Future: filter by
   *       provider_id, license_states, specialties, languages.
   */
  static async getAvailableSlots(date, provider = null, appointmentType = null, timezone = null, clinicId = null, practitionerId = null) {
    console.log('\n🕐 BOOKING SERVICE: Get Available Slots');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      const scopedClinicId = this._ensureClinicId(clinicId, 'checking availability');
      const clinicHours = getClinicBusinessHours(scopedClinicId);
      const requestedTimezone = timezone || clinicHours.timezone;

      // Task 2: Check if calendar is configured (affects double-booking risk)
      const calendarContext = this.getCalendarClient(scopedClinicId);
      const calendar_configured = !!(calendarContext && calendarContext.client);
      const calendar_warning = calendar_configured ? null : 'Google Calendar not configured. Availability from DB only; external events ignored. Double-booking risk if provider has other calendars.';

      // Task 51: timezone-aware; Task 3: business days
      if (!isBusinessDay(date, clinicHours)) {
        console.log('📅 Date is not a business day (weekend or holiday)');
        return {
          success: true,
          date,
          timezone: requestedTimezone,
          appointment_type: appointmentType || 'Mental Health Consultation',
          available_slots: [],
          slots: [],
          slots_with_display: [],
          total_slots: 0,
          booked_slots: 0,
          slot_duration_minutes: 50,
          buffer_before_minutes: 10,
          buffer_after_minutes: 10,
          is_business_day: false,
          calendar_configured,
          calendar_warning
        };
      }

      const requestedDate = this._parseDateWithTimezone(date, requestedTimezone);
      if (isNaN(requestedDate)) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }

      console.log('📅 Checking availability for:', date, `(${requestedTimezone})`);
      if (provider) console.log('📋 Provider filter:', provider);
      if (practitionerId) console.log('📋 Practitioner filter:', practitionerId);
      if (appointmentType) {
        console.log('📋 Appointment type:', appointmentType);
      }

      // Get existing appointments (Task 4: filter by practitioner_id when given)
      let existingAppointments = await db.getAppointmentsByDate(date, scopedClinicId, practitionerId);
      if (provider && !practitionerId) {
        existingAppointments = existingAppointments.filter(
          a => (a.provider || '').toLowerCase().includes(String(provider).toLowerCase())
        );
      }
      console.log('📋 Found', existingAppointments.length, 'existing appointments');

      const internalCalendarEventIds = new Set(
        existingAppointments
          .filter(appt => appt.calendar_event_id)
          .map(appt => appt.calendar_event_id)
      );

      const externalEvents = await this._getExternalCalendarEventsForDate(
        date,
        requestedTimezone,
        internalCalendarEventIds,
        scopedClinicId
      );

      if (externalEvents.length > 0) {
        console.log('📅 Found', externalEvents.length, 'external Google Calendar event(s)');
      }

      // Get appointment type config if specified
      const typeConfig = appointmentType && APPOINTMENT_TYPES[appointmentType]
        ? APPOINTMENT_TYPES[appointmentType]
        : APPOINTMENT_TYPES['Mental Health Consultation'];

      // Generate slots using per-clinic business hours (Task 3)
      const slotConfig = { ...clinicHours, slot_interval_minutes: clinicHours.slot_interval_minutes || 15 };
      const allSlots = this._generateTimeSlotsAdvanced(
        slotConfig,
        typeConfig.duration_minutes,
        typeConfig.buffer_before_minutes,
        typeConfig.buffer_after_minutes
      );

      // Check each slot for conflicts; build timezone-aware display (Task 51)
      const availableSlots = [];
      const slotsWithDisplay = [];
      const bookedSlots = [];

      for (const slotTime of allSlots) {
        const slotStart = this._timeToDate(date, slotTime, requestedTimezone);
        const slotEnd = new Date(slotStart.getTime() +
          (typeConfig.duration_minutes + typeConfig.buffer_before_minutes + typeConfig.buffer_after_minutes) * 60 * 1000);

        // Check for conflicts with existing appointments
        const hasConflict = this._hasTimeConflict(
          slotStart,
          slotEnd,
          existingAppointments,
          externalEvents,
          typeConfig
        );

        if (!hasConflict) {
          availableSlots.push(slotTime);
          slotsWithDisplay.push({
            time: slotTime,
            slot_start_iso: slotStart.toISOString(),
            slot_display: slotStart.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: requestedTimezone
            }),
            timezone: requestedTimezone
          });
        } else {
          bookedSlots.push(slotTime);
        }
      }

      // Filter by provider availability (provider_availability_blocks + is_online)
      const onlineProviders = ProviderService.getBookableProvidersForClinic(scopedClinicId, 'sync');
      const activeProviderCount = ProviderService.getActiveProviderCountForClinic(scopedClinicId);
      if (activeProviderCount > 0 && onlineProviders.length === 0) {
        const readiness = ProviderService.getProviderBookingReadinessForClinic(scopedClinicId);
        const hasOnline = readiness.some((r) => r.is_online);
        const hasBlocks = readiness.some((r) => r.has_availability_blocks);
        const hasCalendar = readiness.some((r) => r.calendar_connected);
        let errorCode = 'NO_ONLINE_PROVIDERS';
        let errorMsg = 'No specialists are currently online. Please try again shortly.';
        if (hasOnline && !hasBlocks) {
          errorCode = 'PROVIDER_AVAILABILITY_NOT_SET';
          errorMsg = 'No specialist availability is configured yet. Please try again shortly.';
        } else if (hasOnline && !hasCalendar && CALENDAR_REQUIRED_FOR_SYNC) {
          errorCode = 'PROVIDER_CALENDAR_NOT_CONNECTED';
          errorMsg = 'No specialist has a connected calendar for sync booking right now.';
        } else if (hasOnline && !hasCalendar && BLOCKS_ONLY_ALLOWED) {
          errorCode = 'NO_BOOKABLE_SYNC_PROVIDER';
          errorMsg = 'No sync-bookable specialist is available right now. Try another date or async review.';
        }
        console.warn(`[BookingService] ${errorCode} clinic=${scopedClinicId} active=${activeProviderCount}`);
        this._trackCalendarObservability('booking_no_bookable_provider_failure', { clinic_id: scopedClinicId });
        return {
          success: false,
          error_code: errorCode,
          error: errorMsg,
          clinic_id: scopedClinicId,
          active_provider_count: activeProviderCount,
          booking_policy: {
            calendar_required_for_sync: CALENDAR_REQUIRED_FOR_SYNC,
            blocks_only_allowed: BLOCKS_ONLY_ALLOWED,
            prefer_synced_providers: PREFER_SYNCED_PROVIDERS
          }
        };
      }
      if (onlineProviders.length > 0) {
        const filtered = [];
        const filteredDisplay = [];
        for (let i = 0; i < availableSlots.length; i++) {
          const slotTime = availableSlots[i];
          const slotStart = this._timeToDate(date, slotTime, requestedTimezone);
          const slotEnd = new Date(slotStart.getTime() +
            (typeConfig.duration_minutes + typeConfig.buffer_before_minutes + typeConfig.buffer_after_minutes) * 60 * 1000);
          const anyProviderAvailable = onlineProviders.some((providerRef) =>
            ProviderService.isSlotInProviderAvailability(providerRef, slotStart, slotEnd, date)
          );
          if (anyProviderAvailable) {
            filtered.push(slotTime);
            filteredDisplay.push(slotsWithDisplay[i]);
          }
        }
        availableSlots.length = 0;
        availableSlots.push(...filtered);
        slotsWithDisplay.length = 0;
        slotsWithDisplay.push(...filteredDisplay);
        console.log('📋 Filtered by canonical provider availability:', onlineProviders.length, 'online provider(s),', availableSlots.length, 'slots after filter');
      }

      console.log('✅ Available slots:', availableSlots.length);
      console.log('📊 Booked slots:', bookedSlots.length);
      if (calendar_warning && !SUPPRESS_CALENDAR_WARNING) {
        if (!warnedCalendarIntegrationByClinic.has(scopedClinicId)) {
          console.warn('⚠️  ' + calendar_warning);
          warnedCalendarIntegrationByClinic.add(scopedClinicId);
        }
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const confidence = onlineProviders.some((p) => p.calendar_connected) ? 'high' : 'medium';
      if (confidence === 'high') this._trackCalendarObservability('booking_calendar_confidence_high');
      else if (confidence === 'medium') this._trackCalendarObservability('booking_calendar_confidence_medium');
      else this._trackCalendarObservability('booking_calendar_confidence_low');
      if (confidence === 'medium') this._trackCalendarObservability('booking_blocks_only_booking');
      this._trackCalendarObservability('booking_total_bookings');

      return {
        success: true,
        date: date,
        timezone: requestedTimezone,
        appointment_type: appointmentType || 'Mental Health Consultation',
        available_slots: availableSlots,
        slots: availableSlots,
        slots_with_display: slotsWithDisplay,
        total_slots: allSlots.length,
        booked_slots: bookedSlots.length,
        slot_duration_minutes: typeConfig.duration_minutes,
        buffer_before_minutes: typeConfig.buffer_before_minutes,
        buffer_after_minutes: typeConfig.buffer_after_minutes,
        calendar_configured,
        calendar_warning,
        calendar_confidence: confidence,
        calendar_source: onlineProviders.some((p) => p.calendar_connected) ? 'google_plus_blocks' : 'availability_blocks_only'
      };

    } catch (error) {
      console.error('❌ Error getting available slots:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Search for appointments by patient phone or email (S-2: tenant-scoped)
   * @param {String} searchTerm - Phone number or email
   * @param {String|null} clinicId - Required for clinic-scoped search
   * @param {String|null} customerId - Optional for customer/tenant-scoped search (multi-tenant)
   * @returns {Object} - Found appointments
   */
  static async searchAppointments(searchTerm, clinicId = null, customerId = null) {
    try {
      const scopedClinicId = customerId ? null : this._ensureClinicId(clinicId, 'searching appointments');
      const appointments = await db.searchAppointments(searchTerm, scopedClinicId, customerId || null);

      return {
        success: true,
        appointments: appointments.map(appt => this._formatAppointment(appt)),
        count: appointments.length
      };

    } catch (error) {
      console.error('❌ Error searching appointments:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== PRIVATE HELPER METHODS ====================

  static _ensureClinicId(clinicId, actionDescription) {
    if (!clinicId) {
      throw new Error(`clinic_id is required for ${actionDescription}`);
    }
    return clinicId;
  }

  static _validateAppointmentData(data) {
    const errors = [];

    if (!data.patient_name) errors.push('Patient name is required');
    if (!data.patient_phone && !data.patient_email) {
      errors.push('Patient phone or email is required');
    }
    if (!data.date) errors.push('Appointment date is required');
    if (!data.time) errors.push('Appointment time is required');

    return {
      valid: errors.length === 0,
      errors
    };
  }

  static _parseDateTime(date, time, timezone = BUSINESS_HOURS.timezone, durationMinutes = 50) {
    // Parse date (YYYY-MM-DD)
    const [year, month, day] = date.split('-').map(Number);

    // Parse time (e.g., "2:00 PM", "14:00", "2pm")
    const timeLower = time.toLowerCase().trim();
    let hours, minutes = 0;

    if (timeLower.includes('pm') || timeLower.includes('am')) {
      // 12-hour format
      const [timeStr, period] = timeLower.split(/\s*(am|pm)\s*/);
      [hours, minutes = 0] = timeStr.split(':').map(Number);

      if (period === 'pm' && hours !== 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
    } else {
      // 24-hour format
      [hours, minutes = 0] = time.split(':').map(Number);
    }

    // Create date with timezone awareness
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    // Create date object in specified timezone
    const startDate = this._createDateInTimezone(dateStr, timezone);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    return {
      date: date,
      time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
      startISO: startDate.toISOString(),
      endISO: endDate.toISOString(),
      timezone: timezone,
      displayTime: startDate.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone
      })
    };
  }

  static async _createCalendarEvent(calendar, calendarId, appointment, originalData) {
    const event = {
      summary: `${appointment.appointment_type}: ${appointment.patient_name}`,
      description: `
Mental Health Appointment

Patient: ${appointment.patient_name}
Phone: ${appointment.patient_phone || 'N/A'}
Email: ${appointment.patient_email || 'N/A'}
Type: ${appointment.appointment_type}
Provider: ${appointment.provider}

Notes: ${appointment.notes || 'None'}

Appointment ID: ${appointment.id}
      `.trim(),
      start: {
        dateTime: appointment.start_time,
        timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York'
      },
      end: {
        dateTime: appointment.end_time,
        timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York'
      },
      // Removed attendees - service accounts can't invite without Domain-Wide Delegation
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },  // 24 hours before
          { method: 'popup', minutes: 60 }        // 1 hour before
        ]
      },
      colorId: '9'  // Blue color for mental health appointments
    };

    const { withRetry } = require('../utils/retry');
    const response = await withRetry(() => calendar.events.insert({
      calendarId: calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
      resource: event
    }), { maxAttempts: 3 });

    return response.data;
  }

  /**
   * Generate time slots with advanced scheduling logic
   * Accounts for appointment duration and buffer times
   */
  static _generateTimeSlotsAdvanced(businessHours, durationMinutes, bufferBefore, bufferAfter) {
    const slots = [];
    const interval = businessHours.slot_interval_minutes || BUSINESS_HOURS.slot_interval_minutes || 15;
    const totalSlotMinutes = durationMinutes + bufferBefore + bufferAfter;

    // Generate slots starting from business start time
    for (let hour = businessHours.start; hour < businessHours.end; hour++) {
      for (let minute = 0; minute < 60; minute += interval) {
        const slotEndHour = hour + Math.floor((minute + totalSlotMinutes) / 60);
        const slotEndMinute = (minute + totalSlotMinutes) % 60;

        // Check if slot fits within business hours
        if (slotEndHour < businessHours.end ||
          (slotEndHour === businessHours.end && slotEndMinute === 0)) {
          const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          slots.push(timeStr);
        }
      }
    }

    return slots;
  }

  /**
   * Check if a time slot has conflicts with existing appointments
   * Accounts for buffer times and overlapping appointments
   */
  static _hasTimeConflict(slotStart, slotEnd, existingAppointments, externalEvents, typeConfig) {
    const combinedEvents = [
      ...existingAppointments,
      ...(externalEvents || [])
    ];

    for (const appt of combinedEvents) {
      // Skip cancelled appointments
      if (appt.status === 'cancelled') continue;

      const apptStart = new Date(appt.start_time);
      const apptEnd = new Date(appt.end_time);

      // Get appointment type config to calculate total blocked time
      const apptTypeConfig = APPOINTMENT_TYPES[appt.appointment_type] ||
        APPOINTMENT_TYPES['Mental Health Consultation'];

      // Calculate total blocked time (appointment + buffers)
      const apptBlockedStart = new Date(apptStart.getTime() - apptTypeConfig.buffer_before_minutes * 60 * 1000);
      const apptBlockedEnd = new Date(apptEnd.getTime() + apptTypeConfig.buffer_after_minutes * 60 * 1000);

      // Check for overlap (with buffers)
      const newSlotBlockedStart = new Date(slotStart.getTime() - typeConfig.buffer_before_minutes * 60 * 1000);
      const newSlotBlockedEnd = new Date(slotEnd.getTime() + typeConfig.buffer_after_minutes * 60 * 1000);

      // Check if there's any overlap
      if (newSlotBlockedStart < apptBlockedEnd && newSlotBlockedEnd > apptBlockedStart) {
        return true; // Conflict detected
      }
    }

    return false; // No conflict
  }

  /**
   * Check if a specific slot is available for booking
   * @param {String} excludeAppointmentId - Appointment ID to exclude from conflict check (for reschedules)
   */
  static async _checkSlotAvailability(startISO, endISO, typeConfig, date, timezone = BUSINESS_HOURS.timezone, clinicId = null, excludeAppointmentId = null, practitionerId = null) {
    const slotStart = new Date(startISO);
    const slotEnd = new Date(endISO);
    const clinicHours = clinicId ? getClinicBusinessHours(clinicId) : BUSINESS_HOURS;
    const tz = timezone || clinicHours.timezone;

    // Get existing appointments for the date
    let existingAppointments = await db.getAppointmentsByDate(date, clinicId || null, practitionerId || null);

    // Exclude the appointment being rescheduled from conflict check
    if (excludeAppointmentId) {
      existingAppointments = existingAppointments.filter(
        appt => appt.id !== excludeAppointmentId && !appt.id.includes(excludeAppointmentId.substring(5))
      );
    }

    const internalCalendarEventIds = new Set(
      existingAppointments
        .filter(appt => appt.calendar_event_id)
        .map(appt => appt.calendar_event_id)
    );

    const externalEvents = await this._getExternalCalendarEventsForDate(
      date,
      timezone,
      internalCalendarEventIds,
      clinicId
    );

    const hasConflict = this._hasTimeConflict(
      slotStart,
      slotEnd,
      existingAppointments,
      externalEvents,
      typeConfig
    );

    if (hasConflict) {
      return {
        available: false,
        reason: 'Time slot conflicts with existing appointment (including buffer times)'
      };
    }

    // Check if within business hours (Task 3: per-clinic)
    const hoursStart = clinicHours.start ?? BUSINESS_HOURS.start;
    const hoursEnd = clinicHours.end ?? BUSINESS_HOURS.end;
    const businessStart = new Date(slotStart);
    businessStart.setHours(hoursStart, 0, 0, 0);

    const businessEnd = new Date(slotStart);
    businessEnd.setHours(hoursEnd, 0, 0, 0);
    // B-2: If business hours span midnight (e.g. 22:00–02:00), end is next calendar day
    if (hoursEnd <= hoursStart && hoursEnd > 0) {
      businessEnd.setDate(businessEnd.getDate() + 1);
    }

    // Calculate appointment end time (without buffer after)
    // slotStart is the actual appointment start time (after buffer before)
    // So we only need to add the appointment duration
    const appointmentEndTime = new Date(slotStart.getTime() + typeConfig.duration_minutes * 60 * 1000);

    // Check if appointment start is before business hours
    if (slotStart < businessStart) {
      return {
        available: false,
        reason: `Time slot is outside business hours (${hoursStart}:00 - ${hoursEnd}:00)`
      };
    }

    // Check if appointment end (without buffer after) is after business hours
    if (appointmentEndTime > businessEnd) {
      return {
        available: false,
        reason: `Time slot is outside business hours (${hoursStart}:00 - ${hoursEnd}:00)`
      };
    }

    return { available: true };
  }

  static async _getExternalCalendarEventsForDate(date, timezone = BUSINESS_HOURS.timezone, internalCalendarEventIds = new Set(), clinicId = null) {
    const calendarContext = this.getCalendarClient(clinicId);
    if (!calendarContext || !calendarContext.client) {
      return [];
    }

    try {
      const startOfDay = new Date(`${date}T00:00:00`);
      const endOfDay = new Date(`${date}T23:59:59`);

      const response = await calendarContext.client.events.list({
        calendarId: calendarContext.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: timezone
      });

      const events = response.data.items || [];
      const externalEvents = [];

      for (const event of events) {
        if (!event || event.status === 'cancelled') continue;
        if (internalCalendarEventIds.has(event.id)) continue;

        const start = event.start?.dateTime || event.start?.date;
        const end = event.end?.dateTime || event.end?.date;

        if (!start || !end) continue;

        externalEvents.push({
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          status: 'external',
          appointment_type: 'External Calendar Event'
        });
      }

      this._captureUpdatedCalendarCredentials(calendarContext);

      return externalEvents;
    } catch (error) {
      console.warn('⚠️  Failed to load Google Calendar events:', error.message);

      if (calendarContext && calendarContext.user) {
        db.updateUserCalendarTokens(calendarContext.user.id, {
          error_message: error.message || 'Failed to load Google Calendar events'
        });
      }

      return [];
    }
  }

  /**
   * Create a date in a specific timezone
   * Simplified approach - for production, consider using date-fns-tz
   */
  static _createDateInTimezone(dateTimeStr, timezone) {
    // Parse the date string
    const date = new Date(dateTimeStr);

    // For now, we'll work with local time and let the database handle timezone
    // The timezone is stored for reference but we'll convert to UTC for storage
    // In a production system, you'd use a proper timezone library
    return date;
  }

  /**
   * Parse date with timezone
   */
  static _parseDateWithTimezone(dateStr, timezone) {
    const date = new Date(dateStr + 'T00:00:00');
    return date;
  }

  /**
   * Convert time string to Date object with timezone
   */
  static _timeToDate(dateStr, timeStr, timezone) {
    return new Date(`${dateStr}T${timeStr}:00`);
  }

  static _formatAppointment(appointment) {
    const tz = appointment.timezone || 'America/New_York';
    return {
      id: appointment.id,
      confirmation_number: appointment.id.substring(5, 13).toUpperCase(),
      clinic_id: appointment.clinic_id || null,
      patient_name: appointment.patient_name,
      patient_phone: appointment.patient_phone,
      appointment_type: appointment.appointment_type,
      date: appointment.date,
      time: appointment.time,
      datetime_display: new Date(appointment.start_time).toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: tz
      }),
      provider: appointment.provider,
      duration_minutes: appointment.duration_minutes,
      status: appointment.status,
      calendar_link: appointment.calendar_link,
      created_at: appointment.created_at
    };
  }

  /**
   * Helper: Create a future appointment with simplified parameters
   * Convenience wrapper around scheduleAppointment for programmatic use
   * 
   * @param {Object} options - Appointment options
   * @param {string} options.patient_name - Patient name (required)
   * @param {string} options.patient_phone - Patient phone (required)
   * @param {string} [options.patient_email] - Patient email
   * @param {string} [options.appointment_type] - Type (default: 'Mental Health Consultation')
   * @param {Date|string} options.date - Appointment date (Date object or YYYY-MM-DD string)
   * @param {string} options.time - Appointment time (HH:MM format, 24-hour)
   * @param {string} [options.timezone] - Timezone (default: BUSINESS_HOURS.timezone)
   * @param {string} [options.provider] - Provider name (default: 'DocLittle Mental Health Team')
   * @param {string} [options.notes] - Appointment notes
   * @param {string} [options.clinic_id] - Clinic ID (default: 'clinic-001')
   * @param {string} [options.customer_id] - Customer ID for tenant isolation
   * @returns {Promise<Object>} - Created appointment result
   * 
   * @example
   * // Create appointment 1 week from now at 2 PM
   * const nextWeek = new Date();
   * nextWeek.setDate(nextWeek.getDate() + 7);
   * const result = await BookingService.createFutureAppointment({
   *   patient_name: 'John Doe',
   *   patient_phone: '+1234567890',
   *   patient_email: 'john@example.com',
   *   clinic_id: 'clinic-001',  // required (B-3)
   *   date: nextWeek,
   *   time: '14:00',
   *   appointment_type: 'Follow-up Session'
   * });
   */
  static async createFutureAppointment(options) {
    if (!options.patient_name || !options.patient_phone) {
      throw new Error('patient_name and patient_phone are required');
    }
    if (!options.clinic_id) {
      throw new Error('clinic_id is required for createFutureAppointment (B-3: no hardcoded fallback)');
    }

    // Normalize date to YYYY-MM-DD string
    let dateStr;
    if (options.date instanceof Date) {
      dateStr = options.date.toISOString().split('T')[0];
    } else if (typeof options.date === 'string') {
      // If already YYYY-MM-DD, use as-is; otherwise try to parse
      if (/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
        dateStr = options.date;
      } else {
        const parsed = new Date(options.date);
        if (isNaN(parsed.getTime())) {
          throw new Error(`Invalid date format: ${options.date}. Use Date object or YYYY-MM-DD string.`);
        }
        dateStr = parsed.toISOString().split('T')[0];
      }
    } else {
      throw new Error('date must be a Date object or YYYY-MM-DD string');
    }

    // Normalize time to HH:MM format
    let timeStr = options.time;
    if (!timeStr || typeof timeStr !== 'string') {
      throw new Error('time is required and must be a string in HH:MM format (24-hour)');
    }
    // Ensure HH:MM format
    if (!/^\d{1,2}:\d{2}$/.test(timeStr)) {
      throw new Error(`Invalid time format: ${timeStr}. Use HH:MM format (24-hour, e.g., "14:30").`);
    }
    // Normalize to HH:MM (pad hour if needed)
    const [hour, minute] = timeStr.split(':');
    timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

    const appointmentData = {
      patient_name: options.patient_name,
      patient_phone: options.patient_phone,
      patient_email: options.patient_email || null,
      appointment_type: options.appointment_type || 'Mental Health Consultation',
      date: dateStr,
      time: timeStr,
      timezone: options.timezone || BUSINESS_HOURS.timezone,
      provider: options.provider || 'DocLittle Mental Health Team',
      notes: options.notes || '',
      clinic_id: options.clinic_id,
      customer_id: options.customer_id || null
    };

    return await this.scheduleAppointment(appointmentData);
  }
}

module.exports = BookingService;