/**
 * KellyToolExecutor
 *
 * Shared function executor for KellyAgentService.
 * Routes tool_call names to existing backend logic.
 *
 * This is K-2 from the migration plan.
 * It reuses the existing HTTP endpoints rather than duplicating logic,
 * so all business rules (fraud detection, duplicate patient checks, etc.)
 * remain in one place.
 */

const axios = require('axios');
const db = require('../database');
const TriageRAGService = require('./triage-rag-service');
const TriageRAGServiceV2 = require('./triage-rag-service-v2');
const SpecialistResolverService = require('./specialist-resolver-service');
const { getAvailableSlotsWithSpecialist, isSpecialtyType } = require('./specialist-slot-service');
const { getClinicBusinessHours, isBusinessDay, getNextBusinessDay, normalizeDateStr } = require('../config/clinic-business-hours');

const BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';

class KellyToolExecutor {
  // ── kelly_session_meta (payment_token persistence) ──────────────────────
  // Used to recover checkout/payment tokens across turns when the LLM
  // drops them from the tool-call args.
  static _ensureSessionMetaTable() {
    try {
      db.db.prepare(`
        CREATE TABLE IF NOT EXISTS kelly_session_meta_kv (
          session_id  TEXT NOT NULL,
          meta_key    TEXT NOT NULL,
          value       TEXT NOT NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, meta_key)
        )
      `).run();
    } catch (_) {}
  }

  static _setSessionMeta(sessionId, key, value) {
    try {
      if (!sessionId || !key) return;
      KellyToolExecutor._ensureSessionMetaTable();
      db.db.prepare(`
        INSERT OR REPLACE INTO kelly_session_meta_kv (session_id, meta_key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(sessionId, key, String(value));
    } catch (_) {}
  }

  static _getSessionMeta(sessionId, key) {
    try {
      if (!sessionId || !key) return null;
      KellyToolExecutor._ensureSessionMetaTable();
      const row = db.db.prepare(`
        SELECT value
        FROM kelly_session_meta_kv
        WHERE session_id = ? AND meta_key = ?
        LIMIT 1
      `).get(sessionId, key);
      return row?.value ?? null;
    } catch (_) {
      return null;
    }
  }

  // ── Date helpers ───────────────────────────────────────────────────────
  static _normalizeToBusinessDate(dateStr, clinicId) {
    const normalized = normalizeDateStr(dateStr);
    if (!normalized) return dateStr;
    const clinicHours = getClinicBusinessHours(clinicId);
    if (isBusinessDay(normalized, clinicHours)) return normalized;
    const next = getNextBusinessDay(normalized, clinicHours) || normalized;
    if (next !== normalized) {
      console.log(`[KellyToolExecutor] Non-business date ${normalized} → ${next}`);
    }
    return next;
  }

  static _httpTimeoutMs() {
    // Integrations/tests may need a longer server timeout; keep default unchanged.
    const v = parseInt(process.env.KELLY_TOOL_HTTP_TIMEOUT_MS || '15000', 10);
    return Number.isFinite(v) && v > 0 ? v : 15000;
  }

  // Shared truthiness helpers for triage/session gates.
  static _isCompleteFlag(value) {
    return value === 1 || value === true;
  }

  static _hasText(value) {
    return !!String(value || '').trim();
  }

  static _ragConfidenceThreshold() {
    const v = process.env.RAG_CONFIDENCE_THRESHOLD ?? '0.7';
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0.7;
  }

  /** Missing/invalid DB rag_confidence → 0 for gating (do not default to threshold). */
  static _confidenceFromTriageRow(triageResult) {
    if (!triageResult || triageResult.rag_confidence == null || triageResult.rag_confidence === '') return 0;
    const n = parseFloat(triageResult.rag_confidence);
    return Number.isFinite(n) ? n : 0;
  }

  static _bumpOpsCounter(name) {
    try {
      if (db.incrementOpsCounter) db.incrementOpsCounter(name);
      console.warn('[KellyToolExecutor] misuse counter bumped:', name);
    } catch (_) {}
  }

  /** Merchant id for public commerce quote/checkout (Kelly HTTP calls to this server). */
  static _resolveMerchantIdForCommerce(args, clinicId) {
    const fromArgs = args && (args.provider_id || args.merchant_id);
    if (fromArgs) return String(fromArgs).trim();
    if (!clinicId) return null;
    try {
      const c = db.getClinic ? db.getClinic(clinicId) : null;
      return c?.merchant_id ? String(c.merchant_id).trim() : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Execute a named tool with args and session context.
   *
   * @param {string} toolName
   * @param {Object} args           - Arguments from LLM tool_call
   * @param {Object} context        - { sessionId, clinicId, patientId, callerPhone, channel }
   * @returns {Promise<Object>}     - Tool result (always an object, never throws to LLM)
   */
  static async execute(toolName, args, context) {
    const { sessionId, clinicId, patientId, callerPhone, channel } = context;

    console.log(`[KellyToolExecutor] ${toolName}`, { sessionId, clinicId });

    try {
      switch (toolName) {

        case 'collect_insurance':
          return await this._collectInsurance(args, { sessionId, patientId, callerPhone });

        case 'get_available_slots':
          return await this._getAvailableSlots(args, { sessionId, clinicId, patientId, channel });

        case 'schedule_appointment': {
          const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
          const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);

          const routineNoSymptoms = (() => {
            try {
              const v = KellyToolExecutor._getSessionMeta ? KellyToolExecutor._getSessionMeta(sessionId, 'routine_no_symptoms') : null;
              return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
            } catch (_) {
              return false;
            }
          })();

          const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;

          // Routine/no-symptoms path: bypass full triage stack when session has routine_no_symptoms flag.
          // Voice HTTP guardrails (allowRoutineBypass) already permit schedule; executor must not block.
          if (routineNoSymptoms) {
            const syntheticTriage = {
              target_specialty: 'Primary Care',
              urgency: 'routine',
              primary_icd10: null,
              soap_note: 'Routine wellness visit — no active symptoms'
            };
            const { getCptCodeForVisit } = require('../utils/cpt-helper');
            const primaryCptRoutine = getCptCodeForVisit({
              specialty: 'PrimaryCare',
              isNewPatient: true,
              urgency: 'routine'
            });
            const normalizedArgsRoutine = { ...args };
            if (normalizedArgsRoutine.date) {
              normalizedArgsRoutine.date = KellyToolExecutor._normalizeToBusinessDate(normalizedArgsRoutine.date, clinicId);
            }
            const rawTime = String(args.time || '').trim();
            const rawLane = String(args.lane || '').trim();
            const isAsyncSlot = rawTime.toUpperCase().includes('ASYNC') || rawLane.toLowerCase().includes('async');
            const normalizedTime = rawTime && !rawTime.toUpperCase().includes('ASYNC') ? rawTime : '11:30 AM';
            normalizedArgsRoutine.time = normalizedTime;
            const visitMode = isAsyncSlot ? 'sync_video' : (String(rawLane || '').toLowerCase() === 'async' ? 'async_review' : 'sync_video');
            const scheduleEndpoint = channel === 'chat' ? '/api/appointments/schedule' : '/voice/appointments/schedule';
            const scheduleResultRoutine = await this._post(scheduleEndpoint, {
              ...normalizedArgsRoutine,
              appointment_type: normalizedArgsRoutine.appointment_type || 'Primary Care',
              clinic_id: clinicId,
              visit_mode: visitMode,
              notes: normalizedArgsRoutine.notes || syntheticTriage.soap_note,
              primary_icd10: null,
              primary_cpt: primaryCptRoutine || null,
              metadata: { session_id: sessionId },
              session_id: sessionId
            });
            if (scheduleResultRoutine?.success && scheduleResultRoutine?.appointment?.id) {
              try {
                const { autoCheckoutAfterSchedule } = require('./auto-checkout-after-schedule');
                const base = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
                const checkoutResult = await autoCheckoutAfterSchedule({
                  base,
                  appointmentId: scheduleResultRoutine.appointment.id,
                  patient_phone: normalizedArgsRoutine.patient_phone || callerPhone,
                  patient_email: normalizedArgsRoutine.patient_email,
                  patient_name: normalizedArgsRoutine.patient_name || 'Patient',
                  clinic_id: clinicId,
                  appointment_type: 'Primary Care',
                  triage_session_id: sessionId,
                  timeoutMs: KellyToolExecutor._httpTimeoutMs()
                });
                console.log('[DEBUG-CHECKOUT] autoCheckoutAfterSchedule result (routine):', JSON.stringify({
                  success: !!checkoutResult,
                  payment_token: checkoutResult?.payment_token ? checkoutResult.payment_token.slice(0, 12) + '…' : null,
                  checkout_id: checkoutResult?.checkout_id || null,
                  requires_verification: checkoutResult?.requires_verification,
                  error: checkoutResult?.error || null
                }));
                if (checkoutResult?.payment_token) {
                  KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', checkoutResult.payment_token);
                  KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', checkoutResult.checkout_id || '');
                }
                return {
                  ...scheduleResultRoutine,
                  checkout: checkoutResult,
                  payment_token: checkoutResult?.payment_token || null,
                  checkout_id: checkoutResult?.checkout_id || null,
                  requires_verification: !!checkoutResult?.requires_verification,
                  say_to_patient: checkoutResult?.requires_verification
                    ? `Your appointment is confirmed. A verification code was sent to ${normalizedArgsRoutine.patient_email}. Enter the 6-digit code to complete payment.`
                    : 'Your appointment is confirmed.'
                };
              } catch (checkoutErr) {
                console.warn('[KellyToolExecutor] Routine schedule checkout failed:', checkoutErr?.message);
                return scheduleResultRoutine;
              }
            }
            if (scheduleResultRoutine?.requiresPhone) {
              return {
                ...scheduleResultRoutine,
                next_step:
                  'Ask the patient for their phone number. When they provide it, call schedule_appointment again with the SAME patient_name and patient_email you already have, plus patient_phone. Do NOT ask for name or email again.'
              };
            }
            return scheduleResultRoutine || { success: false, error: 'Schedule failed' };
          }

          if (!sessionRow) {
            bump('voice_agent_misuse_schedule_appointment_no_triage_session_row');
            return {
              success: false,
              error: 'TRIAGE_REQUIRED',
              error_code: 'TRIAGE_REQUIRED',
              message: 'Please complete triage first (run_triage_rag) before scheduling an appointment.'
            };
          }

          const isSafetyRed =
            sessionRow.safety_level === 'red' ||
            sessionRow.referred_to_911 === 1 ||
            sessionRow.referred_to_911 === true;
          const providerOverrideEmergency = args.provider_override_emergency === true || args.provider_override_emergency === 'true';
          if (isSafetyRed && !providerOverrideEmergency) {
            bump('voice_agent_misuse_schedule_appointment_safety_blocked');
            return {
              success: false,
              error: 'SAFETY_BLOCKED',
              error_code: 'SAFETY_BLOCKED',
              message: 'Scheduling is blocked because this session was flagged as emergency/red safety.'
            };
          }

          const triageForNotes = TriageRAGService.getLatestForSession(sessionId);
          if (!triageForNotes) {
            bump('voice_agent_misuse_schedule_appointment_no_rag_result');
            return {
              success: false,
              error: 'TRIAGE_REQUIRED',
              error_code: 'TRIAGE_REQUIRED',
              message: 'Please complete triage first (run_triage_rag) before scheduling.'
            };
          }

          const triageComplete = KellyToolExecutor._isCompleteFlag(sessionRow.triage_complete);
          if (!triageComplete) {
            bump('voice_agent_misuse_schedule_appointment_triage_incomplete');
            return {
              success: false,
              error: 'TRIAGE_INCOMPLETE',
              error_code: 'TRIAGE_INCOMPLETE',
              message: 'Triage is not complete yet. Ask one more clarifying question / call run_triage_rag before booking.'
            };
          }

          const confidence = KellyToolExecutor._confidenceFromTriageRow(triageForNotes);
          const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';
          const confidenceNearThreshold = confidence >= Math.max(0, THRESHOLD - 0.2);
          const allowBorderlineProgress = !!(
            forceAfterClarified &&
            KellyToolExecutor._isCompleteFlag(sessionRow.opqrst_complete) &&
            !!sessionRow.intake_complete_at &&
            confidenceNearThreshold
          );
          if (confidence < THRESHOLD && !allowBorderlineProgress) {
            bump('voice_agent_misuse_schedule_appointment_low_confidence');
            return {
              success: false,
              error: 'LOW_CONFIDENCE',
              error_code: 'LOW_CONFIDENCE',
              message: 'RAG confidence is low. Please clarify and re-run triage before booking.'
            };
          }

          if (!KellyToolExecutor._isCompleteFlag(sessionRow.opqrst_complete)) {
            bump('voice_agent_misuse_schedule_appointment_opqrst_missing');
            return {
              success: false,
              error: 'OPQRST_REQUIRED',
              error_code: 'OPQRST_REQUIRED',
              message: 'Please complete the OPQRST clinical history before we schedule.'
            };
          }

          if (!sessionRow.intake_complete_at) {
            bump('voice_agent_misuse_schedule_appointment_rich_intake_missing');
            return {
              success: false,
              error: 'RICH_INTAKE_REQUIRED',
              error_code: 'RICH_INTAKE_REQUIRED',
              message: 'Please complete the rich intake (medications, allergies, and key history) before we schedule.'
            };
          }

          // W4-S6.5: Surface soap_note for specialist at appointment creation
          const soapNote = triageForNotes?.soap_note || null;
          const notes = args.notes
            ? (soapNote ? `${soapNote}\n\n---\n${args.notes}` : args.notes)
            : soapNote;
          // W3-S4.2: Pass resolved ICD/CPT from triage for billing
          const { getCptCodeForVisit } = require('../utils/cpt-helper');
          const primaryCpt = triageForNotes?.target_specialty
            ? getCptCodeForVisit({
                specialty: triageForNotes.target_specialty,
                isNewPatient: true,
                urgency: triageForNotes.urgency || 'routine'
              })
            : null;

          // The async slot provider can return `time: "ASYNC"`.
          // Some downstream booking/check-out paths require a concrete time and/or a
          // "sync" scheduling mode so the backend produces an `appointment.id`.
          const rawTime = String(args.time || '').trim();
          const rawLane = String(args.lane || '').trim();
          const isAsyncSlot = rawTime.toUpperCase().includes('ASYNC') || rawLane.toLowerCase().includes('async');

          if (args.date) {
            args = { ...args, date: KellyToolExecutor._normalizeToBusinessDate(args.date, clinicId) };
          }

          const normalizedTime = (() => {
            const t = String(args.time || '').trim();
            if (!t) return args.time;
            const up = t.toUpperCase();
            if (up === 'ASYNC' || up.includes('ASYNC')) return '11:30 AM';
            return args.time;
          })();
          const normalizedArgs = { ...args, time: normalizedTime };
          const visitMode = (() => {
            // If we detected an async slot, schedule as a sync visit mode to ensure
            // the appointment_id + checkout pipeline is available.
            if (isAsyncSlot) return 'sync_video';
            const v = String(normalizedArgs.lane || '').trim() || 'sync_video';
            if (v.toLowerCase() === 'sync') return 'sync_video';
            return v || 'sync_video';
          })();

          const scheduleEndpoint = channel === 'chat' ? '/api/appointments/schedule' : '/voice/appointments/schedule';
          const scheduleResult = await this._post(scheduleEndpoint, {
            ...normalizedArgs,
            clinic_id: clinicId,
            visit_mode: visitMode,
            notes: notes || args.notes,
            primary_icd10: triageForNotes?.primary_icd10 || null,
            primary_cpt: primaryCpt || null,
            // Ensure backend guardrails can reliably associate this tool call
            // with the triage session.
            metadata: { session_id: sessionId },
            session_id: sessionId
          });

          // Auto-chain schedule -> checkout through shared helper so all entry points
          // use one deduped checkout path (A2).
          if (scheduleResult?.success && scheduleResult?.appointment?.id) {
            try {
              const appointmentId = scheduleResult.appointment.id;
              const patientEmail =
                normalizedArgs.patient_email ||
                scheduleResult.appointment.patient_email ||
                null;
              const patientName =
                normalizedArgs.patient_name ||
                scheduleResult.appointment.patient_name ||
                'Patient';
              const patientPhone =
                normalizedArgs.patient_phone ||
                scheduleResult.appointment.patient_phone ||
                callerPhone ||
                null;

              const { autoCheckoutAfterSchedule } = require('./auto-checkout-after-schedule');
              const base = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
              const checkoutResult = await autoCheckoutAfterSchedule({
                base,
                appointmentId,
                patient_phone: patientPhone,
                patient_email: patientEmail,
                patient_name: patientName,
                clinic_id: clinicId,
                appointment_type:
                  normalizedArgs.appointment_type ||
                  triageForNotes?.target_specialty ||
                  scheduleResult.appointment.appointment_type,
                triage_session_id: sessionId || null,
                timeoutMs: KellyToolExecutor._httpTimeoutMs()
              });
              console.log('[DEBUG-CHECKOUT] autoCheckoutAfterSchedule result:', JSON.stringify({
                success: !!checkoutResult,
                payment_token: checkoutResult?.payment_token ? checkoutResult.payment_token.slice(0, 12) + '…' : null,
                checkout_id: checkoutResult?.checkout_id || null,
                requires_verification: checkoutResult?.requires_verification,
                error: checkoutResult?.error || null
              }));
              if (checkoutResult?.payment_token) {
                KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', checkoutResult.payment_token);
                KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', checkoutResult.checkout_id || '');
              }

              return {
                ...scheduleResult,
                checkout: checkoutResult,
                payment_token: checkoutResult?.payment_token || null,
                checkout_id: checkoutResult?.checkout_id || null,
                requires_verification: !!checkoutResult?.requires_verification,
                email_sent: !!checkoutResult?.email_sent,
                message:
                  checkoutResult?.message ||
                  (checkoutResult?.email_sent ? 'Verification code emailed' : undefined),
                next_step:
                  'The appointment is booked. A verification code has been sent to your email. Please provide the 6-digit code to complete checkout.'
              };
            } catch (checkoutErr) {
              console.warn('[KellyToolExecutor] auto checkout chain failed (non-fatal):', checkoutErr.message);
              // Fall back to schedule result only; LLM can call create_appointment_checkout itself.
            }
          }

          // When phone is required, tell the LLM to ask for it then retry with SAME name/email—do NOT re-ask for name
          if (scheduleResult?.requiresPhone) {
            return {
              ...scheduleResult,
              next_step:
                'Ask the patient for their phone number. When they provide it, call schedule_appointment again with the SAME patient_name and patient_email you already have, plus patient_phone. Do NOT ask for name or email again.'
            };
          }

          return scheduleResult;
        }

        case 'search_appointments':
          return await this._post('/voice/appointments/search', {
            search_term: args.search_term,
            clinic_id: clinicId
          });

        case 'confirm_appointment':
          return await this._post('/voice/appointments/confirm', {
            appointment_id: args.appointment_id,
            clinic_id: clinicId
          });

        case 'cancel_appointment':
          return await this._post('/voice/appointments/cancel', {
            appointment_id: args.appointment_id,
            reason: args.reason || null,
            clinic_id: clinicId
          });

        case 'reschedule_appointment':
          return await this._post('/voice/appointments/reschedule', {
            appointment_id: args.appointment_id,
            new_date: args.new_date,
            new_time: args.new_time,
            reason: args.reason || null,
            timezone: args.timezone || null,
            clinic_id: clinicId
          });

        case 'create_appointment_checkout': {
          const checkoutResult = await this._post('/voice/appointments/checkout', {
            ...args,
            clinic_id: clinicId
          });
          if (checkoutResult?.payment_token) {
            KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', checkoutResult.payment_token);
            KellyToolExecutor._setSessionMeta(sessionId, 'checkout_id', checkoutResult.checkout_id || '');
          }
          return {
            ...checkoutResult,
            message:
              checkoutResult?.message ||
              (checkoutResult?.email_sent ? 'Verification code emailed' : undefined)
          };
        }

        case 'verify_checkout_code':
          {
            // If the model dropped payment_token from its tool args, recover it from session meta.
            let paymentToken = args.payment_token;
            if (!paymentToken) {
              paymentToken = KellyToolExecutor._getSessionMeta(sessionId, 'payment_token');
            }
            // Recovery: attempt DB lookup by triage session when token is still missing.
            if (!paymentToken) {
              try {
                const row = db.db?.prepare(`
                  SELECT pt.token AS payment_token
                  FROM voice_checkouts vc
                  INNER JOIN payment_tokens pt ON pt.checkout_id = vc.id
                  WHERE vc.triage_session_id = ?
                    AND (vc.status IS NULL OR vc.status != 'completed')
                    AND (pt.status IS NULL OR pt.status != 'completed')
                  ORDER BY vc.created_at DESC, pt.created_at DESC
                  LIMIT 1
                `).get(sessionId);
                if (row?.payment_token) {
                  paymentToken = row.payment_token;
                  KellyToolExecutor._setSessionMeta(sessionId, 'payment_token', paymentToken);
                  console.log('[TOKEN-RECOVERY] Recovered payment_token from DB for session:', String(sessionId || '').slice(0, 8));
                }
              } catch (_) {}
            }
            if (!paymentToken) {
              return {
                success: false,
                error: 'MISSING_TOKEN',
                message:
                  "I couldn't find your payment session. Let me resend the verification code - what's your email address?"
              };
            }
            return await this._post('/voice/checkout/verify', {
              payment_token: paymentToken,
              verification_code: args.verification_code,
              clinic_id: clinicId
            });
          }

        case 'get_patient_claims':
          return await this._getPatientClaims(args, sessionId);

        case 'get_triage_session':
          return this._getTriageSession(sessionId);

        case 'store_triage_opqrst':
          return this._storeTriageOpqrst(args, sessionId, patientId);

        case 'store_triage_rich_intake':
          return this._storeTriageRichIntake(args, sessionId, patientId);

        case 'run_triage_rag':
          return await this._runTriageRAG(args, sessionId, patientId, clinicId);

        case 'request_document_upload':
          return await this._requestDocumentUpload(args, sessionId, patientId, callerPhone, channel);

        case 'query_patient_records':
          return await this._queryPatientRecords(args, patientId);

        case 'end_call':
          return { success: true, end_call: true };

        case 'get_product_quote': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          if (!merchantId) {
            return {
              success: false,
              error: 'merchant_required',
              message: 'Could not resolve merchant/provider for this clinic. Pass provider_id or configure clinic merchant_id.'
            };
          }
          const productId = args.product_id || args.prescription_id;
          if (!productId) {
            return { success: false, error: 'product_id_required' };
          }
          return await this._post('/api/public/commerce/quote', {
            product_id: productId,
            prescription_id: productId,
            provider_id: merchantId,
            quantity: args.quantity
          });
        }

        case 'prepare_commerce_checkout': {
          const merchantId = KellyToolExecutor._resolveMerchantIdForCommerce(args, clinicId);
          if (!merchantId) {
            return {
              success: false,
              error: 'merchant_required',
              message: 'Could not resolve merchant/provider for this clinic. Pass provider_id or configure clinic merchant_id.'
            };
          }
          const quoteId = args.quote_id || args.checkout_session_id;
          const email = args.customer_email || args.email;
          if (!quoteId || !email) {
            return { success: false, error: 'quote_and_email_required', message: 'quote_id and customer_email are required.' };
          }
          return await this._post('/api/public/checkout/start', {
            quote_id: quoteId,
            checkout_session_id: quoteId,
            provider_id: merchantId,
            email: String(email).trim(),
            phone: args.customer_phone || args.phone || undefined,
            name: args.customer_name || args.name || undefined,
            shipping_address: args.shipping_address || undefined,
            kelly_session_id: sessionId || undefined,
            payment_method: args.payment_method || 'direct_stripe'
          });
        }

        default:
          console.warn(`[KellyToolExecutor] Unknown tool: ${toolName}`);
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      console.error(`[KellyToolExecutor] ${toolName} error:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // gap1+2+4+5: get_available_slots — block until triage, use resolver
  // ─────────────────────────────────────────────────────────────
  static async _getAvailableSlots(args, { sessionId, clinicId, patientId, channel }) {
    const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
    const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);
    const routineNoSymptoms = (() => {
      try {
        const v = KellyToolExecutor._getSessionMeta(sessionId, 'routine_no_symptoms');
        return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
      } catch (_) {
        return false;
      }
    })();

    // gap1: block slots until run_triage_rag has completed
    const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
    const isSafetyRed =
      sessionRow &&
      ((sessionRow.safety_level === 'red') ||
        (sessionRow.referred_to_911 === 1) ||
        (sessionRow.referred_to_911 === true));

    if (isSafetyRed) {
      bump('voice_agent_misuse_get_available_slots_safety_blocked');
      return {
        success: false,
        error: 'SAFETY_BLOCKED',
        error_code: 'SAFETY_BLOCKED',
        message: 'Scheduling is blocked because this session was flagged as emergency/red safety.'
      };
    }

    let triageResult = TriageRAGService.getLatestForSession(sessionId);
    let usingRoutineBypass = false;
    if (!triageResult && routineNoSymptoms) {
      usingRoutineBypass = true;
      triageResult = {
        id: `routine-${sessionId}`,
        target_specialty: args.appointment_type || 'PrimaryCare',
        urgency: 'routine',
        recommended_lane: args.lane || 'sync',
        rag_confidence: THRESHOLD,
        differentials: [{ specialty: args.appointment_type || 'PrimaryCare', probability: 1 }]
      };
    }
    if (!triageResult) {
      bump('voice_agent_misuse_get_available_slots_no_rag_result');
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        error_code: 'TRIAGE_REQUIRED',
        message: 'Please complete triage first. Ask the patient to describe their symptoms, then call run_triage_rag to determine the right specialty. Only after triage can we look up available slots.'
      };
    }
    // Block orphan/stale RAG: triage_sessions must point at this exact RAG row (set on run_triage_rag).
    if (routineNoSymptoms) {
      console.log('[SLOTS] Routine session - skipping stale RAG check');
    } else if (
      !usingRoutineBypass &&
      sessionRow &&
      sessionRow.rag_result_id != null &&
      String(sessionRow.rag_result_id).trim() !== '' &&
      String(sessionRow.rag_result_id) !== String(triageResult.id)
    ) {
      bump('voice_agent_misuse_get_available_slots_no_rag_result');
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        error_code: 'TRIAGE_REQUIRED',
        message: 'Triage is out of date for this visit. Please call run_triage_rag again with the current symptoms before looking up slots.'
      };
    }
    // W3-S5.1: Assert differentials or target_specialty before resolver
    const hasDifferentials = (triageResult.differentials || []).length >= 1;
    const hasSpecialty = !!(triageResult.target_specialty);
    if (!hasDifferentials && !hasSpecialty) {
      return {
        success: false,
        error: 'DIFFERENTIALS_REQUIRED',
        error_code: 'DIFFERENTIALS_REQUIRED',
        message: 'Differentials are not yet generated. Complete triage and run run_triage_rag to get specialty recommendations before looking up available slots.'
      };
    }

    // T20: Hard gate — refuse if triage_complete is false OR rag_confidence is below threshold
    // gap13: block slots when rag_confidence < threshold — ask one more question first
    // IMPORTANT: Check this BEFORE `triage_complete`, otherwise we may return TRIAGE_INCOMPLETE
    // and the UX falls back to a generic "tell me more" question even when the real blocker
    // is confidence.
    const confidence = KellyToolExecutor._confidenceFromTriageRow(triageResult);
    // Controlled borderline override:
    // after repeated clarification loops, allow slot lookup when confidence is only
    // slightly below threshold, but only if OPQRST + rich intake are complete and
    // we already have a specialty from triage.
    const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';
    const opqrstComplete = sessionRow && KellyToolExecutor._isCompleteFlag(sessionRow.opqrst_complete);
    const intakeComplete = !!(sessionRow && sessionRow.intake_complete_at);
    const confidenceNearThreshold = confidence >= Math.max(0, THRESHOLD - 0.2);
    const allowBorderlineProgress = !!(
      forceAfterClarified &&
      opqrstComplete &&
      intakeComplete &&
      hasSpecialty &&
      confidenceNearThreshold
    );
    const bypassConfidenceForRoutine = routineNoSymptoms || usingRoutineBypass;
    if (confidence < THRESHOLD && !allowBorderlineProgress && !bypassConfidenceForRoutine) {
      bump('voice_agent_misuse_get_available_slots_low_confidence');
      return {
        success: false,
        error: 'LOW_CONFIDENCE',
        error_code: 'LOW_CONFIDENCE',
        message: 'RAG confidence is low. Ask one more clarifying question (e.g. "Can you describe the pain in more detail?" or "Is it on both sides?") then call run_triage_rag again before looking up slots.'
      };
    }

    const triageComplete =
      usingRoutineBypass ||
      routineNoSymptoms ||
      (sessionRow && KellyToolExecutor._isCompleteFlag(sessionRow.triage_complete));
    if (!triageComplete) {
      bump('voice_agent_misuse_get_available_slots_triage_incomplete');
      return {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
        error_code: 'TRIAGE_INCOMPLETE',
        message: 'Triage is not complete yet. Please call run_triage_rag until triage is marked complete before looking up slots.'
      };
    }

    const dateRaw = args.date || new Date().toISOString().slice(0, 10);
    const date = KellyToolExecutor._normalizeToBusinessDate(dateRaw, clinicId);
    const timezone = args.timezone || 'America/New_York';
    const lane = args.lane || triageResult.recommended_lane || 'sync';
    // W3-S5.2: specialty from differential (triageResult.target_specialty)
    const appointmentType = routineNoSymptoms
      ? 'Primary Care'
      : (args.appointment_type || triageResult.target_specialty || 'General Consult');

    // gap5: pass patient price_tier
    const pricing = db.getPatientPricing ? db.getPatientPricing(patientId) : { price_tier: 2 };
    const patientTier = (pricing && pricing.price_tier) || 2;

    // W3-S5.3 + W3-S5.4: language from session (kelly_session_meta or triage_sessions.detected_language), location (patient state)
    let language = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
    if (!language && sessionRow?.detected_language) language = sessionRow.detected_language;
    language = language || 'en';
    let patientState = null;
    if (patientId && db.getFHIRPatient) {
      try {
        const patient = db.getFHIRPatient(patientId);
        if (patient?.resource_data) {
          const data = typeof patient.resource_data === 'string' ? JSON.parse(patient.resource_data) : patient.resource_data;
          const addr = data?.address?.[0];
          patientState = addr?.state || (addr?.address?.state) || null;
        }
      } catch (_) {}
    }
    if (!patientState && db.getOrchestrateSessionBySessionId) {
      try {
        const row = db.getOrchestrateSessionBySessionId(sessionId);
        patientState = row?.flow_state?.patient_state || row?.flow_state?.state || null;
      } catch (_) {}
    }

    if (!clinicId) {
      return { success: false, error: 'clinic_id is required' };
    }

    // W3-S5.5: Multi-specialty when primary + secondary differ
    const secondarySpecialties = triageResult.secondary_specialties || [];
    const allSpecialties = [appointmentType, ...secondarySpecialties].filter((s, i, a) => a.indexOf(s) === i);
    const multiSpecialty = allSpecialties.length > 1;

    // gap2 + W3-S5.3: SpecialistResolver with full inputs
    if (isSpecialtyType(appointmentType) || multiSpecialty) {
      try {
        const resolveOpts = {
          clinicId,
          specialty: appointmentType,
          language,
          state: patientState,
          lane,
          urgency: triageResult.urgency || 'routine',
          patientTier,
          date
        };
        let resolverResult = await SpecialistResolverService.resolve(resolveOpts);

        // W3-S5.5: Call resolver for each specialty when multi-specialty, merge option sets
        let allSlots = [];
        let allKellyScripts = [resolverResult.kellyScript].filter(Boolean);
        let mergedProviderMap = resolverResult.providers || new Map();

        if (multiSpecialty && secondarySpecialties.length > 0) {
          for (const spec of secondarySpecialties) {
            if (!isSpecialtyType(spec)) continue;
            const secResult = await SpecialistResolverService.resolve({
              ...resolveOpts,
              specialty: spec
            });
            if (secResult.kellyScript) allKellyScripts.push(secResult.kellyScript);
            if (secResult.providers && secResult.providers.size > 0) {
              for (const [pid, attrs] of secResult.providers) {
                if (!mergedProviderMap.has(pid)) mergedProviderMap.set(pid, { ...attrs, _specialty: spec });
              }
            }
          }
        }

        if (mergedProviderMap.size > 0) {
          const slots = await getAvailableSlotsWithSpecialist({
            date,
            lane,
            providerMap: mergedProviderMap,
            clinicId,
            timezone,
            appointmentType
          });

          const availableSlots = slots.map(s =>
            s.time === 'ASYNC'
              ? `Async review — ${s.practitioner_name}`
              : s.time
          );

          // W3-S5.5 + M-S5.A: kelly_script for filter decay (e.g. "No Swahili-speaking...") or multi-specialty narrative
          let kellyScript = allKellyScripts[0] || null;
          if (!kellyScript && multiSpecialty && allSpecialties.length >= 2) {
            const specLabels = allSpecialties.slice(0, 3).map(s => s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2'));
            kellyScript = `Based on your symptoms you may need both ${specLabels.slice(0, -1).join(' and ')} and ${specLabels[specLabels.length - 1]} care. Here are the available options.`;
          }

          // M-S5.A: say_to_patient ensures LLM says kelly_script verbatim
          const out = {
            success: true,
            available_slots: availableSlots,
            slot_bundles: slots,
            appointment_type: appointmentType,
            secondary_specialties: multiSpecialty ? secondarySpecialties : [],
            kelly_script: kellyScript
          };
          KellyToolExecutor._setSessionMeta(sessionId, 'kelly_script_hint', kellyScript || '');
          if (kellyScript) out.say_to_patient = `Say this to the patient before presenting slots: "${kellyScript}"`;
          return out;
        }
      } catch (err) {
        console.warn('[KellyToolExecutor] Specialist path failed, falling back:', err.message);
      }
    }

    // Fallback: use the shared voice availability endpoint for BOTH chat and voice.
    // The legacy /api/appointments/available-slots route can be disabled and diverges
    // from triage/session parity behavior, causing 403s in chat while voice succeeds.
    const slotsEndpoint = '/voice/appointments/available-slots';
    const fallbackOut = await this._post(slotsEndpoint, {
      date,
      appointment_type: appointmentType,
      timezone,
      lane,
      clinic_id: clinicId,
      // Backend safety-guard (when implemented) and for consistent triage-session traceability.
      metadata: { session_id: sessionId },
      session_id: sessionId
    });
    if (fallbackOut?.slot_bundles && Array.isArray(fallbackOut.slot_bundles)) {
      fallbackOut.slot_bundles = fallbackOut.slot_bundles.map((s) => ({
        ...s,
        practitioner_name: s?.practitioner_name || null,
        practitioner_id: s?.practitioner_id || null
      }));
    }
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_script_hint', fallbackOut?.kelly_script || '');
    return fallbackOut;
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helper
  // ─────────────────────────────────────────────────────────────
  static async _post(path, body) {
    const response = await axios.post(`${BASE_URL}${path}`, body, { timeout: KellyToolExecutor._httpTimeoutMs() });
    return response.data;
  }

  // ─────────────────────────────────────────────────────────────
  // Claims lookup — fixes V-1: forward patient_id from insurance
  // ─────────────────────────────────────────────────────────────
  static async _getPatientClaims(args, sessionId) {
    const insResult = await this._post('/voice/insurance/collect', {
      member_id: args.member_id,
      patient_name: args.patient_name,
      payer_name: args.payer_name || undefined,
      call_id: sessionId
    });

    if (!insResult.success) {
      return { success: false, error: insResult.error || 'Could not find insurance information' };
    }

    const patientId = insResult.patient_id;
    if (!patientId) {
      return { success: false, error: 'Patient not found for this insurance member ID' };
    }

    try {
      const claimsResponse = await axios.get(`${BASE_URL}/api/patient/benefits`, {
        params: { patientId, memberId: args.member_id },
        timeout: KellyToolExecutor._httpTimeoutMs()
      });
      return {
        success: true,
        ...claimsResponse.data,
        insurance: insResult
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // gap11+12: get_triage_session, store_triage_opqrst
  // ─────────────────────────────────────────────────────────────
  static _getTriageSession(sessionId) {
    const row = db.getTriageSession ? db.getTriageSession(sessionId) : null;
    if (!row) return { success: true, session: null };
    return {
      success: true,
      session: {
        onset: row.onset,
        provocation: row.provocation,
        quality: row.quality,
        radiation: row.radiation,
        severity: row.severity,
        timing: row.timing,
        associated_sx: row.associated_sx,
        family_history: row.family_history,
        medications: row.medications,
        prior_diagnoses: row.prior_diagnoses,
        prior_workups: row.prior_workups,
        allergies: row.allergies,
        alcohol_use: row.alcohol_use,
        alcohol_cage_score: row.alcohol_cage_score,
        smoking_status: row.smoking_status,
        phq2_score: row.phq2_score,
        gad2_score: row.gad2_score,
        safety_screen: row.safety_screen,
        substance_use: row.substance_use,
        critical_unknowns: row.critical_unknowns || [],
        occupation: row.occupation ?? null,
        intake_complete_at: row.intake_complete_at ?? null,

        // Upload gating state (needed for pause/resume UX).
        media_requested: row.media_requested ?? null,
        media_received: row.media_received ?? null,
        media_ids: row.media_ids ?? []
      }
    };
  }

  // W1-S6.2: Idempotent for partial updates — merge with stored, DB uses COALESCE
  // Coerce severity: LLM may pass "5" or "unknown" as string; store number 1-10 or null
  static _coerceSeverity(v) {
    if (v == null) return null;
    if (typeof v === 'number' && v >= 1 && v <= 10) return v;
    const s = String(v).trim().toLowerCase();
    if (s === 'unknown' || s === '' || s === 'n/a') return null;
    const n = parseInt(s, 10);
    return (n >= 1 && n <= 10) ? n : null;
  }

  static _normalizeListToText(v) {
    if (v == null) return v;
    if (Array.isArray(v)) {
      const parts = v
        .map(x => (x == null ? '' : String(x).trim()))
        .filter(Boolean);
      return parts.join(', ');
    }
    return String(v);
  }

  static _normalizeArrayOfStrings(v) {
    if (v == null) return null;
    if (Array.isArray(v)) {
      return v
        .map(x => (x == null ? '' : String(x).trim()))
        .filter(Boolean);
    }
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('[')) {
        try {
          const parsed = JSON.parse(t);
          if (Array.isArray(parsed)) {
            return parsed.map(x => (x == null ? '' : String(x).trim())).filter(Boolean);
          }
        } catch (_) {}
      }
      return t
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
    return null;
  }

  static _storeTriageOpqrst(args, sessionId, patientId) {
    try {
      if (!db.upsertTriageSession) return { success: true };
      const stored = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
      const rawSeverity = args.severity ?? stored.severity;
      const severity = KellyToolExecutor._coerceSeverity(rawSeverity) ?? stored.severity;
      const merged = {
        onset: args.onset ?? stored.onset,
        provocation: args.provocation ?? stored.provocation,
        quality: args.quality ?? stored.quality,
        radiation: args.radiation ?? stored.radiation,
        severity,
        timing: args.timing ?? stored.timing,
        associated_sx: args.associated_sx ?? stored.associated_sx,
        family_history: args.family_history ?? stored.family_history,
        medications: KellyToolExecutor._normalizeListToText(args.medications ?? stored.medications),
        prior_diagnoses: KellyToolExecutor._normalizeListToText(args.prior_diagnoses ?? stored.prior_diagnoses),
        prior_workups: args.prior_workups ?? stored.prior_workups,
        allergies: KellyToolExecutor._normalizeListToText(args.allergies ?? stored.allergies),
        alcohol_use: args.alcohol_use ?? stored.alcohol_use,
        alcohol_cage_score: (() => {
          const v = args.alcohol_cage_score;
          if (v != null) {
            if (typeof v === 'number' && v >= 0 && v <= 4) return v;
            const n = parseInt(String(v), 10);
            if (n >= 0 && n <= 4) return n;
          }
          return stored.alcohol_cage_score ?? null;
        })(),
        smoking_status: args.smoking_status ?? stored.smoking_status,
        safety_screen: args.safety_screen ?? stored.safety_screen,
        substance_use: args.substance_use ?? stored.substance_use
      };
      const { scorePHQ2, scoreGAD2 } = require('../utils/phq-gad-scorer');
      let phq2 = args.phq2_score;
      if (phq2 == null && (args.phq2_q1 != null || args.phq2_q2 != null)) {
        phq2 = scorePHQ2({ q1: args.phq2_q1, q2: args.phq2_q2 });
      }
      let gad2 = args.gad2_score;
      if (gad2 == null && (args.gad2_q1 != null || args.gad2_q2 != null)) {
        gad2 = scoreGAD2({ q1: args.gad2_q1, q2: args.gad2_q2 });
      }
      let safetyScreen = args.safety_screen;
      if (safetyScreen == null && (args.safety_screen_q1 != null || args.safety_screen_q2 != null)) {
        const q1 = String(args.safety_screen_q1 || '').toLowerCase();
        const q2 = String(args.safety_screen_q2 || '').toLowerCase();
        const pos = ['yes', 'yeah', 'true', '1'].some(t => q1.includes(t) || q2.includes(t));
        safetyScreen = pos ? 'positive' : 'negative';
      }
      // M-S3.C: opqrst_complete when core OPQRST stored.
      // Provocation/radiation is helpful, but we should not block triage progress when it is missing
      // (otherwise the agent can get stuck in OPQRST-clarification loops).
      const hasOnset = KellyToolExecutor._hasText(merged.onset);
      const hasQuality = KellyToolExecutor._hasText(merged.quality);
      const hasSeverity = merged.severity != null && merged.severity !== '';
      const hasTiming = KellyToolExecutor._hasText(merged.timing);
      const opqrstComplete = hasOnset && hasQuality && hasSeverity && hasTiming;

      if (process.env.KELLY_DEBUG_OPQRST === '1') {
        console.log('[DEBUG_OPQRST]', {
          sessionId,
          patientId,
          receivedKeys: Object.keys(args || {}),
          received: {
            onset: args.onset != null ? String(args.onset).slice(0, 80) : null,
            quality: args.quality != null ? String(args.quality).slice(0, 80) : null,
            severity: args.severity ?? null,
            timing: args.timing != null ? String(args.timing).slice(0, 80) : null
          },
          flags: { hasOnset, hasQuality, hasSeverity, hasTiming, opqrstComplete }
        });
      }

      const detectedLang = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
      const opqrstPayload = {
        session_id: sessionId,
        patient_id: patientId,
        opqrst_complete: opqrstComplete,
        onset: merged.onset,
        provocation: merged.provocation,
        quality: merged.quality,
        radiation: merged.radiation,
        severity: merged.severity,
        timing: merged.timing,
        associated_sx: merged.associated_sx,
        family_history: merged.family_history,
        medications: merged.medications,
        prior_diagnoses: merged.prior_diagnoses,
        prior_workups: merged.prior_workups,
        allergies: merged.allergies,
        alcohol_use: merged.alcohol_use,
        alcohol_cage_score: merged.alcohol_cage_score ?? null,
        smoking_status: merged.smoking_status,
        phq2_score: phq2,
        gad2_score: gad2,
        safety_screen: safetyScreen,
        substance_use: merged.substance_use
      };
      if (detectedLang != null) opqrstPayload.detected_language = detectedLang;
      db.upsertTriageSession(opqrstPayload);
      return {
        success: true,
        stored: {
          onset: merged.onset || null,
          provocation: merged.provocation || null,
          quality: merged.quality || null,
          radiation: merged.radiation || null,
          severity: merged.severity ?? null,
          timing: merged.timing || null,
          opqrst_complete: opqrstComplete
        }
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Phase 1 T2: dedicated rich-intake storage tool.
  static _storeTriageRichIntake(args, sessionId, patientId) {
    try {
      if (!db.upsertTriageSession) return { success: true };
      // Re-read immediately before upsert so we never downgrade flags after a same-turn OPQRST write.
      const stored = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
      const opqrstWasComplete = KellyToolExecutor._isCompleteFlag(stored.opqrst_complete);
      const triageWasComplete = KellyToolExecutor._isCompleteFlag(stored.triage_complete);

      // Set once (idempotent). If already stored, keep the original timestamp.
      const intakeCompleteAt = stored?.intake_complete_at
        ? stored.intake_complete_at
        : new Date().toISOString();

      const payload = {
        session_id: sessionId,
        patient_id: patientId,
        opqrst_complete: opqrstWasComplete,
        triage_complete: triageWasComplete,

        family_history: args.family_history ?? null,
        medications: this._normalizeListToText(args.medications),
        allergies: this._normalizeListToText(args.allergies),
        prior_diagnoses: this._normalizeListToText(args.prior_diagnoses),
        prior_workups: args.prior_workups ?? null,

        alcohol_use: args.alcohol_use ?? null,
        smoking_status: args.smoking_status ?? null,
        substance_use: args.substance_use ?? null,
        occupation: args.occupation ?? null,

        critical_unknowns: this._normalizeArrayOfStrings(args.critical_unknowns),
        intake_complete_at: intakeCompleteAt
      };

      db.upsertTriageSession(payload);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // gap15 + W3-S4: collect_insurance — block until triage, use getCptCodeForVisit
  // ─────────────────────────────────────────────────────────────
  static async _collectInsurance(args, { sessionId, patientId, callerPhone }) {
    const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
    const bump = (n) => KellyToolExecutor._bumpOpsCounter(n);

    const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
    if (sessionRow) {
      const isSafetyRed =
        sessionRow.safety_level === 'red' ||
        sessionRow.referred_to_911 === 1 ||
        sessionRow.referred_to_911 === true;
      if (isSafetyRed) {
        bump('voice_agent_misuse_collect_insurance_safety_blocked');
        return {
          success: false,
          error: 'SAFETY_BLOCKED',
          error_code: 'SAFETY_BLOCKED',
          message: 'Insurance verification is blocked because this session was flagged as emergency/red safety.'
        };
      }
    }

    const triageResult = TriageRAGService.getLatestForSession(sessionId);
    if (!triageResult) {
      bump('voice_agent_misuse_collect_insurance_no_rag_result');
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        error_code: 'TRIAGE_REQUIRED',
        message: 'Complete triage first with run_triage_rag to determine the right specialty and CPT code for insurance verification.'
      };
    }

    if (!sessionRow) {
      bump('voice_agent_misuse_collect_insurance_no_session_row');
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        error_code: 'TRIAGE_REQUIRED',
        message: 'Please complete triage first (run_triage_rag) before we can verify insurance.'
      };
    }

    const triageComplete = KellyToolExecutor._isCompleteFlag(sessionRow.triage_complete);
    if (!triageComplete) {
      bump('voice_agent_misuse_collect_insurance_triage_incomplete');
      return {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
        error_code: 'TRIAGE_INCOMPLETE',
        message: 'Triage is not complete yet. Please call run_triage_rag before we verify insurance.'
      };
    }

    const confidence = KellyToolExecutor._confidenceFromTriageRow(triageResult);
    const forceAfterClarified = args.force_after_clarified === true || args.force_after_clarified === 'true';
    const confidenceNearThreshold = confidence >= Math.max(0, THRESHOLD - 0.2);
    const allowBorderlineProgress = !!(
      forceAfterClarified &&
      KellyToolExecutor._isCompleteFlag(sessionRow.opqrst_complete) &&
      !!sessionRow.intake_complete_at &&
      confidenceNearThreshold
    );
    if (confidence < THRESHOLD && !allowBorderlineProgress) {
      bump('voice_agent_misuse_collect_insurance_low_confidence');
      return {
        success: false,
        error: 'LOW_CONFIDENCE',
        error_code: 'LOW_CONFIDENCE',
        message: 'RAG confidence is low. Please clarify and re-run triage before verifying insurance.'
      };
    }

    if (!KellyToolExecutor._isCompleteFlag(sessionRow.opqrst_complete)) {
      bump('voice_agent_misuse_collect_insurance_opqrst_missing');
      return {
        success: false,
        error: 'OPQRST_REQUIRED',
        error_code: 'OPQRST_REQUIRED',
        message: 'Please complete the OPQRST clinical history before we verify your insurance.'
      };
    }

    if (!sessionRow.intake_complete_at) {
      bump('voice_agent_misuse_collect_insurance_rich_intake_missing');
      return {
        success: false,
        error: 'RICH_INTAKE_REQUIRED',
        error_code: 'RICH_INTAKE_REQUIRED',
        message: 'Please complete the rich intake (medications, allergies, key history) before we verify your insurance.'
      };
    }
    // M-S4.A: Block until target_specialty known
    if (!triageResult.target_specialty) {
      return {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
        error_code: 'TRIAGE_INCOMPLETE',
        message: "I'll confirm your coverage once we understand your needs better. Please complete triage first so we can verify the right specialty and codes."
      };
    }
    // W3-S4.4: Use getCptCodeForVisit instead of firstCpt || '90834'
    const { getCptCodeForVisit } = require('../utils/cpt-helper');
    const serviceCode = getCptCodeForVisit({
      specialty: triageResult.target_specialty,
      isNewPatient: true, // Default; could check patient history
      urgency: triageResult.urgency || 'routine'
    });
    // Bug 9: Pass initial_name for fraud check (from session when Kelly path; Retell path passes it directly)
    let initialName = args.initial_name || null;
    if (!initialName && sessionId && db.getOrchestrateSessionBySessionId) {
      try {
        const row = db.getOrchestrateSessionBySessionId(sessionId);
        initialName = row?.flow_state?.initial_name || null;
      } catch (_) {}
    }
    // W3-S4.2: Pass resolved ICD and CPT to insurance/checkout flow
    return await this._post('/voice/insurance/collect', {
      ...args,
      patient_phone: args.patient_phone || callerPhone || undefined,
      call_id: sessionId,
      service_code: args.service_code || serviceCode,
      primary_icd10: triageResult.primary_icd10 || null,
      initial_name: initialName || undefined
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Triage RAG — gap10+12: merge session state, include media
  // ─────────────────────────────────────────────────────────────
  static async _runTriageRAG(args, sessionId, patientId, clinicId) {
    try {
      const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
      const stored = sessionRow || {};
      const opqrst = {
        onset: args.onset || stored.onset || '',
        provocation: args.provocation || stored.provocation || '',
        quality: args.quality || stored.quality || '',
        radiation: args.radiation || stored.radiation || '',
        severity: KellyToolExecutor._coerceSeverity(args.severity != null ? args.severity : stored.severity),
        timing: args.timing || stored.timing || '',
        associated_sx: args.associated_sx || stored.associated_sx || ''
      };
      const richIntake = {
        family_history: args.family_history || stored.family_history || '',
        medications: args.medications || stored.medications || '',
        prior_diagnoses: args.prior_diagnoses || stored.prior_diagnoses || '',
        prior_workups: args.prior_workups || stored.prior_workups || '',
        allergies: args.allergies || stored.allergies || '',
        alcohol_use: args.alcohol_use || stored.alcohol_use || '',
        alcohol_cage_score: args.alcohol_cage_score ?? stored.alcohol_cage_score,
        smoking_status: args.smoking_status || stored.smoking_status || '',
        safety_screen: args.safety_screen || stored.safety_screen || ''
      };

      let symptomText = args.symptom_text || '';
      if (db.getTriageMediaForSession) {
        const media = db.getTriageMediaForSession(sessionId);
        for (const m of media) {
          let text = '';
          if (m.ai_analysis) {
            try {
              const analysis = typeof m.ai_analysis === 'string' ? JSON.parse(m.ai_analysis) : m.ai_analysis;
              text = analysis?.summary || analysis?.description || analysis?.text || '';
            } catch (_) {}
          }
          if (!text) text = m.context_note || m.file_name || '';
          if (text) symptomText += ` [Uploaded: ${text}]`;
        }
      }
      // M-Doc: Include vision/PDF-extracted text so triage RAG sees image content, not just filenames
      const MAX_TRIAGE_EXTRACTS = 5;
      const MAX_EXTRACT_CHARS = 4000;
      if (patientId && db.getPatientDocumentExtractsByPatient) {
        const extracts = db.getPatientDocumentExtractsByPatient(patientId)
          .filter(e => e.extracted_text && String(e.extracted_text).trim())
          .slice(0, MAX_TRIAGE_EXTRACTS);
        for (const e of extracts) {
          const text = String(e.extracted_text).trim().slice(0, MAX_EXTRACT_CHARS);
          if (text) symptomText += ` [Document extract (${e.doc_id}): ${text}]`;
        }
      }

      const useV2 = process.env.USE_TRIAGE_RAG_V2 === '1' || process.env.USE_TRIAGE_RAG_V2 === 'true';
      const RagService = useV2 ? TriageRAGServiceV2 : TriageRAGService;

      // If the model provided question-level safety answers (q1/q2) but did not
      // provide the normalized `safety_screen` string, compute it here.
      let safetyScreenNorm = richIntake.safety_screen;
      if ((!safetyScreenNorm || String(safetyScreenNorm).trim() === '') &&
        (args.safety_screen_q1 != null || args.safety_screen_q2 != null)) {
        const q1 = String(args.safety_screen_q1 || '').toLowerCase();
        const q2 = String(args.safety_screen_q2 || '').toLowerCase();
        const pos = ['yes', 'yeah', 'true', '1'].some(t => q1.includes(t) || q2.includes(t));
        safetyScreenNorm = pos ? 'positive' : 'negative';
      }
      richIntake.safety_screen = safetyScreenNorm;

      const result = await RagService.enrichFromSymptoms({
        sessionId,
        symptomText: symptomText.trim() || 'Patient-reported symptoms',
        opqrst,
        richIntake,
        patientId,
        clinicId
      });

      const THRESHOLD = KellyToolExecutor._ragConfidenceThreshold();
      const isRoutineBypass = /routine wellness visit|no active symptoms/i.test(args.symptom_text || '');
      const routineNoSymptomsFlag = (() => {
        try {
          const v = KellyToolExecutor._getSessionMeta(sessionId, 'routine_no_symptoms');
          return String(v || '').toLowerCase() === '1' || String(v || '').toLowerCase() === 'true';
        } catch (_) { return false; }
      })();
      if (isRoutineBypass || routineNoSymptomsFlag) {
        result.rag_confidence = Math.max(result.rag_confidence || 0, THRESHOLD);
        result.triage_complete = true;
        result.target_specialty = result.target_specialty || 'PrimaryCare';
        result.urgency = result.urgency || 'routine';
        result.safety_level = result.safety_level || 'green';
        console.log('[RAG] Routine bypass: forcing triage_complete=true, confidence=', result.rag_confidence);
      }

      // M-S3.C: triage_complete when OPQRST + (≥1 differential or specialty) + confidence gate.
      // Rich-intake remains a scheduling/slot gate; do not block triage_complete on intake timestamp.
      const hasDifferential = (result.differentials || []).length >= 1;
      const hasSpecialty = !!(result.target_specialty);
      const conf = KellyToolExecutor._confidenceFromTriageRow(result);
      // Allow a small "near threshold" window when we already have a specialty, so
      // we don't get stuck in clarifying loops when the external differential
      // generation is flaky but a target_specialty is still present.
      const confNearThreshold = conf >= Math.max(0, THRESHOLD - 0.2);
      const confOk = conf >= THRESHOLD || (hasSpecialty && confNearThreshold);
      // Expose the effective threshold so the LLM can make consistent routing decisions.
      result.rag_confidence_threshold = THRESHOLD;
      result.rag_confidence_ok = confOk;
      const latestSession = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
      const opqrstComplete = latestSession && KellyToolExecutor._isCompleteFlag(latestSession.opqrst_complete);
      const triageComplete = !!(result.triage_complete || (opqrstComplete && (hasDifferential || hasSpecialty) && confOk));

      // Debug telemetry: explain why triage_complete isn't being set.
      if (!triageComplete) {
        const reasons = {
          opqrst_complete: !!opqrstComplete,
          has_differentials: hasDifferential,
          has_target_specialty: hasSpecialty,
          rag_confidence: conf,
          rag_confidence_threshold: THRESHOLD,
          triage_complete_computed: triageComplete
        };
        console.warn('[KellyToolExecutor] triage_complete remains false:', JSON.stringify(reasons));
      }

      // M-S2.C: Critical gate — when rag_confidence < threshold, Kelly must ask one more question before routing.
      // If we already accepted a "near threshold" confidence (confOk), don't keep forcing the loop.
      if (conf < THRESHOLD && !confOk) {
        result.suggested_next_step = 'Ask one more clarifying question (e.g. "Can you describe the pain in more detail?" or "Is it on both sides or one side?") then call run_triage_rag again before looking up slots.';
        result.low_confidence = true;
      }

      const detectedLang = db.getKellySessionLanguage ? db.getKellySessionLanguage(sessionId) : null;
      if (db.upsertTriageSession) {
        const sessionPayload = {
          session_id: sessionId,
          patient_id: patientId,
          rag_result_id: result.id,
          safety_level: result.safety_level,
          urgency: result.urgency,
          target_specialty: result.target_specialty,
          opqrst_complete: opqrstComplete,
          triage_complete: triageComplete,
          media_received: true,
          // Bug 6: Pass [] explicitly when empty so stale DB value is cleared on second pass
          critical_unknowns: result.critical_unknowns ?? []
        };
        // Bug 12: Only include detected_language when non-null to avoid overwriting stored value
        if (detectedLang != null) sessionPayload.detected_language = detectedLang;
        // W4-S6.3: Persist SOAP to triage_sessions when triage_complete
        if (triageComplete && result.soap_note) sessionPayload.soap_note = result.soap_note;
        db.upsertTriageSession(sessionPayload);
      }
      return result;
    } catch (err) {
      console.warn('[KellyToolExecutor] TriageRAG unavailable:', err.message);
      return {
        success: false,
        error: err.message,
        safety_level: 'green',
        urgency: 'routine',
        target_specialty: 'PrimaryCare',
        rag_confidence: 0.5
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Document upload request — gap10: set media_requested
  // ─────────────────────────────────────────────────────────────
  static async _requestDocumentUpload(args, sessionId, patientId, callerPhone, channel) {
    try {
      // If we already have uploaded media for this session, do not clear it or
      // keep forcing the user to upload again.
      let existingMediaIds = [];
      let hasMedia = false;
      try {
        if (db.getTriageMediaForSession) {
          const media = db.getTriageMediaForSession(sessionId) || [];
          existingMediaIds = Array.isArray(media)
            ? media.map(m => m?.id).filter(Boolean)
            : [];
          hasMedia = existingMediaIds.length > 0;
        }
      } catch (_) {}

      if (db.upsertTriageSession) {
        db.upsertTriageSession({
          session_id: sessionId,
          patient_id: patientId,
          media_requested: true,
          media_received: hasMedia,
          media_ids: existingMediaIds
        });
      }

      // If upload already exists, unblock the flow by not returning an upload gate.
      if (hasMedia) {
        return {
          success: true,
          channel: channel === 'voice' ? 'voice' : 'chat_widget',
          upload_requested: false,
          message: 'I already received your document/photo. Proceeding with triage.'
        };
      }

      if (channel === 'voice' && callerPhone) {
        const result = await this._post('/api/patient/send-upload-link', {
          patient_id: patientId || undefined,
          patient_phone: callerPhone,
          session_id: sessionId
        });
        return {
          success: true,
          channel: 'sms',
          sent: result.sent,
          message: `Upload link sent to ${callerPhone}. The patient can use it to upload their ${args.reason}.`
        };
      }

      return {
        success: true,
        channel: 'chat_widget',
        upload_requested: true,
        reason: args.reason,
        message: `Please upload your ${args.reason} using the button below.`,
        next_step: 'UPLOAD_IMAGE'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `I wasn't able to send the upload link. Please ask the patient to upload through the patient portal.`
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // M-Doc.3: query_patient_records — RAG over patient document extracts
  // ─────────────────────────────────────────────────────────────
  static async _queryPatientRecords(args, patientId) {
    if (!patientId) {
      return { success: false, answer: "I don't have access to your records yet. Please complete identification first.", sources: 0 };
    }
    const query = (args.query || '').toString().trim();
    if (!query) {
      return { success: false, answer: "What would you like to know about your records?", sources: 0 };
    }
    try {
      const PatientRecordsQueryService = require('./patient-records-query-service');
      const { answer, sources } = await PatientRecordsQueryService.queryPatientRecords(patientId, query);
      return { success: true, answer, sources };
    } catch (e) {
      return { success: false, answer: "I couldn't look up your records right now. Please try again.", sources: 0 };
    }
  }
}

module.exports = KellyToolExecutor;
