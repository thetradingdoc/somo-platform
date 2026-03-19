/**
 * Kelly Function Executor
 * Shared executor for Kelly agent tool calls. Used by both voice (Retell) and chat (triage).
 * Calls voice API endpoints with context (clinic_id, patient_id, etc.).
 * V-1: Passes patient_id from context to collect_insurance and get_patient_claims.
 */

const axios = require('axios');
const SMSService = require('./sms-service');

const API_BASE = process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000';
const BASE = API_BASE.replace(/\/$/, '');

/**
 * Execute a Kelly tool/function.
 * @param {string} functionName - e.g. collect_insurance, schedule_appointment, get_available_slots
 * @param {Object} args - Function arguments from LLM
 * @param {Object} context - { callId, sessionId, clinic_id, patient_id, patient_phone, patient_email, patient_name, conversationHistory }
 * @returns {Promise<Object>} Result object (success, data, error, etc.)
 */
async function execute(functionName, args, context = {}) {
  const {
    callId,
    sessionId,
    clinic_id,
    patient_id,
    patient_phone,
    patient_email,
    patient_name,
    initial_name
  } = context;

  // Merge context into args for APIs that need them
  const merged = {
    ...args,
    clinic_id: args.clinic_id || clinic_id,
    patient_id: args.patient_id || patient_id,
    patient_phone: args.patient_phone || patient_phone,
    patient_email: args.patient_email || patient_email,
    patient_name: args.patient_name || patient_name,
    call_id: args.call_id || callId,
    initial_name: args.initial_name || initial_name
  };

  // V-1: Ensure patient_id flows from collect_insurance to get_patient_claims
  if (functionName === 'get_patient_claims' && !merged.patient_id && patient_id) {
    merged.patient_id = patient_id;
  }

  try {
    switch (functionName) {
      case 'collect_insurance': {
        const phone = merged.patient_phone
          ? (SMSService?.formatPhoneNumber?.(merged.patient_phone) || merged.patient_phone)
          : merged.patient_phone;
        const res = await axios.post(`${BASE}/voice/insurance/collect`, {
          member_id: merged.member_id,
          patient_name: merged.patient_name,
          patient_phone: phone,
          patient_email: merged.patient_email,
          patient_id: merged.patient_id,
          payer_name: merged.payer_name,
          payer_id: merged.payer_id,
          service_code: merged.service_code,
          call_id: merged.call_id,
          initial_name: merged.initial_name
        });
        return res.data;
      }

      case 'get_available_slots': {
        if (!merged.clinic_id) {
          return { success: false, error: 'Missing clinic context for availability check.' };
        }
        const res = await axios.post(`${BASE}/voice/appointments/available-slots`, {
          date: merged.date,
          appointment_type: merged.appointment_type,
          practitioner_id: merged.practitioner_id,
          timezone: merged.timezone || 'America/New_York',
          clinic_id: merged.clinic_id
        });
        let data = res.data;
        if (context.channel === 'chat' && data?.slots?.length > 12) {
          data = { ...data, slots: data.slots.slice(0, 12), _truncated: `${data.slots.length - 12} more slots` };
        }
        return data;
      }

      case 'schedule_appointment': {
        if (!merged.clinic_id) {
          return { success: false, error: 'Missing clinic context. Unable to schedule.' };
        }
        const phone = merged.patient_phone
          ? (SMSService?.formatPhoneNumber?.(merged.patient_phone) || merged.patient_phone)
          : merged.patient_phone;
        const res = await axios.post(`${BASE}/voice/appointments/schedule`, {
          patient_name: merged.patient_name,
          patient_phone: phone,
          patient_email: merged.patient_email,
          appointment_type: merged.appointment_type || 'General Consult',
          date: merged.date,
          time: merged.time,
          timezone: merged.timezone || 'America/New_York',
          notes: merged.notes,
          clinic_id: merged.clinic_id,
          patient_id: merged.patient_id,
          dob: merged.dob,
          country: merged.country,
          city: merged.city,
          visit_mode: merged.visit_mode || 'sync_video',
          provider_override_emergency: merged.provider_override_emergency,
          metadata: { session_id: sessionId || callId }
        });
        return res.data;
      }

      case 'get_patient_intake_status': {
        const res = await axios.post(`${BASE}/voice/patient/intake/status`, {
          patient_id: merged.patient_id,
          patient_email: merged.patient_email,
          patient_phone: merged.patient_phone
        }).catch(() => ({ data: { onboarding_complete: false, missing_fields: ['dob', 'country', 'city'] } }));
        return res.data;
      }

      case 'patient_intake': {
        const res = await axios.post(`${BASE}/voice/patient/intake`, {
          patient_id: merged.patient_id,
          patient_email: merged.patient_email,
          patient_phone: merged.patient_phone,
          dob: merged.dob,
          country: merged.country,
          city: merged.city,
          first_name: merged.first_name,
          last_name: merged.last_name
        }).catch(e => ({ data: { success: false, error: e.message } }));
        return res.data;
      }

      case 'search_appointments': {
        if (!merged.clinic_id) {
          return { success: false, error: 'Missing clinic context for search.' };
        }
        const res = await axios.post(`${BASE}/voice/appointments/search`, {
          search_term: merged.search_term,
          clinic_id: merged.clinic_id
        });
        return res.data;
      }

      case 'confirm_appointment': {
        if (!merged.clinic_id) {
          return { success: false, error: 'Missing clinic context.' };
        }
        const res = await axios.post(`${BASE}/voice/appointments/confirm`, {
          appointment_id: merged.appointment_id,
          clinic_id: merged.clinic_id
        });
        return res.data;
      }

      case 'cancel_appointment': {
        if (!merged.clinic_id) {
          return { success: false, error: 'Missing clinic context.' };
        }
        const res = await axios.post(`${BASE}/voice/appointments/cancel`, {
          appointment_id: merged.appointment_id,
          reason: merged.reason,
          clinic_id: merged.clinic_id
        });
        return res.data;
      }

      case 'reschedule_appointment': {
        if (!merged.clinic_id) {
          return { success: false, error: 'Missing clinic context.' };
        }
        const res = await axios.post(`${BASE}/voice/appointments/reschedule`, {
          appointment_id: merged.appointment_id,
          new_date: merged.new_date,
          new_time: merged.new_time,
          timezone: merged.timezone || 'America/New_York',
          reason: merged.reason,
          clinic_id: merged.clinic_id
        });
        return res.data;
      }

      case 'create_appointment_checkout': {
        const res = await axios.post(`${BASE}/voice/appointments/checkout`, {
          appointment_id: merged.appointment_id,
          customer_email: merged.customer_email || merged.patient_email,
          customer_name: merged.customer_name || merged.patient_name,
          customer_phone: merged.customer_phone || merged.patient_phone,
          patient_email: merged.patient_email,
          patient_name: merged.patient_name,
          patient_phone: merged.patient_phone,
          appointment_type: merged.appointment_type,
          amount: merged.amount,
          clinic_id: merged.clinic_id
        });
        return res.data;
      }

      case 'verify_checkout_code': {
        const res = await axios.post(`${BASE}/voice/checkout/verify`, {
          payment_token: merged.payment_token,
          verification_code: merged.verification_code
        });
        return res.data;
      }

      case 'get_patient_claims': {
        if (!merged.member_id) {
          return { success: false, error: 'Insurance member ID (member_id) is required for claim lookups.' };
        }
        let pid = merged.patient_id;
        if (!pid) {
          const insRes = await axios.post(`${BASE}/voice/insurance/collect`, {
            member_id: merged.member_id,
            patient_name: merged.patient_name,
            patient_phone: merged.patient_phone,
            patient_email: merged.patient_email,
            payer_name: merged.payer_name,
            patient_id: merged.patient_id,
            call_id: merged.call_id
          }).catch(() => null);
          pid = insRes?.data?.patient_id;
        }
        if (!pid) {
          return { success: false, error: 'Could not find patient with provided insurance information.' };
        }
        const res = await axios.get(`${BASE}/api/patient/benefits`, {
          params: { patient_id: pid }
        }).catch(e => ({ data: { success: false, error: e.message } }));
        return res.data;
      }

      case 'send_document_upload_link': {
        const { createAndSendUploadLink } = require('../routes/patient-upload-link');
        const linkResult = await createAndSendUploadLink({
          patient_id: merged.patient_id,
          patient_phone: merged.patient_phone,
          patient_email: merged.patient_email,
          appointment_id: merged.appointment_id,
          channel: 'sms'
        });
        return { success: linkResult?.sent || false, sent: linkResult?.sent, ...linkResult };
      }

      case 'assess_urgency': {
        const { detectRedFlags } = require('./triage-service');
        const assessment = detectRedFlags(merged.symptoms_text || '');
        return {
          success: true,
          urgency: assessment.urgency || 'ROUTINE',
          isEmergency: assessment.isEmergency,
          suggestedResponse: assessment.suggestedResponse
        };
      }

      case 'end_call':
        return { success: true, end_call: true };

      default:
        return { success: false, error: `Unknown function: ${functionName}` };
    }
  } catch (e) {
    const errMsg = e.response?.data?.error || e.message;
    return { success: false, error: errMsg };
  }
}

module.exports = { execute };
