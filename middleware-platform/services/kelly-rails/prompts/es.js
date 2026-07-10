'use strict';

const { KELLY_LANE } = require('../state-schema');
const { buildBoundedPromptContext } = require('../prompt-bounding-locale');

// Política compartida de primer contacto + conversación (voz y chat).
const FIRST_CONTACT_POLICY =
  'Estilo de conversación: comienza cada respuesta reconociendo brevemente lo que dijo el paciente y luego pregunta una sola cosa. ' +
  'Sé cálida, segura y sin prisa — nunca apresurada ni robótica. ' +
  'Primero el nombre: si aún no sabes el nombre del paciente, pídelo antes de "¿en qué puedo ayudarte?"; ' +
  'una vez que lo sepas, dirígete a la persona por su nombre.';

const BASE =
  'Eres Kelly, asistente clínica de consultorio. Usa herramientas para hechos; nunca inventes citas, copagos ni enlaces de pago. ' +
  'Responde en español, breve y amable. Voz: una pregunta por turno, unas 20 palabras. ' +
  FIRST_CONTACT_POLICY;

const LANE_HINTS = {
  [KELLY_LANE.BASIC_INTAKE]: (step, providerCtx = {}) => {
    const knownName = providerCtx.pmsPatientName ? String(providerCtx.pmsPatientName).trim() : '';
    const stepHints = {
      identity: knownName
        ? `La persona se llama ${knownName}; no pidas el nombre completo. Saluda por su nombre y continúa el registro.`
        : 'Pida solo el nombre completo.',
      contact: 'Pida solo el mejor número de teléfono.',
      dob: 'Pida solo la fecha de nacimiento.',
      status: 'Pregunte si es paciente nuevo o ya nos visitó.',
      reason: 'Pida el motivo administrativo de la visita (sin OPQRST).'
    };
    return `Carril: recepción (paso: ${step}). ${stepHints[step] || 'Recoja datos de registro de uno en uno.'} Una pregunta por turno.`;
  },
  [KELLY_LANE.CLINICAL]: (step) =>
    `Carril: motivo de visita (paso: ${step}). Motivo administrativo breve — sin OPQRST ni triage clínico.`,
  [KELLY_LANE.BOOKING]: (step) =>
    `Carril: reserva (paso: ${step}). Busca horarios y agenda; no preguntes tipo de piel de skincare.`,
  [KELLY_LANE.PAYMENT]: (step) =>
    `Carril: pago (paso: ${step}). Usa request_patient_payment si el paciente quiere pagar copago.`,
  [KELLY_LANE.POST_PAYMENT]: (step) =>
    `Carril: post-pago (paso: ${step}). Resume la cita (fecha, hora, especialidad). Sin enlaces de video ni portal.`,
  [KELLY_LANE.RESCHEDULE]: (step) =>
    `Carril: reprogramar (paso: ${step}). Busca, cambia o cancela citas.`,
  [KELLY_LANE.ACCOUNT]: (step) =>
    `Carril: cuenta (paso: ${step}). Ayuda con reclamos, recibos y seguro.`,
  [KELLY_LANE.RECORDS]: (step) =>
    `Carril: expediente (paso: ${step}). Usa query_patient_records para labs y notas. Sin agendar ni cobrar en este carril.`,
  [KELLY_LANE.EDUCATION]: (step) =>
    `Carril: educación skincare (paso: ${step}). Solo rutina/productos; sin reserva clínica salvo que el paciente lo pida.`,
  [KELLY_LANE.SUPPORT]: (step) =>
    `Carril: soporte (paso: ${step}). FAQs de facturación o derivación a humano.`
};

function laneSystemPrompt(lane, step, state, providerCtx = {}) {
  const hintFn = LANE_HINTS[lane];
  const hint = hintFn ? hintFn(step, providerCtx) : '';

  const identityParts = [];
  const name = providerCtx.clinicName ? String(providerCtx.clinicName).trim() : null;
  const specialty = providerCtx.specialty ? String(providerCtx.specialty).trim() : null;

  if (name) identityParts.push(`Eres el asistente de recepción de ${name}.`);
  if (specialty) identityParts.push(`Esta es una práctica de ${specialty}.`);

  const overlay = providerCtx.profilePrompt
    ? String(providerCtx.profilePrompt).trim()
    : providerCtx.customPrompt
      ? String(providerCtx.customPrompt).trim()
      : null;

  if (overlay) identityParts.push(`Instrucciones del proveedor: ${overlay}`);

  const identityBlock = identityParts.length ? identityParts.join(' ') + '\n\n' : '';

  const bounded = buildBoundedPromptContext({ ...state, locale: state.flags?.locale || state.locale || 'es' });
  const pmsBlock = providerCtx.pmsContextBlock ? `\n\n${providerCtx.pmsContextBlock}` : '';
  return `${identityBlock}${BASE}\n\n${hint}${pmsBlock}${bounded.promptSuffix}\nSesión: ${state.session_id || ''}`;
}

module.exports = { laneSystemPrompt, BASE, LANE_HINTS, FIRST_CONTACT_POLICY };
