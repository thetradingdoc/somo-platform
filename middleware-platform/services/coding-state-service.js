/**
 * CODING STATE SERVICE
 *
 * State machine for medical coding voice agent.
 * States: INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING
 *
 * Triggers: transcript (user spoke), function_call (tool invoked)
 */

const STAGES = ['INTAKE', 'EXTRACTION', 'TRIAGE', 'CODING', 'VALIDATION', 'BILLING'];

// Functions that imply a stage (function name → target stage)
const FUNCTION_TO_STAGE = {
  // Coding tools → CODING
  search_icd10_codes: 'CODING',
  search_cpt_codes: 'CODING',
  search_cdt_codes: 'CODING',
  search_hcpcs_codes: 'CODING',
  suggest_codes_from_symptoms: 'CODING',
  extract_medical_text: 'EXTRACTION',
  // Validation
  validate_code_pair: 'VALIDATION',
  assess_urgency: 'TRIAGE',
  check_payer_guidelines: 'VALIDATION',
  // Billing
  collect_insurance: 'BILLING',
  get_code_pricing: 'BILLING',
  // Scheduling/intake - stay in flow
  schedule_appointment: 'INTAKE',
  get_available_slots: 'INTAKE',
  search_appointments: 'INTAKE',
  confirm_appointment: 'INTAKE',
  cancel_appointment: 'INTAKE',
  reschedule_appointment: 'INTAKE',
  collect_contact_info: 'INTAKE'
};

// Order of stages for transition logic (higher index = later in workflow)
const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s, i]));

/**
 * Compute the next stage given current state and trigger
 * @param {string} currentStage - Current stage (default INTAKE)
 * @param {string} triggerType - 'transcript' | 'function_call'
 * @param {object} triggerPayload - { function_name } for function_call, { transcript } for transcript
 * @returns {{ nextStage: string, transition: boolean, reason: string }}
 */
function computeNextStage(currentStage, triggerType, triggerPayload = {}) {
  const stage = currentStage || 'INTAKE';
  const stageIdx = STAGE_ORDER[stage] ?? 0;

  if (triggerType === 'function_call') {
    const fn = triggerPayload.function_name || triggerPayload.functionName;
    const codingFns = ['search_icd10_codes', 'search_cpt_codes', 'search_cdt_codes', 'search_hcpcs_codes', 'suggest_codes_from_symptoms'];

    // After coding functions complete, move CODING → VALIDATION
    if (stage === 'CODING' && codingFns.includes(fn)) {
      return {
        nextStage: 'VALIDATION',
        transition: true,
        reason: `post_coding:${fn}`
      };
    }

    const targetStage = FUNCTION_TO_STAGE[fn];
    if (targetStage) {
      const targetIdx = STAGE_ORDER[targetStage] ?? 0;
      // Only advance (or stay) - never go backwards unless explicitly BILLING
      if (targetIdx >= stageIdx || targetStage === 'BILLING') {
        return {
          nextStage: targetStage,
          transition: targetStage !== stage,
          reason: `function:${fn}`
        };
      }
    }

    return { nextStage: stage, transition: false, reason: 'no_change' };
  }

  if (triggerType === 'transcript') {
    // First user utterance: INTAKE → EXTRACTION
    if (stage === 'INTAKE') {
      return {
        nextStage: 'EXTRACTION',
        transition: true,
        reason: 'first_user_turn'
      };
    }

    // Stay in EXTRACTION until a coding function is called
    return { nextStage: stage, transition: false, reason: 'no_change' };
  }

  return { nextStage: stage, transition: false, reason: 'unknown_trigger' };
}

/**
 * Process a turn: load state, compute next stage, persist, log
 * @param {object} db - Database module with getCallState, upsertCallState, saveAgentStateSnapshot
 * @param {string} callId - Call ID
 * @param {string} triggerType - 'transcript' | 'function_call'
 * @param {object} triggerPayload - Trigger-specific data
 * @param {object} options - { clinic_id }
 * @returns {{ state: object, transition: boolean, fromStage: string, toStage: string }}
 */
function processTurn(db, callId, triggerType, triggerPayload = {}, options = {}) {
  if (!db || typeof db.getCallState !== 'function' || typeof db.upsertCallState !== 'function') {
    return { state: null, transition: false, fromStage: null, toStage: null };
  }

  // 1. Load state
  const currentState = db.getCallState(callId);
  const currentStage = currentState?.current_stage || 'INTAKE';

  // 2. Compute next stage
  const { nextStage, transition, reason } = computeNextStage(currentStage, triggerType, triggerPayload);

  // 3. Merge state_data (preserve existing, add trigger context)
  const existingData = currentState?.state_data || {};
  const stateData = {
    ...existingData,
    last_trigger: triggerType,
    last_trigger_reason: reason,
    last_trigger_at: new Date().toISOString()
  };
  if (triggerType === 'function_call') {
    stateData.last_function = triggerPayload.function_name || triggerPayload.functionName;
    stateData.last_result = triggerPayload.result;
  }

  // 4. Persist
  const updated = db.upsertCallState(callId, {
    clinic_id: options.clinic_id ?? currentState?.clinic_id,
    current_stage: nextStage,
    state_data: stateData
  });

  // 5. Log transition
  if (transition) {
    logTransition(callId, currentStage, nextStage, reason);
    if (typeof db.saveAgentStateSnapshot === 'function') {
      try {
        db.saveAgentStateSnapshot(callId, `stage_${currentStage}_to_${nextStage}`, {
          trigger: triggerType,
          reason,
          previous_stage: currentStage,
          new_stage: nextStage,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.warn('⚠️  Failed to save stage transition snapshot:', e.message);
      }
    }
  }

  return {
    state: updated,
    transition,
    fromStage: currentStage,
    toStage: nextStage,
    reason
  };
}

function logTransition(callId, fromStage, toStage, reason) {
  console.log(`🔄 [${callId}] STATE: ${fromStage} → ${toStage} (${reason})`);
}

module.exports = {
  STAGES,
  STAGE_ORDER,
  FUNCTION_TO_STAGE,
  computeNextStage,
  processTurn,
  logTransition
};
