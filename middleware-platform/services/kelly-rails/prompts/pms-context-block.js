'use strict';

/**
 * Build bounded PMS context text for Kelly system prompts.
 * @param {object} pmsContext
 * @param {string} [locale]
 */
function buildPmsContextBlock(pmsContext = {}, locale = 'en') {
  if (!pmsContext || typeof pmsContext !== 'object') return '';

  const patientName = pmsContext.patient_name ? String(pmsContext.patient_name).trim() : '';
  const isReturning = pmsContext.is_returning === true || pmsContext.is_returning === 'yes';
  const hasInsurance = pmsContext.has_insurance === true || pmsContext.has_insurance === 'yes';
  const balanceFlag = pmsContext.balance_flag === true || pmsContext.balance_flag === 'yes';
  const nextAppt = pmsContext.next_appointment ? String(pmsContext.next_appointment).trim() : '';

  if (!patientName && !isReturning && !hasInsurance && !balanceFlag && !nextAppt) {
    return '';
  }

  const es = String(locale || 'en').slice(0, 2) === 'es';
  const lines = [];
  lines.push(
    es
      ? 'Contexto del sistema de práctica (PMS) — usa solo para personalizar; no inventes datos:'
      : 'Practice management context (PMS) — use only to personalize; do not invent facts:'
  );
  if (patientName) {
    lines.push(es ? `- Nombre del paciente: ${patientName}` : `- Patient name: ${patientName}`);
  }
  if (isReturning) {
    lines.push(es ? '- Paciente conocido / recurrente.' : '- Known returning patient.');
  }
  if (nextAppt) {
    lines.push(es ? `- Próxima cita: ${nextAppt}` : `- Next appointment: ${nextAppt}`);
  }
  if (hasInsurance) {
    lines.push(es ? '- Tiene seguro en archivo.' : '- Insurance on file.');
  }
  if (balanceFlag) {
    lines.push(es ? '- Saldo pendiente en cuenta.' : '- Outstanding balance on account.');
  }

  return lines.join('\n');
}

/** Normalize Retell dynamic variables into pmsContext object. */
function pmsContextFromDynamicVars(dv = {}) {
  if (!dv || typeof dv !== 'object') return null;
  const hasPms =
    dv.pms_context === 'yes' || dv.patient_name || dv.patientName;
  if (!hasPms) return null;

  return {
    patient_name: dv.patient_name || dv.patientName || null,
    is_returning: dv.is_returning === 'yes' || dv.is_returning === true,
    next_appointment: dv.next_appointment || null,
    balance_flag: dv.balance_flag === 'yes' || dv.balance_flag === true,
    has_insurance: dv.has_insurance === 'yes' || dv.has_insurance === true
  };
}

module.exports = { buildPmsContextBlock, pmsContextFromDynamicVars };
