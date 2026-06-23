/**
 * Kelly Function Executor
 * Shared executor for Kelly agent tool calls. Used by both voice (Retell) and chat (triage).
 * Calls voice API endpoints with context (clinic_id, patient_id, etc.).
 * V-1: Passes patient_id from context to collect_insurance and get_patient_claims.
 */

const KellyToolExecutor = require('./kelly-tool-executor');

/**
 * Execute a Kelly tool/function.
 * @param {string} functionName - e.g. collect_insurance, schedule_appointment, get_available_slots
 * @param {Object} args - Function arguments from LLM
 * @param {Object} context - { callId, sessionId, clinic_id, patient_id, patient_phone, patient_email, patient_name, conversationHistory }
 * @returns {Promise<Object>} Result object (success, data, error, etc.)
 */
async function execute(functionName, args, context = {}) {
  // A3: legacy dead-code shim. Delegate to KellyToolExecutor so there is one source of truth.
  try {
    return await KellyToolExecutor.execute(functionName, args || {}, {
      sessionId: context.sessionId || context.callId || null,
      clinicId: context.clinic_id || args?.clinic_id || null,
      patientId: context.patient_id || args?.patient_id || null,
      callerPhone: context.patient_phone || args?.patient_phone || null,
      channel: context.channel || 'voice'
    });
  } catch (e) {
    return { success: false, error: e?.message || 'Executor failed' };
  }
}

module.exports = { execute };
