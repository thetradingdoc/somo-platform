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

const BASE_URL = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';

class KellyToolExecutor {
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
          return await this._getAvailableSlots(args, { sessionId, clinicId, patientId });

        case 'schedule_appointment': {
          // W4-S6.5: Surface soap_note for specialist at appointment creation
          const triageForNotes = TriageRAGService.getLatestForSession(sessionId);
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
          return await this._post('/voice/appointments/schedule', {
            ...args,
            clinic_id: clinicId,
            visit_mode: args.lane || 'sync_video',
            notes: notes || args.notes,
            primary_icd10: triageForNotes?.primary_icd10 || null,
            primary_cpt: primaryCpt || null
          });
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

        case 'create_appointment_checkout':
          return await this._post('/voice/appointments/checkout', {
            ...args,
            clinic_id: clinicId
          });

        case 'verify_checkout_code':
          return await this._post('/voice/checkout/verify', {
            payment_token: args.payment_token,
            verification_code: args.verification_code,
            clinic_id: clinicId
          });

        case 'get_patient_claims':
          return await this._getPatientClaims(args, sessionId);

        case 'get_triage_session':
          return this._getTriageSession(sessionId);

        case 'store_triage_opqrst':
          return this._storeTriageOpqrst(args, sessionId, patientId);

        case 'run_triage_rag':
          return await this._runTriageRAG(args, sessionId, patientId, clinicId);

        case 'request_document_upload':
          return await this._requestDocumentUpload(args, sessionId, patientId, callerPhone, channel);

        case 'query_patient_records':
          return await this._queryPatientRecords(args, patientId);

        case 'end_call':
          return { success: true, end_call: true };

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
  static async _getAvailableSlots(args, { sessionId, clinicId, patientId }) {
    // gap1: block slots until run_triage_rag has completed
    const triageResult = TriageRAGService.getLatestForSession(sessionId);
    if (!triageResult) {
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        message: 'Please complete triage first. Ask the patient to describe their symptoms, then call run_triage_rag to determine the right specialty. Only after triage can we look up available slots.'
      };
    }
    // W3-S5.1: Assert differentials or target_specialty before resolver
    const hasDifferentials = (triageResult.differentials || []).length >= 1;
    const hasSpecialty = !!(triageResult.target_specialty);
    if (!hasDifferentials && !hasSpecialty) {
      return {
        success: false,
        error: 'DIFFERENTIALS_REQUIRED',
        message: 'Differentials are not yet generated. Complete triage and run run_triage_rag to get specialty recommendations before looking up available slots.'
      };
    }
    // M-S3.C: block until triage_complete (≥1 differential or specialty + rag_confidence ≥ 0.7)
    // Bug 10: Use hasDiffs/conf — don't block when differentials exist and confidence ≥ 0.7 even if triage_complete not yet set
    const sessionRow = db.getTriageSession ? db.getTriageSession(sessionId) : null;
    const triageComplete = sessionRow && (sessionRow.triage_complete === 1 || sessionRow.triage_complete === true);
    if (!triageComplete && sessionRow) {
      const hasDiffs = (triageResult.differentials || []).length >= 1;
      const conf = parseFloat(triageResult.rag_confidence ?? 0.7);
      if (!hasDiffs || conf < 0.7) {
        return {
          success: false,
          error: 'TRIAGE_INCOMPLETE',
          message: conf < 0.7
            ? 'Triage confidence is still low. Ask one more clarifying question, then call run_triage_rag again before looking up slots.'
            : 'Triage needs at least one differential or specialty. Ask more about the patient\'s symptoms, then call run_triage_rag again before looking up slots.'
        };
      }
      // Fall through — hasDiffs && conf >= 0.7, allow slot lookup
    }
    // gap13: block slots when rag_confidence < 0.7 — ask one more question first
    const confidence = triageResult.rag_confidence != null ? parseFloat(triageResult.rag_confidence) : 0.7;
    if (confidence < 0.7) {
      return {
        success: false,
        error: 'LOW_CONFIDENCE',
        message: 'RAG confidence is low. Ask one more clarifying question (e.g. "Can you describe the pain in more detail?" or "Is it on both sides?") then call run_triage_rag again before looking up slots.'
      };
    }

    const date = args.date || new Date().toISOString().slice(0, 10);
    const timezone = args.timezone || 'America/New_York';
    const lane = args.lane || triageResult.recommended_lane || 'sync';
    // W3-S5.2: specialty from differential (triageResult.target_specialty)
    const appointmentType = args.appointment_type || triageResult.target_specialty || 'General Consult';

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
          if (kellyScript) out.say_to_patient = `Say this to the patient before presenting slots: "${kellyScript}"`;
          return out;
        }
      } catch (err) {
        console.warn('[KellyToolExecutor] Specialist path failed, falling back:', err.message);
      }
    }

    // Fallback: standard HTTP endpoint
    return await this._post('/voice/appointments/available-slots', {
      date,
      appointment_type: appointmentType,
      timezone,
      lane,
      clinic_id: clinicId
    });
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helper
  // ─────────────────────────────────────────────────────────────
  static async _post(path, body) {
    const response = await axios.post(`${BASE_URL}${path}`, body, { timeout: 15000 });
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
        timeout: 15000
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
        critical_unknowns: row.critical_unknowns || []
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

  static _storeTriageOpqrst(args, sessionId, patientId) {
    try {
      if (!db.upsertTriageSession) return { success: true };
      const stored = db.getTriageSession ? db.getTriageSession(sessionId) : {};
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
        medications: args.medications ?? stored.medications,
        prior_diagnoses: args.prior_diagnoses ?? stored.prior_diagnoses,
        prior_workups: args.prior_workups ?? stored.prior_workups,
        allergies: args.allergies ?? stored.allergies,
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
      // M-S3.C: opqrst_complete when core OPQRST stored (onset, quality, severity, timing required; provocation/radiation for non-mental-health)
      const hasOnset = !!String(merged.onset || '').trim();
      const hasQuality = !!String(merged.quality || '').trim();
      const hasSeverity = merged.severity != null && merged.severity !== '';
      const hasTiming = !!String(merged.timing || '').trim();
      const hasProvOrRad = !!String(merged.provocation || '').trim() || !!String(merged.radiation || '').trim();
      const opqrstComplete = hasOnset && hasQuality && hasSeverity && hasTiming && hasProvOrRad;

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
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // gap15 + W3-S4: collect_insurance — block until triage, use getCptCodeForVisit
  // ─────────────────────────────────────────────────────────────
  static async _collectInsurance(args, { sessionId, patientId, callerPhone }) {
    const triageResult = TriageRAGService.getLatestForSession(sessionId);
    if (!triageResult) {
      return {
        success: false,
        error: 'TRIAGE_REQUIRED',
        message: 'Complete triage first with run_triage_rag to determine the right specialty and CPT code for insurance verification.'
      };
    }
    // M-S4.A: Block until target_specialty known
    if (!triageResult.target_specialty) {
      return {
        success: false,
        error: 'TRIAGE_INCOMPLETE',
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
        severity: args.severity != null ? args.severity : stored.severity,
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
      const result = await RagService.enrichFromSymptoms({
        sessionId,
        symptomText: symptomText.trim() || 'Patient-reported symptoms',
        opqrst,
        richIntake,
        patientId,
        clinicId
      });

      // M-S3.C: triage_complete when: (OPQRST complete OR ≥1 differential) + (≥1 differential or specialty) + rag_confidence ≥ 0.7
      const hasDifferential = (result.differentials || []).length >= 1;
      const hasSpecialty = !!(result.target_specialty);
      const conf = result.rag_confidence != null ? parseFloat(result.rag_confidence) : 0.7;
      const confOk = conf >= 0.7;
      const latestSession = db.getTriageSession ? db.getTriageSession(sessionId) : sessionRow;
      const opqrstComplete = latestSession && (latestSession.opqrst_complete === 1 || latestSession.opqrst_complete === true);
      const triageComplete = (opqrstComplete || hasDifferential) && (hasDifferential || hasSpecialty) && confOk;

      // M-S2.C: Critical gate — when rag_confidence < 0.7, Kelly must ask one more question before routing
      if (conf < 0.7) {
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
      if (db.upsertTriageSession) {
        db.upsertTriageSession({
          session_id: sessionId,
          patient_id: patientId,
          media_requested: true,
          media_received: false
        });
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
