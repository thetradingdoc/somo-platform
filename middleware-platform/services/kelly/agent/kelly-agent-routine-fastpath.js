'use strict';

const db = require('../../../database');
const KellyToolExecutor = require('../kelly-tool-executor');
const { detectPreferredLanguage } = require('./kelly-agent-language');
const {
  _hasNoSymptomsRoutineSignal,
  _hasGeneralVisitSignal,
} = require('./kelly-agent-prelude');

async function handleRoutineBookingFastPath({
  message,
  sessionId,
  patientId,
  clinicId,
  callerPhone,
  channel,
  appendToHistory,
}) {
  const preferredLanguage = detectPreferredLanguage([], message);
  const explicitNoSymptoms = _hasNoSymptomsRoutineSignal(message);
  const likelyGeneralVisit = _hasGeneralVisitSignal(message);

  if (!explicitNoSymptoms && likelyGeneralVisit) {
    const bookingForSelf = KellyToolExecutor._getSessionMeta?.(sessionId, 'booking_for');
    if (!bookingForSelf && patientId) {
      const selfOrOtherReply = 'Got it! Are we booking this appointment for you, or for someone else?';
      appendToHistory(sessionId, 'user', message);
      appendToHistory(sessionId, 'assistant', selfOrOtherReply);
      try { KellyToolExecutor._setSessionMeta(sessionId, 'booking_for_prompt_pending', '1'); } catch (_) {}
      return {
        reply: selfOrOtherReply,
        endCall: false,
        toolsUsed: [],
        language: preferredLanguage || 'en',
        next_chips: [
          { label: 'For me', value: 'booking_for_self', action: 'booking_for_self' },
          { label: 'For someone else', value: 'booking_for_other', action: 'booking_for_other' },
        ],
        chips_display: 'list',
      };
    }
    const confirmByLang = {
      ru: 'Поняла. Это плановый визит. У вас сейчас есть какие-либо симптомы или жалобы?',
      es: 'Entiendo. Es una visita general. Tiene algun sintoma o molestia hoy?',
      fr: 'Compris. C est une visite generale. Avez-vous des symptomes ou une gene aujourd hui ?',
      sw: 'Nimeelewa. Hii ni miadi ya kawaida. Je, una dalili au usumbufu wowote kwa sasa?',
    };
    const confirmReply =
      confirmByLang[preferredLanguage] ||
      'Understood. This is a general visit. Do you have any current symptoms or concerns today?';
    appendToHistory(sessionId, 'user', message);
    appendToHistory(sessionId, 'assistant', confirmReply);
    return {
      reply: confirmReply,
      endCall: false,
      toolsUsed: [],
      language: preferredLanguage || 'en',
      usedFallback: false,
    };
  }

  if (KellyToolExecutor._triageRowHasConcernOrOnsetStored(sessionId)) {
    return null;
  }

  const routineReplyByLang = {
    ru: 'Отлично, помогу с плановым визитом. Если активных симптомов нет, мы можем пропустить симптомный опрос. Вам нужно к врачу срочно сейчас или хотите запланировать прием на позже? И какая дата вам подходит?',
    es: 'Perfecto, puedo ayudarle con una visita de rutina. Si no tiene sintomas activos, podemos omitir el triage de sintomas. Necesita ver al medico de inmediato o prefiere programar para despues? Que fecha le funciona mejor?',
    fr: 'Parfait, je peux vous aider pour une visite de routine. S il n y a pas de symptomes actifs, nous pouvons sauter le triage des symptomes. Avez-vous besoin de voir un medecin immediatement, ou preferez-vous planifier plus tard ? Quelle date vous convient ?',
    sw: 'Vizuri, naweza kusaidia kwa miadi ya kawaida. Kama hakuna dalili za sasa, tunaweza kuruka triage ya dalili. Unahitaji kumuona daktari mara moja au ungependa kupanga miadi ya baadaye? Ni tarehe gani inakufaa?',
  };
  const routineReply =
    routineReplyByLang[preferredLanguage] ||
    "Great - I can help with a routine wellness visit. Since you don't have active symptoms, we can skip symptom triage. Do you need to see a doctor immediately, or would you like to schedule for later? What date works best for you?";
  appendToHistory(sessionId, 'user', message);
  appendToHistory(sessionId, 'assistant', routineReply);
  try {
    if (KellyToolExecutor._setSessionMeta) KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '1');
  } catch (_) {}
  try {
    if (db.upsertTriageSession) {
      const existing = db.getTriageSession ? (db.getTriageSession(sessionId) || {}) : {};
      db.upsertTriageSession({
        session_id: sessionId,
        patient_id: patientId,
        detected_language: existing.detected_language || 'en',
        safety_level: existing.safety_level || 'green',
        urgency: existing.urgency || 'routine',
        target_specialty: existing.target_specialty || 'PrimaryCare',
        opqrst_complete: true,
        triage_complete: true,
        intake_complete_at: existing.intake_complete_at || new Date().toISOString(),
      });
    }
  } catch (_) {}
  try {
    await KellyToolExecutor.execute(
      'run_triage_rag',
      { symptom_text: 'Routine wellness visit — no active symptoms' },
      {
        sessionId,
        clinicId: clinicId ?? null,
        patientId,
        callerPhone: callerPhone ?? null,
        channel: channel || 'chat',
      }
    );
  } catch (_) {}
  return {
    reply: routineReply,
    endCall: false,
    toolsUsed: ['run_triage_rag'],
    language: preferredLanguage || 'en',
    usedFallback: false,
  };
}

module.exports = { handleRoutineBookingFastPath };
