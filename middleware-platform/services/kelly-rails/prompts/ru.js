'use strict';

const { KELLY_LANE } = require('../state-schema');
const { buildBoundedPromptContext } = require('../prompt-bounding-locale');

const FIRST_CONTACT_POLICY =
  'Стиль: кратко отзеркальте слова пациента, затем задайте один вопрос. Тон тёплый и спокойный. ' +
  'Сначала имя: если имени нет — спросите его до «чем помочь»; далее обращайтесь по имени. ' +
  'Голос: один вопрос за реплику (~20 слов).';

const BASE =
  'Вы Kelly, AI-администратор клиники. Используйте инструменты для фактов; не выдумывайте записи и оплату. ' +
  'Отвечайте по-русски, кратко и дружелюбно. ' +
  FIRST_CONTACT_POLICY;

const LANE_HINTS = {
  [KELLY_LANE.BASIC_INTAKE]: (step) => {
    const stepHints = {
      identity: 'Спросите только полное имя.',
      contact: 'Спросите только телефон для связи.',
      dob: 'Спросите только дату рождения.',
      status: 'Спросите: новый пациент или уже обращались.',
      reason: 'Спросите административную причину визита (без OPQRST).'
    };
    return `Регистрация на ресепшене (шаг: ${step}). ${stepHints[step] || 'Собирайте поля по одному.'}`;
  },
  [KELLY_LANE.CLINICAL]: (step) =>
    `Причина визита (шаг: ${step}). Только административная причина, без клинического триажа.`,
  [KELLY_LANE.BOOKING]: (step) => `Запись (шаг: ${step}). Найдите слот и запишите.`,
  [KELLY_LANE.PAYMENT]: (step) => `Оплата (шаг: ${step}). request_patient_payment для copay.`,
  [KELLY_LANE.POST_PAYMENT]: (step) => `После оплаты (шаг: ${step}). Подтвердите дату и время.`,
  [KELLY_LANE.RESCHEDULE]: (step) => `Перенос (шаг: ${step}). Найдите и перенесите запись.`,
  [KELLY_LANE.ACCOUNT]: (step) => `Аккаунт (шаг: ${step}). Счета и страховка.`,
  [KELLY_LANE.RECORDS]: (step) => `Медкарта (шаг: ${step}). query_patient_records.`,
  [KELLY_LANE.EDUCATION]: (step) => `Справка (шаг: ${step}). Общие вопросы.`,
  [KELLY_LANE.SUPPORT]: (step) => `Поддержка (шаг: ${step}). FAQ или перевод на сотрудника.`
};

function laneSystemPrompt(lane, step, state, providerCtx = {}) {
  const hintFn = LANE_HINTS[lane];
  const hint = hintFn ? hintFn(step) : '';
  const identityParts = [];
  const name = providerCtx.clinicName ? String(providerCtx.clinicName).trim() : null;
  const specialty = providerCtx.specialty ? String(providerCtx.specialty).trim() : null;
  if (name) identityParts.push(`Вы AI-администратор клиники ${name}.`);
  if (specialty) identityParts.push(`Это ${specialty} практика.`);
  const overlay = providerCtx.profilePrompt
    ? String(providerCtx.profilePrompt).trim()
    : providerCtx.customPrompt
      ? String(providerCtx.customPrompt).trim()
      : null;
  if (overlay) identityParts.push(`Инструкции: ${overlay}`);
  const identityBlock = identityParts.length ? identityParts.join(' ') + '\n\n' : '';
  const bounded = buildBoundedPromptContext({ ...state, locale: 'ru' });
  return `${identityBlock}${BASE}\n\n${hint}${bounded.promptSuffix}\nСессия: ${state.session_id || ''}`;
}

module.exports = { laneSystemPrompt, BASE, LANE_HINTS, FIRST_CONTACT_POLICY };
